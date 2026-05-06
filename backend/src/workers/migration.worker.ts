import dotenv from 'dotenv';
dotenv.config();

import { eq, and, isNull, sql } from 'drizzle-orm';
import { claimNextJob, completeJob, failJob } from '../lib/queue';
import { dz } from '../db';
import { annotations, parts, partSlotAssignments, versionDiffs, versions, charts } from '../schema';
import type { PartDiff, MeasureBounds } from '../lib/diff';
import { sendNotification } from '../notifications/send';

const POLL_INTERVAL_MS = parseInt(process.env.MIGRATION_POLL_INTERVAL_MS ?? '5000');
const MAX_ATTEMPTS = parseInt(process.env.MIGRATION_MAX_ATTEMPTS ?? '3');

interface MigrationSource {
  sourcePartId: string;
  sourceVersionId: string;
  targetPartId: string;
}

interface MigrationJobPayload {
  versionId: string;
  userId: string;
  sources: MigrationSource[];
}

/**
 * Determine if source and target parts share an instrument slot.
 */
async function sharesSlot(sourcePartId: string, targetPartId: string): Promise<boolean> {
  const [srcSlots, tgtSlots] = await Promise.all([
    dz.select({ slotId: partSlotAssignments.instrumentSlotId })
      .from(partSlotAssignments)
      .where(eq(partSlotAssignments.partId, sourcePartId)),
    dz.select({ slotId: partSlotAssignments.instrumentSlotId })
      .from(partSlotAssignments)
      .where(eq(partSlotAssignments.partId, targetPartId)),
  ]);
  const tgtSet = new Set(tgtSlots.map(r => r.slotId));
  return srcSlots.some(r => tgtSet.has(r.slotId));
}

/**
 * Migrate anchor using measure mapping from a diff, or identity if no diff exists.
 */
function migrateAnchor(
  anchorType: string,
  anchorJson: Record<string, unknown>,
  measureMapping: Record<number, number | null>,
  measureConfidence?: Record<number, number>,
  newMeasureToPage?: Map<number, number>,
): { newAnchorType: string; newAnchorJson: Record<string, unknown>; needsReview: boolean } {
  switch (anchorType) {
    case 'measure': {
      const oldN = anchorJson.measureNumber as number;
      const newN = measureMapping[oldN];
      if (newN == null) return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      const conf = measureConfidence?.[oldN];
      const newPageHint = newMeasureToPage?.get(newN);
      return {
        newAnchorType: 'measure',
        newAnchorJson: { measureNumber: newN, ...(newPageHint !== undefined ? { pageHint: newPageHint } : {}) },
        needsReview: conf !== undefined && conf < 0.80,
      };
    }
    case 'beat': {
      const oldN = anchorJson.measureNumber as number;
      const newN = measureMapping[oldN];
      if (newN == null) return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      const conf = measureConfidence?.[oldN];
      return {
        newAnchorType: 'beat',
        newAnchorJson: { measureNumber: newN, beat: anchorJson.beat },
        needsReview: conf !== undefined && conf < 0.75,
      };
    }
    case 'note': {
      const oldN = anchorJson.measureNumber as number;
      const newN = measureMapping[oldN];
      if (newN == null) return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      const conf = measureConfidence?.[oldN];
      return {
        newAnchorType: 'note',
        newAnchorJson: { measureNumber: newN, beat: anchorJson.beat, pitch: anchorJson.pitch, duration: anchorJson.duration },
        needsReview: conf !== undefined && conf < 0.75,
      };
    }
    case 'section':
      return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: false };
    case 'page': {
      const hint = anchorJson.measureHint as number | undefined;
      if (hint !== undefined) {
        const newN = measureMapping[hint];
        if (newN != null) {
          const newPageHint = newMeasureToPage?.get(newN);
          return {
            newAnchorType: 'measure',
            newAnchorJson: { measureNumber: newN, ...(newPageHint !== undefined ? { pageHint: newPageHint } : {}) },
            needsReview: false,
          };
        }
      }
      return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
    }
    default:
      return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
  }
}

