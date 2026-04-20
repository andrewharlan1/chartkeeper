import dotenv from 'dotenv';
dotenv.config();

import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { notifyNewVersion, notifyNewVersionNoDiff } from '../lib/notifications';
import { computeMeasureMapping, visionResultToPartDiff, ConcurrencyPool } from '../lib/vision-diff';
import { migrateAnnotationsForVersion } from '../lib/annotation-migration';
import type { VersionDiffJson } from '../lib/diff';
import { downloadFile } from '../lib/s3';
import { db } from '../db';

const POLL_INTERVAL_MS = parseInt(process.env.DIFF_POLL_INTERVAL_MS ?? '5000');
const MAX_ATTEMPTS     = parseInt(process.env.DIFF_MAX_ATTEMPTS     ?? '3');
const MAX_CONCURRENCY  = parseInt(process.env.VISION_MAX_CONCURRENCY ?? '5');

interface DiffJobPayload {
  chartId:       string;
  fromVersionId: string;
  toVersionId:   string;
  directorHint?: string;
}

interface PartRow {
  id:              string;
  instrument_name: string;
  pdf_s3_key:      string;
}

async function processDiffJob(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { chartId, fromVersionId, toVersionId, directorHint } = payload;

  // Fetch parts for both versions — only need pdf_s3_key now, no OMR dependency
  const fromParts = await db.query<PartRow>(
    `SELECT id, instrument_name, pdf_s3_key
     FROM parts WHERE chart_version_id = $1 AND deleted_at IS NULL`,
    [fromVersionId]
  );
  const toParts = await db.query<PartRow>(
    `SELECT id, instrument_name, pdf_s3_key
     FROM parts WHERE chart_version_id = $1 AND deleted_at IS NULL`,
    [toVersionId]
  );

  if (fromParts.rows.length === 0 || toParts.rows.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] Skipping diff for ${toVersionId} — no parts in one or both versions`);
    await notifyNewVersionNoDiff(chartId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Match parts by instrument name
  const toPartMap = new Map(toParts.rows.map(p => [p.instrument_name, p]));
  const pairs = fromParts.rows.filter(p => toPartMap.has(p.instrument_name));

  if (pairs.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] No matching instruments between versions — skipping diff`);
    await notifyNewVersionNoDiff(chartId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Run Vision diff for all instruments in parallel, capped by pool
  const pool = new ConcurrencyPool(MAX_CONCURRENCY);
  const partDiffResults = await Promise.all(
    pairs.map(fromPart => pool.run(async () => {
      const toPart = toPartMap.get(fromPart.instrument_name)!;
      try {
        const [oldPdf, newPdf] = await Promise.all([
          downloadFile(fromPart.pdf_s3_key),
          downloadFile(toPart.pdf_s3_key),
        ]);

        const result = await computeMeasureMapping(oldPdf, newPdf, fromPart.instrument_name, {
          directorHint,
          partId:        toPart.id,
          fromVersionId,
          toVersionId,
        });

        console.log(
          `[diff.worker] ${fromPart.instrument_name}: confidence=${result.overallConfidence.toFixed(2)}, ` +
          `changed=${result.changedMeasures.length}, inserted=${result.insertedMeasures.length}, ` +
          `deleted=${result.deletedMeasures.length}, latency=${result.processingMs}ms`
        );

        return {
          instrument: fromPart.instrument_name,
          partDiff:   visionResultToPartDiff(result),
          ok:         true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[diff.worker] Vision diff failed for ${fromPart.instrument_name}:`, msg);
        return { instrument: fromPart.instrument_name, partDiff: null, ok: false };
      }
    }))
  );

  // Build version diff JSON — include all successful instrument diffs
  const parts: VersionDiffJson['parts'] = {};
  for (const r of partDiffResults) {
    if (r.ok && r.partDiff) parts[r.instrument] = r.partDiff;
  }

  if (Object.keys(parts).length === 0) {
    // All instruments failed — still complete the job, notify without diff
    await completeJob(jobId);
    console.warn(`[diff.worker] All instrument diffs failed for ${toVersionId}`);
    await notifyNewVersionNoDiff(chartId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  const diffJson = { parts };

  await db.query(
    `INSERT INTO version_diffs (chart_id, from_version_id, to_version_id, diff_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_version_id, to_version_id)
     DO UPDATE SET diff_json = EXCLUDED.diff_json, updated_at = NOW()`,
    [chartId, fromVersionId, toVersionId, JSON.stringify(diffJson)]
  );

  await completeJob(jobId);
  console.log(`[diff.worker] Diff complete for version ${toVersionId} (${Object.keys(parts).length} instruments)`);

  // Migrate annotations from the previous version's parts to the new parts
  await migrateAnnotationsForVersion(fromVersionId, toVersionId, diffJson).then(summaries => {
    for (const s of summaries) {
      if (s.total > 0) {
        console.log(
          `[diff.worker] Annotations migrated for ${s.instrument}: ` +
          `${s.migrated} clean, ${s.flagged} flagged for review, ${s.skipped} skipped`
        );
      }
    }
  }).catch(err => console.error('[diff.worker] Annotation migration failed:', err));

  await notifyNewVersion(chartId, toVersionId, diffJson as Parameters<typeof notifyNewVersion>[2]).catch(err =>
    console.error('[diff.worker] Notification failed:', err)
  );
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

run().catch(err => {
  console.error('[diff.worker] Fatal error:', err);
  process.exit(1);
});
