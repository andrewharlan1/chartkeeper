# PDF Viewer Diagnostic — 2026-05-05

## Task 1 — Identify the renderer

**The PdfViewer component (`frontend/src/components/PdfViewer.tsx`) has a two-stage rendering architecture:**

1. **Stage 1 — `PdfThumbnail`** (lines 82–156): An `<iframe>` that loads a blob URL of the PDF with Chrome's built-in PDF viewer (`#toolbar=0&navpanes=0`). Fixed height of **200px**. Has `pointerEvents: 'none'` on the iframe itself, with a transparent overlay `<div>` that intercepts clicks. Clicking triggers `onClick` → `setOpen(true)`.

2. **Stage 2 — `FullscreenViewer`** (lines 336–1415): A `position: fixed; inset: 0; z-index: 1000` overlay. Uses **pdfjs-dist v4.4.168** to render PDF pages to `<canvas>` elements. Dual-canvas: one for the PDF bitmap, one for hand-drawn annotation overlays. Sizing is computed dynamically from the container: `scale = Math.min((containerWidth - 80) / pageWidth, (containerHeight - 40) / pageHeight, 2.0)`.

**The public `PdfViewer` export (lines 1419–1443) always starts at Stage 1.** It renders `PdfThumbnail`, and only mounts `FullscreenViewer` when `open` state becomes `true` (i.e. after a click).

**Library:** pdfjs-dist ^4.4.168, rendering to `<canvas>`.

## Task 2 — Trace the sizing chain

### Resting state (revealed=false)

```
div.pv             position:fixed; inset:0; flex-column
  div.pv-content   flex:1; overflow:auto; padding:0 5.5%
    div             transform: scale(zoom/100); transformOrigin: top center
      PdfViewer     → renders PdfThumbnail (iframe, height:200px, width:100%)
```

**The PDF is a 200px-tall iframe thumbnail.** The `.pv-content` container has `flex: 1` and fills the remaining viewport height (after banners + title block + footer ≈ most of the screen), but the iframe inside it is hardcoded to 200px. That's the "thin framed rectangle" the user sees. It's not a loading state — it's the **actual rendered output at thumbnail size**.

### Revealed/annotation mode (revealed=true)

```
div.pv.revealed             position:fixed; inset:0; flex-column
  div.pv-topbar             height:44px; flex-shrink:0
  div.pv-strip              height:26px; flex-shrink:0 (conditional)
  div.pv-revealed-body      flex:1; position:relative; overflow:hidden
    div.pv-rail             position:absolute; left:0; width:52px
    div.pv-revealed-content position:absolute; left:52px; right:0; top:0; bottom:44px; overflow:auto
      div                    transform: scale(zoom/100)
        PdfViewer            → renders PdfThumbnail (iframe, height:200px)
    div.pv-footstrip        position:absolute; bottom:0; height:44px
```

Same result: the PdfThumbnail iframe renders at 200px height inside a large available area. This is the "tiny thumbnail floating near the top toolbar."

### Zoom

The CSS `transform: scale(zoom/100)` wrapping div scales the **PdfThumbnail iframe**, not a pdfjs canvas. At 100% zoom, the thumbnail is 200px. At 200% zoom, it's 400px (but still an iframe with Chrome's PDF viewer inside). The zoom has no effect on actual PDF rendering quality.

### The gap

- **Available canvas area (revealed mode):** viewport height minus ~114px (topbar + strip + footstrip), viewport width minus 52px (rail). On a 1440×900 display: ~786px × 1388px.
- **Actual PDF element:** 200px × (container width). The iframe fills width but is clamped to 200px height.
- **Gap:** ~586px of vertical space is unused. The PDF is rendered at roughly 25% of its intended area.

## Task 3 — Resting state rendering

The "thin framed rectangle with text 'Test-1 / Flute / 3-Note-Diff'" is the `PdfThumbnail` component:

