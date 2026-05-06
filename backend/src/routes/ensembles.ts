import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { ensembles, workspaces, charts, versions, parts, annotations, partSlotAssignments, instrumentSlots, workspaceMembers } from '../schema';
import { requireAuth } from '../middleware/auth';
import {
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  requireEnsembleMember,
  requireEnsembleAdmin,
} from '../lib/ensembleAuth';
import { sendNotification } from '../notifications/send';

export const ensemblesRouter = Router();
ensemblesRouter.use(requireAuth);

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

// GET /ensembles?workspaceId=...  — ensembles in a workspace the user belongs to
ensemblesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const wsId = req.query.workspaceId as string | undefined;
  if (!wsId) {
    res.status(400).json({ error: 'workspaceId query parameter is required' });
    return;
  }

  try {
    await requireWorkspaceMember(wsId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select()
    .from(ensembles)
    .where(and(eq(ensembles.workspaceId, wsId), isNull(ensembles.deletedAt)))
    .orderBy(ensembles.sortOrder, ensembles.createdAt);

  res.json({ ensembles: rows });
});

// POST /ensembles
ensemblesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    workspaceId: z.string().uuid(),
    name: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await requireWorkspaceAdmin(parsed.data.workspaceId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Next sort_order
  const [{ next }] = await dz.select({ next: sql<number>`coalesce(max(${ensembles.sortOrder}), -1) + 1` })
    .from(ensembles)
    .where(eq(ensembles.workspaceId, parsed.data.workspaceId));

  const [ens] = await dz.insert(ensembles).values({
    workspaceId: parsed.data.workspaceId,
    name: parsed.data.name,
    sortOrder: Number(next),
  }).returning();

  res.status(201).json({ ensemble: ens });
});

// GET /ensembles/:id
ensemblesRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireEnsembleMember(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [ens] = await dz.select().from(ensembles)
    .where(and(eq(ensembles.id, req.params.id), isNull(ensembles.deletedAt)));
  if (!ens) {
    res.status(404).json({ error: 'Ensemble not found' });
    return;
  }
  res.json({ ensemble: ens });
});

// PATCH /ensembles/:id
ensemblesRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireEnsembleAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Capture old name for notification
  const [old] = await dz.select({ name: ensembles.name, workspaceId: ensembles.workspaceId })
    .from(ensembles).where(eq(ensembles.id, req.params.id));

  const [updated] = await dz.update(ensembles)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(ensembles.id, req.params.id))
    .returning();
  if (!updated) { res.status(404).json({ error: 'Ensemble not found' }); return; }

  res.json({ ensemble: updated });

  // Fire-and-forget: notify all workspace members about the rename
  if (old && old.name !== parsed.data.name) {
    dz.select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, old.workspaceId))
      .then(members => {
        for (const m of members) {
          if (m.userId === req.user!.id) continue; // Skip the renamer
          sendNotification(m.userId, {
            eventType: 'ensemble_renamed',
            ensembleId: req.params.id,
            payload: {
              oldName: old.name,
              newName: parsed.data.name,
              ensembleId: req.params.id,
              ensembleName: parsed.data.name,
            },
          }).catch(() => {});
        }
      }).catch(() => {});
  }
});

// DELETE /ensembles/:id (soft delete)
ensemblesRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireEnsembleAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(ensembles)
    .set({ deletedAt: new Date() })
    .where(eq(ensembles.id, req.params.id));

  res.json({ deleted: true });
});

