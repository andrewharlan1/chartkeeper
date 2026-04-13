import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { authRouter } from './routes/auth';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);

const PORT = process.env.PORT ?? 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ChartKeeper API listening on port ${PORT}`);
  });
}

export { app };
