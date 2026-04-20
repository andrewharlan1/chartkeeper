import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { versions, charts, parts } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';
import { getChartEnsembleId } from './charts';

export const versionsRouter = Router();
versionsRouter.use(requireAuth);

function isHttpError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

function handleError(err: unknown, res: Response): void {
  if (isHttpError(err)) {
    res.status(err.status).json({ error: err.message });
  } else {
    throw err;
  }
}

/** Resolve a version to its ensemble for auth. */
async function getVersionEnsembleId(versionId: string): Promise<string | null> {
  const rows = await dz.select({ ensembleId: charts.ensembleId })
    .from(versions)
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(eq(versions.id, versionId), isNull(versions.deletedAt)));
  return rows[0]?.ensembleId ?? null;
}

// GET /versions?chartId=...
versionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const chartId = req.query.chartId as string | undefined;
  if (!chartId) {
    res.status(400).json({ error: 'chartId query parameter is required' });
    return;
  }

  const ensembleId = await getChartEnsembleId(chartId);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select()
    .from(versions)
    .where(and(eq(versions.chartId, chartId), isNull(versions.deletedAt)))
    .orderBy(versions.sortOrder);

  res.json({ versions: rows });
});

// POST /versions
versionsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    chartId: z.string().uuid(),
    name: z.string().min(1),
    notes: z.string().optional(),
    seededFromVersionId: z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const ensembleId = await getChartEnsembleId(parsed.data.chartId);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [{ next }] = await dz.select({
    next: sql<number>`coalesce(max(${versions.sortOrder}), -1) + 1`,
  }).from(versions).where(eq(versions.chartId, parsed.data.chartId));

  const [ver] = await dz.insert(versions).values({
    chartId: parsed.data.chartId,
    name: parsed.data.name,
    notes: parsed.data.notes ?? null,
    seededFromVersionId: parsed.data.seededFromVersionId ?? null,
    sortOrder: Number(next),
  }).returning();

  res.status(201).json({ version: ver });
});

// GET /versions/:id
versionsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const [ver] = await dz.select().from(versions)
    .where(and(eq(versions.id, req.params.id), isNull(versions.deletedAt)));
  if (!ver) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const ensembleId = await getVersionEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
    .from(parts)
    .where(and(eq(parts.versionId, ver.id), isNull(parts.deletedAt)));

  res.json({ version: { ...ver, partCount: Number(count) } });
});

// PATCH /versions/:id
versionsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getVersionEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  const [updated] = await dz.update(versions)
    .set(updates)
    .where(eq(versions.id, req.params.id))
    .returning();

  res.json({ version: updated });
});

// DELETE /versions/:id (soft delete)
versionsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getVersionEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(versions)
    .set({ deletedAt: new Date() })
    .where(eq(versions.id, req.params.id));

  res.json({ deleted: true });
});
