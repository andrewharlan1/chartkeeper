import dotenv from 'dotenv';
dotenv.config();

import { claimNextJob, completeJob, failJob, enqueueJob } from '../lib/queue';
import { uploadFile, downloadFile } from '../lib/s3';
import { db } from '../db';
import { extractMeasureLayout } from '../lib/vision-measure-layout';
import { annotatePdfWithMeasures } from '../lib/annotate-pdf';

const OMR_SERVICE_URL = process.env.OMR_SERVICE_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = parseInt(process.env.OMR_POLL_INTERVAL_MS ?? '10000');
const MAX_ATTEMPTS = parseInt(process.env.OMR_MAX_ATTEMPTS ?? '3');

// OMR_ENGINE controls how the pipeline resolves parts:
//   'audiveris' — call the omr-service (Audiveris wrapper) — requires omr-service running
//   'vision'    — use Claude Vision to extract measure layout (page per measure)
//   'none'      — skip OMR entirely; mark parts complete with empty omr_json
const OMR_ENGINE = (process.env.OMR_ENGINE ?? 'vision') as 'audiveris' | 'vision' | 'none';

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

  if (OMR_ENGINE === 'none') {
    await db.query(
      `UPDATE parts
       SET omr_status = 'complete',
           omr_json = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ measures: [], sections: [], partName: instrument }), partId]
    );
    await completeJob(jobId);
    console.log(`[omr.worker] Part ${partId} (${instrument}) — OMR_ENGINE=none, skipped OMR`);
    await maybeEnqueueDiff(chartId, versionId);
    return;
  }

  if (OMR_ENGINE === 'vision') {
    // Use Claude Vision to extract measure layout (which page each measure is on)
    await db.query(
      `UPDATE parts SET omr_status = 'processing', updated_at = NOW() WHERE id = $1`,
      [partId]
    );

    const pdfBuffer = await downloadFile(pdfS3Key);
    const omrJson = await extractMeasureLayout(pdfBuffer, instrument);

    // Generate annotated PDF with boxes around each measure
    let debugPdfKey: string | null = null;
    try {
      const annotatedPdf = await annotatePdfWithMeasures(pdfBuffer, omrJson);
      debugPdfKey = pdfS3Key.replace(/\.pdf$/i, '_measures.pdf');
      await uploadFile(debugPdfKey, annotatedPdf, 'application/pdf');
      console.log(`[omr.worker] Part ${partId} (${instrument}) — annotated PDF uploaded: ${debugPdfKey}`);
    } catch (err) {
      console.error(`[omr.worker] Part ${partId} — annotated PDF failed:`, err instanceof Error ? err.message : err);
    }

    await db.query(
      `UPDATE parts
       SET omr_status = 'complete',
           omr_json = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(omrJson), partId]
    );
    await completeJob(jobId);
    console.log(`[omr.worker] Part ${partId} (${instrument}) — DONE — ${omrJson.measures.length} measures extracted, boxes drawn`);
    await maybeEnqueueDiff(chartId, versionId);
    return;
  }

  // ── Audiveris path ───────────────────────────────────────────────────────────
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

  // Generate annotated debug PDF with measure boxes
  let debugPdfKey: string | null = null;
  try {
    const pdfBuffer = await downloadFile(pdfS3Key);
    const annotatedPdf = await annotatePdfWithMeasures(pdfBuffer, result.omrJson);
    debugPdfKey = pdfS3Key.replace(/\.pdf$/i, '_measures.pdf');
    await uploadFile(debugPdfKey, annotatedPdf, 'application/pdf');
    console.log(`[omr.worker] Part ${partId} (${instrument}) — annotated PDF uploaded: ${debugPdfKey}`);
  } catch (err) {
    console.error(`[omr.worker] Part ${partId} — annotated PDF failed:`, err instanceof Error ? err.message : err);
  }

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
  console.log(`[omr.worker] Part ${partId} (${instrument}) processed via Audiveris — ${result.omrJson.measures.length} measures`);

  // Check if all parts for this version are now complete — if so, enqueue diff
  await maybeEnqueueDiff(chartId, versionId);
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

async function maybeEnqueueDiff(chartId: string, toVersionId: string): Promise<void> {
  // Are all parts for this version done (complete or failed)?
  const pending = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM parts
     WHERE chart_version_id = $1 AND omr_status IN ('pending', 'processing')`,
    [toVersionId]
  );
  if (parseInt(pending.rows[0].count) > 0) return;

  // Find the immediately previous version by version_number
  const prev = await db.query<{ id: string }>(
    `SELECT cv.id FROM chart_versions cv
     JOIN chart_versions curr ON curr.id = $1 AND curr.chart_id = cv.chart_id
     WHERE cv.version_number = curr.version_number - 1`,
    [toVersionId]
  );
  if (!prev.rows[0]) return; // first version — nothing to diff against

  const fromVersionId = prev.rows[0].id;

  // Don't re-enqueue if a diff job already exists for this pair
  const existing = await db.query(
    `SELECT id FROM jobs
     WHERE type = 'diff'
       AND payload->>'fromVersionId' = $1
       AND payload->>'toVersionId' = $2
       AND status != 'failed'`,
    [fromVersionId, toVersionId]
  );
  if (existing.rows.length > 0) return;

  await enqueueJob('diff', { chartId, fromVersionId, toVersionId });
  console.log(`[omr.worker] Enqueued diff job: ${fromVersionId} → ${toVersionId}`);
}

let processing = false;

async function run(): Promise<void> {
  console.log(`[omr.worker] Started — polling every ${POLL_INTERVAL_MS}ms, OMR_ENGINE=${OMR_ENGINE}`);
  setInterval(async () => {
    if (processing) return; // only one job at a time to avoid API rate limits
    processing = true;
    try {
      await tick();
    } finally {
      processing = false;
    }
  }, POLL_INTERVAL_MS);
}

run().catch((err) => {
  console.error('[omr.worker] Fatal error:', err);
  process.exit(1);
});
