import dotenv from 'dotenv';
dotenv.config();

import { eq, and, inArray, lt, desc, sql } from 'drizzle-orm';
import { claimNextJob, completeJob, failJob, enqueueJob } from '../lib/queue';
import { uploadFile, downloadFile } from '../lib/s3';
import { db, dz } from '../db';
import { parts, versions, charts } from '../schema';
import { annotatePdfWithMeasures } from '../lib/annotate-pdf';

const OMR_SERVICE_URL = process.env.OMR_SERVICE_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = parseInt(process.env.OMR_POLL_INTERVAL_MS ?? '10000');
const MAX_ATTEMPTS = parseInt(process.env.OMR_MAX_ATTEMPTS ?? '3');

// OMR_ENGINE controls how the pipeline resolves parts:
//   'audiveris' — call the omr-service (Audiveris wrapper) — requires omr-service running
//   'none'      — skip OMR entirely; mark parts complete with empty omr_json
//   'vision'    — LEGACY, quarantined — code moved to legacy/vision-measure-layout.ts
const OMR_ENGINE = (process.env.OMR_ENGINE ?? 'audiveris') as 'audiveris' | 'vision' | 'none';

interface OmrJobPayload {
  partId: string;
  pdfS3Key: string;
  ensembleId: string;
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
  const { partId, pdfS3Key, ensembleId, versionId, instrument } = payload;

  if (OMR_ENGINE === 'none') {
    await dz.update(parts)
      .set({
        omrStatus: 'complete',
        omrJson: { measures: [], sections: [], partName: instrument },
        omrEngine: 'none',
        updatedAt: new Date(),
      })
      .where(eq(parts.id, partId));

    await completeJob(jobId);
    console.log(`[omr.worker] Part ${partId} (${instrument}) — OMR_ENGINE=none, skipped OMR`);
    await maybeEnqueueDiff(ensembleId, versionId);
    return;
  }

  if (OMR_ENGINE === 'vision') {
    throw new Error(
      'OMR_ENGINE=vision is no longer supported. Vision code has been quarantined to legacy/. ' +
      'Use OMR_ENGINE=audiveris (default) or OMR_ENGINE=none.'
    );
  }

  // ── Audiveris path ───────────────────────────────────────────────────────────
  await dz.update(parts)
    .set({ omrStatus: 'processing', updatedAt: new Date() })
    .where(eq(parts.id, partId));

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
  const musicxmlKey = `ensembles/${ensembleId}/versions/${versionId}/parts/${instrument}.musicxml`;
  const musicxmlBuffer = Buffer.from(result.musicxml, 'base64');
  await uploadFile(musicxmlKey, musicxmlBuffer, 'application/xml');

  // Generate annotated debug PDF with measure boxes
  try {
    const pdfBuffer = await downloadFile(pdfS3Key);
    const annotatedPdf = await annotatePdfWithMeasures(pdfBuffer, result.omrJson);
    const debugPdfKey = pdfS3Key.replace(/\.pdf$/i, '_measures.pdf');
    await uploadFile(debugPdfKey, annotatedPdf, 'application/pdf');
    console.log(`[omr.worker] Part ${partId} (${instrument}) — annotated PDF uploaded: ${debugPdfKey}`);
  } catch (err) {
    console.error(`[omr.worker] Part ${partId} — annotated PDF failed:`, err instanceof Error ? err.message : err);
  }

  await dz.update(parts)
    .set({
      omrStatus: 'complete',
      audiverisMxlS3Key: musicxmlKey,
      omrJson: result.omrJson,
      omrEngine: 'audiveris',
      updatedAt: new Date(),
    })
    .where(eq(parts.id, partId));

  await completeJob(jobId);
  console.log(`[omr.worker] Part ${partId} (${instrument}) processed via Audiveris — ${result.omrJson.measures.length} measures`);

  await maybeEnqueueDiff(ensembleId, versionId);
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
    // (jobs table is outside Drizzle schema — use raw query)
    const jobRow = await db.query<{ attempts: number }>(
      `SELECT attempts FROM jobs WHERE id = $1`,
      [job.id]
    );
    if (jobRow.rows[0]?.attempts >= MAX_ATTEMPTS) {
      await dz.update(parts)
        .set({ omrStatus: 'failed', updatedAt: new Date() })
        .where(eq(parts.id, payload.partId));
      console.warn(`[omr.worker] Part ${payload.partId} marked failed after ${MAX_ATTEMPTS} attempts`);
    }
  }
}

async function maybeEnqueueDiff(ensembleId: string, toVersionId: string): Promise<void> {
  // Are all parts for this version done (complete or failed)?
  const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
    .from(parts)
    .where(
      and(
        eq(parts.versionId, toVersionId),
        inArray(parts.omrStatus, ['pending', 'processing']),
      )
    );
  if (Number(count) > 0) return;

  // Find the immediately previous version by sort_order within the same chart
  const [currentVersion] = await dz.select({ sortOrder: versions.sortOrder, chartId: versions.chartId })
    .from(versions)
    .where(eq(versions.id, toVersionId));
  if (!currentVersion) return;

  const [prev] = await dz.select({ id: versions.id })
    .from(versions)
    .where(
      and(
        eq(versions.chartId, currentVersion.chartId),
        lt(versions.sortOrder, currentVersion.sortOrder),
      )
    )
    .orderBy(desc(versions.sortOrder))
    .limit(1);
  if (!prev) return; // first version — nothing to diff against

  const fromVersionId = prev.id;

  // Don't re-enqueue if a diff job already exists for this pair
  // (jobs table is outside Drizzle schema — use raw query)
  const existing = await db.query(
    `SELECT id FROM jobs
     WHERE type = 'diff'
       AND payload->>'fromVersionId' = $1
       AND payload->>'toVersionId' = $2
       AND status != 'failed'`,
    [fromVersionId, toVersionId]
  );
  if (existing.rows.length > 0) return;

  await enqueueJob('diff', { ensembleId, fromVersionId, toVersionId });
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
