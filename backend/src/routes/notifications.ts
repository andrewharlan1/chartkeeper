import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// GET /notifications
// Returns the current user's notification inbox, newest first.
// Supports ?unreadOnly=true and ?limit=
notificationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    unreadOnly: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { unreadOnly, limit = 50 } = parsed.data;

  const result = await db.query(
    `SELECT id, ensemble_id, chart_version_id, type, message, read_at, created_at
     FROM notifications
     WHERE user_id = $1
       ${unreadOnly === 'true' ? 'AND read_at IS NULL' : ''}
     ORDER BY created_at DESC
     LIMIT $2`,
    [req.user!.id, limit]
  );

  res.json({ notifications: result.rows });
});

// POST /notifications/mark-read
// Body: { ids: string[] } — marks specific notifications as read.
// Pass ids: [] with allBefore to mark all as read.
notificationsRouter.post('/mark-read', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ids: z.array(z.string().uuid()).min(1),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await db.query(
    `UPDATE notifications
     SET read_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`,
    [req.user!.id, parsed.data.ids]
  );

  res.json({ ok: true });
});
