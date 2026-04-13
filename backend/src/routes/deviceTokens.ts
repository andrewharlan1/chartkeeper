import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

export const deviceTokensRouter = Router();

deviceTokensRouter.use(requireAuth);

const iosSchema = z.object({
  token: z.string().min(1),
  platform: z.literal('ios'),
});

const webSchema = z.object({
  token: z.string().min(1),
  platform: z.literal('web'),
  webEndpoint: z.string().url(),
  webP256dh: z.string().min(1),
  webAuth: z.string().min(1),
});

const registerSchema = z.discriminatedUnion('platform', [iosSchema, webSchema]);

// POST /device-tokens
deviceTokensRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const userId = req.user!.id;

  if (data.platform === 'ios') {
    await db.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, 'ios')
       ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW()`,
      [userId, data.token]
    );
  } else {
    await db.query(
      `INSERT INTO device_tokens (user_id, token, platform, web_endpoint, web_p256dh, web_auth)
       VALUES ($1, $2, 'web', $3, $4, $5)
       ON CONFLICT (user_id, token) DO UPDATE
         SET web_endpoint = EXCLUDED.web_endpoint,
             web_p256dh = EXCLUDED.web_p256dh,
             web_auth = EXCLUDED.web_auth,
             updated_at = NOW()`,
      [userId, data.token, data.webEndpoint, data.webP256dh, data.webAuth]
    );
  }

  res.status(201).json({ ok: true });
});

// DELETE /device-tokens/:token
deviceTokensRouter.delete('/:token', async (req: Request, res: Response): Promise<void> => {
  await db.query(
    `DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`,
    [req.user!.id, req.params.token]
  );
  res.status(204).send();
});
