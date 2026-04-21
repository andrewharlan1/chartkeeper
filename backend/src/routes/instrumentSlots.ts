import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { instrumentSlots, instrumentSlotAssignments, users } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';

export const instrumentSlotsRouter = Router();
instrumentSlotsRouter.use(requireAuth);

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

// GET /instrument-slots/assignments/by-ensemble?ensembleId=...
// Bulk fetch all slot assignments for an ensemble (avoids N+1)
// Must be registered BEFORE /:id routes to avoid being caught by :id param
instrumentSlotsRouter.get('/assignments/by-ensemble', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = req.query.ensembleId as string | undefined;
  if (!ensembleId) { res.status(400).json({ error: 'ensembleId required' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select({
    slotId: instrumentSlotAssignments.slotId,
    userId: users.id,
    name: users.displayName,
    email: users.email,
    isDummy: users.isDummy,
  })
    .from(instrumentSlotAssignments)
    .innerJoin(users, eq(users.id, instrumentSlotAssignments.userId))
    .innerJoin(instrumentSlots, eq(instrumentSlots.id, instrumentSlotAssignments.slotId))
    .where(and(eq(instrumentSlots.ensembleId, ensembleId), isNull(instrumentSlots.deletedAt)));

  // Group by slotId
  const bySlot: Record<string, typeof rows> = {};
  for (const row of rows) {
    (bySlot[row.slotId] ??= []).push(row);
  }

  res.json({ assignments: bySlot });
});

// GET /instrument-slots?ensembleId=...
instrumentSlotsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
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
    .from(instrumentSlots)
    .where(and(eq(instrumentSlots.ensembleId, ensembleId), isNull(instrumentSlots.deletedAt)))
    .orderBy(instrumentSlots.sortOrder, instrumentSlots.createdAt);

  res.json({ instrumentSlots: rows });
});

// POST /instrument-slots
instrumentSlotsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ensembleId: z.string().uuid(),
    name: z.string().min(1).max(100),
    section: z.string().max(100).optional(),
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
    next: sql<number>`coalesce(max(${instrumentSlots.sortOrder}), -1) + 1`,
  }).from(instrumentSlots).where(eq(instrumentSlots.ensembleId, parsed.data.ensembleId));

  const [slot] = await dz.insert(instrumentSlots).values({
    ensembleId: parsed.data.ensembleId,
    name: parsed.data.name.trim(),
    section: parsed.data.section?.trim() ?? null,
    sortOrder: Number(next),
  }).returning();

  res.status(201).json({ instrumentSlot: slot });
});

// GET /instrument-slots/:id
instrumentSlotsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(and(eq(instrumentSlots.id, req.params.id), isNull(instrumentSlots.deletedAt)));
  if (!slot) {
    res.status(404).json({ error: 'Instrument slot not found' });
    return;
  }

  try {
    await requireEnsembleMember(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  res.json({ instrumentSlot: slot });
});

// PATCH /instrument-slots/:id
instrumentSlotsRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(eq(instrumentSlots.id, req.params.id));
  if (!slot) {
    res.status(404).json({ error: 'Instrument slot not found' });
    return;
  }

  try {
    await requireEnsembleAdmin(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1).max(100).optional(),
    section: z.string().max(100).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.section !== undefined) updates.section = parsed.data.section?.trim() ?? null;

  const [updated] = await dz.update(instrumentSlots)
    .set(updates)
    .where(eq(instrumentSlots.id, req.params.id))
    .returning();

  res.json({ instrumentSlot: updated });
});

// DELETE /instrument-slots/:id (soft delete)
instrumentSlotsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(eq(instrumentSlots.id, req.params.id));
  if (!slot) {
    res.status(404).json({ error: 'Instrument slot not found' });
    return;
  }

  try {
    await requireEnsembleAdmin(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(instrumentSlots)
    .set({ deletedAt: new Date() })
    .where(eq(instrumentSlots.id, req.params.id));

  res.json({ deleted: true });
});

// ── Slot assignments (users → instrument slots) ──────────────────────────────

// GET /instrument-slots/:id/assignments
instrumentSlotsRouter.get('/:id/assignments', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(and(eq(instrumentSlots.id, req.params.id), isNull(instrumentSlots.deletedAt)));
  if (!slot) { res.status(404).json({ error: 'Instrument slot not found' }); return; }

  try {
    await requireEnsembleMember(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select({
    userId: users.id,
    name: users.displayName,
    email: users.email,
    isDummy: users.isDummy,
    assignedAt: instrumentSlotAssignments.createdAt,
  })
    .from(instrumentSlotAssignments)
    .innerJoin(users, eq(users.id, instrumentSlotAssignments.userId))
    .where(eq(instrumentSlotAssignments.slotId, req.params.id));

  res.json({ assignments: rows });
});

// POST /instrument-slots/:id/assignments
instrumentSlotsRouter.post('/:id/assignments', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(and(eq(instrumentSlots.id, req.params.id), isNull(instrumentSlots.deletedAt)));
  if (!slot) { res.status(404).json({ error: 'Instrument slot not found' }); return; }

  try {
    await requireEnsembleAdmin(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const [assignment] = await dz.insert(instrumentSlotAssignments).values({
      slotId: req.params.id,
      userId: parsed.data.userId,
    }).returning();
    res.status(201).json({ assignment });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'User is already assigned to this instrument' });
      return;
    }
    throw err;
  }
});

// DELETE /instrument-slots/:id/assignments/:userId
instrumentSlotsRouter.delete('/:id/assignments/:userId', async (req: Request, res: Response): Promise<void> => {
  const [slot] = await dz.select().from(instrumentSlots)
    .where(eq(instrumentSlots.id, req.params.id));
  if (!slot) { res.status(404).json({ error: 'Instrument slot not found' }); return; }

  try {
    await requireEnsembleAdmin(slot.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [deleted] = await dz.delete(instrumentSlotAssignments)
    .where(and(
      eq(instrumentSlotAssignments.slotId, req.params.id),
      eq(instrumentSlotAssignments.userId, req.params.userId),
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: 'Assignment not found' }); return; }
  res.json({ deleted: true });
});
