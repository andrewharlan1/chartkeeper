import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { dz } from '../db';
import { workspaces, workspaceMembers, users } from '../schema';
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

// GET /workspaces/:id/members — all members of a workspace
workspacesRouter.get('/:id/members', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireWorkspaceMember(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const rows = await dz.select({
    id: users.id,
    email: users.email,
    name: users.displayName,
    isDummy: users.isDummy,
    role: workspaceMembers.role,
    joinedAt: workspaceMembers.createdAt,
  })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, req.params.id))
    .orderBy(workspaceMembers.createdAt);

  res.json({ members: rows });
});

// POST /workspaces/:id/members — add a member (create user if needed)
workspacesRouter.post('/:id/members', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireWorkspaceAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    role: z.enum(['admin', 'member', 'viewer']).default('member'),
    isDummy: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { name, role, isDummy } = parsed.data;
  const email = parsed.data.email?.toLowerCase() ?? `dummy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@placeholder.local`;

  // Check if user with this email already exists
  const [existing] = await dz.select().from(users).where(eq(users.email, email));
  let userId: string;

  if (existing) {
    userId = existing.id;
    // Check if already a member
    const [existingMembership] = await dz.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, req.params.id), eq(workspaceMembers.userId, userId)));
    if (existingMembership) {
      res.status(409).json({ error: 'User is already a member of this workspace' });
      return;
    }
  } else {
    // Create the user
    const passwordHash = isDummy
      ? await bcrypt.hash('__dummy_no_login__', 4)
      : await bcrypt.hash('changeme_' + Math.random().toString(36).slice(2), 12);

    const [newUser] = await dz.insert(users).values({
      email,
      displayName: name,
      passwordHash,
      isDummy,
    }).returning();
    userId = newUser.id;
  }

  // Create membership
  const [membership] = await dz.insert(workspaceMembers).values({
    workspaceId: req.params.id,
    userId,
    role,
  }).returning();

  // Return the member info
  const [member] = await dz.select({
    id: users.id,
    email: users.email,
    name: users.displayName,
    isDummy: users.isDummy,
    role: workspaceMembers.role,
    joinedAt: workspaceMembers.createdAt,
  })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.id, membership.id));

  res.status(201).json({ member });
});

// DELETE /workspaces/:id/members/:userId — remove a member
workspacesRouter.delete('/:id/members/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireWorkspaceAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  // Don't allow removing yourself
  if (req.params.userId === req.user!.id) {
    res.status(400).json({ error: 'Cannot remove yourself from the workspace' });
    return;
  }

  const [deleted] = await dz.delete(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, req.params.id),
      eq(workspaceMembers.userId, req.params.userId),
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: 'Member not found' }); return; }
  res.json({ deleted: true });
});

// POST /workspaces/:id/seed-dummies — create 5 dummy users for testing
const DUMMY_NAMES = [
  { name: 'Sarah Chen', email: 'sarah.chen' },
  { name: 'John Martinez', email: 'john.martinez' },
  { name: 'Priya Patel', email: 'priya.patel' },
  { name: 'Marcus Johnson', email: 'marcus.johnson' },
  { name: 'Emma Wilson', email: 'emma.wilson' },
];

workspacesRouter.post('/:id/seed-dummies', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireWorkspaceAdmin(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const passwordHash = await bcrypt.hash('__dummy_no_login__', 4);
  const created: Array<{ id: string; name: string | null; email: string; isDummy: boolean; role: string }> = [];

  for (const d of DUMMY_NAMES) {
    const email = `${d.email}@dummy.scorva.local`;

    // Skip if user with this email already exists in this workspace
    const [existing] = await dz.select({ id: users.id })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(and(eq(users.email, email), eq(workspaceMembers.workspaceId, req.params.id)));
    if (existing) continue;

    // Create or find user
    let [user] = await dz.select().from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await dz.insert(users).values({
        email,
        displayName: d.name,
        passwordHash,
        isDummy: true,
      }).returning();
    }

    // Create membership
    await dz.insert(workspaceMembers).values({
      workspaceId: req.params.id,
      userId: user.id,
      role: 'member',
    }).onConflictDoNothing();

    created.push({ id: user.id, name: user.displayName, email: user.email, isDummy: true, role: 'member' });
  }

  res.status(201).json({ seeded: created.length, members: created });
});
