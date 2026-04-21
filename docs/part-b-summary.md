# Annotation Object Model -- Part B Complete

**Shipped:** 2026-04-21
**Total commits:** 20+ (from initial selection overlay through polish)

## What was built

A complete Illustrator-style annotation system for music score PDFs. Players can draw ink strokes, place text, create highlights, and then select, move, resize, recolor, and delete any annotation. Annotations are anchored to musical measures (not page positions), so they survive across version updates via intelligent migration. The system includes a full undo/redo stack, error recovery with toast notifications, offline detection, and keyboard shortcuts for every tool.

## Key architectural decisions

- Per-measure annotation anchoring with auto-split at barlines (highlights only)
- Ink strokes stay as single objects across measures, anchored by centroid
- Illustrator-style object model (selectable, movable, resizable, deletable)
- Session-only undo stack (not persistent across refresh)
- Optimistic UI with backend sync and graceful error recovery
- Page-level bounds for move/resize (annotations not constrained to their anchor measure)
- SVG matrix transform for real-time resize visual feedback
- Inline migration UI in the upload form (per-entry, slot-based matching)

## Deferred to v1.5+

- Multi-select / group operations
- Copy/paste
- Shape tool (circles, rectangles, arrows)
- Stroke width picker
- Persistent undo history
- Annotation layers UI

## Next feature

Version Diff Highlighting -- see Section 4 of overnight spec.
