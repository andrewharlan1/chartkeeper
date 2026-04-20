import { eq, and, isNull, sql, ne } from 'drizzle-orm';
import { dz } from '../db';
import { annotations, parts, versions, versionDiffs } from '../schema';
import type { VersionDiffJson, PartDiff, MeasureBounds } from './diff';

export interface MigrationSummary {
  instrument: string;
  total:     number;
  migrated:  number; // clean — HIGH confidence
  flagged:   number; // needsReview = true — player must confirm
  skipped:   number; // already migrated (idempotency guard)
}

// ── Anchor migration rules ────────────────────────────────────────────────────
//
// Each anchor type has a clear migration path:
//
//   measure  → look up measureMapping[N]; if null/missing → flag
//   beat     → same measure lookup; carry beat through
//   note     → same measure lookup; carry beat/pitch/duration through
//   section  → section label is a stable musical identifier; pass through
//   page     → page layout changes every version; upgrade to measure if measureHint
//              is available and maps cleanly, otherwise flag

function migrateAnchor(
  anchorType:  string,
  anchorJson:  Record<string, unknown>,
  partDiff:    PartDiff,
  newMeasureToPage?: Map<number, number>,
): { newAnchorType: string; newAnchorJson: Record<string, unknown>; needsReview: boolean } {
  const mm = partDiff.measureMapping;

  switch (anchorType) {
    case 'measure': {
      const oldN = anchorJson.measureNumber as number;
      const newN = mm[oldN];
      if (newN == null) {
        return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      }
      const conf = partDiff.measureConfidence?.[oldN];
      const lowConfidence = conf !== undefined && conf < 0.80;
      // Resolve pageHint from the NEW version's measure layout instead of
      // carrying the old version's stale pageHint
      const newPageHint = newMeasureToPage?.get(newN);
      return {
        newAnchorType: 'measure',
        newAnchorJson: {
          measureNumber: newN,
          ...(newPageHint !== undefined ? { pageHint: newPageHint } : {}),
        },
        needsReview: lowConfidence,
      };
    }

    case 'beat': {
      const oldN = anchorJson.measureNumber as number;
      const newN = mm[oldN];
      if (newN == null) {
        return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      }
      const conf = partDiff.measureConfidence?.[oldN];
      return {
        newAnchorType: 'beat',
        newAnchorJson: { measureNumber: newN, beat: anchorJson.beat },
        needsReview:   conf !== undefined && conf < 0.75,
      };
    }

    case 'note': {
      const oldN = anchorJson.measureNumber as number;
      const newN = mm[oldN];
      if (newN == null) {
        return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: true };
      }
      const conf = partDiff.measureConfidence?.[oldN];
      return {
        newAnchorType: 'note',
        newAnchorJson: {
          measureNumber: newN,
          beat:     anchorJson.beat,
          pitch:    anchorJson.pitch,
          duration: anchorJson.duration,
        },
        needsReview: conf !== undefined && conf < 0.75,
      };
    }

    case 'section': {
      // Section labels are stable musical identifiers (rehearsal letters, named sections).
      // The label remains valid even if the section shifted measure positions — the rendering
      // layer resolves the label against the current version's section data at display time.
      return { newAnchorType: anchorType, newAnchorJson: anchorJson, needsReview: false };
    }

    case 'page': {
      // Page layout changes with every version reprint.
      // Upgrade to a measure anchor if measureHint maps cleanly.
      const hint = anchorJson.measureHint as number | undefined;
      if (hint !== undefined) {
        const newN = mm[hint];
        if (newN != null) {
          // Resolve pageHint from the new version's measure layout
          const newPageHint = newMeasureToPage?.get(newN);
          return {
            newAnchorType: 'measure',
            newAnchorJson: {
              measureNumber: newN,
              ...(newPageHint !== undefined ? { pageHint: newPageHint } : {}),
            },
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

// ── Ink content relocation ────────────────────────────────────────────────────

/**
 * Shift all stroke points and highlight rects by (dx, dy) so that ink
 * annotations follow their measure when it moves between versions.
 */
function relocateInkContent(
  content: Record<string, unknown>,
  dx: number,
  dy: number,
): Record<string, unknown> {
  const result = { ...content };

  if (Array.isArray(content.strokes)) {
    result.strokes = content.strokes.map((stroke: Record<string, unknown>) => ({
      ...stroke,
      points: Array.isArray(stroke.points)
        ? stroke.points.map((p: { x: number; y: number }) => ({
            ...p,
            x: p.x + dx,
            y: p.y + dy,
          }))
        : stroke.points,
    }));
  }

  if (Array.isArray(content.highlights)) {
    result.highlights = content.highlights.map((hl: Record<string, unknown>) => ({
      ...hl,
      x: (hl.x as number) + dx,
      y: (hl.y as number) + dy,
    }));
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * For every instrument in the diff, copy each player's annotations from the
 * old version's parts to the new version's parts, updating anchors via the
 * measure mapping.
 *
 * Idempotent: if an annotation has already been migrated to a given part it
 * won't be duplicated.
 */
export async function migrateAnnotationsForVersion(
  fromVersionId: string,
  toVersionId:   string,
  diffJson:      VersionDiffJson,
): Promise<MigrationSummary[]> {
  const summaries: MigrationSummary[] = [];

  for (const [instrument, partDiff] of Object.entries(diffJson.parts)) {
    // Find old and new parts by version + name
    const [oldPartRows, newPartRows] = await Promise.all([
      dz.select({ id: parts.id })
        .from(parts)
        .where(and(eq(parts.versionId, fromVersionId), eq(parts.name, instrument), isNull(parts.deletedAt))),
      dz.select({ id: parts.id })
        .from(parts)
        .where(and(eq(parts.versionId, toVersionId), eq(parts.name, instrument), isNull(parts.deletedAt))),
    ]);

    if (!oldPartRows[0] || !newPartRows[0]) continue;

    const oldPartId = oldPartRows[0].id;
    const newPartId = newPartRows[0].id;

    // Load measure layout from both old and new parts
    // - newMeasureToPage: for setting pageHint on migrated anchors
    // - oldMeasureBounds / newMeasureBounds: for relocating ink stroke coordinates
    const newMeasureToPage = new Map<number, number>();
    const oldMeasureBounds = new Map<number, MeasureBounds>();
    const newMeasureBounds = new Map<number, MeasureBounds>();

    const [oldOmrRows, newOmrRows] = await Promise.all([
      dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, oldPartId)),
      dz.select({ omrJson: parts.omrJson }).from(parts).where(eq(parts.id, newPartId)),
    ]);

    type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
    const oldOmr = oldOmrRows[0]?.omrJson as OmrData;
    const newOmr = newOmrRows[0]?.omrJson as OmrData;

    for (const m of oldOmr?.measures ?? []) {
      if (m.bounds && !oldMeasureBounds.has(m.number)) {
        oldMeasureBounds.set(m.number, m.bounds);
      }
    }
    for (const m of newOmr?.measures ?? []) {
      if (m.bounds) {
        if (!newMeasureToPage.has(m.number)) newMeasureToPage.set(m.number, m.bounds.page);
        if (!newMeasureBounds.has(m.number)) newMeasureBounds.set(m.number, m.bounds);
      }
    }

    // Fetch annotations from old part
    const annRows = await dz.select({
      id: annotations.id,
      ownerUserId: annotations.ownerUserId,
      anchorType: annotations.anchorType,
      anchorJson: annotations.anchorJson,
      kind: annotations.kind,
      contentJson: annotations.contentJson,
    })
      .from(annotations)
      .where(and(eq(annotations.partId, oldPartId), isNull(annotations.deletedAt)));

    let migrated = 0;
    let flagged  = 0;
    let skipped  = 0;

    for (const ann of annRows) {
      // Idempotency: skip if already migrated to this target part
      const existing = await dz.select({ id: annotations.id })
        .from(annotations)
        .where(and(
          eq(annotations.migratedFromAnnotationId, ann.id),
          eq(annotations.partId, newPartId),
          isNull(annotations.deletedAt),
        ));
      if (existing.length > 0) { skipped++; continue; }

      const { newAnchorType, newAnchorJson, needsReview } = migrateAnchor(
        ann.anchorType,
        ann.anchorJson as Record<string, unknown>,
        partDiff,
        newMeasureToPage,
      );

      // Migrate content based on object model type.
      //
      // New object-model annotations have a `boundingBox` in content_json with
      // measure-relative coordinates (0-1). These don't need page-coordinate
      // relocation — the coordinates stay valid because they're relative to the
      // measure, not the page.
      //
      // Old-style annotations store ink strokes in page coordinates and need
      // dx/dy relocation when the measure moves.
      let migratedContent = ann.contentJson as Record<string, unknown>;
      const isObjectModel = migratedContent.boundingBox != null;

      if (!isObjectModel && ann.kind === 'ink' && newAnchorType === 'measure') {
        // Old-style page-coordinate ink: shift strokes by measure center offset
        const oldMN = (ann.anchorJson as Record<string, unknown>).measureNumber as number | undefined;
        const newMN = (newAnchorJson as Record<string, unknown>).measureNumber as number | undefined;
        if (oldMN != null && newMN != null) {
          const oldB = oldMeasureBounds.get(oldMN);
          const newB = newMeasureBounds.get(newMN);
          if (oldB && newB) {
            const dx = (newB.x + newB.w / 2) - (oldB.x + oldB.w / 2);
            const dy = (newB.y + newB.h / 2) - (oldB.y + oldB.h / 2);
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
              migratedContent = relocateInkContent(migratedContent, dx, dy);
            }
          }
        }
      }
      // New object-model annotations (ink, text, highlight, shape):
      // Content is already measure-relative — copy as-is.

      // New schema has no `is_unresolved` column. Encode review flag in contentJson.
      const finalContent = needsReview
        ? { ...migratedContent, _needsReview: true }
        : migratedContent;

      await dz.insert(annotations).values({
        partId: newPartId,
        ownerUserId: ann.ownerUserId,
        anchorType: newAnchorType,
        anchorJson: newAnchorJson,
        kind: ann.kind,
        contentJson: finalContent,
        migratedFromAnnotationId: ann.id,
      });

      if (needsReview) flagged++;
      else             migrated++;
    }

    summaries.push({ instrument, total: annRows.length, migrated, flagged, skipped });
  }

  return summaries;
}

// ── Per-part migration (for manual migration UI) ─────────────────────────────

/**
 * Migrate annotations from one specific part to another.
 * Uses the version_diffs table for measure mapping if available,
 * otherwise copies annotations with a direct 1:1 mapping (flagged for review).
 */
export async function migratePartAnnotations(
  sourcePartId: string,
  targetPartId: string,
): Promise<MigrationSummary> {
  // Load source and target part info
  const [srcRows, tgtRows] = await Promise.all([
    dz.select({ id: parts.id, name: parts.name, omrJson: parts.omrJson })
      .from(parts).where(eq(parts.id, sourcePartId)),
    dz.select({ id: parts.id, name: parts.name, omrJson: parts.omrJson })
      .from(parts).where(eq(parts.id, targetPartId)),
  ]);
  const src = srcRows[0];
  const tgt = tgtRows[0];
  if (!src || !tgt) return { instrument: '', total: 0, migrated: 0, flagged: 0, skipped: 0 };

  // Try to find an existing diff between these parts
  const diffRows = await dz.select({ diffJson: versionDiffs.diffJson })
    .from(versionDiffs)
    .where(and(eq(versionDiffs.fromPartId, sourcePartId), eq(versionDiffs.toPartId, targetPartId)));

  // Build a partDiff — from stored diff or identity mapping
  let partDiff: PartDiff;
  if (diffRows[0]) {
    partDiff = diffRows[0].diffJson as unknown as PartDiff;
  } else {
    // No diff available: identity mapping for all measures in source
    type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
    const srcOmr = src.omrJson as OmrData;
    const measureMapping: Record<number, number | null> = {};
    for (const m of srcOmr?.measures ?? []) {
      measureMapping[m.number] = m.number; // 1:1, flagged below
    }
    partDiff = {
      changedMeasures: [],
      changeDescriptions: {},
      structuralChanges: { insertedMeasures: [], deletedMeasures: [], sectionLabelChanges: [] },
      measureMapping,
      // No confidence data — all migrated annotations will be flagged for review
    };
  }

  // Build measure-to-page map and measure bounds from target part OMR
  const newMeasureToPage = new Map<number, number>();
  const oldMeasureBounds = new Map<number, MeasureBounds>();
  const newMeasureBounds = new Map<number, MeasureBounds>();

  type OmrData = { measures?: { number: number; bounds?: MeasureBounds }[] } | null;
  const srcOmr = src.omrJson as OmrData;
  const tgtOmr = tgt.omrJson as OmrData;

  for (const m of srcOmr?.measures ?? []) {
    if (m.bounds && !oldMeasureBounds.has(m.number)) oldMeasureBounds.set(m.number, m.bounds);
  }
  for (const m of tgtOmr?.measures ?? []) {
    if (m.bounds) {
      if (!newMeasureToPage.has(m.number)) newMeasureToPage.set(m.number, m.bounds.page);
      if (!newMeasureBounds.has(m.number)) newMeasureBounds.set(m.number, m.bounds);
    }
  }

  // Fetch annotations from source part
  const annRows = await dz.select({
    id: annotations.id,
    ownerUserId: annotations.ownerUserId,
    anchorType: annotations.anchorType,
    anchorJson: annotations.anchorJson,
    kind: annotations.kind,
    contentJson: annotations.contentJson,
  })
    .from(annotations)
    .where(and(eq(annotations.partId, sourcePartId), isNull(annotations.deletedAt)));

  let migrated = 0;
  let flagged = 0;
  let skipped = 0;

  for (const ann of annRows) {
    // Idempotency: skip if already migrated to target
    const existing = await dz.select({ id: annotations.id })
      .from(annotations)
      .where(and(
        eq(annotations.migratedFromAnnotationId, ann.id),
        eq(annotations.partId, targetPartId),
        isNull(annotations.deletedAt),
      ));
    if (existing.length > 0) { skipped++; continue; }

    const { newAnchorType, newAnchorJson, needsReview } = migrateAnchor(
      ann.anchorType,
      ann.anchorJson as Record<string, unknown>,
      partDiff,
      newMeasureToPage,
    );

    // Relocate old-style ink content if needed
    let migratedContent = ann.contentJson as Record<string, unknown>;
    const isObjectModel = migratedContent.boundingBox != null;

    if (!isObjectModel && ann.kind === 'ink' && newAnchorType === 'measure') {
      const oldMN = (ann.anchorJson as Record<string, unknown>).measureNumber as number | undefined;
      const newMN = (newAnchorJson as Record<string, unknown>).measureNumber as number | undefined;
      if (oldMN != null && newMN != null) {
        const oldB = oldMeasureBounds.get(oldMN);
        const newB = newMeasureBounds.get(newMN);
        if (oldB && newB) {
          const dx = (newB.x + newB.w / 2) - (oldB.x + oldB.w / 2);
          const dy = (newB.y + newB.h / 2) - (oldB.y + oldB.h / 2);
          if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
            migratedContent = relocateInkContent(migratedContent, dx, dy);
          }
        }
      }
    }

    // Flag for review if no diff was available (identity mapping = no confidence data)
    const noRealDiff = !diffRows[0];
    const finalNeedsReview = needsReview || noRealDiff;
    const finalContent = finalNeedsReview
      ? { ...migratedContent, _needsReview: true }
      : migratedContent;

    await dz.insert(annotations).values({
      partId: targetPartId,
      ownerUserId: ann.ownerUserId,
      anchorType: newAnchorType,
      anchorJson: newAnchorJson,
      kind: ann.kind,
      contentJson: finalContent,
      migratedFromAnnotationId: ann.id,
    });

    if (finalNeedsReview) flagged++;
    else migrated++;
  }

  return { instrument: src.name, total: annRows.length, migrated, flagged, skipped };
}

// ── Annotation sources query ─────────────────────────────────────────────────

export interface AnnotationSource {
  versionId: string;
  versionName: string;
  partId: string;
  partName: string;
  annotationCount: number;
}

/**
 * For a given target version, find all previous versions that have annotations
 * for matching instruments. Returns per-target-part source options.
 */
export async function getAnnotationSources(
  targetVersionId: string,
): Promise<Record<string, AnnotationSource[]>> {
  // Get the target version and its chart
  const [targetVer] = await dz.select({
    id: versions.id,
    chartId: versions.chartId,
    sortOrder: versions.sortOrder,
  }).from(versions).where(eq(versions.id, targetVersionId));
  if (!targetVer) return {};

  // Get target version's parts
  const targetParts = await dz.select({ id: parts.id, name: parts.name })
    .from(parts)
    .where(and(eq(parts.versionId, targetVersionId), isNull(parts.deletedAt)));

  // Get all earlier versions for this chart (by sortOrder)
  const earlierVersions = await dz.select({
    id: versions.id,
    name: versions.name,
    sortOrder: versions.sortOrder,
  })
    .from(versions)
    .where(and(
      eq(versions.chartId, targetVer.chartId),
      isNull(versions.deletedAt),
      ne(versions.id, targetVersionId),
    ));

  // For each target part, find matching parts in earlier versions with annotations
  const result: Record<string, AnnotationSource[]> = {};

  for (const tp of targetParts) {
    const sources: AnnotationSource[] = [];

    for (const ver of earlierVersions) {
      // Find matching part by instrument name
      const matchingParts = await dz.select({ id: parts.id, name: parts.name })
        .from(parts)
        .where(and(eq(parts.versionId, ver.id), eq(parts.name, tp.name), isNull(parts.deletedAt)));

      if (matchingParts.length === 0) continue;

      const mp = matchingParts[0];
      // Count annotations on this part
      const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
        .from(annotations)
        .where(and(eq(annotations.partId, mp.id), isNull(annotations.deletedAt)));

      if (Number(count) > 0) {
        sources.push({
          versionId: ver.id,
          versionName: ver.name,
          partId: mp.id,
          partName: mp.name,
          annotationCount: Number(count),
        });
      }
    }

    // Sort by version sortOrder descending (most recent first)
    sources.sort((a, b) => {
      const verA = earlierVersions.find(v => v.id === a.versionId);
      const verB = earlierVersions.find(v => v.id === b.versionId);
      return (verB?.sortOrder ?? 0) - (verA?.sortOrder ?? 0);
    });

    result[tp.id] = sources;
  }

  return result;
}
