import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { dz } from '../db';
import { workspaces, workspaceMembers } from '../schema';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceMember, requireWorkspaceAdmin } from '../lib/ensembleAuth';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

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

// GET /workspaces — all workspaces the current user belongs to
workspacesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const rows = await dz.select({
    id: workspaces.id,
    name: workspaces.name,
    role: workspaceMembers.role,
    createdAt: workspaces.createdAt,
  })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, req.user!.id))
    .orderBy(workspaces.sortOrder, workspaces.createdAt);

  res.json({ workspaces: rows });
});

// POST /workspaces
workspacesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [ws] = await dz.insert(workspaces).values({ name: parsed.data.name }).returning();
  await dz.insert(workspaceMembers).values({
    workspaceId: ws.id,
    userId: req.user!.id,
    role: 'owner',
  });

  res.status(201).json({ workspace: { ...ws, role: 'owner' } });
});

// GET /workspaces/:id
workspacesRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const role = await requireWorkspaceMember(req.params.id, req.user!.id);
    const [ws] = await dz.select().from(workspaces).where(eq(workspaces.id, req.params.id));
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
    res.json({ workspace: { ...ws, role } });
  } catch (err) {
    handleError(err, res);
  }
});

// PATCH /workspaces/:id
workspacesRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireWorkspaceAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [updated] = await dz.update(workspaces)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(workspaces.id, req.params.id))
    .returning();
  if (!updated) { res.status(404).json({ error: 'Workspace not found' }); return; }

  res.json({ workspace: updated });
});

// DELETE /workspaces/:id (soft delete)
workspacesRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const role = await requireWorkspaceMember(req.params.id, req.user!.id);
    if (role !== 'owner') {
      res.status(403).json({ error: 'Only the workspace owner can delete it' });
      return;
    }
  } catch (err) {
    handleError(err, res);
    return;
  }

  await dz.update(workspaces)
    .set({ deletedAt: new Date() })
    .where(eq(workspaces.id, req.params.id));

  res.json({ deleted: true });
});
