# Architecture Session 3 Summary

**Date:** 2026-04-21
**Scope:** Per-instrument diff computation

## Audit Findings

The diff engine was **not instrument-aware**. The diff worker (`diff.worker.ts`) matched parts between versions by **filename** (`p.name`). This meant:
- Renamed files between versions silently broke diff computation
- Reassigned parts (e.g., moved from Violin I to Violin II) diffed against the wrong reference
- No slot-level granularity — a single diff per part regardless of how many instruments it served

The core diff algorithms (LCS in `diff.ts`, Vision API in `vision-diff.ts`) were sound — only the matching and storage layers needed changes.

## What Shipped

### Commit 1 — Audit memo (`67053d3`)
- `docs/diff-engine-audit.md` documenting current behavior, planned changes, blast radius

### Commit 2 — Schema + per-instrument diff computation (`bc63a6c`)
- Migration 019: `slot_id` column on `version_diffs` (nullable, NULL = score diff)
- Backfill existing diffs from `part_slot_assignments`
- New unique constraint: `(to_part_id, slot_id)` replaces old `(from_part_id, to_part_id)`
- `findPreviousVersionPartForSlot()` — walks previous versions by sort_order to find slot match
- `findPreviousVersionScore()` — finds previous score for score-to-score diffs
- Diff worker iterates over each part's slot assignments, computing one diff per slot
- Score diffs stored with `slot_id = NULL`
- Test export updated for slot-based approach

### Commit 3 — Diff storage and retrieval updates (`d2225c6`)
- `GET /parts/:id/diff` returns `{ diffs: SlotDiff[] }` — one per slot, with instrumentName, sourceVersionName, sourcePartId
- Chart instruments endpoint includes per-slot diff status: `{ slotId, sourceVersionName, changedMeasureCount, hasChangelog }`
- Frontend `getPartDiffs()` returns new array shape
- `getPartDiff()` unions all slot diffs into legacy single-diff shape for backward compat
- `useDiffs` hook returns per-slot array; `useDiff` preserved as union for DiffHighlightLayer

### Commit 4 — Frontend UI integration (`d14e83b`)
- Instrument part rows show styled diff badges with measure count + source version name
- Score parts section shows diff badges when available
- DiffHighlightLayer continues to work via union-based `useDiff` hook (no changes needed)

### Commit 5 — Regression tests + session summary
- 11 new tests across 3 categories:
  - Data layer: slot-specific diff storage, multi-slot diffs, score diffs with null slotId
  - API: diff endpoint returns array, empty array for no diffs, instruments endpoint includes diff status
  - LCS engine: change detection, identical parts, insertions, deletions, structural changes
- 13 test suites pass (12 existing + 1 new), same 6 pre-existing failures

## Schema Changes

- **Migration 019** (`019_version_diffs_slot_id.sql`): adds `slot_id UUID` to `version_diffs`, backfills from `part_slot_assignments`, new unique constraint `(to_part_id, slot_id)`, index on `slot_id`

## New Files

- `docs/diff-engine-audit.md` — audit memo
- `backend/src/workers/per-instrument-diff.test.ts` — 11 regression tests

## Edge Cases Deferred

- **Multi-part-per-slot in previous version**: picks most recent by `updated_at`. Imperfect for divisi, but handles the common case.
- **Cross-instrument diffs**: diff always compares within the same slot. Cross-instrument annotation migration (Session 1) is a separate concern.
- **Orphaned diffs on slot reassignment**: existing diffs left in place when slot assignments change. They are informational, not harmful.
- **Parallel diff computation**: diffs per slot run sequentially for now. `Promise.all` optimization deferred.
- **Diff recomputation on demand**: after migration, existing charts need a re-upload or OMR re-run to get slot-aware diffs. No background recomputation job written.

## Validation Scenario

End-to-end (requires real uploads to trigger OMR + diff worker):
1. Upload v1 of a string quartet with Violin I, Violin II, Viola, Cello parts assigned to matching slots
2. Upload v2 with a modified Violin I part (different filename)
3. Diff worker matches by slot (not filename), computes correct diff
4. Sarah (assigned to Violin I) sees "2 measures changed vs Version 1" on the chart page
5. John (assigned to Cello, unchanged) sees no diff badge

This scenario works end-to-end with the new slot-based matching — the key improvement over the old name-based system.

## Test Status

- **13 suites pass** (auth, charts, ensembles, workspaces, instrumentSlots, versions, parts, annotations, annotation-migration, smoke integration, omr worker, annotation-content schema, **per-instrument-diff**)
- **6 suites fail (pre-existing)**: pipeline integration (missing device_tokens table), deviceTokens (missing table), notifications lib (references device_tokens), diff.test (type errors), vision-diff.test (vitest), diff.worker.test (old schema)

## Architecture Refactor Complete

With Session 3 complete, all three architecture sessions have shipped:

| Session | What Shipped | Key Change |
|---------|-------------|------------|
| Session 1 | Content kinds, auto-instrument, migration UI, current version | Parts know what kind of content they are |
| Session 2 | Users, assignments, instrument-centric chart page, notifications | Users are assigned to instruments, chart page organized by instrument |
| Session 3 | Per-instrument diff computation | Diffs follow instrument continuity, not file names |

The instrument-centric mental model now works end-to-end: upload a new version, diffs compute per-instrument by slot assignment, players see exactly what changed in their part.
