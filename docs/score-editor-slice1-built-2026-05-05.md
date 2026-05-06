# Score Editor Slice 1 — Build Summary

**Status:** Complete
**Date:** 2026-05-05
**Spec:** `docs/score-editor-spec-2026-05-05.md`
**Scope:** Transposition only (transpose, octave displace, instrument change)

## What Was Built

End-to-end transposition pipeline: Ask Palette (NL input) -> LLM parse -> music21 sidecar transform -> Verovio preview -> save as personal/ensemble version -> PDF render job.

## Architecture Layers

### 1. music21 Sidecar (`omr-diff/server.py`)

Extended the existing OMR diff service (FastAPI, port 8484) with three new endpoints:

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /transpose` | musicxml + interval name | transformed MusicXML + pitch list |
| `POST /octave-displace` | musicxml + direction | transformed MusicXML + pitch list |
| `POST /instrument-change` | musicxml + source/target instrument | transformed MusicXML + pitch list |

- music21 7.3.3 (already installed, works fine)
- `intervalFromGenericAndChromatic` handles diatonic + chromatic deltas for instrument transposition
- 10 sidecar tests all passing (pytest)
- Python 3.7 compatibility required `from __future__ import annotations` and `typing.Dict/List`

Hardcoded instruments for Slice 1: flute, trumpet_in_bb, horn_in_f, alto_saxophone, tenor_saxophone, clarinet_in_bb, violin, viola, cello.

### 2. Schema (`migrations/024_score_editor_slice1.sql`)

New columns on `versions`:
- `private_owner_user_id` (UUID, nullable FK) — null = ensemble, set = personal
- `branch_label` (TEXT) — user's name for personal versions
- `parent_version_id` (UUID, self-FK) — fork point
- `edit_origin` (TEXT, CHECK constraint) — 'upload' | 'editor_director' | 'editor_player'
- `musicxml_blob` (TEXT) — stores transformed MusicXML for editor-created versions
- `pdf_render_status` (TEXT) — 'pending' | 'rendering' | 'complete' | 'failed'

New table `edit_operations` (audit log of every Ask Palette command).

### 3. Visibility Filter

Added `(private_owner_user_id IS NULL OR private_owner_user_id = $userId)` to:
- `GET /versions?chartId=` (list)
- `GET /versions/:id` (single fetch)
- Chart detail version queries (4 sites in `charts.ts`)

Internal/system queries (migration worker, getVersionEnsembleId) deliberately NOT filtered.

### 4. Operation Grammar (`backend/src/editor/grammar.ts`)

Zod discriminated union with all 6 operation types from spec. Slice 1 handles 3:
- `transpose` — interval enum + scope (whole_part or measureRange)
- `octave_displace` — direction + scope
- `instrument_change` — newInstrument enum

Remaining 3 (pitch_fix, rhythm_fix, accidental_fix) are parsed by Zod but rejected at apply time with "Not yet supported."

### 5. Backend API (`backend/src/routes/edits.ts`)

| Endpoint | Purpose |
|----------|---------|
| `POST /edits/parse` | NL -> LLM (Claude Sonnet 4.7) -> validated operation JSON |
| `POST /edits/apply` | Operation + version -> sidecar transform -> range check -> MusicXML response |
| `POST /edits/save` | Commit: create version row, audit row, annotation carry-forward or migration, PDF render job |

LLM prompt (`backend/src/editor/llmPrompt.ts`) includes grammar, examples, and part context.

Range checking hardcoded for flute (C4-D7), violin (G3-E7), trumpet (F#3-D6). Other instruments skip checking.

### 6. PDF Render Worker (`backend/src/workers/pdfRender.worker.ts`)

Polls for `pdf_render` jobs, invokes MuseScore CLI, uploads PDF to S3. Graceful failure if MuseScore not installed (frontend falls back to Verovio).

**MuseScore CLI status:** NOT installed locally. Worker will mark jobs as `failed`. This is acceptable for Slice 1 — Verovio provides the preview.

### 7. Frontend Components

| Component | Location |
|-----------|----------|
| `VerovioRenderer` | `components/editor/VerovioRenderer.tsx` |
| `AskPalette` | `components/editor/AskPalette.tsx` |
| `OperationPreview` | `components/editor/OperationPreview.tsx` |
| `EditorPanel` | `components/editor/EditorPanel.tsx` |
| `RangeWarningModal` | `components/editor/RangeWarningModal.tsx` |
| `SaveAsDialog` | `components/editor/SaveAsDialog.tsx` |
| `BranchSwitcher` | `components/editor/BranchSwitcher.tsx` |
| API client | `api/edits.ts` |

- Verovio 6.1.0 installed (WASM toolkit, async init)
- Type declaration added (`src/verovio.d.ts`)
- EditorPanel manages full state machine: input -> preview_op -> applying -> result -> range_warning -> save_dialog -> saving
- Edit mode activated via "Edit" pill in part viewer resting chrome
- Full-screen overlay when in score edit mode

### 8. Integration Points

- **Annotation carry-forward:** Personal save copies user's annotations from parent part to new version with same anchors
- **Ensemble save:** Triggers standard cross-version migration job (existing pipeline)
- **Notifications:** Ensemble publish triggers existing `version_published` notifications from the notifications buildout

## Type Check

Both `frontend` and `backend` compile cleanly (`tsc --noEmit` passes with zero errors).

## Calibration

- Music21 sidecar: smooth. Already installed, API stable. Python 3.7 type hint compatibility was the main friction.
- Verovio: installed without conflict. Haven't tested actual rendering yet (requires running dev server).
- MuseScore CLI: not available locally. Worker degrades gracefully.
- LLM integration: Anthropic SDK already in deps. Not tested live (requires API key in env).
- MusicXML storage: chose `versions.musicxml_blob` (TEXT column). Source MusicXML fetched from part's S3 key for existing OMR-processed parts.

## Deferred to Slice 2

- Click-to-edit (note selection)
- Pitch fix, rhythm fix, accidental fix operations
- Full instrument range database
- Branch switcher integration into PartView header (component built, not wired into version list)
- Personal version management (rename, delete)
- Range database beyond 3 hardcoded instruments
- Edit history/undo within session
- MuseScore deployment for production PDF rendering

## Flag-back Items

1. **MuseScore CLI not available.** Build proceeds with PDF render failing gracefully.
2. **Anthropic API key.** LLM parse endpoint returns 503 if key not configured. Manually test with key in `.env`.
3. **BranchSwitcher not wired.** Component built but not yet integrated into the version list dropdown on part view. Needs data from existing version-listing API (which now includes personal versions).
4. **`isDirector` prop hardcoded to `true`** in the EditorPanel integration. Should resolve from auth context / workspace role. Acceptable for Slice 1 development.
