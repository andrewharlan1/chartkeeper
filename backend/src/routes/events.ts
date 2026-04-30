import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, asc, desc } from 'drizzle-orm';
import { dz } from '../db';
import { events, eventCharts, charts, ensembles, workspaceMembers } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireEnsembleMember, requireEnsembleAdmin } from '../lib/ensembleAuth';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

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

/** Look up an event's ensembleId for auth. Returns null if not found. */
async function getEventEnsembleId(eventId: string): Promise<string | null> {
  const [row] = await dz.select({ ensembleId: events.ensembleId })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
  return row?.ensembleId ?? null;
}

// ── Ensemble-scoped routes ────────────────────────────────────────────────

// GET /ensembles/:ensembleId/events
eventsRouter.get('/ensembles/:ensembleId/events', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireEnsembleMember(req.params.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select()
    .from(events)
    .where(and(eq(events.ensembleId, req.params.ensembleId), isNull(events.deletedAt)))
    .orderBy(asc(events.startsAt));

  res.json({ events: rows });
});

// POST /ensembles/:ensembleId/events
eventsRouter.post('/ensembles/:ensembleId/events', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireEnsembleAdmin(req.params.ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1),
    eventType: z.enum(['gig', 'rehearsal', 'recording', 'workshop', 'other']).default('gig'),
    startsAt: z.string().datetime(),
    location: z.string().optional(),
    notes: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [event] = await dz.insert(events).values({
    ensembleId: req.params.ensembleId,
    name: parsed.data.name,
    eventType: parsed.data.eventType,
    startsAt: new Date(parsed.data.startsAt),
    location: parsed.data.location ?? null,
    notes: parsed.data.notes ?? null,
  }).returning();

  res.status(201).json({ event });
});

// ── Event-scoped routes ───────────────────────────────────────────────────

// GET /events/:eventId
eventsRouter.get('/events/:eventId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleMember(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const [event] = await dz.select().from(events)
    .where(and(eq(events.id, req.params.eventId), isNull(events.deletedAt)));
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }

  // Get associated charts
  const chartRows = await dz.select({
    id: eventCharts.id,
    chartId: eventCharts.chartId,
    sortOrder: eventCharts.sortOrder,
    chartName: charts.name,
    chartComposer: charts.composer,
  })
    .from(eventCharts)
    .innerJoin(charts, eq(charts.id, eventCharts.chartId))
    .where(eq(eventCharts.eventId, req.params.eventId))
    .orderBy(asc(eventCharts.sortOrder));

  res.json({ event, charts: chartRows });
});

// PATCH /events/:eventId
eventsRouter.patch('/events/:eventId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1).optional(),
    eventType: z.enum(['gig', 'rehearsal', 'recording', 'workshop', 'other']).optional(),
    startsAt: z.string().datetime().optional(),
    location: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.eventType !== undefined) updates.eventType = parsed.data.eventType;
  if (parsed.data.startsAt !== undefined) updates.startsAt = new Date(parsed.data.startsAt);
  if (parsed.data.location !== undefined) updates.location = parsed.data.location;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  const [updated] = await dz.update(events)
    .set(updates)
    .where(eq(events.id, req.params.eventId))
    .returning();

  res.json({ event: updated });
});

// DELETE /events/:eventId (soft delete)
eventsRouter.delete('/events/:eventId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(events)
    .set({ deletedAt: new Date() })
    .where(eq(events.id, req.params.eventId));

  res.json({ deleted: true });
});

// ── Event-Charts join routes ──────────────────────────────────────────────

