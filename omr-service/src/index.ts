import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { runAudiveris } from './audiveris';

const app = express();
app.use(express.json());

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/process', async (req: Request, res: Response): Promise<void> => {
  const { pdfS3Key, partId } = req.body as { pdfS3Key: string; partId: string };

  if (!pdfS3Key || !partId) {
    res.status(400).json({ error: 'pdfS3Key and partId are required' });
    return;
  }

  // Derive instrument name from S3 key: .../parts/{instrument}.pdf
  const partName = path.basename(pdfS3Key, '.pdf');

  // Download PDF from S3 to a temp file
  const tmpPath = path.join(os.tmpdir(), `omr-${partId}-${Date.now()}.pdf`);
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: pdfS3Key,
    });
    const s3Response = await s3.send(command);
    const stream = s3Response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    await fs.writeFile(tmpPath, Buffer.concat(chunks));

    const result = await runAudiveris(tmpPath, partName);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[omr-service] Failed to process part ${partId}: ${message}`);
    res.status(500).json({ error: message });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
});

const PORT = process.env.PORT ?? 3001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ChartKeeper OMR service listening on port ${PORT}`);
  });
}

export { app };
