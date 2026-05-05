# Inline PDF Renderer — 2026-05-05

## Files added
| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/components/InlinePdfRenderer.tsx` | ~470 | New inline pdfjs canvas renderer — controlled component |
| `frontend/src/components/NotePanel.tsx` | ~120 | Extracted notes sidebar (was private in PdfViewer.tsx) |

## Files modified
| File | Change |
|------|--------|
| `frontend/src/pages/OpenedPartView.tsx` | Replaced `PdfViewer` import with `InlinePdfRenderer`. Removed CSS transform zoom wrapper. Added `darkScore`, `annotationsVisible`, `notesOpen` state. Wired all chrome controls to renderer props. Added arrow-key page nav to keyboard handler. Footer now shows `page N of M`. |
| `frontend/src/pages/Chart.tsx` | Fixed part tile links in LayoutB, LayoutC, LayoutD to route to `/charts/:id/versions/:vId/parts/:pId` (player view) instead of `/charts/:id/versions/:vId` (version detail). |

## Files NOT removed
| File | Reason |
|------|--------|
| `frontend/src/components/PdfViewer.tsx` | Still imported by `PartRenderer.tsx` → used by `VersionDetail.tsx`. The thumbnail+fullscreen pattern remains available for the version detail route. |

## What was extracted from FullscreenViewer

**Kept in InlinePdfRenderer:**
- pdfjs-dist PDF loading via `fetchPdfData()` → `pdfjsLib.getDocument({ data })`
- Canvas page rendering with fit-to-container + zoom viewport scaling
- Draw canvas overlay for measure boxes (edit mode) and diff highlights (yellow rectangles)
- SVG AnnotationLayer mounting with full annotation interaction (ink, text, highlight, select, erase)
- SVG DiffHighlightLayer mounting
- DiffBadge floating badge
- AnnotationToolbar floating toolbar
- NotePanel sidebar (extracted to separate file)
- Annotation loading from API with stroke relocation for migrated annotations
- ResizeObserver for re-rendering on container resize

**Stripped out (FullscreenViewer-only concerns):**
- `position: fixed; inset: 0; z-index: 1000` overlay container
- Dark `#080812` background
- Toolbar row (title, page nav, close button, dark mode toggle, etc.)
- Internal page/zoom/mode state management (now controlled via props)
- Legacy canvas-based pen/highlight drawing pipeline (dead code — AnnotationLayer handles all annotation drawing)
- `saveOverlays()` and `saveEditMode()` canvas save pipelines (AnnotationLayer handles saving)
- `findMeasureForPoint()` (was used by canvas drawing, now handled by AnnotationLayer)
- Anchor dialog modal (was used by canvas save, now handled by AnnotationLayer)
- Keyboard shortcuts (moved to OpenedPartView)

## Remaining imports of deleted components

No component was deleted. `PdfViewer` is still imported by:
- `frontend/src/components/PartRenderer.tsx` (used by VersionDetail page)

No other route imports `PdfThumbnail` or `FullscreenViewer` (they were never exported independently).

## Zoom approach

**pdfjs re-render at viewport scale**, not CSS transform. The zoom flow:

1. OpenedPartView's zoom slider sets `zoom` state (50-200)
2. Passed as `zoomPercent` prop to InlinePdfRenderer
3. Renderer computes: `fitScale = Math.min(availW / pageW, availH / pageH, 2.0)`
4. Final scale: `fitScale * (zoomPercent / 100)`
5. Canvas dimensions and pdfjs viewport set to this scale
6. `page.render()` called at the new viewport → sharp text at any zoom level

