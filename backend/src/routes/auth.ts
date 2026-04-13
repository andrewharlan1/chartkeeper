import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  inviteToken: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function signToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET as string,
    { expiresIn: '30d' }
  );
}

authRouter.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, name, password, inviteToken } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Validate invite token before creating the user
    let invitation: { id: string; ensemble_id: string; role: string; email: string } | undefined;
    if (inviteToken) {
      const invResult = await client.query<{ id: string; ensemble_id: string; role: string; email: string }>(
        `SELECT id, ensemble_id, role, email FROM invitations
         WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
        [inviteToken]
      );
      invitation = invResult.rows[0];
      if (!invitation) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invite token is invalid or has expired' });
        return;
      }
      if (invitation.email.toLowerCase() !== normalizedEmail) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'This invite was sent to a different email address' });
        return;
      }
    }

    let user: { id: string; email: string; name: string };
    try {
      const result = await client.query<{ id: string; email: string; name: string }>(
        `INSERT INTO users (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [normalizedEmail, name, passwordHash]
      );
      user = result.rows[0];
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }
      throw err;
    }

    if (invitation) {
      await client.query(
        `INSERT INTO ensemble_members (ensemble_id, user_id, role) VALUES ($1, $2, $3)`,
        [invitation.ensemble_id, user.id, invitation.role]
      );
      await client.query(
        `UPDATE invitations SET accepted_at = NOW() WHERE id = $1`,
        [invitation.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const result = await db.query<{ id: string; email: string; name: string; password_hash: string }>(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  const valid = user && await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const { password_hash: _, ...safeUser } = user;
  res.json({ token: signToken(safeUser), user: safeUser });
});

// POST /auth/accept-invite/:token
// For users who already have an account — joins them to the ensemble directly.
// New users should sign up with inviteToken in the body (handled in /signup).
authRouter.post('/accept-invite/:token', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const invResult = await db.query<{ id: string; ensemble_id: string; role: string; email: string }>(
    `SELECT id, ensemble_id, role, email FROM invitations
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
    [req.params.token]
  );
  const invitation = invResult.rows[0];

  if (!invitation) {
    res.status(400).json({ error: 'Invite token is invalid or has expired' });
    return;
  }

  if (invitation.email.toLowerCase() !== normalizedEmail) {
    res.status(400).json({ error: 'This invite was sent to a different email address' });
    return;
  }

  const userResult = await db.query<{ id: string; email: string; name: string; password_hash: string }>(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
    [normalizedEmail]
  );

  const user = userResult.rows[0];

  if (!user) {
    // New user — tell the client to complete signup with the token
    res.status(200).json({ requiresSignup: true, email: normalizedEmail, token: req.params.token });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Upsert — in case they were already added another way
    await client.query(
      `INSERT INTO ensemble_members (ensemble_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (ensemble_id, user_id) DO NOTHING`,
      [invitation.ensemble_id, user.id, invitation.role]
    );
    await client.query(
      `UPDATE invitations SET accepted_at = NOW() WHERE id = $1`,
      [invitation.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { password_hash: _, ...safeUser } = user;
  res.json({ token: signToken(safeUser), user: safeUser, ensembleId: invitation.ensemble_id });
});
