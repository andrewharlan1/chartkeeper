import { db } from '../db';
import type { VersionDiffJson, PartDiff, MeasureBounds } from './diff';

export interface MigrationSummary {
  instrument: string;
  total:     number;
  migrated:  number; // clean — HIGH confidence
  flagged:   number; // is_unresolved = true — player must confirm
  skipped:   number; // already migrated (idempotency guard)
}

interface AnnotationRow {
  id:           string;
  user_id:      string;
  anchor_type:  string;
  anchor_json:  Record<string, unknown>;
  content_type: string;
  content_json: Record<string, unknown>;
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
    const [oldPartRes, newPartRes] = await Promise.all([
      db.query<{ id: string }>(
        `SELECT id FROM parts WHERE chart_version_id = $1 AND instrument_name = $2 AND deleted_at IS NULL`,
        [fromVersionId, instrument]
      ),
      db.query<{ id: string }>(
        `SELECT id FROM parts WHERE chart_version_id = $1 AND instrument_name = $2 AND deleted_at IS NULL`,
        [toVersionId, instrument]
      ),
    ]);

    if (!oldPartRes.rows[0] || !newPartRes.rows[0]) continue;

    const oldPartId = oldPartRes.rows[0].id;
    const newPartId = newPartRes.rows[0].id;

    // Load measure layout from both old and new parts
    // - newMeasureToPage: for setting pageHint on migrated anchors
    // - oldMeasureBounds / newMeasureBounds: for relocating ink stroke coordinates
    const newMeasureToPage = new Map<number, number>();
    const oldMeasureBounds = new Map<number, MeasureBounds>();
    const newMeasureBounds = new Map<number, MeasureBounds>();

    const [oldOmrRes, newOmrRes] = await Promise.all([
      db.query<{ omr_json: { measures?: { number: number; bounds?: MeasureBounds }[] } | null }>(
        `SELECT omr_json FROM parts WHERE id = $1`, [oldPartId]
      ),
      db.query<{ omr_json: { measures?: { number: number; bounds?: MeasureBounds }[] } | null }>(
        `SELECT omr_json FROM parts WHERE id = $1`, [newPartId]
      ),
    ]);

    for (const m of oldOmrRes.rows[0]?.omr_json?.measures ?? []) {
      if (m.bounds && !oldMeasureBounds.has(m.number)) {
        oldMeasureBounds.set(m.number, m.bounds);
      }
    }
    for (const m of newOmrRes.rows[0]?.omr_json?.measures ?? []) {
      if (m.bounds) {
        if (!newMeasureToPage.has(m.number)) newMeasureToPage.set(m.number, m.bounds.page);
        if (!newMeasureBounds.has(m.number)) newMeasureBounds.set(m.number, m.bounds);
      }
    }

    const { rows: annotations } = await db.query<AnnotationRow>(
      `SELECT id, user_id, anchor_type, anchor_json, content_type, content_json
       FROM annotations
       WHERE part_id = $1 AND deleted_at IS NULL`,
      [oldPartId]
    );

    let migrated = 0;
    let flagged  = 0;
    let skipped  = 0;

    for (const ann of annotations) {
      // Idempotency: skip if already migrated to this target part
      const { rows: existing } = await db.query<{ id: string }>(
        `SELECT id FROM annotations
         WHERE migrated_from_annotation_id = $1 AND part_id = $2 AND deleted_at IS NULL`,
        [ann.id, newPartId]
      );
      if (existing.length > 0) { skipped++; continue; }

      const { newAnchorType, newAnchorJson, needsReview } = migrateAnchor(
        ann.anchor_type,
        ann.anchor_json as Record<string, unknown>,
        partDiff,
        newMeasureToPage,
      );

      // Relocate ink/highlight strokes if the measure moved to a new position
      let migratedContent = ann.content_json;
      if (ann.content_type === 'ink' && newAnchorType === 'measure') {
        const oldMN = (ann.anchor_json as Record<string, unknown>).measureNumber as number | undefined;
        const newMN = (newAnchorJson as Record<string, unknown>).measureNumber as number | undefined;
        if (oldMN != null && newMN != null) {
          const oldB = oldMeasureBounds.get(oldMN);
          const newB = newMeasureBounds.get(newMN);
          if (oldB && newB) {
            // Compute offset: center of old measure → center of new measure
            const dx = (newB.x + newB.w / 2) - (oldB.x + oldB.w / 2);
            const dy = (newB.y + newB.h / 2) - (oldB.y + oldB.h / 2);
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
              migratedContent = relocateInkContent(ann.content_json, dx, dy);
            }
          }
        }
      }

      await db.query(
        `INSERT INTO annotations
           (part_id, user_id, anchor_type, anchor_json, content_type, content_json,
            migrated_from_annotation_id, is_unresolved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newPartId,
          ann.user_id,
          newAnchorType,
          JSON.stringify(newAnchorJson),
          ann.content_type,
          JSON.stringify(migratedContent),
          ann.id,
          needsReview,
        ]
      );

      if (needsReview) flagged++;
      else             migrated++;
    }

    summaries.push({ instrument, total: annotations.length, migrated, flagged, skipped });
  }

  return summaries;
}
