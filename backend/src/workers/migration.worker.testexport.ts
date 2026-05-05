/**
 * Re-exports the core migration processing function for use in tests.
 * The main worker file starts a polling loop on import, so we isolate
 * the testable logic here.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { dz } from '../db';
import { annotations, parts, partSlotAssignments, versionDiffs } from '../schema';
import type { PartDiff, MeasureBounds } from '../lib/diff';

interface MigrationSource {
  sourcePartId: string;
  sourceVersionId: string;
  targetPartId: string;
}

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

export async function processMigrationSource(
  source: MigrationSource,
  userId: string,
): Promise<{ sourcePartId: string; migrated: number; flagged: number; skipped: number; failed: boolean; error?: string }> {
  const { sourcePartId, targetPartId } = source;

  try {
    const isSameInstrument = await sharesSlot(sourcePartId, targetPartId);
    const migrationSourceKind = isSameInstrument ? 'same_instrument' as const : 'cross_instrument' as const;

    // Try to find an existing diff
    const diffRows = await dz.select({ diffJson: versionDiffs.diffJson })
      .from(versionDiffs)
      .where(and(eq(versionDiffs.fromPartId, sourcePartId), eq(versionDiffs.toPartId, targetPartId)));

    let measureMapping: Record<number, number | null> = {};
    let measureConfidence: Record<number, number> | undefined;

    if (diffRows[0]) {
      const partDiff = diffRows[0].diffJson as unknown as PartDiff;
      measureMapping = partDiff.measureMapping;
      measureConfidence = partDiff.measureConfidence;
    } else {
      type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
      const [srcPart] = await dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, sourcePartId));
      const srcOmr = srcPart?.omrJson as OmrData;
      for (const m of srcOmr?.measures ?? []) {
        measureMapping[m.number] = m.number;
      }
    }

    const newMeasureToPage = new Map<number, number>();
    type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
    const [tgtPart] = await dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, targetPartId));
    const tgtOmr = tgtPart?.omrJson as OmrData;
    for (const m of tgtOmr?.measures ?? []) {
      if (m.bounds && !newMeasureToPage.has(m.number)) newMeasureToPage.set(m.number, m.bounds.page);
    }

    // WIDE READING: fetch all migratable annotations, NO owner_user_id filter
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

      const needsReview = migrationSourceKind === 'cross_instrument' ? true : anchorNeedsReview;

      await dz.insert(annotations).values({
        partId: targetPartId,
        ownerUserId: userId,
        anchorType: newAnchorType,
        anchorJson: newAnchorJson,
        kind: ann.kind,
        contentJson: ann.contentJson,
        sourceAnnotationId: ann.id,
        sourceVersionId: source.sourceVersionId,
        migrationSourceKind: migrationSourceKind,
        needsReview,
        migratable: true,
      });

      if (needsReview) flagged++;
      else migrated++;
    }

    return { sourcePartId, migrated, flagged, skipped, failed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sourcePartId, migrated: 0, flagged: 0, skipped: 0, failed: true, error: msg };
  }
}
