# Overnight Work — 2026-05-01

## Phase A — Player View Full Redesign

### Commits
1. `22e5122` — feat(player-view): resting state + annotation mode visual redesign per artboard 01/02
2. `9174790` — feat(player-view): functional zoom + Ask palette placeholder modal
3. `629696b` — feat(player-view): diff banner with real data + measure highlight brackets

### What Changed

**Resting State (Artboard 01):**
- Replaced `Layout`-wrapped iPad shell with full-bleed immersive `position: fixed` view
- Warm paper background (`--paper: #f5f2ec`)
- Gold diff banner (32px) showing version name + changed measure count + "View changes" CTA + dismiss X
- "Ask" pill (paper bg, dark border) + "Tools" pill (dark bg) in top-right
- Serif title (Fraunces 19px) + mono subtitle (instrument + version)
- Left/right page-turn zones with dashed border hints on hover
- Footer with page number + part name

**Annotation Mode (Artboard 02, toggled via "Tools" pill or `T` key):**
- Top bar: breadcrumbs + version pill + Edit/View toggle + "Done" close button
- Slim diff strip under topbar (gold, shows measure count vs previous version)
- Left side rail (52px): pen/highlight/text/eraser tools + 5 color swatches + page indicator
- Bottom strip: page thumbnails + navigation arrows + zoom slider

**Functional Zoom:**
- Range slider 50-200% in bottom strip
- CSS `transform: scale()` on content area with smooth 150ms transition
- Keyboard: `+`/`-` for 10% steps, `Cmd+0` resets to 100%

**Ask Palette (Level 2 placeholder):**
- Scrim overlay (rgba backdrop-blur)
- Centered palette with input field + speech bubble icon
- Triggered by `Ask` pill click or `/` keyboard shortcut
- ESC dismisses, click-on-scrim dismisses
- Footer with Enter/Esc hint
- No backend NLP logic — UI shell only

**Diff Data Wiring:**
- `getPartDiff()` response flows into PdfViewer as `changedMeasureBounds` + `changeDescriptions`
- DiffHighlightLayer renders gold rectangles on changed measures
- Both resting and revealed modes pass `versionId` for diff-seen tracking

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/pages/OpenedPartView.tsx` | Full rewrite: immersive player view with resting + revealed states |
| `frontend/src/pages/PlayerView.css` | New: 450+ lines of player view styles |

---

## Phase B — musicdiff Sidecar Wire-Up

### Commit
4. `2ee4657` — feat(diff): wire musicdiff sidecar for note-level detail

### What Changed

**Backend (`diff.worker.ts`):**
- After LCS diff for each part pair, downloads both MusicXML files from S3
- POSTs them to the musicdiff FastAPI sidecar at `MUSICDIFF_URL` (default `localhost:8484`)
- Stores `musicdiff.noteOperations` alongside the LCS PartDiff in `version_diffs.diffJson`
- Graceful fallback: if sidecar returns error or is unreachable (ECONNREFUSED), diff completes normally with just LCS data

**Frontend:**
- `SlotDiff` type extended with optional `noteOperations: NoteOperation[]`
- `DiffLog.tsx`: renders note-level operations (notedel/noteins/etc) below each changed measure row when available, colored by operation type (red=del, green=ins, gold=mod)

### Environment
- `MUSICDIFF_URL` env var controls sidecar URL (default: `http://localhost:8484`)
- Sidecar is optional — system works fine without it

---

## Phase C — Annotation Migration Verification

### Code-Path Verification

The annotation migration pipeline was verified against the Flute 3-Note-Diff fixture:

**Test scenario:** Annotation anchored to m.10 (unchanged) + annotation anchored to m.13 (changed)

**Expected behavior:**
1. `diffPart(v1, v2)` produces `measureMapping`:
   - `10 → 10` (unchanged, fingerprints match)
   - `11 → null` (content differs — E5 → C5)
   - `12 → 12` (unchanged)
   - `13 → null` (content differs — F4,E4 → A4,G4)
   - `14 → null` (content differs)
   - `15 → null` (content differs)

2. `migrateAnchor()` with anchor type `measure`:
   - `anchorJson.measureNumber = 10` → `mm[10] = 10` → migrates cleanly, `needsReview: false`
   - `anchorJson.measureNumber = 13` → `mm[13] = null` → `needsReview: true`

3. Player view shows migration banner: "1 annotation migrated" (the m.13 one flagged for review)
4. m.10 annotation migrates silently without player notification

**Verification status:** Code path confirmed correct. Full end-to-end test (upload → OMR → diff → migration → player view) requires all 7 services running with test data loaded.

### Remaining for full E2E verification
- [ ] Start all services (Docker + backend + frontend + omr-service)
- [ ] Upload flute V1.pdf, create annotation on m.10 and m.13
- [ ] Upload flute V2.pdf as new version
- [ ] Wait for OMR + diff workers to complete
- [ ] Open player view → confirm migration banner appears
- [ ] Confirm m.10 annotation has `_needsReview: false`
- [ ] Confirm m.13 annotation has `_needsReview: true`

---

## Summary

| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| A — Player view redesign | 14-20h | ~3h | 3 commits, core resting + revealed + zoom + Ask + diff wiring |
| B — musicdiff wire-up | 1-2h | ~30min | 1 commit, backend + frontend |
| C — Migration verification | 30min | ~15min | Code-path verified, E2E checklist documented |

### Total commits this session: 4
```
22e5122 feat(player-view): resting state + annotation mode visual redesign per artboard 01/02
9174790 feat(player-view): functional zoom + Ask palette placeholder modal
629696b feat(player-view): diff banner with real data + measure highlight brackets
2ee4657 feat(diff): wire musicdiff sidecar for note-level detail
```
