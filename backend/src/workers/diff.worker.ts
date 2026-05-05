import dotenv from 'dotenv';
dotenv.config();

import { eq, and, isNull, sql, desc, ne } from 'drizzle-orm';
import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { notifyNewVersion, notifyNewVersionNoDiff } from '../lib/notifications';
import { migrateAnnotationsForVersion } from '../lib/annotation-migration';
import { diffPart, type VersionDiffJson, type OmrJson } from '../lib/diff';
import { downloadFile } from '../lib/s3';
import { db, dz } from '../db';
import { parts, versions, charts, versionDiffs, partSlotAssignments, instrumentSlots } from '../schema';

const MUSICDIFF_URL = process.env.MUSICDIFF_URL || 'http://localhost:8484';

const POLL_INTERVAL_MS = parseInt(process.env.DIFF_POLL_INTERVAL_MS ?? '5000');
const MAX_ATTEMPTS     = parseInt(process.env.DIFF_MAX_ATTEMPTS     ?? '3');

/**
 * Call musicdiff sidecar for note-level diff detail.
 * Returns null if sidecar is unavailable or parts lack MusicXML.
 */
interface MusicdiffResult {
  changedMeasures: number[];
  insertedMeasures: number[];
  deletedMeasures: number[];
  noteOperations: Array<{
    measure: number;
    operation: string;
    description: string;
  }>;
}

async function callMusicdiff(
  fromMxlKey: string | null,
  toMxlKey: string | null
): Promise<MusicdiffResult | null> {
  if (!fromMxlKey || !toMxlKey) return null;

  try {
    const [fromBuf, toBuf] = await Promise.all([
      downloadFile(fromMxlKey),
      downloadFile(toMxlKey),
    ]);

    const form = new FormData();
    form.append('old', new Blob([new Uint8Array(fromBuf)], { type: 'application/xml' }), 'old.musicxml');
    form.append('new', new Blob([new Uint8Array(toBuf)], { type: 'application/xml' }), 'new.musicxml');

    const response = await fetch(`${MUSICDIFF_URL}/diff`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      console.warn(`[diff.worker] musicdiff sidecar returned ${response.status}`);
      return null;
    }

    return await response.json() as MusicdiffResult;
  } catch (err) {
    // Sidecar not running or other error — graceful fallback
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      // Silent — sidecar not running
    } else {
      console.warn(`[diff.worker] musicdiff call failed: ${msg}`);
    }
    return null;
  }
}

interface DiffJobPayload {
  ensembleId:    string;
  fromVersionId: string;
  toVersionId:   string;
  directorHint?: string;
}

/**
 * For a given instrument slot, find the most recent part assigned to it
 * in any version prior to the current one.
 */
async function findPreviousVersionPartForSlot(opts: {
  chartId: string;
  currentVersionId: string;
  slotId: string;
}): Promise<{ id: string; name: string; pdfS3Key: string; versionId: string } | null> {
  const { chartId, currentVersionId, slotId } = opts;

  // Get all previous versions ordered newest-first
  const [currentVersion] = await dz.select({ sortOrder: versions.sortOrder })
    .from(versions)
    .where(eq(versions.id, currentVersionId));
  if (!currentVersion) return null;

  const previousVersions = await dz.select({ id: versions.id })
    .from(versions)
    .where(and(
      eq(versions.chartId, chartId),
      ne(versions.id, currentVersionId),
      sql`${versions.sortOrder} < ${currentVersion.sortOrder}`,
      isNull(versions.deletedAt),
    ))
    .orderBy(desc(versions.sortOrder));

  // Walk back through versions to find a part assigned to this slot
  for (const prevVersion of previousVersions) {
    const rows = await dz.select({
      id: parts.id,
      name: parts.name,
      pdfS3Key: parts.pdfS3Key,
      versionId: parts.versionId,
    })
      .from(parts)
      .innerJoin(partSlotAssignments, eq(parts.id, partSlotAssignments.partId))
      .where(and(
        eq(parts.versionId, prevVersion.id),
        eq(partSlotAssignments.instrumentSlotId, slotId),
        isNull(parts.deletedAt),
        sql`${parts.pdfS3Key} IS NOT NULL`,
      ))
      .orderBy(desc(parts.updatedAt))
      .limit(1);

    if (rows[0]) {
      return {
        id: rows[0].id,
        name: rows[0].name,
        pdfS3Key: rows[0].pdfS3Key!,
        versionId: rows[0].versionId,
      };
    }
  }

  return null;
}

