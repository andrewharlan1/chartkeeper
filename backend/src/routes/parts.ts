import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember } from '../lib/ensembleAuth';
import { s3, BUCKET } from '../lib/s3';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const partsRouter = Router();

partsRouter.use(requireAuth);

// ── Player router (mounted at /player) ───────────────────────────────────────

export const playerRouter = Router();

playerRouter.use(requireAuth);

// GET /player/parts — all parts assigned to the current user (from active versions)
playerRouter.get('/parts', async (req: Request, res: Response): Promise<void> => {
  const result = await db.query(
    `SELECT
       a.id AS assignment_id,
       c.id AS chart_id, c.title AS chart_title,
       e.id AS ensemble_id, e.name AS ensemble_name,
       a.instrument_name,
       p.id AS part_id, p.part_type, p.omr_status, p.url,
       cv.id AS version_id, cv.version_number, cv.version_name
     FROM chart_part_assignments a
     JOIN charts c ON c.id = a.chart_id AND c.deleted_at IS NULL
     JOIN ensembles e ON e.id = c.ensemble_id
     JOIN chart_versions cv ON cv.chart_id = c.id AND cv.is_active = true AND cv.deleted_at IS NULL
     LEFT JOIN parts p ON p.chart_version_id = cv.id
                       AND p.instrument_name = a.instrument_name
                       AND p.deleted_at IS NULL
     WHERE a.user_id = $1
     ORDER BY e.name, c.title, a.instrument_name`,
    [req.user!.id]
  );

  const parts = result.rows.map(row => ({
    ...row,
    pdf_url: row.part_id && row.part_type !== 'link' ? `/parts/${row.part_id}/pdf` : null,
  }));

  res.json({ parts });
});

function isHttpError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

