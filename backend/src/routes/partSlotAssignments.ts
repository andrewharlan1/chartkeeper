import { Router, Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { dz } from '../db';
import { partSlotAssignments, parts, versions, charts, instrumentSlots } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';

export const partSlotAssignmentsRouter = Router();
partSlotAssignmentsRouter.use(requireAuth);

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

/** Resolve a part to its ensemble for auth. */
async function getPartEnsembleId(partId: string): Promise<string | null> {
  const rows = await dz.select({ ensembleId: charts.ensembleId })
    .from(parts)
    .innerJoin(versions, eq(versions.id, parts.versionId))
    .innerJoin(charts, eq(charts.id, versions.chartId))
    .where(and(eq(parts.id, partId), isNull(parts.deletedAt)));
  return rows[0]?.ensembleId ?? null;
}

// GET /parts/:partId/slots — list slot assignments for a part
partSlotAssignmentsRouter.get('/:partId/slots', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsembleId(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select({
    id: partSlotAssignments.id,
    partId: partSlotAssignments.partId,
    instrumentSlotId: partSlotAssignments.instrumentSlotId,
    slotName: instrumentSlots.name,
    slotSection: instrumentSlots.section,
    createdAt: partSlotAssignments.createdAt,
  })
    .from(partSlotAssignments)
    .innerJoin(instrumentSlots, eq(instrumentSlots.id, partSlotAssignments.instrumentSlotId))
    .where(eq(partSlotAssignments.partId, req.params.partId));

  res.json({ assignments: rows });
});

// POST /parts/:partId/slots/:slotId — assign a part to a slot
partSlotAssignmentsRouter.post('/:partId/slots/:slotId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsembleId(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Verify the slot belongs to the same ensemble
  const [slot] = await dz.select({ ensembleId: instrumentSlots.ensembleId })
    .from(instrumentSlots)
    .where(and(eq(instrumentSlots.id, req.params.slotId), isNull(instrumentSlots.deletedAt)));
  if (!slot || slot.ensembleId !== ensembleId) {
    res.status(400).json({ error: 'Instrument slot not found in this ensemble' });
    return;
  }

  try {
    const [assignment] = await dz.insert(partSlotAssignments).values({
      partId: req.params.partId,
      instrumentSlotId: req.params.slotId,
    }).returning();

    res.status(201).json({ assignment });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Part is already assigned to this slot' });
      return;
    }
    throw err;
  }
});

// DELETE /parts/:partId/slots/:slotId — unassign a part from a slot
partSlotAssignmentsRouter.delete('/:partId/slots/:slotId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getPartEnsembleId(req.params.partId);
  if (!ensembleId) { res.status(404).json({ error: 'Part not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const deleted = await dz.delete(partSlotAssignments)
    .where(and(
      eq(partSlotAssignments.partId, req.params.partId),
      eq(partSlotAssignments.instrumentSlotId, req.params.slotId),
    ))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }

  res.json({ deleted: true });
});
