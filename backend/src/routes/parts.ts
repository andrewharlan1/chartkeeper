import { Router, Request, Response } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember } from '../lib/ensembleAuth';
import { getSignedDownloadUrl } from '../lib/s3';

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
} | null> {
  const result = await db.query(
    `SELECT p.id, p.chart_version_id, p.instrument_name, p.pdf_s3_key,
            p.musicxml_s3_key, p.omr_status, p.omr_json, p.created_at,
            c.ensemble_id, c.id AS chart_id
     FROM parts p
     JOIN chart_versions cv ON cv.id = p.chart_version_id
     JOIN charts c ON c.id = cv.chart_id
     WHERE p.id = $1`,
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

  const pdfUrl = await getSignedDownloadUrl(part.pdf_s3_key);
  const { omr_json: _, ensemble_id: __, chart_id: ___, ...safePart } = part;

  res.json({ part: { ...safePart, pdfUrl } });
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