async function getPartWithEnsemble(partId: string): Promise<{
  id: string;
  chart_version_id: string;
  instrument_name: string;
  pdf_s3_key: string;
  musicxml_s3_key: string | null;
  omr_status: string;
  omr_json: unknown;
  created_at: string;
  ensemble_id: string;
  chart_id: string;
  inherited_from_part_id: string | null;
} | null> {
  const result = await db.query(
    `SELECT p.id, p.chart_version_id, p.instrument_name, p.pdf_s3_key,
            p.musicxml_s3_key, p.omr_status, p.omr_json, p.created_at,
            p.inherited_from_part_id,
            c.ensemble_id, c.id AS chart_id
     FROM parts p
     JOIN chart_versions cv ON cv.id = p.chart_version_id
     JOIN charts c ON c.id = cv.chart_id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [partId]
  );
  return result.rows[0] ?? null;
}

// GET /parts/:id
partsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) {
    res.status(404).json({ error: 'Part not found' });
    return;
  }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  const { omr_json: _, ensemble_id: __, chart_id: ___, ...safePart } = part;
  // pdfUrl points to our own proxy endpoint — no CORS issues, auth enforced
  res.json({ part: { ...safePart, pdfUrl: `/parts/${part.id}/pdf` } });
});

// GET /parts/:id/diff
partsRouter.get('/:id/diff', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) {
    res.status(404).json({ error: 'Part not found' });
    return;
  }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  // Find the version diff where this part's version is the "to" side
  const diffRow = await db.query<{ diff_json: Record<string, unknown> }>(
    `SELECT vd.diff_json
     FROM version_diffs vd
     WHERE vd.to_version_id = $1`,
    [part.chart_version_id]
  );

  if (!diffRow.rows[0]) {
    // Diff not yet available (OMR pending, or first version)
    res.json({ diff: null });
    return;
  }

  const diffJson = diffRow.rows[0].diff_json as {
    parts: Record<string, unknown>;
  };

  const partDiff = diffJson.parts?.[part.instrument_name] ?? null;
  res.json({ diff: partDiff });
});

// GET /parts/:id/measure-layout — returns per-measure bounding boxes from omr_json
partsRouter.get('/:id/measure-layout', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  interface OmrMeasureRow { number: number; bounds?: { x: number; y: number; w: number; h: number; page: number }; multiRestCount?: number }
  const omrJson = part.omr_json as { measures?: OmrMeasureRow[] } | null;
  if (!omrJson?.measures) {
    res.json({ measureLayout: [] });
    return;
  }

  const measureLayout = omrJson.measures
    .filter((m) => m.bounds)
    .map((m) => ({
      measureNumber: m.number,
      ...m.bounds!,
      ...(m.multiRestCount ? { multiRestCount: m.multiRestCount } : {}),
    }));

  res.json({ measureLayout });
});

// POST /parts/:id/detect-measure — use Claude Vision to detect measure number from a PDF page image
partsRouter.post('/:id/detect-measure', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  if (!anthropic) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  const { imageBase64, cx, cy } = req.body as { imageBase64?: string; cx?: number; cy?: number };
  if (!imageBase64) {
    res.status(400).json({ error: 'imageBase64 required' });
    return;
  }

  // Strip data URL prefix if present
  const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

  // Build a location hint so Claude knows exactly where to look
  const xPct = cx != null ? Math.round(cx * 100) : 50;
  const yPct = cy != null ? Math.round(cy * 100) : 50;
  const hPos = xPct < 33 ? 'left third' : xPct < 67 ? 'middle' : 'right third';
  const vPos = yPct < 33 ? 'top third' : yPct < 67 ? 'middle' : 'bottom third';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Data },
          },
          {
            type: 'text',
            text: `This is a page from a music score. A red circle marks a specific location in the ${vPos} of the page, ${hPos} horizontally (approximately ${xPct}% from left, ${yPct}% from top). What is the measure number of the bar containing or nearest to the red circle? Measure numbers are small integers printed above the staff, usually at the start of each system or every few bars. Respond with ONLY the integer (e.g. "42"). If you truly cannot determine it, respond with "0".`,
          },
        ],
      }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    const measureNumber = parseInt(raw.replace(/\D/g, ''), 10) || 0;
    res.json({ measureNumber });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[detect-measure] Claude API error:', msg);
    res.status(500).json({ error: msg });
  }
});

// DELETE /parts/:id  (owner or editor, hard delete from DB + S3)
partsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) {
    res.status(404).json({ error: 'Part not found' });
    return;
  }

  let role: string | null = null;
  try {
    role = await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  if (role !== 'owner' && role !== 'editor') {
    res.status(403).json({ error: 'Only owners and editors can delete parts' });
    return;
  }

  // For native (non-inherited) parts, clean up S3 objects
  if (!part.inherited_from_part_id) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: part.pdf_s3_key }));
    if (part.musicxml_s3_key) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: part.musicxml_s3_key }));
    }
  }

  // Soft delete — removes from this version's view only
  await db.query(`UPDATE parts SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ deleted: true });
});

// GET /parts/:id/pdf  — proxies PDF from S3 through the backend (avoids CORS)
partsRouter.get('/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).end(); return; }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: part.pdf_s3_key });
    const s3Res = await s3.send(command);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${part.instrument_name}.pdf"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err) {
    console.error(`[pdf] S3 error:`, err);
    res.status(500).end();
  }
});

// GET /parts/:id/debug-pdf  — serves the annotated PDF with measure bounding boxes
partsRouter.get('/:id/debug-pdf', async (req: Request, res: Response): Promise<void> => {
  const part = await getPartWithEnsemble(req.params.id);
  if (!part) { res.status(404).end(); return; }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  // The annotated PDF is stored alongside the original with _measures suffix
  const debugKey = part.pdf_s3_key?.replace(/\.pdf$/i, '_measures.pdf');
  if (!debugKey) { res.status(404).json({ error: 'No PDF key for this part' }); return; }

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: debugKey });
    const s3Res = await s3.send(command);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${part.instrument_name}_measures.pdf"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: 'Annotated PDF not yet generated. OMR may still be processing.' });
    } else {
      console.error(`[debug-pdf] S3 error:`, err);
      res.status(500).end();
    }
  }
});
