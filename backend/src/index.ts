import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { authRouter } from './routes/auth';
import { workspacesRouter } from './routes/workspaces';
import { ensemblesRouter } from './routes/ensembles';
import { instrumentSlotsRouter } from './routes/instrumentSlots';
import { versionsRouter } from './routes/versions';
import { chartsRouter } from './routes/charts';
import { partSlotAssignmentsRouter } from './routes/partSlotAssignments';
import { deviceTokensRouter } from './routes/deviceTokens';
import { partsRouter, playerRouter } from './routes/parts';
import { notificationsRouter } from './routes/notifications';
import { annotationsRouter } from './routes/annotations';

const app = express();

app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/workspaces', workspacesRouter);
app.use('/ensembles', ensemblesRouter);
app.use('/instrument-slots', instrumentSlotsRouter);
app.use('/versions', versionsRouter);
app.use('/charts', chartsRouter);
app.use('/parts', partSlotAssignmentsRouter);
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
