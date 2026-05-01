# Audiveris Cutover — 2026-05-01

## Summary

Replaced the Vision-based OMR and diff pipeline with Audiveris + LCS diff.
The old pipeline made two Claude Vision API calls per version-diff (one for
OMR layout extraction, one for PDF-to-PDF comparison). The new pipeline
runs entirely offline: Audiveris (Java, local) for MusicXML extraction,
`parseMusicXml()` for OmrJson conversion, and `diffPart()` (LCS fingerprint
alignment) for semantic diff.

A Python musicdiff sidecar was also added as an optional high-fidelity diff
engine that can complement or replace LCS in the future.

## What Changed

### Milestone 1 — Audiveris as default OMR engine
**Commit:** `082bc7c`

- `omr-service/src/audiveris.ts`: Added `extractNotesAndDynamics()` to
  `parseMusicXml()`. Previously hardcoded `notes: []` for every measure,
  making the LCS diff engine see all measures as identical.
- `backend/src/workers/omr.worker.ts`: Changed default from `'vision'` to
  `'audiveris'`. The vision code path now throws an error.
- `backend/.env` / `.env.example`: Commented out `VISION_*` and
  `ANTHROPIC_API_KEY` vars; added `AUDIVERIS_PATH`.

### Milestone 2 — Quarantine Vision code, wire LCS diff
**Commit:** `c1bdaee`

- Moved `vision-diff.ts`, `vision-diff.test.ts`, `vision-measure-layout.ts`,
  `vision-prompt.ts` from `backend/src/lib/` → `backend/src/legacy/`.
- `backend/src/workers/diff.worker.ts`: Removed Vision diff imports and PDF
  download logic. Now loads OmrJson from the database and calls `diffPart()`
  (the LCS engine) directly.

### Milestone 3 — musicdiff FastAPI sidecar
**Commit:** `91998ec`

- Created `omr-diff/` directory with:
  - `server.py` — FastAPI app exposing `POST /diff` (MusicXML uploads → JSON)
  - `requirements.txt` — musicdiff 5.2, music21 9.9, FastAPI, uvicorn
  - `README.md` — setup and usage instructions
- Uses musicdiff's `Comparison.annotated_scores_diff()` for note-level edit
  operations, with measure number resolution via AnnScore structure.
- Handles bar substitution (del+ins for same measure → changed measure).

### Milestone 4 — End-to-end fixture verification
All three engines verified against the Flute 3-Note-Diff fixture
(15 measures, changes in m.11, m.13, m.14, m.15):

| Engine       | Changed Measures | Match | Notes |
|-------------|-----------------|-------|-------|
| LCS (diffPart) | 11, 13, 14, 15 | FULL  | Reports as structural (insert+delete) |
| musicdiff   | 11, 13, 14, 15 | FULL  | Reports as changedMeasures |
| Vision (legacy) | — | N/A | API key expired; no longer in production path |

## Architecture (Before → After)

### Before (Vision pipeline)
```
PDF → Vision API call #1 (OMR layout)  → OmrJson (empty notes[])
                                         ↓
PDF v1 + PDF v2 → Vision API call #2   → VisionDiffResult → PartDiff
```
- Two API calls per diff (~$0.10–0.30 each)
- LCS engine existed but was broken (empty notes[])
- Required ANTHROPIC_API_KEY

### After (Audiveris + LCS pipeline)
```
PDF → Audiveris (local Java) → MusicXML → parseMusicXml() → OmrJson (with notes)
                                                              ↓
OmrJson v1 + OmrJson v2 → diffPart() (LCS fingerprint)    → PartDiff
```
- Zero API calls
- Runs offline, deterministic, ~37ms for diff
- Optional musicdiff sidecar at port 8484 for higher-fidelity diff

## Root Cause of Original Failure

`parseMusicXml()` in `omr-service/src/audiveris.ts` had never extracted
notes from MusicXML. Every measure was constructed with `notes: []`, which
produced identical LCS fingerprints (`"|"`) for all measures. The LCS diff
engine is correct — it was starved of data.

The Vision pipeline masked this by bypassing OmrJson/LCS entirely and doing
raw PDF-to-PDF comparison via Claude API. When the API key expired, the diff
worker failed silently (circuit breaker), no `version_diffs` row was stored,
and the UI showed no changes.

## Files Modified/Created

| File | Status | Description |
|------|--------|-------------|
| `omr-service/src/audiveris.ts` | Modified | Added note/dynamics extraction |
| `backend/src/workers/omr.worker.ts` | Modified | Default engine → audiveris |
| `backend/src/workers/diff.worker.ts` | Modified | Vision → LCS diff |
| `backend/src/legacy/vision-*.ts` | Moved | From lib/ to legacy/ |
| `backend/src/scripts/diagnose-*.ts` | Created | Diagnostic scripts |
| `omr-diff/server.py` | Created | musicdiff FastAPI sidecar |
| `omr-diff/requirements.txt` | Created | Python dependencies |
| `omr-diff/README.md` | Created | Setup instructions |

## LCS vs musicdiff Behavior

The LCS engine models measure changes as delete+insert (structural),
while musicdiff reports them as content changes with detailed edit operations.
Both are correct for annotation migration — the `measureMapping` in both
cases correctly maps unchanged measures 1:1 and flags changed measures.

For annotation migration, the LCS engine's `null` mapping on changed measures
triggers `needsReview: true`, which is appropriate — the measure content
changed, so annotations may no longer apply.

## Remaining Work

- [ ] Wire backend to call musicdiff sidecar (optional, LCS is sufficient)
- [ ] Add musicdiff output to the diff log UI
- [ ] Containerize musicdiff sidecar (Dockerfile)
- [ ] Integration test: full upload → Audiveris → diff → migration cycle
- [ ] Monitor Audiveris processing times on real-world charts
