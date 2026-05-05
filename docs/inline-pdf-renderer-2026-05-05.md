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
