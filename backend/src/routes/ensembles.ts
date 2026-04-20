import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { ensembles, workspaces } from '../schema';
import { requireAuth } from '../middleware/auth';
import {
  requireWorkspaceMember,
  requireWorkspaceAdmin,
  requireEnsembleMember,
  requireEnsembleAdmin,
} from '../lib/ensembleAuth';

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

  const [updated] = await dz.update(ensembles)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(ensembles.id, req.params.id))
    .returning();
  if (!updated) { res.status(404).json({ error: 'Ensemble not found' }); return; }

  res.json({ ensemble: updated });
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