// POST /events/:eventId/charts — add chart to event (idempotent: 409 on duplicate)
eventsRouter.post('/events/:eventId/charts', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    chartId: z.string().uuid(),
    sortOrder: z.number().int().nonnegative().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Check chart exists and belongs to same ensemble
  const [chart] = await dz.select({ ensembleId: charts.ensembleId })
    .from(charts)
    .where(and(eq(charts.id, parsed.data.chartId), isNull(charts.deletedAt)));
  if (!chart || chart.ensembleId !== ensembleId) {
    res.status(400).json({ error: 'Chart not found in this ensemble' });
    return;
  }

  // Check for existing entry
  const [existing] = await dz.select({ id: eventCharts.id })
    .from(eventCharts)
    .where(and(eq(eventCharts.eventId, req.params.eventId), eq(eventCharts.chartId, parsed.data.chartId)));
  if (existing) {
    res.status(409).json({ error: 'Chart already in this event' });
    return;
  }

  // Get next sort order if not provided
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const [{ next }] = await dz.select({
      next: sql<number>`coalesce(max(${eventCharts.sortOrder}), -1) + 1`,
    }).from(eventCharts).where(eq(eventCharts.eventId, req.params.eventId));
    sortOrder = Number(next);
  }

  const [row] = await dz.insert(eventCharts).values({
    eventId: req.params.eventId,
    chartId: parsed.data.chartId,
    sortOrder,
  }).returning();

  res.status(201).json({ eventChart: row });
});

// DELETE /events/:eventId/charts/:chartId — remove chart from event
eventsRouter.delete('/events/:eventId/charts/:chartId', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const result = await dz.delete(eventCharts)
    .where(and(eq(eventCharts.eventId, req.params.eventId), eq(eventCharts.chartId, req.params.chartId)));

  res.json({ deleted: true });
});

// PUT /events/:eventId/charts/order — reorder charts within event
eventsRouter.put('/events/:eventId/charts/order', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = await getEventEnsembleId(req.params.eventId);
  if (!ensembleId) { res.status(404).json({ error: 'Event not found' }); return; }

  try {
    await requireEnsembleAdmin(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    chartIds: z.array(z.string().uuid()).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Update sort_order for each chart based on array index
  for (let i = 0; i < parsed.data.chartIds.length; i++) {
    await dz.update(eventCharts)
      .set({ sortOrder: i })
      .where(and(
        eq(eventCharts.eventId, req.params.eventId),
        eq(eventCharts.chartId, parsed.data.chartIds[i]),
      ));
  }

  res.json({ reordered: true });
});

// ── User-scoped: my events across all ensembles ──────────────────────────

// GET /me/events
eventsRouter.get('/me/events', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  // Find all workspaces the user belongs to
  const memberships = await dz.select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if (memberships.length === 0) {
    res.json({ events: [] });
    return;
  }

  // Find all ensembles in those workspaces
  const ensembleRows = await dz.select({ id: ensembles.id, name: ensembles.name })
    .from(ensembles)
    .where(and(
      sql`${ensembles.workspaceId} in (${sql.join(memberships.map(m => sql`${m.workspaceId}`), sql`, `)})`,
      isNull(ensembles.deletedAt),
    ));

  if (ensembleRows.length === 0) {
    res.json({ events: [] });
    return;
  }

  // Get all events for those ensembles
  const eventRows = await dz.select()
    .from(events)
    .where(and(
      sql`${events.ensembleId} in (${sql.join(ensembleRows.map(e => sql`${e.id}`), sql`, `)})`,
      isNull(events.deletedAt),
    ))
    .orderBy(asc(events.startsAt));

  if (eventRows.length === 0) {
    res.json({ events: [] });
    return;
  }

  // Get charts for each event
  const eventIds = eventRows.map(e => e.id);
  const chartJoins = await dz.select({
    eventId: eventCharts.eventId,
    chartId: eventCharts.chartId,
    sortOrder: eventCharts.sortOrder,
    chartName: charts.name,
  })
    .from(eventCharts)
    .innerJoin(charts, eq(charts.id, eventCharts.chartId))
    .where(sql`${eventCharts.eventId} in (${sql.join(eventIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(asc(eventCharts.sortOrder));

  const chartsByEvent: Record<string, typeof chartJoins> = {};
  for (const cj of chartJoins) {
    (chartsByEvent[cj.eventId] ??= []).push(cj);
  }

  const ensembleNameMap = new Map(ensembleRows.map(e => [e.id, e.name]));

  const result = eventRows.map(e => ({
    ...e,
    ensembleName: ensembleNameMap.get(e.ensembleId) ?? '',
    charts: chartsByEvent[e.id] ?? [],
  }));

  res.json({ events: result });
});
