import dotenv from 'dotenv';
dotenv.config();

import { eq, and, isNull } from 'drizzle-orm';
import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { notifyNewVersion, notifyNewVersionNoDiff } from '../lib/notifications';
import { computeMeasureMapping, visionResultToPartDiff, ConcurrencyPool } from '../lib/vision-diff';
import { migrateAnnotationsForVersion } from '../lib/annotation-migration';
import type { VersionDiffJson } from '../lib/diff';
import { downloadFile } from '../lib/s3';
import { db, dz } from '../db';
import { parts, versions, charts, versionDiffs } from '../schema';

const POLL_INTERVAL_MS = parseInt(process.env.DIFF_POLL_INTERVAL_MS ?? '5000');
const MAX_ATTEMPTS     = parseInt(process.env.DIFF_MAX_ATTEMPTS     ?? '3');
const MAX_CONCURRENCY  = parseInt(process.env.VISION_MAX_CONCURRENCY ?? '5');

interface DiffJobPayload {
  ensembleId:    string;
  fromVersionId: string;
  toVersionId:   string;
  directorHint?: string;
}

interface PartRow {
  id:       string;
  name:     string;
  pdfS3Key: string;
}

async function processDiffJob(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { ensembleId, fromVersionId, toVersionId, directorHint } = payload;

  // Fetch parts for both versions
  const fromParts = await dz.select({
    id: parts.id,
    name: parts.name,
    pdfS3Key: parts.pdfS3Key,
  }).from(parts).where(and(eq(parts.versionId, fromVersionId), isNull(parts.deletedAt)));

  const toParts = await dz.select({
    id: parts.id,
    name: parts.name,
    pdfS3Key: parts.pdfS3Key,
  }).from(parts).where(and(eq(parts.versionId, toVersionId), isNull(parts.deletedAt)));

  if (fromParts.length === 0 || toParts.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] Skipping diff for ${toVersionId} — no parts in one or both versions`);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Match parts by name
  const toPartMap = new Map(toParts.map(p => [p.name, p]));
  const pairs = fromParts.filter(p => toPartMap.has(p.name));

  if (pairs.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] No matching instruments between versions — skipping diff`);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Run Vision diff for all instruments in parallel, capped by pool
  const pool = new ConcurrencyPool(MAX_CONCURRENCY);
  const partDiffResults = await Promise.all(
    pairs.map(fromPart => pool.run(async () => {
      const toPart = toPartMap.get(fromPart.name)!;
      try {
        const [oldPdf, newPdf] = await Promise.all([
          downloadFile(fromPart.pdfS3Key),
          downloadFile(toPart.pdfS3Key),
        ]);

        const result = await computeMeasureMapping(oldPdf, newPdf, fromPart.name, {
          directorHint,
          partId:        toPart.id,
          fromVersionId,
          toVersionId,
        });

        console.log(
          `[diff.worker] ${fromPart.name}: confidence=${result.overallConfidence.toFixed(2)}, ` +
          `changed=${result.changedMeasures.length}, inserted=${result.insertedMeasures.length}, ` +
          `deleted=${result.deletedMeasures.length}, latency=${result.processingMs}ms`
        );

        return {
          instrument:  fromPart.name,
          fromPartId:  fromPart.id,
          toPartId:    toPart.id,
          partDiff:    visionResultToPartDiff(result),
          ok:          true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[diff.worker] Vision diff failed for ${fromPart.name}:`, msg);
        return { instrument: fromPart.name, fromPartId: fromPart.id, toPartId: null, partDiff: null, ok: false };
      }
    }))
  );

  // Build version diff JSON — include all successful instrument diffs
  const diffParts: VersionDiffJson['parts'] = {};
  for (const r of partDiffResults) {
    if (r.ok && r.partDiff) diffParts[r.instrument] = r.partDiff;
  }

  if (Object.keys(diffParts).length === 0) {
    await completeJob(jobId);
    console.warn(`[diff.worker] All instrument diffs failed for ${toVersionId}`);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  const diffJson: VersionDiffJson = { parts: diffParts };

  // Store one version_diffs row per part pair
  for (const r of partDiffResults) {
    if (!r.ok || !r.partDiff || !r.toPartId) continue;
    await dz.insert(versionDiffs).values({
      fromPartId: r.fromPartId,
      toPartId: r.toPartId,
      diffJson: r.partDiff,
    });
  }

  await completeJob(jobId);
  console.log(`[diff.worker] Diff complete for version ${toVersionId} (${Object.keys(diffParts).length} instruments)`);

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

  await notifyNewVersion(ensembleId, toVersionId, diffJson as Parameters<typeof notifyNewVersion>[2]).catch(err =>
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
