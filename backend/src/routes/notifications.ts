import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';
import { dz } from '../db';
import { notifications } from '../schema';
import { requireAuth } from '../middleware/auth';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// GET /notifications?limit=20
notificationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const unreadOnly = req.query.unreadOnly === 'true';

  const conditions = [eq(notifications.userId, req.user!.id)];
  if (unreadOnly) conditions.push(isNull(notifications.readAt));

  const rows = await dz.select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  res.json({ notifications: rows });
});

// GET /notifications/unread-count
notificationsRouter.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));

  res.json({ count: Number(count) });
});

// POST /notifications/mark-read
// Body: { ids?: string[] } — if ids provided, mark those; otherwise mark all
notificationsRouter.post('/mark-read', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ids: z.array(z.string().uuid()).optional(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const now = new Date();

  if (parsed.data?.ids && parsed.data.ids.length > 0) {
    // Mark specific notifications
    await dz.update(notifications)
      .set({ readAt: now })
      .where(and(
        eq(notifications.userId, req.user!.id),
        isNull(notifications.readAt),
        sql`${notifications.id} in (${sql.join(parsed.data.ids.map(id => sql`${id}`), sql`, `)})`,
      ));
  } else {
    // Mark all as read
    await dz.update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
  }

  res.json({ ok: true });
});
