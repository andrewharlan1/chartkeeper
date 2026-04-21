import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { charts, ensembles, versions, parts, annotations, partSlotAssignments } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';

export const chartsRouter = Router();
chartsRouter.use(requireAuth);

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

/** Look up a chart's ensembleId for auth. Returns null if not found. */
export async function getChartEnsembleId(chartId: string): Promise<string | null> {
  const [row] = await dz.select({ ensembleId: charts.ensembleId })
    .from(charts)
    .where(and(eq(charts.id, chartId), isNull(charts.deletedAt)));
  return row?.ensembleId ?? null;
}

// GET /charts?ensembleId=...
chartsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = req.query.ensembleId as string | undefined;
  if (!ensembleId) {
    res.status(400).json({ error: 'ensembleId query parameter is required' });
    return;
  }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select()
    .from(charts)
    .where(and(eq(charts.ensembleId, ensembleId), isNull(charts.deletedAt)))
    .orderBy(charts.sortOrder, charts.createdAt);

  res.json({ charts: rows });
});

// POST /charts
chartsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ensembleId: z.string().uuid(),
    name: z.string().min(1),
    composer: z.string().optional(),
    notes: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await requireEnsembleAdmin(parsed.data.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [{ next }] = await dz.select({
    next: sql<number>`coalesce(max(${charts.sortOrder}), -1) + 1`,
  }).from(charts).where(eq(charts.ensembleId, parsed.data.ensembleId));

  const [chart] = await dz.insert(charts).values({
    ensembleId: parsed.data.ensembleId,
    name: parsed.data.name,
    composer: parsed.data.composer ?? null,
    notes: parsed.data.notes ?? null,
    sortOrder: Number(next),
  }).returning();

  res.status(201).json({ chart });
});

// GET /charts/:id
chartsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getChartEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [chart] = await dz.select().from(charts)
    .where(and(eq(charts.id, req.params.id), isNull(charts.deletedAt)));
  if (!chart) { res.status(404).json({ error: 'Chart not found' }); return; }

  res.json({ chart });
});

// PATCH /charts/:id
chartsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getChartEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1).optional(),
    composer: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.composer !== undefined) updates.composer = parsed.data.composer;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

  const [updated] = await dz.update(charts)
    .set(updates)
    .where(eq(charts.id, req.params.id))
    .returning();

  res.json({ chart: updated });
});

// DELETE /charts/:id (soft delete)
chartsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getChartEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(charts)
    .set({ deletedAt: new Date() })
    .where(eq(charts.id, req.params.id));

  res.json({ deleted: true });
});

// GET /charts/:id/annotation-sources
// Returns all parts across all versions of this chart that have annotations,
// grouped by version, with their instrument slot assignments.
chartsRouter.get('/:id/annotation-sources', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getChartEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Get all versions for this chart
  const versionRows = await dz.select({
    id: versions.id,
    name: versions.name,
    sortOrder: versions.sortOrder,
  })
    .from(versions)
    .where(and(eq(versions.chartId, req.params.id), isNull(versions.deletedAt)))
    .orderBy(versions.sortOrder);

  // Get all parts across all versions with annotation counts
  const partRows = await dz.select({
    id: parts.id,
    name: parts.name,
    kind: parts.kind,
    versionId: parts.versionId,
    annotationCount: sql<number>`(
      select count(*) from annotations
      where annotations.part_id = ${parts.id}
      and annotations.deleted_at is null
    )`,
  })
    .from(parts)
    .where(and(
      sql`${parts.versionId} in (select id from versions where chart_id = ${req.params.id} and deleted_at is null)`,
      isNull(parts.deletedAt),
    ));

  // Get slot assignments for annotated parts
  const annotatedParts = partRows.filter(p => Number(p.annotationCount) > 0);
  const slotMap: Record<string, string[]> = {};

  if (annotatedParts.length > 0) {
    const slotRows = await dz.select({
      partId: partSlotAssignments.partId,
      slotId: partSlotAssignments.instrumentSlotId,
    })
      .from(partSlotAssignments)
      .where(sql`${partSlotAssignments.partId} in (${sql.join(annotatedParts.map(p => sql`${p.id}`), sql`, `)})`);

    for (const row of slotRows) {
      if (!slotMap[row.partId]) slotMap[row.partId] = [];
      slotMap[row.partId].push(row.slotId);
    }
  }

  // Build response grouped by version
  const versionMap = new Map(versionRows.map(v => [v.id, v]));
  const sources = versionRows.map(v => ({
    versionId: v.id,
    versionName: v.name,
    sortOrder: v.sortOrder,
    parts: annotatedParts
      .filter(p => p.versionId === v.id)
      .map(p => ({
        partId: p.id,
        partName: p.name,
        kind: p.kind,
        annotationCount: Number(p.annotationCount),
        slotIds: slotMap[p.id] ?? [],
      })),
  })).filter(v => v.parts.length > 0);

  // Most recent version first
  sources.sort((a, b) => b.sortOrder - a.sortOrder);

  res.json({ sources });
});
