import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { dz } from '../db';
import {
  charts, ensembles, versions, parts, annotations,
  partSlotAssignments, instrumentSlots, instrumentSlotAssignments, users, versionDiffs,
} from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin, getWorkspaceRole } from '../lib/ensembleAuth';

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

// GET /charts/:id/migration-sources
// Returns all versions with their parts, annotation counts, and annotation previews
// grouped by version, for the migration dialogue on the chart page.
chartsRouter.get('/:id/migration-sources', async (req: Request, res: Response): Promise<void> => {
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
    createdAt: versions.createdAt,
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

  // Get slot assignments for all parts
  const allPartIds = partRows.map(p => p.id);
  const slotAssignmentRows = allPartIds.length > 0
    ? await dz.select({
        partId: partSlotAssignments.partId,
        slotId: partSlotAssignments.instrumentSlotId,
        slotName: instrumentSlots.name,
      })
        .from(partSlotAssignments)
        .innerJoin(instrumentSlots, eq(instrumentSlots.id, partSlotAssignments.instrumentSlotId))
        .where(sql`${partSlotAssignments.partId} in (${sql.join(allPartIds.map(id => sql`${id}`), sql`, `)})`)
    : [];

  const slotMap: Record<string, { slotId: string; slotName: string }[]> = {};
  for (const row of slotAssignmentRows) {
    if (!slotMap[row.partId]) slotMap[row.partId] = [];
    slotMap[row.partId].push({ slotId: row.slotId, slotName: row.slotName });
  }

  // Get annotation previews (first 3) for parts that have annotations
  const annotatedParts = partRows.filter(p => Number(p.annotationCount) > 0);
  const previewMap: Record<string, Array<{ measureNumber: number | null; kind: string; content?: string }>> = {};

  if (annotatedParts.length > 0) {
    const previewRows = await dz.select({
      id: annotations.id,
      partId: annotations.partId,
      anchorJson: annotations.anchorJson,
      kind: annotations.kind,
      contentJson: annotations.contentJson,
    })
      .from(annotations)
      .where(and(
        sql`${annotations.partId} in (${sql.join(annotatedParts.map(p => sql`${p.id}`), sql`, `)})`,
        isNull(annotations.deletedAt),
      ));

    for (const row of previewRows) {
      if (!previewMap[row.partId]) previewMap[row.partId] = [];
      const anchor = row.anchorJson as { measureNumber?: number } | null;
      const content = row.contentJson as { text?: string } | null;
      previewMap[row.partId].push({
        measureNumber: anchor?.measureNumber ?? null,
        kind: row.kind,
        content: content?.text,
      });
    }
    // Keep only first 3 per part
    for (const partId of Object.keys(previewMap)) {
      previewMap[partId] = previewMap[partId].slice(0, 3);
    }
  }

  // Build response grouped by version
  const result = versionRows.map(v => ({
    versionId: v.id,
    versionName: v.name,
    createdAt: v.createdAt,
    parts: partRows
      .filter(p => p.versionId === v.id)
      .map(p => ({
        partId: p.id,
        instrumentName: p.name,
        instrumentIcon: slotMap[p.id]?.[0]?.slotName ?? p.name,
        annotationCount: Number(p.annotationCount),
        annotationPreview: previewMap[p.id] ?? [],
      })),
  }));

  // Most recent version first
  result.sort((a, b) => {
    const ai = versionRows.findIndex(v => v.id === a.versionId);
    const bi = versionRows.findIndex(v => v.id === b.versionId);
    return bi - ai;
  });

  res.json({ versions: result });
});

