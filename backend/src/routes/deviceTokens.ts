import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

export const deviceTokensRouter = Router();
deviceTokensRouter.use(requireAuth);

// TODO: device_tokens table not yet in Drizzle schema. Stubbed out.

deviceTokensRouter.post('/', async (_req: Request, res: Response): Promise<void> => {
  res.status(201).json({ ok: true });
});

deviceTokensRouter.delete('/:token', async (_req: Request, res: Response): Promise<void> => {
  res.status(204).send();
});
