import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember } from '../lib/ensembleAuth';
import { s3, BUCKET } from '../lib/s3';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export const partsRouter = Router();

partsRouter.use(requireAuth);

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
  console.log(`[pdf] GET /parts/${req.params.id}/pdf — auth header: ${req.headers.authorization ? 'present' : 'MISSING'}`);

  const part = await getPartWithEnsemble(req.params.id);
  if (!part) {
    console.log(`[pdf] part ${req.params.id} not found`);
    res.status(404).end();
    return;
  }

  try {
    await requireMember(part.ensemble_id, req.user!.id);
  } catch (err) {
    console.log(`[pdf] auth failed:`, err);
    if (isHttpError(err)) { res.status(err.status).end(); return; }
    throw err;
  }

  console.log(`[pdf] fetching S3 key: ${part.pdf_s3_key}`);
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: part.pdf_s3_key });
    const s3Res = await s3.send(command);
    console.log(`[pdf] S3 response OK, ContentLength: ${s3Res.ContentLength}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${part.instrument_name}.pdf"`);
    if (s3Res.ContentLength) res.setHeader('Content-Length', s3Res.ContentLength);
    (s3Res.Body as Readable).pipe(res);
  } catch (err) {
    console.error(`[pdf] S3 error:`, err);
    res.status(500).end();
  }
});