- It IS the same renderer in both modes — `PdfThumbnail` via `<iframe>`.
- It is NOT a loading placeholder — it's the actual rendered state. The loading state shows "Loading…" text; the error state shows "Preview unavailable". What the user sees is the **successfully loaded** thumbnail.
- The 200px height is hardcoded at `PdfThumbnail` line 129: `style={{ display: 'block', width: '100%', height: 200, border: 'none', pointerEvents: 'none' }}`.
- The PDF data IS being fetched correctly — the iframe displays the first page of the PDF. The `fetchPdfData()` call succeeds, creates a blob URL, and the iframe loads it. If it weren't fetching, the user would see "Preview unavailable."
- The text "Test-1 / Flute / 3-Note-Diff" is rendered by Chrome's built-in PDF viewer inside the iframe — it's the PDF content itself, just tiny.

## Task 4 — "Falls through to Chrome's PDF viewer"

**Root cause: the PDF IS rendered by Chrome's built-in PDF viewer.** The `PdfThumbnail` component uses `<iframe src={blobUrl}>`. Chrome renders PDFs natively inside iframes. The iframe has `pointerEvents: 'none'` and there's a transparent overlay div on top to capture clicks.

The click IS being captured — it calls `onClick={() => setOpen(true)}`, which mounts the `FullscreenViewer`. But the `FullscreenViewer` renders as a `position: fixed; inset: 0; z-index: 1000` overlay with a dark `#080812` background and its own toolbar. **This overlay is what appears to be "Chrome's PDF viewer"** — it has a dark background, a toolbar row at top, page navigation buttons, and the PDF rendered to canvas inside it. It looks like a separate viewer because it IS a separate full-screen overlay that sits on top of the player view chrome.

So the chain is:
1. User sees PdfThumbnail (200px iframe) in the player view
2. User clicks it
3. FullscreenViewer opens as a z-index:1000 fixed overlay
4. This overlay covers the entire viewport with its own dark UI
5. User perceives this as "leaving the app" or "Chrome taking over" because the entire redesigned player chrome vanishes behind the overlay

**There is no `<a href>` or `target="_blank"` involved.** The click does not navigate to a new URL. It stays in-app, but the FullscreenViewer's visual language (dark bg, own toolbar) is completely different from the redesigned player view's visual language (warm paper bg, left rail, bottom strip).

## Task 5 — Compare to last-known-good

### Git history

```
629696b feat(player-view): diff banner with real data + measure highlight brackets
9174790 feat(player-view): functional zoom + Ask palette placeholder modal
22e5122 feat(player-view): resting state + annotation mode visual redesign per artboard 01/02
bdc01e7 fix(annotations): include boundingBox in PdfViewer save payloads
```

None of the overnight commits touched `PdfViewer.tsx`. The overnight work only modified `OpenedPartView.tsx` and `PlayerView.css`.

### Before vs. after

**Before (pre-22e5122):** OpenedPartView rendered inside `<Layout>` with a `div.score-page-area` container (`flex:1; padding:36px 56px; min-height:400px`). PdfViewer was mounted inside this container. The PdfThumbnail displayed at 200px height, same as now. Clicking opened FullscreenViewer, same as now.

**After (22e5122):** OpenedPartView was rewritten with full-bleed `position:fixed` chrome. PdfViewer is mounted inside `.pv-content` or `.pv-revealed-content`. Still renders PdfThumbnail at 200px. Still opens FullscreenViewer on click.

**The overnight work did not introduce a rendering regression.** The PdfViewer component behaves identically before and after. The rendering was always two-stage (thumbnail → fullscreen overlay). What changed is the **context**: the old Layout wrapper made the 200px thumbnail look intentional (it was in a card-like area with other UI around it). The new full-bleed immersive chrome makes the 200px thumbnail look broken because there's now a huge warm-paper viewport with a tiny rectangle in it.

### The real regression