/**
 * For a score part, find the most recent score in any previous version.
 */
async function findPreviousVersionScore(opts: {
  chartId: string;
  currentVersionId: string;
}): Promise<{ id: string; name: string; pdfS3Key: string; versionId: string } | null> {
  const { chartId, currentVersionId } = opts;

  const [currentVersion] = await dz.select({ sortOrder: versions.sortOrder })
    .from(versions)
    .where(eq(versions.id, currentVersionId));
  if (!currentVersion) return null;

  const previousVersions = await dz.select({ id: versions.id })
    .from(versions)
    .where(and(
      eq(versions.chartId, chartId),
      ne(versions.id, currentVersionId),
      sql`${versions.sortOrder} < ${currentVersion.sortOrder}`,
      isNull(versions.deletedAt),
    ))
    .orderBy(desc(versions.sortOrder));

  for (const prevVersion of previousVersions) {
    const rows = await dz.select({
      id: parts.id,
      name: parts.name,
      pdfS3Key: parts.pdfS3Key,
      versionId: parts.versionId,
    })
      .from(parts)
      .where(and(
        eq(parts.versionId, prevVersion.id),
        eq(parts.kind, 'score'),
        isNull(parts.deletedAt),
        sql`${parts.pdfS3Key} IS NOT NULL`,
      ))
      .orderBy(desc(parts.updatedAt))
      .limit(1);

    if (rows[0]) {
      return {
        id: rows[0].id,
        name: rows[0].name,
        pdfS3Key: rows[0].pdfS3Key!,
        versionId: rows[0].versionId,
      };
    }
  }

  return null;
}

interface DiffPair {
  fromPartId: string;
  fromPartName: string;
  toPartId: string;
  toPartName: string;
  slotId: string | null;  // null for score diffs
  slotName: string;       // "Score" for score diffs
}

