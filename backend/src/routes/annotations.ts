import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember } from '../lib/ensembleAuth';

export const annotationsRouter = Router();
annotationsRouter.use(requireAuth);

function isHttpError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

async function getPartEnsemble(partId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT c.ensemble_id
     FROM parts p
     JOIN chart_versions cv ON cv.id = p.chart_version_id
     JOIN charts c ON c.id = cv.chart_id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [partId]
  );
  return result.rows[0]?.ensemble_id ?? null;
}

// GET /parts/:partId/annotations
annotationsRouter.get('/:partId/annotations', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsemble(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try { await requireMember(ensembleId, req.user!.id); }
  catch (err) { if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; } throw err; }

  const result = await db.query(
    `SELECT a.id, a.part_id, a.user_id, a.anchor_type, a.anchor_json,
            a.content_type, a.content_json, a.is_unresolved,
            a.migrated_from_annotation_id, a.created_at, a.updated_at,
            u.name AS user_name
     FROM annotations a
     JOIN users u ON u.id = a.user_id
     WHERE a.part_id = $1 AND a.deleted_at IS NULL
     ORDER BY COALESCE((a.anchor_json->>'page')::int, (a.anchor_json->>'measureNumber')::int) NULLS LAST, a.created_at`,
    [req.params.partId]
  );
  res.json({ annotations: result.rows });
});

const anchorSchema = z.union([
  z.object({ measureNumber: z.number().int().positive(), pageHint: z.number().int().positive().optional() }),
  z.object({ measureNumber: z.number().int().positive(), beat: z.number(), pageHint: z.number().int().positive().optional() }),
  z.object({ measureNumber: z.number().int().positive(), beat: z.number(), pitch: z.string(), duration: z.string() }),
  z.object({ sectionLabel: z.string(), measureOffset: z.number().int().nonnegative().optional() }),
  z.object({ page: z.number().int().positive(), measureHint: z.number().int().positive().optional() }),
]);

// POST /parts/:partId/annotations
annotationsRouter.post('/:partId/annotations', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsemble(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try { await requireMember(ensembleId, req.user!.id); }
  catch (err) { if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; } throw err; }

  const parsed = z.object({
    anchorType: z.enum(['measure', 'beat', 'note', 'section', 'page']),
    anchorJson: anchorSchema,
    contentType: z.enum(['text', 'ink', 'highlight']),
    contentJson: z.record(z.unknown()),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { anchorType, anchorJson, contentType, contentJson } = parsed.data;
  const result = await db.query(
    `INSERT INTO annotations (part_id, user_id, anchor_type, anchor_json, content_type, content_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, part_id, user_id, anchor_type, anchor_json, content_type, content_json,
               is_unresolved, created_at, updated_at`,
    [req.params.partId, req.user!.id, anchorType, JSON.stringify(anchorJson), contentType, JSON.stringify(contentJson)]
  );
  const u = await db.query(`SELECT name FROM users WHERE id = $1`, [req.user!.id]);
  res.status(201).json({ annotation: { ...result.rows[0], user_name: u.rows[0].name } });
});

// PATCH /annotations/:id
annotationsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const existing = await db.query(
    `SELECT a.part_id, a.user_id, c.ensemble_id
     FROM annotations a
     JOIN parts p ON p.id = a.part_id
     JOIN chart_versions cv ON cv.id = p.chart_version_id
     JOIN charts c ON c.id = cv.chart_id
     WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!existing.rows[0]) { res.status(404).json({ error: 'Annotation not found' }); return; }
  if (existing.rows[0].user_id !== req.user!.id) { res.status(403).json({ error: 'You can only edit your own annotations' }); return; }

  const parsed = z.object({ contentJson: z.record(z.unknown()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const result = await db.query(
    `UPDATE annotations SET content_json = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, content_type, content_json, updated_at`,
    [JSON.stringify(parsed.data.contentJson), req.params.id]
  );
  res.json({ annotation: result.rows[0] });
});

// DELETE /annotations/:id  (soft delete, own annotations only)
annotationsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const existing = await db.query(
    `SELECT user_id FROM annotations WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!existing.rows[0]) { res.status(404).json({ error: 'Annotation not found' }); return; }
  if (existing.rows[0].user_id !== req.user!.id) { res.status(403).json({ error: 'You can only delete your own annotations' }); return; }

  await db.query(`UPDATE annotations SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ deleted: true });
});