The overnight redesign built a complete annotation-mode chrome (left rail with pen/highlight/text/eraser, bottom strip with page thumbnails and zoom, top bar with Edit/View toggle) — but this chrome is **decorative only**. It doesn't control the actual PdfViewer. The zoom slider scales the thumbnail iframe. The page thumbnails set `currentPage` state in OpenedPartView, but PdfViewer has its own internal page state. The tool buttons set `activeTool` state in OpenedPartView, but PdfViewer/FullscreenViewer has its own tool state. Nothing is wired together.

## Task 6 — Architecture classification

**Category: B + A (combination, but primarily B)**

**B — Renderer regression:** The overnight redesign built new chrome that expects the PDF to render inline at full size, but still mounts `PdfViewer` which starts as a 200px thumbnail iframe and only renders via pdfjs in a separate fullscreen overlay. The redesign's UI (rail tools, zoom slider, page nav, Edit/View toggle) has no connection to the actual PDF renderer. The fix requires either:
- (a) Making PdfViewer render in "inline fullscreen" mode (skip the thumbnail, render pdfjs canvas directly in the container), or
- (b) Extracting the FullscreenViewer's pdfjs rendering logic into a new inline component that the OpenedPartView chrome can control.

**A — Sizing/layout bug (secondary):** Even if the renderer is fixed, the container sizing needs work. The `.pv-content` and `.pv-revealed-content` containers provide the space, but the PDF renderer needs to be told to fill that space instead of rendering at 200px.

**Evidence:**
- PdfViewer.tsx lines 1419–1443: public component always renders thumbnail first
- PdfThumbnail line 129: hardcoded `height: 200`
- FullscreenViewer line 1050: `position: 'fixed', inset: 0, zIndex: 1000` — it's a portal-like overlay, not an inline renderer
- OpenedPartView zoom/page/tool state is not passed to or consumed by PdfViewer

## Estimated time to fix

**Medium (2–8 hours)**

The core work is creating an inline rendering mode for the PDF that:
- Uses pdfjs canvas rendering (not iframe) directly in the player view container
- Sizes to fill the available container (`.pv-content` or `.pv-revealed-content`)
- Accepts page, zoom, and tool state from the parent (OpenedPartView)
- Integrates with the existing AnnotationLayer and DiffHighlightLayer

The FullscreenViewer already has all this logic — it just needs to be refactored from a fixed overlay into an inline component.

## Fix recommendation

Extract the canvas-rendering core of `FullscreenViewer` (pdfjs loading, page rendering, canvas sizing, annotation layer mounting, diff highlight layer) into a new `InlinePdfRenderer` component that renders as a normal flow element sized by its container. `OpenedPartView` mounts this component inside `.pv-content` / `.pv-revealed-content` and passes it the page number, zoom level, annotation mode, tool selection, and diff data as props. Remove the `PdfThumbnail` → `FullscreenViewer` two-stage flow from this route entirely. The FullscreenViewer overlay pattern can remain available for other contexts (e.g., quick preview from a file list) but the player view should never use it.

## Open questions

1. **Should the FullscreenViewer's own toolbar be preserved as a fallback?** The redesigned chrome duplicates its functionality (page nav, zoom, tool selection, dark mode toggle, notes panel). If the inline renderer is wired to OpenedPartView's chrome, the FullscreenViewer toolbar is redundant in this route. But removing it means the OpenedPartView chrome must handle everything — including the annotation save flow, anchor dialogs, and undo/redo. Product decision: migrate all toolbar functions to the new chrome, or keep a simplified FullscreenViewer toolbar as an escape hatch?

2. **Zoom behavior:** The current design applies CSS `transform: scale()` to the container. The FullscreenViewer instead re-renders the PDF at a different pdfjs viewport scale. CSS scale is cheaper but produces blurry text at high zoom. pdfjs re-render is sharper but causes a flash. Which behavior does the design spec require?

3. **Page turn zones vs. page navigation:** OpenedPartView has left/right page-turn zones (`.pv-turnzone`) that set `currentPage` state, but this state doesn't flow to PdfViewer. Should page turns be animated (slide transition) or instant (re-render)?
