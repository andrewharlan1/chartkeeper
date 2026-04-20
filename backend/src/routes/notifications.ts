import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// TODO: Notifications table not yet in Drizzle schema. Stubbed out.

notificationsRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  res.json({ notifications: [] });
});

notificationsRouter.post('/mark-read', async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true });
});
