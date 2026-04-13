import dotenv from 'dotenv';
dotenv.config();

import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { uploadFile } from '../lib/s3';
import { db } from '../db';

const OMR_SERVICE_URL = process.env.OMR_SERVICE_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = parseInt(process.env.OMR_POLL_INTERVAL_MS ?? '10000');
const MAX_ATTEMPTS = parseInt(process.env.OMR_MAX_ATTEMPTS ?? '3');

interface OmrJobPayload {
  partId: string;
  pdfS3Key: string;
  chartId: string;
  versionId: string;
  instrument: string;
}

interface OmrServiceResponse {
  musicxml: string;   // base64-encoded MusicXML
  omrJson: {
    measures: Array<{
      number: number;
      notes: Array<{ pitch: string; beat: number; duration: string }>;
      dynamics: Array<{ type: string; beat: number }>;
    }>;
    sections: Array<{ label: string; measureNumber: number }>;
    partName: string;
  };
}

async function processOmrJob(jobId: string, payload: OmrJobPayload): Promise<void> {
  const { partId, pdfS3Key, chartId, versionId, instrument } = payload;

  // Mark part as processing
  await db.query(
    `UPDATE parts SET omr_status = 'processing', updated_at = NOW() WHERE id = $1`,
    [partId]
  );

  // Call the OMR microservice
  const response = await fetch(`${OMR_SERVICE_URL}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfS3Key, partId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OMR service returned ${response.status}: ${text}`);
  }

  const result = await response.json() as OmrServiceResponse;

  // Upload MusicXML to S3
  const musicxmlKey = `charts/${chartId}/versions/${versionId}/parts/${instrument}.musicxml`;
  const musicxmlBuffer = Buffer.from(result.musicxml, 'base64');
  await uploadFile(musicxmlKey, musicxmlBuffer, 'application/xml');

  // Update the part row
  await db.query(
    `UPDATE parts
     SET omr_status = 'complete',
         musicxml_s3_key = $1,
         omr_json = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [musicxmlKey, JSON.stringify(result.omrJson), partId]
  );

  await completeJob(jobId);
  console.log(`[omr.worker] Part ${partId} (${instrument}) processed successfully`);
}

async function tick(): Promise<void> {
  const job = await claimNextJob('omr');
  if (!job) return;

  const payload = job.payload as OmrJobPayload;
  console.log(`[omr.worker] Processing job ${job.id} for part ${payload.partId}`);

  try {
    await processOmrJob(job.id, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[omr.worker] Job ${job.id} failed: ${message}`);

    await failJob(job.id, message, MAX_ATTEMPTS);

    // If this was the final attempt, mark the part as failed
    const jobRow = await db.query<{ attempts: number }>(
      `SELECT attempts FROM jobs WHERE id = $1`,
      [job.id]
    );
    if (jobRow.rows[0]?.attempts >= MAX_ATTEMPTS) {
      await db.query(
        `UPDATE parts SET omr_status = 'failed', updated_at = NOW() WHERE id = $1`,
        [payload.partId]
      );
      console.warn(`[omr.worker] Part ${payload.partId} marked failed after ${MAX_ATTEMPTS} attempts`);
    }
  }
}

async function run(): Promise<void> {
  console.log(`[omr.worker] Started — polling every ${POLL_INTERVAL_MS}ms`);
  // Drain any pending jobs immediately on startup, then settle into polling
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

run().catch((err) => {
  console.error('[omr.worker] Fatal error:', err);
  process.exit(1);
});