// GET /charts/:id/versions/:vId/instruments
// Returns the instrument-centric view of a chart version.
// Each instrument slot in the ensemble gets a row with its assigned users,
// current version parts, and fallback parts from previous versions.
chartsRouter.get('/:id/versions/:vId/instruments', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getChartEnsembleId(req.params.id);
  if (!ensembleId) { res.status(404).json({ error: 'Chart not found' }); return; }

  let userRole: string;
  try {
    userRole = await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [chart] = await dz.select().from(charts)
    .where(and(eq(charts.id, req.params.id), isNull(charts.deletedAt)));
  if (!chart) { res.status(404).json({ error: 'Chart not found' }); return; }

  const [version] = await dz.select().from(versions)
    .where(and(eq(versions.id, req.params.vId), isNull(versions.deletedAt)));
  if (!version) { res.status(404).json({ error: 'Version not found' }); return; }

  // All instrument slots for the ensemble
  const allSlots = await dz.select()
    .from(instrumentSlots)
    .where(and(eq(instrumentSlots.ensembleId, ensembleId), isNull(instrumentSlots.deletedAt)))
    .orderBy(instrumentSlots.sortOrder);

  // All slot assignments (users → slots)
  const slotUserRows = await dz.select({
    slotId: instrumentSlotAssignments.slotId,
    userId: users.id,
    name: users.displayName,
    isDummy: users.isDummy,
  })
    .from(instrumentSlotAssignments)
    .innerJoin(users, eq(users.id, instrumentSlotAssignments.userId))
    .innerJoin(instrumentSlots, eq(instrumentSlots.id, instrumentSlotAssignments.slotId))
    .where(and(eq(instrumentSlots.ensembleId, ensembleId), isNull(instrumentSlots.deletedAt)));

  const slotUsersMap: Record<string, Array<{ userId: string; name: string | null; isDummy: boolean }>> = {};
  for (const r of slotUserRows) {
    (slotUsersMap[r.slotId] ??= []).push({ userId: r.userId, name: r.name, isDummy: r.isDummy });
  }

  // All parts for the current version
  const currentParts = await dz.select({
    id: parts.id, name: parts.name, kind: parts.kind,
    pdfS3Key: parts.pdfS3Key, omrStatus: parts.omrStatus,
    linkUrl: parts.linkUrl,
  })
    .from(parts)
    .where(and(eq(parts.versionId, req.params.vId), isNull(parts.deletedAt)));

  // Annotation counts for current parts
  const annCountRows = currentParts.length > 0
    ? await dz.select({
        partId: annotations.partId,
        count: sql<number>`count(*)`,
      })
        .from(annotations)
        .where(and(
          sql`${annotations.partId} in (${sql.join(currentParts.map(p => sql`${p.id}`), sql`, `)})`,
          isNull(annotations.deletedAt),
        ))
        .groupBy(annotations.partId)
    : [];
  const annCountMap: Record<string, number> = {};
  for (const r of annCountRows) annCountMap[r.partId] = Number(r.count);

  // Part→slot mapping for current parts
  const psa = currentParts.length > 0
    ? await dz.select({ partId: partSlotAssignments.partId, slotId: partSlotAssignments.instrumentSlotId })
        .from(partSlotAssignments)
        .where(sql`${partSlotAssignments.partId} in (${sql.join(currentParts.map(p => sql`${p.id}`), sql`, `)})`)
    : [];
  const partToSlots: Record<string, string[]> = {};
  const slotToParts: Record<string, string[]> = {};
  for (const r of psa) {
    (partToSlots[r.partId] ??= []).push(r.slotId);
    (slotToParts[r.slotId] ??= []).push(r.partId);
  }

  // Diff data for current parts — now keyed by (partId, slotId) for per-instrument diffs
  const diffRows = currentParts.length > 0
    ? await dz.select({
        toPartId: versionDiffs.toPartId,
        slotId: versionDiffs.slotId,
        fromPartId: versionDiffs.fromPartId,
        diffJson: versionDiffs.diffJson,
      })
        .from(versionDiffs)
        .where(sql`${versionDiffs.toPartId} in (${sql.join(currentParts.map(p => sql`${p.id}`), sql`, `)})`)
    : [];

  // Get source version names for diff display
  const diffFromPartIds = [...new Set(diffRows.map(r => r.fromPartId))];
  const diffSourceVersionMap: Record<string, string> = {};
  if (diffFromPartIds.length > 0) {
    const sourceRows = await dz.select({ partId: parts.id, versionName: versions.name })
      .from(parts)
      .innerJoin(versions, eq(versions.id, parts.versionId))
      .where(sql`${parts.id} in (${sql.join(diffFromPartIds.map(id => sql`${id}`), sql`, `)})`);
    for (const r of sourceRows) diffSourceVersionMap[r.partId] = r.versionName;
  }

  // Keyed by "partId:slotId" for slot-specific lookups, and "partId" for aggregate
  const slotDiffMap: Record<string, { changedMeasureCount: number; sourceVersionName: string }> = {};
  const partDiffMap: Record<string, { changedMeasureCount: number; sourceVersionName: string; hasChangelog: boolean }> = {};
  for (const r of diffRows) {
    const d = r.diffJson as { changedMeasures?: number[]; changeDescriptions?: Record<string, string> };
    const count = d.changedMeasures?.length ?? 0;
    const sourceVersionName = diffSourceVersionMap[r.fromPartId] || '';
    const hasChangelog = Object.keys(d.changeDescriptions ?? {}).length > 0;
    const slotKey = `${r.toPartId}:${r.slotId ?? 'score'}`;
    slotDiffMap[slotKey] = { changedMeasureCount: count, sourceVersionName };
    // Aggregate: keep highest count for the part
    const existing = partDiffMap[r.toPartId];
    if (!existing || count > existing.changedMeasureCount) {
      partDiffMap[r.toPartId] = { changedMeasureCount: count, sourceVersionName, hasChangelog };
    }
  }

  // Previous version parts (for fallback state B)
  const previousVersions = await dz.select({ id: versions.id, name: versions.name })
    .from(versions)
    .where(and(
      eq(versions.chartId, req.params.id),
      isNull(versions.deletedAt),
      sql`${versions.sortOrder} < ${version.sortOrder}`,
    ))
    .orderBy(desc(versions.sortOrder));

  let prevPartsBySlot: Record<string, Array<{ partId: string; name: string; versionId: string; versionName: string }>> = {};
  if (previousVersions.length > 0) {
    const prevParts = await dz.select({
      id: parts.id, name: parts.name, versionId: parts.versionId,
    })
      .from(parts)
      .where(and(
        sql`${parts.versionId} in (${sql.join(previousVersions.map(v => sql`${v.id}`), sql`, `)})`,
        isNull(parts.deletedAt),
      ));

    const prevPartIds = prevParts.map(p => p.id);
    const prevPsa = prevPartIds.length > 0
      ? await dz.select({ partId: partSlotAssignments.partId, slotId: partSlotAssignments.instrumentSlotId })
          .from(partSlotAssignments)
          .where(sql`${partSlotAssignments.partId} in (${sql.join(prevPartIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const prevPartToSlots: Record<string, string[]> = {};
    for (const r of prevPsa) (prevPartToSlots[r.partId] ??= []).push(r.slotId);

    const versionNameMap = new Map(previousVersions.map(v => [v.id, v.name]));

    for (const p of prevParts) {
      const slots = prevPartToSlots[p.id] || [];
      for (const slotId of slots) {
        (prevPartsBySlot[slotId] ??= []).push({
          partId: p.id, name: p.name, versionId: p.versionId,
          versionName: versionNameMap.get(p.versionId) || '',
        });
      }
    }
    // Keep only the most recent previous version's part per slot
    for (const slotId of Object.keys(prevPartsBySlot)) {
      const sortedPrev = prevPartsBySlot[slotId].sort((a, b) => {
        const ai = previousVersions.findIndex(v => v.id === a.versionId);
        const bi = previousVersions.findIndex(v => v.id === b.versionId);
        return ai - bi; // lower index = more recent
      });
      prevPartsBySlot[slotId] = [sortedPrev[0]];
    }
  }

  // Access control: filter by user's assignments if not admin/owner
  const isAdmin = userRole === 'owner' || userRole === 'admin';
  let userSlotIds: Set<string> | null = null;
  if (!isAdmin) {
    const userAssignments = await dz.select({ slotId: instrumentSlotAssignments.slotId })
      .from(instrumentSlotAssignments)
      .where(eq(instrumentSlotAssignments.userId, req.user!.id));
    userSlotIds = new Set(userAssignments.map(a => a.slotId));
  }

  const partsById = new Map(currentParts.map(p => [p.id, p]));

  // Build instrument rows
  const instrumentRows = allSlots
    .filter(slot => {
      if (isAdmin) return true;
      return userSlotIds!.has(slot.id);
    })
    .map(slot => {
      const partIds = slotToParts[slot.id] || [];
      return {
        slotId: slot.id,
        instrumentName: slot.name,
        section: slot.section,
        sortOrder: slot.sortOrder,
        assignedUsers: slotUsersMap[slot.id] || [],
        currentParts: partIds.map(pid => {
          const p = partsById.get(pid)!;
          const slotKey = `${p.id}:${slot.id}`;
          const slotDiff = slotDiffMap[slotKey];
          return {
            partId: p.id,
            name: p.name,
            kind: p.kind,
            annotationCount: annCountMap[p.id] || 0,
            diffStatus: slotDiff ? {
              slotId: slot.id,
              sourceVersionName: slotDiff.sourceVersionName,
              changedMeasureCount: slotDiff.changedMeasureCount,
              hasChangelog: true,
            } : null,
          };
        }),
        previousVersionParts: !partIds.length ? (prevPartsBySlot[slot.id] || []) : [],
      };
    });

  // Score parts (visible to all) — parts of kind 'score' in current version
  const scoreParts = currentParts
    .filter(p => p.kind === 'score')
    .map(p => {
      const scoreDiff = partDiffMap[p.id];
      return {
        partId: p.id,
        name: p.name,
        kind: p.kind,
        annotationCount: annCountMap[p.id] || 0,
        diffStatus: scoreDiff ? {
          slotId: null as string | null,
          sourceVersionName: scoreDiff.sourceVersionName,
          changedMeasureCount: scoreDiff.changedMeasureCount,
          hasChangelog: scoreDiff.hasChangelog,
        } : null,
      };
    });

  res.json({
    chart: { id: chart.id, name: chart.name, composer: chart.composer, ensembleId },
    version: { id: version.id, name: version.name, isCurrent: version.isCurrent },
    instruments: instrumentRows,
    scoreParts,
  });
});