async function processMigrationSource(
  source: MigrationSource,
  userId: string,
): Promise<{ sourcePartId: string; migrated: number; flagged: number; skipped: number; failed: boolean; error?: string }> {
  const { sourcePartId, targetPartId } = source;

  try {
    // Determine migration_source_kind
    const isSameInstrument = await sharesSlot(sourcePartId, targetPartId);
    const migrationSourceKind = isSameInstrument ? 'same_instrument' as const : 'cross_instrument' as const;

    // Try to find an existing diff between source and target parts
    const diffRows = await dz.select({ diffJson: versionDiffs.diffJson })
      .from(versionDiffs)
      .where(and(eq(versionDiffs.fromPartId, sourcePartId), eq(versionDiffs.toPartId, targetPartId)));

    // Build measure mapping
    let measureMapping: Record<number, number | null> = {};
    let measureConfidence: Record<number, number> | undefined;

    if (diffRows[0]) {
      const partDiff = diffRows[0].diffJson as unknown as PartDiff;
      measureMapping = partDiff.measureMapping;
      measureConfidence = partDiff.measureConfidence;
    } else {
      // No diff: identity mapping for cross-instrument (all flagged for review)
      type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
      const [srcPart] = await dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, sourcePartId));
      const srcOmr = srcPart?.omrJson as OmrData;
      for (const m of srcOmr?.measures ?? []) {
        measureMapping[m.number] = m.number;
      }
    }

    // Build measure-to-page map from target
    const newMeasureToPage = new Map<number, number>();
    type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
    const [tgtPart] = await dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, targetPartId));
    const tgtOmr = tgtPart?.omrJson as OmrData;
    for (const m of tgtOmr?.measures ?? []) {
      if (m.bounds && !newMeasureToPage.has(m.number)) newMeasureToPage.set(m.number, m.bounds.page);
    }

    // Fetch all migratable annotations from source part — WIDE READING: no owner_user_id filter
    const annRows = await dz.select({
      id: annotations.id,
      ownerUserId: annotations.ownerUserId,
      anchorType: annotations.anchorType,
      anchorJson: annotations.anchorJson,
      kind: annotations.kind,
      contentJson: annotations.contentJson,
    })
      .from(annotations)
      .where(and(
        eq(annotations.partId, sourcePartId),
        isNull(annotations.deletedAt),
        eq(annotations.migratable, true),
      ));

    let migrated = 0;
    let flagged = 0;
    let skipped = 0;

    for (const ann of annRows) {
      // Idempotency: skip if already migrated from this source annotation to target part
      const existing = await dz.select({ id: annotations.id })
        .from(annotations)
        .where(and(
          eq(annotations.sourceAnnotationId, ann.id),
          eq(annotations.partId, targetPartId),
          isNull(annotations.deletedAt),
        ));
      if (existing.length > 0) { skipped++; continue; }

      const { newAnchorType, newAnchorJson, needsReview: anchorNeedsReview } = migrateAnchor(
        ann.anchorType,
        ann.anchorJson as Record<string, unknown>,
        measureMapping,
        measureConfidence,
        newMeasureToPage,
      );

      // Cross-instrument always needs review; same-instrument uses anchor logic
      const needsReview = migrationSourceKind === 'cross_instrument' ? true : anchorNeedsReview;

      await dz.insert(annotations).values({
        partId: targetPartId,
        ownerUserId: userId, // Destination user owns the copy
        anchorType: newAnchorType,
        anchorJson: newAnchorJson,
        kind: ann.kind,
        contentJson: ann.contentJson,
        sourceAnnotationId: ann.id,
        sourceVersionId: source.sourceVersionId,
        migrationSourceKind: migrationSourceKind,
        needsReview,
        migratable: true, // Copy is migratable by default
      });

      if (needsReview) flagged++;
      else migrated++;
    }

    return { sourcePartId, migrated, flagged, skipped, failed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[migration.worker] Source ${sourcePartId} failed: ${msg}`);
    return { sourcePartId, migrated: 0, flagged: 0, skipped: 0, failed: true, error: msg };
  }
}

async function processMigrationJob(jobId: string, payload: MigrationJobPayload): Promise<void> {
  const { userId, sources } = payload;

  console.log(`[migration.worker] Processing migration job ${jobId}: ${sources.length} sources`);

  const results = [];
  let anyFailed = false;

  for (const source of sources) {
    const result = await processMigrationSource(source, userId);
    results.push(result);
    if (result.failed) anyFailed = true;
    console.log(
      `[migration.worker] Source ${source.sourcePartId} → ${source.targetPartId}: ` +
      `${result.migrated} migrated, ${result.flagged} flagged, ${result.skipped} skipped` +
      (result.failed ? ` [FAILED: ${result.error}]` : ''),
    );
  }

  if (anyFailed && results.every(r => r.failed)) {
    // All failed — send migration_failed notification, then throw
    try {
      const targetPartId = sources[0]?.targetPartId;
      if (targetPartId) {
        const [part] = await dz.select({
          versionId: parts.versionId,
          chartId: versions.chartId,
          chartName: charts.name,
          versionName: versions.name,
          ensembleId: charts.ensembleId,
        })
          .from(parts)
          .innerJoin(versions, eq(versions.id, parts.versionId))
          .innerJoin(charts, eq(charts.id, versions.chartId))
          .where(eq(parts.id, targetPartId));
        if (part) {
          await sendNotification(userId, {
            eventType: 'migration_failed',
            ensembleId: part.ensembleId,
            payload: {
              partId: targetPartId,
              versionId: part.versionId,
              chartId: part.chartId,
              chartName: part.chartName,
              versionName: part.versionName,
              error: results[0]?.error ?? 'All sources failed',
            },
          });
        }
      }
    } catch (notifErr) {
      console.error('[migration.worker] Failed to send migration_failed notification:', notifErr);
    }
    throw new Error(`All ${sources.length} migration sources failed`);
  }

  // Send migration_complete notification
  try {
    const targetPartId = sources[0]?.targetPartId;
    if (targetPartId) {
      const [part] = await dz.select({
        versionId: parts.versionId,
        chartId: versions.chartId,
        chartName: charts.name,
        versionName: versions.name,
        ensembleId: charts.ensembleId,
      })
        .from(parts)
        .innerJoin(versions, eq(versions.id, parts.versionId))
        .innerJoin(charts, eq(charts.id, versions.chartId))
        .where(eq(parts.id, targetPartId));
      if (part) {
        const sourcesSucceeded = results.filter(r => !r.failed).length;
        const sourcesFailed = results.filter(r => r.failed).length;
        const annotationsAdded = results.reduce((sum, r) => sum + r.migrated + r.flagged, 0);
        await sendNotification(userId, {
          eventType: 'migration_complete',
          ensembleId: part.ensembleId,
          payload: {
            partId: targetPartId,
            versionId: part.versionId,
            chartId: part.chartId,
            chartName: part.chartName,
            versionName: part.versionName,
            sourcesSucceeded,
            sourcesFailed,
            annotationsAdded,
          },
        });
      }
    }
  } catch (notifErr) {
    console.error('[migration.worker] Failed to send migration_complete notification:', notifErr);
  }

  await completeJob(jobId);
  console.log(`[migration.worker] Job ${jobId} complete`);
}

async function tick(): Promise<void> {
  const job = await claimNextJob('migration');
  if (!job) return;

  const payload = job.payload as MigrationJobPayload;
  console.log(`[migration.worker] Claimed job ${job.id}`);

  try {
    await processMigrationJob(job.id, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[migration.worker] Job ${job.id} failed: ${message}`);
    await failJob(job.id, message, MAX_ATTEMPTS);
  }
}

async function run(): Promise<void> {
  console.log(`[migration.worker] Started — polling every ${POLL_INTERVAL_MS}ms`);
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

run().catch(err => {
  console.error('[migration.worker] Fatal error:', err);
  process.exit(1);
});
