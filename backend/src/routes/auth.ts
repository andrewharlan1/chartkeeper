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
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await db.query<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email.toLowerCase(), name, passwordHash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    throw err;
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
