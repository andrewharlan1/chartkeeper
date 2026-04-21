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

  const { email, name, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let user: { id: string; email: string; display_name: string | null };
    try {
      const result = await client.query<{ id: string; email: string; display_name: string | null }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name`,
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

    // Create a default workspace and add the user as owner
    const wsName = name ? `${name}'s Workspace` : 'My Workspace';
    const wsResult = await client.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [wsName]
    );
    const workspace = wsResult.rows[0];

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspace.id, user.id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.display_name },
      workspaceId: workspace.id,
    });
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

  const result = await db.query<{ id: string; email: string; display_name: string | null; password_hash: string; is_dummy: boolean }>(
    `SELECT id, email, display_name, password_hash, is_dummy FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (user?.is_dummy) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  const valid = user && await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const { password_hash: _, ...safeUser } = user;
  res.json({ token: signToken(safeUser), user: { id: safeUser.id, email: safeUser.email, name: safeUser.display_name } });
});
