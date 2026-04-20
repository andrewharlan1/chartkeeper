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

// GET /ensembles  — all ensembles the current user is a member of
ensemblesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const result = await db.query(
    `SELECT e.id, e.name, e.owner_id, e.created_at, em.role
     FROM ensembles e
     JOIN ensemble_members em ON em.ensemble_id = e.id
     WHERE em.user_id = $1
     ORDER BY e.created_at`,
    [req.user!.id]
  );
  res.json({ ensembles: result.rows });
});

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

// GET /ensembles/:id/instruments
ensemblesRouter.get('/:id/instruments', async (req: Request, res: Response): Promise<void> => {
  try { await requireMember(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const result = await db.query(
    `SELECT id, name, display_order, created_at
     FROM ensemble_instruments
     WHERE ensemble_id = $1
     ORDER BY display_order, created_at`,
    [req.params.id]
  );
  res.json({ instruments: result.rows });
});

// POST /ensembles/:id/instruments
ensemblesRouter.post('/:id/instruments', async (req: Request, res: Response): Promise<void> => {
  try { await requireOwnerOrEditor(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Use current max order + 1
  const orderResult = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM ensemble_instruments WHERE ensemble_id = $1`,
    [req.params.id]
  );

  try {
    const result = await db.query(
      `INSERT INTO ensemble_instruments (ensemble_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, display_order, created_at`,
      [req.params.id, parsed.data.name.trim(), orderResult.rows[0].next]
    );
    res.status(201).json({ instrument: result.rows[0] });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'That instrument already exists in this ensemble' });
      return;
    }
    throw err;
  }
});

// PATCH /ensembles/:id/instruments/:instrumentId  (rename)
ensemblesRouter.patch('/:id/instruments/:instrumentId', async (req: Request, res: Response): Promise<void> => {
  try { await requireOwnerOrEditor(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const result = await db.query(
    `UPDATE ensemble_instruments SET name = $1
     WHERE id = $2 AND ensemble_id = $3
     RETURNING id, name, display_order, created_at`,
    [parsed.data.name.trim(), req.params.instrumentId, req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Instrument not found' }); return; }
  res.json({ instrument: result.rows[0] });
});

// DELETE /ensembles/:id/instruments/:instrumentId
ensemblesRouter.delete('/:id/instruments/:instrumentId', async (req: Request, res: Response): Promise<void> => {
  try { await requireOwnerOrEditor(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  await db.query(
    `DELETE FROM ensemble_instruments WHERE id = $1 AND ensemble_id = $2`,
    [req.params.instrumentId, req.params.id]
  );
  res.json({ deleted: true });
});

// GET /ensembles/:id/instruments/:instrumentId/assignments
ensemblesRouter.get('/:id/instruments/:instrumentId/assignments', async (req: Request, res: Response): Promise<void> => {
  try { await requireMember(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const result = await db.query(
    `SELECT eia.id, eia.ensemble_instrument_id, eia.user_id, eia.assigned_by, eia.created_at,
            u.name AS user_name, u.email AS user_email
     FROM ensemble_instrument_assignments eia
     JOIN users u ON u.id = eia.user_id
     WHERE eia.ensemble_instrument_id = $1`,
    [req.params.instrumentId]
  );
  res.json({ assignments: result.rows });
});

// POST /ensembles/:id/instruments/:instrumentId/assignments
ensemblesRouter.post('/:id/instruments/:instrumentId/assignments', async (req: Request, res: Response): Promise<void> => {
  try { await requireOwnerOrEditor(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const member = await db.query(
    `SELECT id FROM ensemble_members WHERE ensemble_id = $1 AND user_id = $2`,
    [req.params.id, parsed.data.userId]
  );
  if (!member.rows[0]) { res.status(400).json({ error: 'User is not a member of this ensemble' }); return; }

  try {
    const result = await db.query(
      `INSERT INTO ensemble_instrument_assignments (ensemble_instrument_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (ensemble_instrument_id, user_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
       RETURNING id, ensemble_instrument_id, user_id, assigned_by, created_at`,
      [req.params.instrumentId, parsed.data.userId, req.user!.id]
    );
    const u = await db.query(`SELECT name, email FROM users WHERE id = $1`, [parsed.data.userId]);
    res.status(201).json({ assignment: { ...result.rows[0], user_name: u.rows[0].name, user_email: u.rows[0].email } });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23503') {
      res.status(404).json({ error: 'Instrument not found' });
      return;
    }
    throw err;
  }
});

// DELETE /ensembles/:id/instruments/:instrumentId/assignments/:assignmentId
ensemblesRouter.delete('/:id/instruments/:instrumentId/assignments/:assignmentId', async (req: Request, res: Response): Promise<void> => {
  try { await requireOwnerOrEditor(req.params.id, req.user!.id); }
  catch (err) { handleError(err, res); return; }

  await db.query(
    `DELETE FROM ensemble_instrument_assignments WHERE id = $1 AND ensemble_instrument_id = $2`,
    [req.params.assignmentId, req.params.instrumentId]
  );
  res.json({ deleted: true });
});

// POST /ensembles/:id/seed-members — dev helper: add dummy players to ensemble
ensemblesRouter.post('/:id/seed-members', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = req.params.id;
  try {
    await requireOwnerOrEditor(ensembleId, req.user!.id);
  } catch (err) {
    handleError(err, res);
    return;
  }

  const DUMMY_PLAYERS = [
    { name: 'Alice Chen', email: `alice.${ensembleId.slice(0,6)}@dummy.scorva` },
    { name: 'Marcus Webb', email: `marcus.${ensembleId.slice(0,6)}@dummy.scorva` },
    { name: 'Sofia Reyes', email: `sofia.${ensembleId.slice(0,6)}@dummy.scorva` },
    { name: 'James Okafor', email: `james.${ensembleId.slice(0,6)}@dummy.scorva` },
    { name: 'Priya Nair', email: `priya.${ensembleId.slice(0,6)}@dummy.scorva` },
    { name: 'Leo Fischer', email: `leo.${ensembleId.slice(0,6)}@dummy.scorva` },
  ];

  const client = await db.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    for (const p of DUMMY_PLAYERS) {
      // Upsert user
      const userResult = await client.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, 'dummy-not-usable')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [p.name, p.email]
      );
      const userId = userResult.rows[0].id;
      // Add to ensemble if not already a member
      const existing = await client.query(
        `SELECT id FROM ensemble_members WHERE ensemble_id = $1 AND user_id = $2`,
        [ensembleId, userId]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO ensemble_members (ensemble_id, user_id, role) VALUES ($1, $2, 'player')`,
          [ensembleId, userId]
        );
        added++;
      }
    }
    await client.query('COMMIT');
    res.json({ added });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

// DELETE /ensembles/:id — owner only, soft-deletes by removing all members + data
ensemblesRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const ensembleId = req.params.id;
  const userId = req.user!.id;

  // Only the owner can delete
  const ownerCheck = await db.query(
    `SELECT id FROM ensembles WHERE id = $1 AND owner_id = $2`,
    [ensembleId, userId]
  );
  if (!ownerCheck.rows[0]) {
    res.status(403).json({ error: 'Only the ensemble owner can delete it' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Soft-delete all charts in this ensemble (preserves music data, avoids FK block)
    await client.query(
      `UPDATE charts SET deleted_at = NOW() WHERE ensemble_id = $1 AND deleted_at IS NULL`,
      [ensembleId]
    );
    // Remove invitations, instruments (cascades to assignments), and members
    await client.query(`DELETE FROM invitations WHERE ensemble_id = $1`, [ensembleId]);
    await client.query(`DELETE FROM ensemble_instruments WHERE ensemble_id = $1`, [ensembleId]);
    await client.query(`DELETE FROM ensemble_members WHERE ensemble_id = $1`, [ensembleId]);
    await client.query(`DELETE FROM ensembles WHERE id = $1`, [ensembleId]);
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
