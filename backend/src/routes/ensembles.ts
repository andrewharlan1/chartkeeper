import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireMember, requireOwnerOrEditor } from '../lib/ensembleAuth';

export const ensemblesRouter = Router();

ensemblesRouter.use(requireAuth);

// Error shape for auth helpers that throw {status, message}
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

// POST /ensembles
ensemblesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.user!.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ensResult = await client.query<{ id: string; name: string; owner_id: string; created_at: string }>(
      `INSERT INTO ensembles (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id, created_at`,
      [parsed.data.name, userId]
    );
    const ensemble = ensResult.rows[0];
    await client.query(
      `INSERT INTO ensemble_members (ensemble_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [ensemble.id, userId]
    );
    await client.query('COMMIT');
    res.status(201).json({ ensemble });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /ensembles/:id
ensemblesRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireMember(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const result = await db.query<{ id: string; name: string; owner_id: string; created_at: string }>(
    `SELECT id, name, owner_id, created_at FROM ensembles WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Ensemble not found' });
    return;
  }
  res.json({ ensemble: result.rows[0] });
});

// GET /ensembles/:id/members
ensemblesRouter.get('/:id/members', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireMember(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const result = await db.query(
    `SELECT u.id, u.name, u.email, em.role, em.created_at AS joined_at
     FROM ensemble_members em
     JOIN users u ON u.id = em.user_id
     WHERE em.ensemble_id = $1
     ORDER BY em.created_at`,
    [req.params.id]
  );
  res.json({ members: result.rows });
});

// POST /ensembles/:id/invite
ensemblesRouter.post('/:id/invite', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireOwnerOrEditor(req.params.id, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const parsed = z.object({
    email: z.string().email(),
    role: z.enum(['editor', 'player']),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, role } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // Check if already a member
  const existing = await db.query(
    `SELECT em.id FROM ensemble_members em
     JOIN users u ON u.id = em.user_id
     WHERE em.ensemble_id = $1 AND u.email = $2`,
    [req.params.id, normalizedEmail]
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'User is already a member of this ensemble' });
    return;
  }

  // If a pending invite already exists for this email+ensemble, reuse it
  const existingInvite = await db.query<{ token: string }>(
    `SELECT token FROM invitations
     WHERE ensemble_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()`,
    [req.params.id, normalizedEmail]
  );

  let token: string;
  if (existingInvite.rows.length > 0) {
    token = existingInvite.rows[0].token;
  } else {
    const invResult = await db.query<{ token: string }>(
      `INSERT INTO invitations (ensemble_id, email, role, invited_by)
       VALUES ($1, $2, $3, $4)
       RETURNING token`,
      [req.params.id, normalizedEmail, role, req.user!.id]
    );
    token = invResult.rows[0].token;
  }

  res.status(201).json({ inviteUrl: `/auth/accept-invite/${token}` });
});
