import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { authRouter } from './routes/auth';
import { ensemblesRouter } from './routes/ensembles';
import { chartsRouter } from './routes/charts';
import { deviceTokensRouter } from './routes/deviceTokens';
import { partsRouter, playerRouter } from './routes/parts';
import { notificationsRouter } from './routes/notifications';
import { annotationsRouter } from './routes/annotations';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/ensembles', ensemblesRouter);
app.use('/charts', chartsRouter);
app.use('/device-tokens', deviceTokensRouter);
app.use('/parts', partsRouter);
app.use('/player', playerRouter);
app.use('/notifications', notificationsRouter);
app.use('/parts', annotationsRouter);
app.use('/annotations', annotationsRouter);

const PORT = process.env.PORT ?? 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Scorva API listening on port ${PORT}`);
  });
}

export { app };