// GET /ensembles/:id/migration-candidates?partId=...
// Returns parts in the ensemble with migratable annotation counts, for the cross-instrument migration picker.
ensemblesRouter.get('/:id/migration-candidates', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = req.params.id;
  const destPartId = req.query.partId as string | undefined;
  if (!destPartId) {
    res.status(400).json({ error: 'partId query parameter is required' });
    return;
  }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Resolve destination part's instrument slot IDs
  const destSlotRows = await dz.select({ instrumentSlotId: partSlotAssignments.instrumentSlotId })
    .from(partSlotAssignments)
    .where(eq(partSlotAssignments.partId, destPartId));
  const destSlotIds = new Set(destSlotRows.map(r => r.instrumentSlotId));

  // Get all parts in the ensemble (across all charts/versions), excluding destination
  const allParts = await dz.select({
    partId: parts.id,
    partName: parts.name,
    versionId: versions.id,
    versionName: versions.name,
    versionSortOrder: versions.sortOrder,
    chartId: charts.id,
  })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(
      eq(charts.ensembleId, ensembleId),
      isNull(parts.deletedAt),
      isNull(versions.deletedAt),
      isNull(charts.deletedAt),
    ));

  // Filter out the destination part itself
  const candidateParts = allParts.filter(p => p.partId !== destPartId);

  // Batch-load slot assignments for all candidate parts
  const candidatePartIds = candidateParts.map(p => p.partId);
  const slotAssignments = candidatePartIds.length > 0
    ? await dz.select({
        partId: partSlotAssignments.partId,
        instrumentSlotId: partSlotAssignments.instrumentSlotId,
      })
        .from(partSlotAssignments)
        .where(sql`${partSlotAssignments.partId} IN (${sql.join(candidatePartIds.map(id => sql`${id}`), sql`,`)})`)
    : [];

  // Build partId → slotIds map
  const partSlotMap = new Map<string, string[]>();
  for (const sa of slotAssignments) {
    const arr = partSlotMap.get(sa.partId) ?? [];
    arr.push(sa.instrumentSlotId);
    partSlotMap.set(sa.partId, arr);
  }

  // Count migratable annotations per part (wide-reading: no owner filter)
  const annotationCounts = candidatePartIds.length > 0
    ? await dz.select({
        partId: annotations.partId,
        count: sql<number>`count(*)`,
      })
        .from(annotations)
        .where(and(
          sql`${annotations.partId} IN (${sql.join(candidatePartIds.map(id => sql`${id}`), sql`,`)})`,
          isNull(annotations.deletedAt),
          eq(annotations.migratable, true),
        ))
        .groupBy(annotations.partId)
    : [];

  const countMap = new Map<string, number>();
  for (const row of annotationCounts) {
    countMap.set(row.partId, Number(row.count));
  }

  // Find the most recent version per chart
  const maxSortOrderPerChart = new Map<string, number>();
  for (const p of candidateParts) {
    const cur = maxSortOrderPerChart.get(p.chartId) ?? -1;
    if (p.versionSortOrder > cur) maxSortOrderPerChart.set(p.chartId, p.versionSortOrder);
  }

  // Group by part → versions
  interface VersionEntry {
    versionId: string;
    versionLabel: string;
    annotationCount: number;
    isMostRecent: boolean;
  }
  interface CandidateEntry {
    partId: string;
    partName: string;
    instrumentSlotIds: string[];
    isSameInstrument: boolean;
    versions: VersionEntry[];
  }

  // Group candidate parts by partId (a part only belongs to one version, so each entry is unique)
  const candidateMap = new Map<string, CandidateEntry>();
  for (const p of candidateParts) {
    const slotIds = partSlotMap.get(p.partId) ?? [];
    const isSameInstrument = slotIds.some(sid => destSlotIds.has(sid));
    const annCount = countMap.get(p.partId) ?? 0;
    const isMostRecent = p.versionSortOrder === maxSortOrderPerChart.get(p.chartId);

    // Group by part name + version chain to aggregate versions under one candidate
    // Key: partName to match cross-version grouping
    const key = `${p.partName}::${p.chartId}`;
    const existing = candidateMap.get(key);
    if (existing) {
      existing.versions.push({
        versionId: p.versionId,
        versionLabel: p.versionName,
        annotationCount: annCount,
        isMostRecent,
      });
      // Merge slot IDs (union)
      for (const sid of slotIds) {
        if (!existing.instrumentSlotIds.includes(sid)) existing.instrumentSlotIds.push(sid);
      }
      existing.isSameInstrument = existing.isSameInstrument || isSameInstrument;
    } else {
      candidateMap.set(key, {
        partId: p.partId,
        partName: p.partName,
        instrumentSlotIds: slotIds,
        isSameInstrument,
        versions: [{
          versionId: p.versionId,
          versionLabel: p.versionName,
          annotationCount: annCount,
          isMostRecent,
        }],
      });
    }
  }

  // Sort versions within each candidate (most recent first)
  const candidates = Array.from(candidateMap.values());
  for (const c of candidates) {
    c.versions.sort((a, b) => {
      // Most recent first
      const aRecent = a.isMostRecent ? 1 : 0;
      const bRecent = b.isMostRecent ? 1 : 0;
      return bRecent - aRecent;
    });
  }

  // Sort candidates: same instrument first, then by annotation count
  candidates.sort((a, b) => {
    if (a.isSameInstrument !== b.isSameInstrument) return a.isSameInstrument ? -1 : 1;
    const aTotal = a.versions.reduce((sum, v) => sum + v.annotationCount, 0);
    const bTotal = b.versions.reduce((sum, v) => sum + v.annotationCount, 0);
    return bTotal - aTotal;
  });

  res.json({ candidates });
});
