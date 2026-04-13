import dotenv from 'dotenv';
dotenv.config();

import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { diffVersion, OmrJson } from '../lib/diff';
import { db } from '../db';

const POLL_INTERVAL_MS = parseInt(process.env.DIFF_POLL_INTERVAL_MS ?? '5000');
const MAX_ATTEMPTS = parseInt(process.env.DIFF_MAX_ATTEMPTS ?? '3');

interface DiffJobPayload {
  chartId: string;
  fromVersionId: string;
  toVersionId: string;
}

async function processDiffJob(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { chartId, fromVersionId, toVersionId } = payload;

  // Fetch OMR JSON for all complete parts in both versions
  const fromParts = await db.query<{ instrument_name: string; omr_json: OmrJson }>(
    `SELECT instrument_name, omr_json FROM parts
     WHERE chart_version_id = $1 AND omr_status = 'complete' AND omr_json IS NOT NULL`,
    [fromVersionId]
  );

  const toParts = await db.query<{ instrument_name: string; omr_json: OmrJson }>(
    `SELECT instrument_name, omr_json FROM parts
     WHERE chart_version_id = $1 AND omr_status = 'complete' AND omr_json IS NOT NULL`,
    [toVersionId]
  );

  if (fromParts.rows.length === 0 || toParts.rows.length === 0) {
    // Nothing to diff — one side has no OMR data
    await completeJob(jobId);
    console.log(`[diff.worker] Skipping diff for ${toVersionId} — insufficient OMR data`);
    return;
  }

  // Match parts by instrument name
  const toPartMap = new Map(toParts.rows.map((p) => [p.instrument_name, p.omr_json]));
  const pairs = fromParts.rows
    .filter((p) => toPartMap.has(p.instrument_name))
    .map((p) => ({
      instrument: p.instrument_name,
      oldOmr: p.omr_json,
      newOmr: toPartMap.get(p.instrument_name)!,
    }));

  if (pairs.length === 0) {
    // Instrument lineup changed entirely — no common parts to diff
    await completeJob(jobId);
    console.log(`[diff.worker] No matching instruments between versions — skipping diff`);
    return;
  }

  const diffJson = diffVersion(pairs);

  await db.query(
    `INSERT INTO version_diffs (chart_id, from_version_id, to_version_id, diff_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_version_id, to_version_id)
     DO UPDATE SET diff_json = EXCLUDED.diff_json, updated_at = NOW()`,
    [chartId, fromVersionId, toVersionId, JSON.stringify(diffJson)]
  );

  await completeJob(jobId);
  console.log(`[diff.worker] Diff computed for version ${toVersionId} (${pairs.length} parts)`);
}

async function tick(): Promise<void> {
  const job = await claimNextJob('diff');
  if (!job) return;

  const payload = job.payload as DiffJobPayload;
  console.log(`[diff.worker] Processing diff job ${job.id} → version ${payload.toVersionId}`);

  try {
    await processDiffJob(job.id, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[diff.worker] Job ${job.id} failed: ${message}`);
    await failJob(job.id, message, MAX_ATTEMPTS);
  }
}

async function run(): Promise<void> {
  console.log(`[diff.worker] Started — polling every ${POLL_INTERVAL_MS}ms`);
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

run().catch((err) => {
  console.error('[diff.worker] Fatal error:', err);
  process.exit(1);
});
