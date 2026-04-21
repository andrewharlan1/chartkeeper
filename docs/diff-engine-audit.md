# Diff Engine Audit

**Date:** 2026-04-21
**Purpose:** Understand the current diff pipeline before making it instrument-aware.

## Where Diff Computation Happens

Three layers:

1. **`backend/src/lib/diff.ts`** — Pure LCS-based diff functions. `diffPart(oldOmr, newOmr)` fingerprints measures and aligns them using longest common subsequence. `diffVersion()` wraps multiple `diffPart` calls. Not used in production — the Vision path replaced it.

2. **`backend/src/lib/vision-diff.ts`** — Production diff engine. `computeMeasureMapping()` sends two PDFs to Claude Vision, parses the structured JSON response (measure mapping, changed measures, confidence scores, bounding boxes). Has circuit breaker, retry logic, concurrency pool, and call logging.

3. **`backend/src/workers/diff.worker.ts`** — Job worker. Polls the `jobs` queue for `type='diff'` jobs. Fetches parts for both versions, matches them, runs Vision diff, stores results, then triggers annotation migration and notifications.

## Where Diff Data Is Stored

**`version_diffs`** table (Drizzle schema in `schema.ts`):
- `from_part_id` (UUID, FK to parts)
- `to_part_id` (UUID, FK to parts)
- `diff_json` (JSONB — contains changedMeasures, changeDescriptions, structuralChanges, measureMapping, measureConfidence, changedMeasureBounds)
- Unique constraint on `(from_part_id, to_part_id)`
- One row per part pair

Note: The original SQL migration (001) had `chart_id, from_version_id, to_version_id` but the Drizzle schema was later refactored to part-pair-based: `fromPartId, toPartId`.

## How Diff Is Currently Triggered

1. OMR worker finishes processing a part
2. Calls `maybeEnqueueDiff(ensembleId, toVersionId)` in `omr.worker.ts:175`
3. Checks if all parts in the version are done (no pending/processing OMR)
4. Finds previous version by `sort_order`
5. Enqueues a diff job: `{ ensembleId, fromVersionId, toVersionId }`

## The Problem: Name-Based Part Matching

**`diff.worker.ts` lines 57-58:**
```typescript
const toPartMap = new Map(toParts.filter(p => p.pdfS3Key).map(p => [p.name, p]));
const pairs = fromParts.filter(p => p.pdfS3Key && toPartMap.has(p.name));
```

Parts between versions are matched by **filename** (`p.name`). This breaks when:
- Filenames differ even slightly between versions (e.g. "Violin I.pdf" → "Violin_I_v2.pdf")
- A part is reassigned to a different instrument slot
- A part is assigned to multiple slots (only one diff computed, not per-slot)

There is no `slot_id` on `version_diffs`, so diffs are not instrument-aware at all.

## What Needs to Change

1. **Schema**: Add `slot_id` (nullable UUID) to `version_diffs`. NULL = score diff. One diff per `(target_part_id, slot_id)` combination.

2. **Diff worker**: Replace name-based matching with slot-based matching. For each new part, find which slots it's assigned to, then find the previous version's part in each slot.

3. **Diff retrieval**: `GET /parts/:id/diff` returns an array of diffs (one per slot). Chart instruments endpoint includes slot-specific diff status.

4. **Frontend**: `useDiff` hook handles array. Highlight layer unions changed measures. Changelog groups by slot when multiple diffs exist.

## Blast Radius

| File | Change |
|------|--------|
| `migrations/019_*.sql` | Add slot_id column + backfill |
| `backend/src/schema.ts` | Add slotId to versionDiffs |
| `backend/src/workers/diff.worker.ts` | Slot-based matching instead of name-based |
| `backend/src/routes/parts.ts` | Diff endpoint returns array |
| `backend/src/routes/charts.ts` | Instruments endpoint includes slot-specific diffs |
| `frontend/src/api/parts.ts` | Update PartDiffData type |
| `frontend/src/api/charts.ts` | Update InstrumentPart diffStatus type |
| `frontend/src/hooks/useDiff.ts` | Handle array response |
| `frontend/src/pages/Chart.tsx` | Show per-instrument diff status |
| `backend/src/lib/annotation-migration.ts` | May need update if it relies on diff structure |

## Conclusion

The diff engine is **not** instrument-aware. It uses name-based matching which is the root cause of broken diffs when filenames change. The refactor to slot-based matching is necessary and the blast radius is manageable — the core diff computation logic (LCS and Vision) doesn't change, only the matching and storage layers.