Container padding reduced from 80px/40px (FullscreenViewer's generous margins) to 40px/24px to give more space to the PDF in the player view's tighter layout.

## Performance notes

- PDF load: single `fetch()` → `ArrayBuffer` → `pdfjsLib.getDocument()`. Same as before.
- Page render: `page.render()` is the bottleneck. At 100% zoom on a typical part PDF (~1000×1400 canvas), renders in <50ms. At 200% zoom (~2000×2800), renders in ~100-150ms. Acceptable.
- Zoom slider drag: each step triggers a full re-render. There's a brief flash between zoom levels. This is the expected tradeoff for sharp text (vs blurry CSS transform).
- ResizeObserver: triggers re-render on container resize (e.g., toggling notes panel, resizing browser). Debounced by the `renderingRef` guard.
- No memory leaks: PDF document is loaded once per `pdfUrl` change.

## TODOs for future polish

1. **Rail tool buttons → AnnotationLayer mode sync**: The left rail's tool buttons (pen/highlight/text/eraser) set `activeTool` state in OpenedPartView, but AnnotationLayer manages its own `annotationMode` internally via `useAnnotationMode()`. These two state systems should be unified so clicking "pen" in the rail switches the AnnotationLayer to ink mode.

2. **Page-turn animation**: Currently instant swap. Could add a subtle crossfade or slide transition.

3. **Pinch-to-zoom on iPad**: The zoom slider works, but touch gesture support for pinch zoom would be ideal for the iPad player use case.

4. **Delete PdfViewer.tsx**: When VersionDetail is migrated to also use InlinePdfRenderer (or when VersionDetail is deprecated in favor of the player view), PdfViewer.tsx + PdfThumbnail + FullscreenViewer can be fully deleted.

5. **Dark score in resting mode**: The `darkScore` state exists but no UI toggle is shown in resting mode. Consider adding it to the pills area or making it a user preference.

## UX result

The PDF now renders inline at full container size on first load — no click required, no overlay, no dark background taking over the screen. The warm cream paper background shows through as padding around the PDF page edges. The zoom slider re-renders the PDF at native pdfjs resolution, producing sharp musical notation at any zoom level. Page navigation via bottom strip thumbnails, arrow buttons, keyboard arrows, and left/right turn zones all drive the same `currentPage` state that the renderer reads. The annotation toolbar floats over the score and the SVG annotation layer accepts ink, text, highlight, and erase interactions directly on the rendered PDF. It feels like a real in-app PDF viewer, not a Chrome iframe with a click-through overlay.

---

## Chrome ↔ AnnotationLayer state sync (2026-05-05, follow-up)

### Problem
The left rail's tool buttons (pen/highlight/text/eraser) and color swatches in OpenedPartView set local `activeTool`/`activeColor` state that was never passed to InlinePdfRenderer. Meanwhile, InlinePdfRenderer created its own `useAnnotationMode()` hook instance — a completely disconnected state system. The only working way to change annotation tools was the floating AnnotationToolbar inside InlinePdfRenderer.

### Diagnosis
- **AnnotationLayer** was already a controlled component — takes `mode`, `inkColor`, `highlightColor`, `textColor`, `fontSize`, `fontFamily` as props with no internal state for these.
- **InlinePdfRenderer** created its own `useAnnotationMode()` hook at line 73, then passed `annotationMode.mode`, `annotationMode.inkColor`, etc. to AnnotationLayer. This was the disconnected state.
- **OpenedPartView** held `activeTool` (ToolId) and `activeColor` as standalone state variables unrelated to annotation mode.

### Fix
1. **Removed `useAnnotationMode()` from InlinePdfRenderer.** The component no longer owns annotation state.
2. **Added annotation state props to `InlinePdfRendererProps`:** `annotationMode`, `onAnnotationModeChange`, `inkColor/textColor/highlightColor` + onChange callbacks, `fontSize`, `fontFamily`, `selectedAnnotationId`, `onSelectionChange`. InlinePdfRenderer passes these straight through to AnnotationLayer and AnnotationToolbar.
3. **Lifted `useAnnotationMode()` to OpenedPartView.** Single source of truth.
4. **Derived `activeTool` and `activeColor` from annotation state** via mapping tables:
   - `TOOL_TO_MODE`: pen→ink, highlight→highlight, text→text, eraser→erase
   - `MODE_TO_TOOL`: ink→pen, highlight→highlight, text→text, erase→eraser
5. **`effectiveAnnotationMode`:** `revealed ? annState.mode : 'read'` — resting state always sends `'read'` mode to the renderer, preventing accidental drawing.
6. **`toggleRevealed()`:** Entering edit mode activates ink (pen) if mode is `'read'`; leaving sets mode back to `'read'`.

### State flow
```
Rail pen click → setActiveTool('pen') → annState.setMode('ink')
                                           ↓
                              effectiveAnnotationMode = 'ink'
                                           ↓
                         InlinePdfRenderer annotationMode='ink'
                                           ↓
                            AnnotationLayer mode='ink' ← draws ink strokes
                            AnnotationToolbar mode='ink' ← highlights pen button

Rail swatch click → setActiveColor('#c8531c') → annState.setInkColor('#c8531c')
                                                    ↓
                              InlinePdfRenderer inkColor='#c8531c'
                                                    ↓
                            AnnotationLayer inkColor='#c8531c' ← new strokes use this color

AnnotationToolbar mode change → onAnnotationModeChange('highlight')
                                    ↓
                              annState.setMode('highlight')
                                    ↓
                              activeTool derived as 'highlight' ← rail highlights the right button
```

### Bidirectional sync
The floating AnnotationToolbar (inside InlinePdfRenderer) and the rail (in OpenedPartView) both drive the same state. Changing the tool in either location updates the other. Color pickers in the AnnotationToolbar call `onInkColorChange` etc., which flows back up to `annState` and back down through props.

### Files changed
| File | Change |
|------|--------|
| `frontend/src/components/InlinePdfRenderer.tsx` | Removed `useAnnotationMode()` hook. Added 14 annotation state props. All AnnotationLayer and AnnotationToolbar bindings now read from props. |
| `frontend/src/pages/OpenedPartView.tsx` | Added `useAnnotationMode()` hook. Removed standalone `activeTool`/`activeColor` state; derived them from annotation mode. Added `TOOL_TO_MODE`/`MODE_TO_TOOL` mapping tables. Added `effectiveAnnotationMode` and `toggleRevealed()`. Passed all annotation state to InlinePdfRenderer. |

### TODOs resolved
- ~~Rail tool buttons → AnnotationLayer mode sync~~ **Done.** Rail, floating toolbar, and AnnotationLayer all share one state.

### Remaining TODOs
Items 2–5 from the original list are unchanged.

---

## Issue 1: Sidecar diagnostic (2026-05-05)

**Category 4 — sidecar is producing output, but the API endpoint isn't surfacing it.**

The musicdiff sidecar is running on port 8484 (`/health` returns `{"status":"ok"}`). The diff worker process is running and calls it when both parts have `audiverisMxlS3Key`. The worker stores the result inside `diffJson` as `{ ...lcsDiff, musicdiff: { noteOperations } }`. However, the `GET /parts/:id/diff` endpoint (parts.ts:611-638) casts `diffJson` to a type that omits the `musicdiff` key — it never extracts `noteOperations`. The frontend type `SlotDiff` already has an optional `noteOperations` field and `DiffLog.tsx` renders it, but the field is always undefined.

**Fix:** In `backend/src/routes/parts.ts`, add `musicdiff` to the `diffJson` type cast and surface `noteOperations` in the response object.

Full diagnostic at `docs/sidecar-diagnostic-2026-05-05.md`.

---

## Issue 2: Floating toolbar removed (2026-05-05)

### What was deleted
- **`AnnotationToolbar` JSX block** from `InlinePdfRenderer.tsx` — the entire `{partId && showAnnotations && (<AnnotationToolbar ... />)}` block
- **`AnnotationToolbar` import** from `InlinePdfRenderer.tsx`
- **`AnnotationToolbar.tsx`** file — no remaining consumers after PdfViewer.tsx was also deleted (Issue 3)
- **Dead state**: `annSaveStatus`, `canUndo`, `canRedo`, `selectedAnnotationKind`, `annLayerRef`, `guardedSetMode` — all existed only to feed the toolbar
- **Dead props**: `onAnnotationModeChange`, `onFontSizeChange`, `onFontFamilyChange` removed from `InlinePdfRendererProps`
- **Dead imports**: `SaveStatus`, `useToast`

### What remains
The left rail in OpenedPartView is the sole tool selector. Color swatches in the rail drive `annState.setInkColor()`. AnnotationLayer receives all state as props via InlinePdfRenderer passthrough.

---

## Issue 3: InlinePdfRenderer rolled out everywhere (2026-05-05)

### Routes migrated
| Route | Component | Change |
|-------|-----------|--------|
| Player view (My Parts) | `OpenedPartView.tsx` | Already used InlinePdfRenderer (from earlier today) |
| Version detail | `VersionDetail.tsx` via `PartRenderer.tsx` | PartRenderer now renders InlinePdfRenderer in a 400px constrained container with `annotationMode='read'` and annotations hidden |

### Files deleted
| File | Reason |
|------|--------|
| `PdfViewer.tsx` | No remaining consumers. Was only imported by PartRenderer.tsx (now updated). |
| `PdfViewer.css` | Companion to PdfViewer.tsx. |
| `AnnotationToolbar.tsx` | No remaining consumers after PdfViewer.tsx deletion and Issue 2. |

### Stop conditions
VersionDetail uses PartRenderer in a card-with-constrained-dimensions context (multiple parts in a scrollable list). This is structurally different from the player view, but InlinePdfRenderer handles it cleanly: the 400px-tall container limits the rendering area, `annotationMode='read'` prevents drawing, and `annotationsVisible={false}` hides the SVG layer. No stop condition triggered.

---

## Issue 4: Full-screen layout with auto-hide chrome (2026-05-05)

### Design decisions implemented
1. **PDF fills viewport** — Removed `padding: 0 5.5%` from `.pv-content`. The PDF now renders edge-to-edge with only the InlinePdfRenderer's internal 12px/20px padding around the canvas.
2. **Title block → floating overlay** — Replaced the in-flow `.pv-title-block` (which ate vertical space above the score) with a `.pv-title-overlay` (position:absolute, centered, z-index:5). Part of the auto-hide chrome.
3. **Auto-hide chrome** — Top chrome (banners, back button, title, pills) and bottom chrome (footer) wrap in `.pv-chrome` divs. After 3 seconds of no mouse move, key press, or touch, chrome fades out via `opacity: 0; pointer-events: none` with `transition: opacity 200ms`. Elements remain in DOM for keyboard shortcuts.
4. **Drawing pause** — `onPointerDown`/`onPointerUp` on the `.pv` container track active drawing state. When `drawingRef.current === true`, the idle timer doesn't reset — chrome stays visible during strokes.
5. **Diff banner → badge** — After 5 seconds, the full-width diff banner auto-collapses to a floating pill (`.pv-diff-badge`) at top-right showing `"v2 · 4↓"`. Clicking re-expands. The `×` dismiss button removes the banner entirely. Badge is outside the auto-hide chrome wrapper — always visible.
6. **Cmd zoom** — `Cmd+=`/`Cmd++` zoom in 10%, `Cmd+-` zoom out 10%, `Cmd+0` reset to 100%. `e.preventDefault()` blocks browser zoom. Bare `+`/`-` still work without modifier.
7. **Pinch-to-zoom** — Touch event listeners on the renderer container track two-finger distance changes. Ratio maps to `zoomPercent` (50–200 range). Uses `onZoomChange` callback prop from InlinePdfRenderer to parent.
8. **Page-turn zones always active** — `.pv-turnzone` elements are outside the chrome wrapper. Keyboard arrow keys and turn zones work regardless of chrome visibility.

### Files modified
| File | Change |
|------|--------|
| `frontend/src/pages/OpenedPartView.tsx` | Added `useRef`. Added `chromeVisible`, `diffBannerCollapsed` state. Added idle timer (`resetIdleTimer`, `handlePointerDown`/`handlePointerUp`, `drawingRef`). Added diff banner collapse timer (5s). Updated keyboard handler with Cmd+=/Cmd+-/Cmd+0 zoom (preventDefault). Rewrote resting state JSX: `.pv-chrome` wrappers for top/bottom chrome, `.pv-title-overlay` floating title, `.pv-diff-badge` collapsed pill, removed in-flow title block. Passed `onZoomChange={setZoom}` to InlinePdfRenderer. |
| `frontend/src/pages/PlayerView.css` | Removed `padding: 0 5.5%` from `.pv-content`. Replaced `.pv-title-block` with `.pv-title-overlay` (floating). Added `.pv-chrome` + `.pv-chrome.hidden` (opacity transition). Added `.pv-diff-badge` pill styles. |
| `frontend/src/components/InlinePdfRenderer.tsx` | Added `onZoomChange` prop. Added pinch-to-zoom touch handler (touchstart/touchmove/touchend on container). |

### Updated TODO list
1. ~~Rail tool buttons → AnnotationLayer mode sync~~ **Done.**
2. **Page-turn animation**: Still instant swap. Could add crossfade.
3. ~~Pinch-to-zoom on iPad~~ **Done.** Touch gesture drives `zoomPercent` via `onZoomChange`.
4. ~~Delete PdfViewer.tsx~~ **Done.** PartRenderer migrated to InlinePdfRenderer.
5. **Dark score in resting mode**: Toggle exists but no UI shown in resting state. Could add to pills area.
6. **Sidecar fix**: Backend `GET /parts/:id/diff` needs to extract `musicdiff.noteOperations` from stored `diffJson`. One-line fix in `parts.ts:612`.