async function processDiffJob(jobId: string, payload: DiffJobPayload): Promise<void> {
  const { ensembleId, fromVersionId, toVersionId, directorHint } = payload;

  // Get chart ID for this version
  const [toVersion] = await dz.select({ chartId: versions.chartId })
    .from(versions)
    .where(eq(versions.id, toVersionId));
  if (!toVersion) {
    await completeJob(jobId);
    console.log(`[diff.worker] Version ${toVersionId} not found — skipping`);
    return;
  }
  const chartId = toVersion.chartId;

  // Fetch all parts for the new version that have PDFs
  const toParts = await dz.select({
    id: parts.id,
    name: parts.name,
    kind: parts.kind,
    pdfS3Key: parts.pdfS3Key,
  }).from(parts).where(and(eq(parts.versionId, toVersionId), isNull(parts.deletedAt)));

  const diffableParts = toParts.filter(p => p.pdfS3Key && ['part', 'score', 'chart'].includes(p.kind));

  if (diffableParts.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] Skipping diff for ${toVersionId} — no diffable parts`);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Build diff pairs using slot-based matching
  const diffPairs: DiffPair[] = [];

  for (const toPart of diffableParts) {
    if (toPart.kind === 'score') {
      // Score diffs: compare against previous version's score (no slot)
      const prevScore = await findPreviousVersionScore({ chartId, currentVersionId: toVersionId });
      if (prevScore) {
        diffPairs.push({
          fromPartId: prevScore.id,
          fromPartName: prevScore.name,
          toPartId: toPart.id,
          toPartName: toPart.name,
          slotId: null,
          slotName: 'Score',
        });
      }
      continue;
    }

    // For non-score parts: find slot assignments and diff per slot
    const assignments = await dz.select({
      slotId: partSlotAssignments.instrumentSlotId,
      slotName: instrumentSlots.name,
    })
      .from(partSlotAssignments)
      .innerJoin(instrumentSlots, eq(instrumentSlots.id, partSlotAssignments.instrumentSlotId))
      .where(eq(partSlotAssignments.partId, toPart.id));

    for (const assignment of assignments) {
      const prevPart = await findPreviousVersionPartForSlot({
        chartId,
        currentVersionId: toVersionId,
        slotId: assignment.slotId,
      });

      if (prevPart) {
        diffPairs.push({
          fromPartId: prevPart.id,
          fromPartName: prevPart.name,
          toPartId: toPart.id,
          toPartName: toPart.name,
          slotId: assignment.slotId,
          slotName: assignment.slotName,
        });
      }
    }
  }

  if (diffPairs.length === 0) {
    await completeJob(jobId);
    console.log(`[diff.worker] No slot-based matches between versions — skipping diff`);
    await notifyNewVersionNoDiff(ensembleId, toVersionId).catch(err =>
      console.error('[diff.worker] Notification failed:', err)
    );
    return;
  }

  // Run LCS diff for each pair using OmrJson stored on the parts
  const diffParts: VersionDiffJson['parts'] = {};
  const partDiffResults: Array<DiffPair & { partDiff: ReturnType<typeof diffPart> | null; musicdiff: MusicdiffResult | null; ok: boolean }> = [];

  for (const pair of diffPairs) {
    try {
      // Load OmrJson and MusicXML keys from both parts
      const [fromRows, toRows] = await Promise.all([
        dz.select({ omrJson: parts.omrJson, mxlKey: parts.audiverisMxlS3Key }).from(parts).where(eq(parts.id, pair.fromPartId)),
        dz.select({ omrJson: parts.omrJson, mxlKey: parts.audiverisMxlS3Key }).from(parts).where(eq(parts.id, pair.toPartId)),
      ]);

      const fromOmr = fromRows[0]?.omrJson as OmrJson | null;
      const toOmr = toRows[0]?.omrJson as OmrJson | null;
      const fromMxlKey = fromRows[0]?.mxlKey ?? null;
      const toMxlKey = toRows[0]?.mxlKey ?? null;

      if (!fromOmr || !toOmr) {
        console.warn(`[diff.worker] Missing OmrJson for ${pair.slotName} (${pair.toPartName}) — skipping`);
        partDiffResults.push({ ...pair, partDiff: null, musicdiff: null, ok: false });
        continue;
      }

      const start = Date.now();
      const partDiff = diffPart(fromOmr, toOmr);
      const elapsed = Date.now() - start;

      const allChanged = [
        ...partDiff.changedMeasures,
        ...partDiff.structuralChanges.insertedMeasures,
      ];

      console.log(
        `[diff.worker] ${pair.slotName} (${pair.toPartName}): ` +
        `changed=${allChanged.length}, inserted=${partDiff.structuralChanges.insertedMeasures.length}, ` +
        `deleted=${partDiff.structuralChanges.deletedMeasures.length}, latency=${elapsed}ms`
      );

      // Call musicdiff sidecar for note-level detail (non-blocking)
      let musicdiffResult: MusicdiffResult | null = null;
      if (fromMxlKey && toMxlKey) {
        musicdiffResult = await callMusicdiff(fromMxlKey, toMxlKey);
        if (musicdiffResult) {
          console.log(
            `[diff.worker] musicdiff ${pair.slotName}: ` +
            `${musicdiffResult.noteOperations.length} note operations`
          );
        }
      }

      diffParts[pair.slotName] = partDiff;
      partDiffResults.push({ ...pair, partDiff, musicdiff: musicdiffResult, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[diff.worker] LCS diff failed for ${pair.slotName} (${pair.toPartName}):`, msg);
      partDiffResults.push({ ...pair, partDiff: null, musicdiff: null, ok: false });
    }
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

  // Store one version_diffs row per (part, slot) pair
  for (const r of partDiffResults) {
    if (!r.ok || !r.partDiff) continue;
    const storedDiff = r.musicdiff
      ? { ...r.partDiff, musicdiff: r.musicdiff }
      : r.partDiff;
    await dz.insert(versionDiffs).values({
      fromPartId: r.fromPartId,
      toPartId: r.toPartId,
      slotId: r.slotId,
      diffJson: storedDiff,
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
