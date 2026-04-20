import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { dz } from '../db';
import { annotations, parts, versions, charts, users } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember } from '../lib/ensembleAuth';
import {
  inkContentSchema,
  textContentSchema,
  highlightContentSchema,
} from '../schemas/annotation-content';

export const annotationsRouter = Router();
annotationsRouter.use(requireAuth);

function isHttpError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

/** Resolve a part to its ensemble for auth (part → version → chart → ensemble). */
async function getPartEnsembleId(partId: string): Promise<string | null> {
  const rows = await dz.select({ ensembleId: charts.ensembleId })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(eq(parts.id, partId), isNull(parts.deletedAt)));
  return rows[0]?.ensembleId ?? null;
}

// GET /parts/:partId/annotations
annotationsRouter.get('/:partId/annotations', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsembleId(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  const rows = await dz.select({
    id: annotations.id,
    partId: annotations.partId,
    ownerUserId: annotations.ownerUserId,
    anchorType: annotations.anchorType,
    anchorJson: annotations.anchorJson,
    kind: annotations.kind,
    contentJson: annotations.contentJson,
    scope: annotations.scope,
    layerId: annotations.layerId,
    migratedFromAnnotationId: annotations.migratedFromAnnotationId,
    createdAt: annotations.createdAt,
    updatedAt: annotations.updatedAt,
    ownerName: users.displayName,
  })
    .from(annotations)
    .innerJoin(users, eq(users.id, annotations.ownerUserId))
    .where(and(eq(annotations.partId, req.params.partId), isNull(annotations.deletedAt)))
    .orderBy(asc(annotations.createdAt));

  res.json({ annotations: rows });
});

// Order: most-specific first so z.union's first-match + strip() doesn't swallow fields.
const anchorSchema = z.union([
  z.object({ measureNumber: z.number().int().positive(), beat: z.number(), pitch: z.string(), duration: z.string() }),
  z.object({ measureNumber: z.number().int().positive(), beat: z.number(), pageHint: z.number().int().positive().optional() }),
  z.object({ measureNumber: z.number().int().positive(), pageHint: z.number().int().positive().optional() }),
  z.object({ sectionLabel: z.string(), measureOffset: z.number().int().nonnegative().optional() }),
  z.object({ page: z.number().int().positive(), measureHint: z.number().int().positive().optional() }),
]);

// POST /parts/:partId/annotations
annotationsRouter.post('/:partId/annotations', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsembleId(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    if (isHttpError(err)) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }

  const parsed = z.object({
    anchorType: z.enum(['measure', 'beat', 'note', 'section', 'page']),
    anchorJson: anchorSchema,
    kind: z.enum(['ink', 'text', 'highlight']),
    contentJson: z.record(z.unknown()),
    layerId: z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { anchorType, anchorJson, kind, contentJson, layerId } = parsed.data;

  // Validate content against the kind-specific schema
  const contentSchemas = { ink: inkContentSchema, text: textContentSchema, highlight: highlightContentSchema } as const;
  const contentResult = contentSchemas[kind].safeParse(contentJson);
  if (!contentResult.success) {
    res.status(400).json({ error: contentResult.error.flatten() });
    return;
  }

  const [ann] = await dz.insert(annotations).values({
    partId: req.params.partId,
    ownerUserId: req.user!.id,
    anchorType,
    anchorJson,
    kind,
    contentJson: contentResult.data,
    ...(layerId ? { layerId } : {}),
  }).returning();

  const [user] = await dz.select({ displayName: users.displayName })
    .from(users).where(eq(users.id, req.user!.id));

  res.status(201).json({ annotation: { ...ann, ownerName: user.displayName } });
});

// PATCH /annotations/:id
annotationsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const [existing] = await dz.select({
    partId: annotations.partId,
    ownerUserId: annotations.ownerUserId,
    ensembleId: charts.ensembleId,
  })
    .from(annotations)
    .innerJoin(parts, eq(parts.id, annotations.partId))
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(eq(annotations.id, req.params.id), isNull(annotations.deletedAt)));

  if (!existing) { res.status(404).json({ error: 'Annotation not found' }); return; }
  if (existing.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: 'You can only edit your own annotations' });
    return;
  }

  const parsed = z.object({
    contentJson: z.record(z.unknown()).optional(),
    anchorJson: anchorSchema.optional(),
    layerId: z.string().uuid().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.contentJson !== undefined) updates.contentJson = parsed.data.contentJson;
  if (parsed.data.anchorJson !== undefined) updates.anchorJson = parsed.data.anchorJson;
  if (parsed.data.layerId !== undefined) updates.layerId = parsed.data.layerId;

  const [updated] = await dz.update(annotations)
    .set(updates)
    .where(eq(annotations.id, req.params.id))
    .returning();

  res.json({ annotation: updated });
});

// DELETE /annotations/:id (soft delete, own annotations only)
annotationsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const [existing] = await dz.select({ ownerUserId: annotations.ownerUserId })
    .from(annotations)
    .where(and(eq(annotations.id, req.params.id), isNull(annotations.deletedAt)));

  if (!existing) { res.status(404).json({ error: 'Annotation not found' }); return; }
  if (existing.ownerUserId !== req.user!.id) {
    res.status(403).json({ error: 'You can only delete your own annotations' });
    return;
  }

  await dz.update(annotations)
    .set({ deletedAt: new Date() })
    .where(eq(annotations.id, req.params.id));

  res.json({ deleted: true });
});
