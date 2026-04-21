import { useEffect, useState, useRef, useCallback, PointerEvent as ReactPointerEvent } from 'react';
import { MeasureLayoutItem, Annotation, Stroke, StrokePoint, InkContent, HighlightContent, TextContent, FontFamily } from '../../types';
import { getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation } from '../../api/annotations';
import { AnnotationMode } from '../../hooks/useAnnotationMode';
import { SaveStatus } from './SaveStatusIndicator';
import { InkRenderer, smoothPath } from './InkRenderer';
import { HighlightRenderer } from './HighlightRenderer';
import { TextRenderer } from './TextRenderer';
import { SelectionOverlay, getAnnotationBounds } from './SelectionOverlay';
import { useAnnotationHistory } from '../../hooks/useAnnotationHistory';
import { useToast } from '../Toast';

interface Props {
  partId: string;
  currentPage: number;
  measureLayout: MeasureLayoutItem[];
  canvasWidth: number;
  canvasHeight: number;
  mode: AnnotationMode;
  inkColor: string;
  highlightColor: string;
  textColor: string;
  fontSize: number;
  fontFamily: FontFamily;
  selectedAnnotationId: string | null;
  onSelectionChange: (id: string | null) => void;
  onSelectedKindChange?: (kind: 'ink' | 'text' | 'highlight' | null) => void;
  onSaveStatusChange: (status: SaveStatus) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean, undo: () => void, redo: () => void) => void;
  onInkColorChange?: (color: string) => void;
  onTextColorChange?: (color: string) => void;
  onHighlightColorChange?: (color: string) => void;
}

const INK_STROKE_WIDTH = 0.002; // normalized to page width
const ERASE_HIT_PAD = 0.008; // ~8px hit tolerance at 1000px canvas

// Page-level bounds for move/resize — generous padding allows annotations near page edges
const PAGE_BOUNDS = { minX: 0, minY: -0.15, maxX: 1, maxY: 1.15 };

function rgbToHex(r: string, g: string, b: string): string {
  return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function parseRgba(rgba: string): { color: string; opacity: number } {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) return { color: rgbToHex(m[1], m[2], m[3]), opacity: m[4] ? parseFloat(m[4]) : 1 };
  return { color: rgba, opacity: 1 };
}

/** Return a padded AABB (normalized coords) for hit-testing any annotation type. */
function getAnnotationBBox(a: Annotation): { x1: number; y1: number; x2: number; y2: number } | null {
  const pad = ERASE_HIT_PAD;
  if (a.kind === 'ink') {
    const c = a.contentJson as InkContent;
    if (!c.boundingBox) return null;
    const { x, y, width, height } = c.boundingBox;
    return { x1: x - pad, y1: y - pad, x2: x + width + pad, y2: y + height + pad };
  }
  if (a.kind === 'highlight') {
    const c = a.contentJson as HighlightContent;
    const { x, y, width, height } = c.boundingBox;
    return { x1: x - pad, y1: y - pad, x2: x + width + pad, y2: y + height + pad };
  }
  if (a.kind === 'text') {
    const c = a.contentJson as TextContent;
    const { x, y, widthPageUnits, heightPageUnits } = c.boundingBox;
    return { x1: x - pad, y1: y - pad, x2: x + widthPageUnits + pad, y2: y + heightPageUnits + pad };
  }
  return null;
}

function pointInBBox(px: number, py: number, bb: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return px >= bb.x1 && px <= bb.x2 && py >= bb.y1 && py <= bb.y2;
}

export function AnnotationLayer({
  partId,
  currentPage,
  measureLayout,
  canvasWidth,
  canvasHeight,
  mode,
  inkColor,
  highlightColor,
  textColor,
  fontSize,
  fontFamily,
  selectedAnnotationId,
  onSelectionChange,
  onSelectedKindChange,
  onSaveStatusChange,
  onHistoryChange,
  onInkColorChange,
  onTextColorChange,
  onHighlightColorChange,
}: Props) {
  const { showToast } = useToast();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [livePoints, setLivePoints] = useState<StrokePoint[]>([]);
  const isDrawing = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokes = useRef<{ points: StrokePoint[]; color: string; width: number }[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const hlStartRef = useRef<StrokePoint | null>(null);
  const [hlLiveEnd, setHlLiveEnd] = useState<StrokePoint | null>(null);
  const [activeText, setActiveText] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const textTapRef = useRef<StrokePoint | null>(null);
  // Eraser state
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const eraseStartRef = useRef<StrokePoint | null>(null);
  const pendingDeletes = useRef<Set<string>>(new Set());
  const history = useAnnotationHistory();
  // Selection drag state
  const dragRef = useRef<{
    type: 'body' | 'handle';
    startPt: StrokePoint;
    originalBounds: { x: number; y: number; w: number; h: number };
    annotationId: string;
    handle?: string;
    anchor?: { x: number; y: number }; // Fixed opposite corner for resize
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [resizeBounds, setResizeBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Re-color tracking
  const prevColorRef = useRef<{ ink: string; text: string; hl: string }>({ ink: inkColor, text: textColor, hl: highlightColor });
  const recolorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-click detection for text editing
  const lastClickRef = useRef<{ time: number; id: string | null }>({ time: 0, id: null });
  // Measure reassignment picker state
  const [showMeasurePicker, setShowMeasurePicker] = useState(false);

  // Fetch annotations on mount
  useEffect(() => {
    getAnnotations(partId)
      .then(r => setAnnotations(r.annotations))
      .catch(() => {});
  }, [partId]);

  // Find which measure a normalized point falls in on the current page
  const findMeasure = useCallback((nx: number, ny: number): number | null => {
    for (const m of measureLayout) {
      if (m.page !== currentPage) continue;
      if (nx >= m.x && nx <= m.x + m.w && ny >= m.y && ny <= m.y + m.h) {
        return m.measureNumber;
      }
    }
    // Fallback: nearest measure on this page
    let nearest: number | null = null;
    let minDist = Infinity;
    for (const m of measureLayout) {
      if (m.page !== currentPage) continue;
      const cx = m.x + m.w / 2;
      const cy = m.y + m.h / 2;
      const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
      if (dist < minDist) { minDist = dist; nearest = m.measureNumber; }
    }
    return nearest;
  }, [measureLayout, currentPage]);

  // Convert pointer event to normalized 0-1 coords relative to the SVG
  function toNormalized(e: ReactPointerEvent<SVGSVGElement>): StrokePoint {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  // Commit pending strokes — split by measure and POST each
  const commitStrokes = useCallback(async () => {
    const strokes = pendingStrokes.current;
    if (strokes.length === 0) return;
    pendingStrokes.current = [];

    onSaveStatusChange('saving');

    // Group whole strokes by measure using bounding-box centroid (no splitting)
    const byMeasure = new Map<number, Stroke[]>();
    for (const stroke of strokes) {
      const xs = stroke.points.map(p => p.x);
      const ys = stroke.points.map(p => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const measureNum = findMeasure(cx, cy);
      if (measureNum == null) continue;
      if (!byMeasure.has(measureNum)) byMeasure.set(measureNum, []);
      byMeasure.get(measureNum)!.push({
        points: stroke.points,
        color: stroke.color,
        width: stroke.width,
      });
    }

    try {
      const newAnnotations: Annotation[] = [];
      for (const [measureNum, measureStrokes] of byMeasure) {
        const allPts = measureStrokes.flatMap(s => s.points);
        const xs = allPts.map(p => p.x);
        const ys = allPts.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        const contentJson: InkContent = {
          strokes: measureStrokes,
          boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        };

        const { annotation } = await createAnnotation(partId, {
          anchorType: 'measure',
          anchorJson: { measureNumber: measureNum },
          kind: 'ink',
          contentJson,
        });
        newAnnotations.push(annotation);
      }
      setAnnotations(prev => [...prev, ...newAnnotations]);
      for (const a of newAnnotations) {
        history.pushOperation({ kind: 'create', annotationId: a.id, snapshot: a });
      }
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
      showToast("Couldn't save annotation. Try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, findMeasure, onSaveStatusChange, showToast]);

  // Commit a highlight rectangle
  const commitHighlight = useCallback(async (start: StrokePoint, end: StrokePoint) => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (width < 0.005 && height < 0.005) return;

    const measureNum = findMeasure(x + width / 2, y + height / 2);
    if (measureNum == null) return;

    const { color, opacity } = parseRgba(highlightColor);
    const contentJson: HighlightContent = { color, opacity, boundingBox: { x, y, width, height } };

    onSaveStatusChange('saving');
    try {
      const { annotation } = await createAnnotation(partId, {
        anchorType: 'measure',
        anchorJson: { measureNumber: measureNum },
        kind: 'highlight',
        contentJson,
      });
      setAnnotations(prev => [...prev, annotation]);
      history.pushOperation({ kind: 'create', annotationId: annotation.id, snapshot: annotation });
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
      showToast("Couldn't save annotation. Try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, highlightColor, findMeasure, onSaveStatusChange, showToast]);

  // Commit a text annotation
  const commitText = useCallback(async (data: { x: number; y: number; text: string }) => {
    if (!data.text.trim()) return;

    const measureNum = findMeasure(data.x, data.y);
    if (measureNum == null) return;

    const lines = data.text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length));

    const contentJson: TextContent = {
      text: data.text.trim(),
      fontSize,
      color: textColor,
      fontWeight: 'normal',
      fontStyle: 'normal',
      fontFamily,
      boundingBox: {
        x: data.x,
        y: data.y,
        widthPageUnits: maxLen * fontSize * 0.6,
        heightPageUnits: lines.length * fontSize * 1.3,
      },
    };

    onSaveStatusChange('saving');
    try {
      const { annotation } = await createAnnotation(partId, {
        anchorType: 'measure',
        anchorJson: { measureNumber: measureNum },
        kind: 'text',
        contentJson,
      });
      setAnnotations(prev => [...prev, annotation]);
      history.pushOperation({ kind: 'create', annotationId: annotation.id, snapshot: annotation });
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
      showToast("Couldn't save annotation. Try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textColor, fontSize, fontFamily, partId, findMeasure, onSaveStatusChange, showToast]);

  // Find annotations hit by a point (for eraser)
  const eraseHitTest = useCallback((pt: StrokePoint, candidates: Annotation[]): Annotation[] => {
    const hits: Annotation[] = [];
    for (const a of candidates) {
      if (fadingIds.has(a.id) || pendingDeletes.current.has(a.id)) continue;
      const bb = getAnnotationBBox(a);
      if (bb && pointInBBox(pt.x, pt.y, bb)) hits.push(a);
    }
    return hits;
  }, [fadingIds]);

  // Commit batched deletes to the server
  const commitErases = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const erased = annotations.filter(a => idSet.has(a.id));
    // Push delete entries to undo history
    for (const a of erased) {
      history.pushOperation({ kind: 'delete', annotationId: a.id, snapshot: a });
    }

    onSaveStatusChange('saving');
    try {
      await Promise.all(ids.map(id => deleteAnnotation(id)));
      setAnnotations(prev => prev.filter(a => !idSet.has(a.id)));
      onSaveStatusChange('saved');
    } catch {
      // Restore faded annotations on failure
      setAnnotations(prev => [...prev]); // trigger re-render to show them
      onSaveStatusChange('error');
      showToast("Couldn't delete. Try again.");
    }
    setFadingIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, onSaveStatusChange, showToast]);

  // Undo — reverse the last operation
  const handleUndo = useCallback(async () => {
    const entry = history.popUndo();
    if (!entry) return;
    onSaveStatusChange('saving');
    try {
      if (entry.kind === 'create') {
        // Undo create → delete the annotation
        await deleteAnnotation(entry.annotationId);
        setAnnotations(prev => prev.filter(a => a.id !== entry.annotationId));
      } else if (entry.kind === 'delete') {
        // Undo delete → re-create from snapshot
        const { annotation } = await createAnnotation(partId, {
          anchorType: entry.snapshot.anchorType,
          anchorJson: entry.snapshot.anchorJson,
          kind: entry.snapshot.kind,
          contentJson: entry.snapshot.contentJson,
        });
        // Update the entry's snapshot with the new ID for redo
        entry.annotationId = annotation.id;
        entry.snapshot = annotation;
        setAnnotations(prev => [...prev, annotation]);
      } else if (entry.kind === 'update') {
        // Undo update → revert to before state
        await updateAnnotation(entry.annotationId, { contentJson: entry.before.contentJson });
        setAnnotations(prev => prev.map(a => a.id === entry.annotationId ? { ...a, contentJson: entry.before.contentJson } : a));
      }
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, onSaveStatusChange]);

  // Redo — re-apply the last undone operation
  const handleRedo = useCallback(async () => {
    const entry = history.popRedo();
    if (!entry) return;
    onSaveStatusChange('saving');
    try {
      if (entry.kind === 'create') {
        // Redo create → re-create annotation
        const { annotation } = await createAnnotation(partId, {
          anchorType: entry.snapshot.anchorType,
          anchorJson: entry.snapshot.anchorJson,
          kind: entry.snapshot.kind,
          contentJson: entry.snapshot.contentJson,
        });
        entry.annotationId = annotation.id;
        entry.snapshot = annotation;
        setAnnotations(prev => [...prev, annotation]);
      } else if (entry.kind === 'delete') {
        // Redo delete → delete the annotation again
        await deleteAnnotation(entry.annotationId);
        setAnnotations(prev => prev.filter(a => a.id !== entry.annotationId));
      } else if (entry.kind === 'update') {
        // Redo update → apply the after state
        await updateAnnotation(entry.annotationId, { contentJson: entry.after.contentJson });
        setAnnotations(prev => prev.map(a => a.id === entry.annotationId ? { ...a, contentJson: entry.after.contentJson } : a));
      }
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, onSaveStatusChange]);

  // Delete the currently selected annotation (fade + API delete)
  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) return;
    const id = selectedAnnotationId;
    onSelectionChange(null);
    setFadingIds(prev => new Set(prev).add(id));
    setTimeout(() => commitErases([id]), 150);
  }, [selectedAnnotationId, onSelectionChange, commitErases]);

  // Clamp a drag offset so the annotation stays within page bounds
  const clampOffset = useCallback((dx: number, dy: number, bounds: { x: number; y: number; w: number; h: number }) => {
    const newX = bounds.x + dx;
    const newY = bounds.y + dy;
    const clampedX = Math.max(PAGE_BOUNDS.minX, Math.min(newX, PAGE_BOUNDS.maxX - bounds.w));
    const clampedY = Math.max(PAGE_BOUNDS.minY, Math.min(newY, PAGE_BOUNDS.maxY - bounds.h));
    return { dx: clampedX - bounds.x, dy: clampedY - bounds.y };
  }, []);

  // Commit a move — update annotation coordinates and save to server
  const commitMove = useCallback(async (annotationId: string, dx: number, dy: number) => {
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann || (dx === 0 && dy === 0)) return;

    let updatedContent: typeof ann.contentJson;
    if (ann.kind === 'ink') {
      const c = ann.contentJson as InkContent;
      updatedContent = {
        strokes: c.strokes.map(s => ({
          ...s,
          points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
        })),
        boundingBox: {
          x: c.boundingBox.x + dx,
          y: c.boundingBox.y + dy,
          width: c.boundingBox.width,
          height: c.boundingBox.height,
        },
      } as InkContent;
    } else if (ann.kind === 'highlight') {
      const c = ann.contentJson as HighlightContent;
      updatedContent = {
        ...c,
        boundingBox: { ...c.boundingBox, x: c.boundingBox.x + dx, y: c.boundingBox.y + dy },
      } as HighlightContent;
    } else if (ann.kind === 'text') {
      const c = ann.contentJson as TextContent;
      updatedContent = {
        ...c,
        boundingBox: { ...c.boundingBox, x: c.boundingBox.x + dx, y: c.boundingBox.y + dy },
      } as TextContent;
    } else {
      return;
    }

    const updatedAnn = { ...ann, contentJson: updatedContent! };
    history.pushOperation({ kind: 'update', annotationId, before: ann, after: updatedAnn });

    // Optimistic local update
    setAnnotations(prev => prev.map(a => a.id === annotationId ? updatedAnn : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { contentJson: updatedContent });
      onSaveStatusChange('saved');
    } catch {
      // Revert on failure
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
      showToast("Couldn't save change. Reverted.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, onSaveStatusChange, showToast]);

  // Start a body drag from SelectionOverlay
  const handleSelectionBodyDown = useCallback((e: React.PointerEvent) => {
    if (!selectedAnnotationId) return;
    const ann = annotations.find(a => a.id === selectedAnnotationId);
    if (!ann) return;
    const bounds = getAnnotationBounds(ann);
    if (!bounds) return;

    const rect = svgRef.current!.getBoundingClientRect();
    const pt = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };

    dragRef.current = {
      type: 'body',
      startPt: pt,
      originalBounds: bounds,
      annotationId: selectedAnnotationId,
    };
    setDragOffset({ dx: 0, dy: 0 });
    (svgRef.current as Element).setPointerCapture(e.pointerId);
  }, [selectedAnnotationId, annotations]);

  // Commit a resize — apply per-type geometry changes and save
  const commitResize = useCallback(async (annotationId: string, newBounds: { x: number; y: number; w: number; h: number }) => {
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;

    let updatedContent: typeof ann.contentJson;
    if (ann.kind === 'ink') {
      const c = ann.contentJson as InkContent;
      const ob = c.boundingBox;
      // Scale stroke points: (oldPt - oldOrigin) / oldSize * newSize + newOrigin
      updatedContent = {
        strokes: c.strokes.map(s => ({
          ...s,
          points: s.points.map(p => ({
            x: ob.width > 0 ? (p.x - ob.x) / ob.width * newBounds.w + newBounds.x : newBounds.x,
            y: ob.height > 0 ? (p.y - ob.y) / ob.height * newBounds.h + newBounds.y : newBounds.y,
          })),
        })),
        boundingBox: { x: newBounds.x, y: newBounds.y, width: newBounds.w, height: newBounds.h },
      } as InkContent;
    } else if (ann.kind === 'highlight') {
      const c = ann.contentJson as HighlightContent;
      updatedContent = {
        ...c,
        boundingBox: { x: newBounds.x, y: newBounds.y, width: newBounds.w, height: newBounds.h },
      } as HighlightContent;
    } else if (ann.kind === 'text') {
      const c = ann.contentJson as TextContent;
      updatedContent = {
        ...c,
        boundingBox: { ...c.boundingBox, x: newBounds.x, y: newBounds.y, widthPageUnits: newBounds.w, heightPageUnits: newBounds.h },
      } as TextContent;
    } else {
      return;
    }

    const updatedAnn = { ...ann, contentJson: updatedContent! };
    history.pushOperation({ kind: 'update', annotationId, before: ann, after: updatedAnn });

    setAnnotations(prev => prev.map(a => a.id === annotationId ? updatedAnn : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { contentJson: updatedContent });
      onSaveStatusChange('saved');
    } catch {
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
      showToast("Couldn't save change. Reverted.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, onSaveStatusChange, showToast]);

  // Reassign an annotation to a different measure
  const commitReassignMeasure = useCallback(async (annotationId: string, newMeasureNumber: number) => {
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;

    const oldAnchor = ann.anchorJson as { measureNumber?: number; pageHint?: number };
    if (oldAnchor.measureNumber === newMeasureNumber) return;

    const newAnchor = { ...oldAnchor, measureNumber: newMeasureNumber };
    const updatedAnn = { ...ann, anchorJson: newAnchor };
    history.pushOperation({ kind: 'update', annotationId, before: ann, after: updatedAnn });

    setAnnotations(prev => prev.map(a => a.id === annotationId ? updatedAnn : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { anchorJson: newAnchor });
      onSaveStatusChange('saved');
    } catch {
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
      showToast("Couldn't save change. Reverted.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, onSaveStatusChange, showToast]);

  // Start a handle drag from SelectionOverlay
  const handleSelectionHandleDown = useCallback((e: React.PointerEvent, handle: string) => {
    if (!selectedAnnotationId) return;
    const ann = annotations.find(a => a.id === selectedAnnotationId);
    if (!ann) return;
    const bounds = getAnnotationBounds(ann);
    if (!bounds) return;

    const rect = svgRef.current!.getBoundingClientRect();
    const pt = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };

    // Compute anchor — the opposite corner/edge that stays fixed during resize
    const { x, y, w, h } = bounds;
    let anchor: { x: number; y: number };
    if (handle === 'nw') anchor = { x: x + w, y: y + h };
    else if (handle === 'n') anchor = { x: x, y: y + h }; // top edge: anchor bottom-left
    else if (handle === 'ne') anchor = { x: x, y: y + h };
    else if (handle === 'e') anchor = { x: x, y: y }; // right edge: anchor top-left
    else if (handle === 'se') anchor = { x: x, y: y };
    else if (handle === 's') anchor = { x: x, y: y }; // bottom edge: anchor top-left
    else if (handle === 'sw') anchor = { x: x + w, y: y };
    else /* w */ anchor = { x: x + w, y: y }; // left edge: anchor top-right

    dragRef.current = {
      type: 'handle',
      startPt: pt,
      originalBounds: bounds,
      annotationId: selectedAnnotationId,
      handle,
      anchor,
    };
    setResizeBounds(bounds);
    (svgRef.current as Element).setPointerCapture(e.pointerId);
  }, [selectedAnnotationId, annotations]);

  // Notify parent of history state changes
  useEffect(() => {
    onHistoryChange?.(history.canUndo, history.canRedo, handleUndo, handleRedo);
  }, [history.canUndo, history.canRedo, onHistoryChange, handleUndo, handleRedo]);

  // Clear stacks on part change
  useEffect(() => {
    history.clearStacks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (activeText) return; // don't capture when editing text
      if (dragRef.current) return; // ignore during active drag/resize
      // Cmd+Z undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (history.canUndo) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }
      // Cmd+Shift+Z or Cmd+Y redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || e.key === 'y') && (e.key === 'y' || e.shiftKey)) {
        if (history.canRedo) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }
      // Delete/Backspace — delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        e.preventDefault();
        deleteSelectedAnnotation();
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history.canUndo, history.canRedo, handleUndo, handleRedo, selectedAnnotationId, activeText, deleteSelectedAnnotation]);

  // Sync toolbar color and report kind to selected annotation on selection
  useEffect(() => {
    setShowMeasurePicker(false);
    if (!selectedAnnotationId) {
      onSelectedKindChange?.(null);
      return;
    }
    const ann = annotations.find(a => a.id === selectedAnnotationId);
    if (!ann) { onSelectedKindChange?.(null); return; }
    if (ann.kind === 'ink' || ann.kind === 'text' || ann.kind === 'highlight') {
      onSelectedKindChange?.(ann.kind);
    }
    if (ann.kind === 'ink') {
      const c = ann.contentJson as InkContent;
      const color = c.strokes[0]?.color;
      if (color && color !== inkColor) {
        prevColorRef.current.ink = color;
        onInkColorChange?.(color);
      }
    } else if (ann.kind === 'text') {
      const c = ann.contentJson as TextContent;
      if (c.color !== textColor) {
        prevColorRef.current.text = c.color;
        onTextColorChange?.(c.color);
      }
    } else if (ann.kind === 'highlight') {
      // Highlight colors are stored as hex+opacity, toolbar uses rgba — skip color sync
      void onHighlightColorChange;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAnnotationId]);

  // Re-color selected annotation when toolbar color changes
  const commitRecolor = useCallback(async (annotationId: string, newColor: string) => {
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;

    let updatedContent: typeof ann.contentJson;
    if (ann.kind === 'ink') {
      const c = ann.contentJson as InkContent;
      updatedContent = { ...c, strokes: c.strokes.map(s => ({ ...s, color: newColor })) } as InkContent;
    } else if (ann.kind === 'highlight') {
      const c = ann.contentJson as HighlightContent;
      const { opacity } = parseRgba(newColor);
      updatedContent = { ...c, color: newColor.startsWith('#') ? newColor : parseRgba(newColor).color, opacity: newColor.startsWith('#') ? c.opacity : opacity } as HighlightContent;
    } else if (ann.kind === 'text') {
      const c = ann.contentJson as TextContent;
      updatedContent = { ...c, color: newColor } as TextContent;
    } else {
      return;
    }

    const updatedAnn = { ...ann, contentJson: updatedContent! };
    history.pushOperation({ kind: 'update', annotationId, before: ann, after: updatedAnn });
    setAnnotations(prev => prev.map(a => a.id === annotationId ? updatedAnn : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { contentJson: updatedContent });
      onSaveStatusChange('saved');
    } catch {
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
      showToast("Couldn't save change. Reverted.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, onSaveStatusChange, showToast]);

  // Detect color prop changes and apply to selected annotation
  useEffect(() => {
    const prev = prevColorRef.current;
    prevColorRef.current = { ink: inkColor, text: textColor, hl: highlightColor };
    if (!selectedAnnotationId) return;
    const ann = annotations.find(a => a.id === selectedAnnotationId);
    if (!ann) return;

    let newColor: string | null = null;
    if (ann.kind === 'ink' && inkColor !== prev.ink) newColor = inkColor;
    else if (ann.kind === 'text' && textColor !== prev.text) newColor = textColor;
    else if (ann.kind === 'highlight' && highlightColor !== prev.hl) newColor = highlightColor;

    if (newColor) {
      // Debounce recolor saves
      if (recolorTimer.current) clearTimeout(recolorTimer.current);
      recolorTimer.current = setTimeout(() => {
        recolorTimer.current = null;
        commitRecolor(selectedAnnotationId, newColor!);
      }, 300);
    }

    return () => {
      if (recolorTimer.current) clearTimeout(recolorTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkColor, textColor, highlightColor]);

  // Pointer handlers
  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== 'ink' && mode !== 'highlight' && mode !== 'text' && mode !== 'erase' && mode !== 'select') return;
    e.preventDefault();
    const pt = toNormalized(e);

    if (mode === 'select') {
      // Hit test — iterate reverse for z-order (topmost first)
      let hit: Annotation | null = null;
      for (let i = pageAnnotations.length - 1; i >= 0; i--) {
        const a = pageAnnotations[i];
        if (fadingIds.has(a.id)) continue;
        const bb = getAnnotationBBox(a);
        if (bb && pointInBBox(pt.x, pt.y, bb)) { hit = a; break; }
      }
      // Double-click detection
      const now = Date.now();
      if (hit && hit.id === lastClickRef.current.id && now - lastClickRef.current.time < 400) {
        if (hit.kind === 'text') {
          // Double-click text → enter edit mode
          const tc = hit.contentJson as TextContent;
          onSelectionChange(null);
          setActiveText({ x: tc.boundingBox.x, y: tc.boundingBox.y, text: tc.text });
          setAnnotations(prev => prev.filter(a => a.id !== hit!.id));
          deleteAnnotation(hit.id).catch(() => {});
        } else {
          // Double-click non-text → delete
          onSelectionChange(null);
          setFadingIds(prev => new Set(prev).add(hit!.id));
          setTimeout(() => commitErases([hit!.id]), 150);
        }
        lastClickRef.current = { time: 0, id: null };
        return;
      }
      lastClickRef.current = { time: now, id: hit?.id ?? null };
      onSelectionChange(hit?.id ?? null);
      return;
    }

    if (mode === 'ink') {
      (e.target as Element).setPointerCapture(e.pointerId);
      isDrawing.current = true;
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      setLivePoints([pt]);
    } else if (mode === 'highlight') {
      (e.target as Element).setPointerCapture(e.pointerId);
      isDrawing.current = true;
      hlStartRef.current = pt;
      setHlLiveEnd(pt);
    } else if (mode === 'text') {
      textTapRef.current = pt;
    } else if (mode === 'erase') {
      (e.target as Element).setPointerCapture(e.pointerId);
      isDrawing.current = true;
      eraseStartRef.current = pt;
      pendingDeletes.current = new Set();
      // Immediate hit test at down point
      const hits = eraseHitTest(pt, pageAnnotations);
      for (const h of hits) {
        pendingDeletes.current.add(h.id);
        setFadingIds(prev => new Set(prev).add(h.id));
      }
    }
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    // Handle drag (resize) in select mode
    if (dragRef.current?.type === 'handle') {
      e.preventDefault();
      const pt = toNormalized(e);
      const { originalBounds: ob, handle, anchor } = dragRef.current;
      if (!anchor) return;
      const minW = 10 / canvasWidth;
      const minH = 10 / canvasHeight;

      // Compute the "free" point — the dragged corner/edge position
      // Start from the original dragged corner/edge, add delta from pointer movement
      const dx = pt.x - dragRef.current.startPt.x;
      const dy = pt.y - dragRef.current.startPt.y;

      // Compute new bounds based on handle type
      let nx: number, ny: number, nw: number, nh: number;
      if (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w') {
        // Edge handles: only one axis changes, the other stays at original bounds
        nx = ob.x; ny = ob.y; nw = ob.w; nh = ob.h;
        if (handle === 'n') {
          const freeY = ob.y + dy;
          ny = Math.min(anchor.y, freeY);
          nh = Math.abs(freeY - anchor.y);
        } else if (handle === 's') {
          const freeY = ob.y + ob.h + dy;
          ny = Math.min(anchor.y, freeY);
          nh = Math.abs(freeY - anchor.y);
        } else if (handle === 'e') {
          const freeX = ob.x + ob.w + dx;
          nx = Math.min(anchor.x, freeX);
          nw = Math.abs(freeX - anchor.x);
        } else /* w */ {
          const freeX = ob.x + dx;
          nx = Math.min(anchor.x, freeX);
          nw = Math.abs(freeX - anchor.x);
        }
      } else {
        // Corner handles: both axes move
        let freeX: number, freeY: number;
        if (handle === 'nw') { freeX = ob.x + dx; freeY = ob.y + dy; }
        else if (handle === 'ne') { freeX = ob.x + ob.w + dx; freeY = ob.y + dy; }
        else if (handle === 'sw') { freeX = ob.x + dx; freeY = ob.y + ob.h + dy; }
        else /* se */ { freeX = ob.x + ob.w + dx; freeY = ob.y + ob.h + dy; }
        nx = Math.min(anchor.x, freeX);
        ny = Math.min(anchor.y, freeY);
        nw = Math.abs(freeX - anchor.x);
        nh = Math.abs(freeY - anchor.y);
      }

      // Enforce minimum size
      if (nw < minW) nw = minW;
      if (nh < minH) nh = minH;

      // Shift: lock aspect ratio for corner handles
      const shiftKey = (e.nativeEvent as PointerEvent).shiftKey;
      const aspect = ob.w / (ob.h || 1);
      if (shiftKey && (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')) {
        if (nw / nh > aspect) { nw = nh * aspect; }
        else { nh = nw / aspect; }
      }

      // Clamp to page-level bounds
      nx = Math.max(PAGE_BOUNDS.minX, nx);
      ny = Math.max(PAGE_BOUNDS.minY, ny);
      nw = Math.min(nw, PAGE_BOUNDS.maxX - nx);
      nh = Math.min(nh, PAGE_BOUNDS.maxY - ny);

      setResizeBounds({ x: nx, y: ny, w: nw, h: nh });
      return;
    }
    // Body drag in select mode
    if (dragRef.current?.type === 'body') {
      e.preventDefault();
      const pt = toNormalized(e);
      let dx = pt.x - dragRef.current.startPt.x;
      let dy = pt.y - dragRef.current.startPt.y;
      // Clamp to page-level bounds
      ({ dx, dy } = clampOffset(dx, dy, dragRef.current.originalBounds));
      setDragOffset({ dx, dy });
      return;
    }
    // Hover detection in select mode
    if (mode === 'select' && !isDrawing.current) {
      const pt = toNormalized(e);
      let hoverHit: string | null = null;
      for (let i = pageAnnotations.length - 1; i >= 0; i--) {
        const a = pageAnnotations[i];
        if (a.id === selectedAnnotationId || fadingIds.has(a.id)) continue;
        const bb = getAnnotationBBox(a);
        if (bb && pointInBBox(pt.x, pt.y, bb)) { hoverHit = a.id; break; }
      }
      setHoveredId(hoverHit);
      return;
    }
    if (!isDrawing.current) return;
    e.preventDefault();
    const pt = toNormalized(e);
    if (mode === 'ink') {
      setLivePoints(prev => [...prev, pt]);
    } else if (mode === 'highlight') {
      setHlLiveEnd(pt);
    } else if (mode === 'erase') {
      const hits = eraseHitTest(pt, pageAnnotations);
      for (const h of hits) {
        pendingDeletes.current.add(h.id);
        setFadingIds(prev => new Set(prev).add(h.id));
      }
    }
  }

  function handlePointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    // Complete handle drag (resize)
    if (dragRef.current?.type === 'handle') {
      e.preventDefault();
      const bounds = resizeBounds;
      const id = dragRef.current.annotationId;
      dragRef.current = null;
      setResizeBounds(null);
      if (bounds) {
        commitResize(id, bounds);
      }
      return;
    }
    // Complete body drag
    if (dragRef.current?.type === 'body') {
      e.preventDefault();
      const offset = dragOffset;
      const id = dragRef.current.annotationId;
      dragRef.current = null;
      setDragOffset(null);
      if (offset && (Math.abs(offset.dx) > 0.001 || Math.abs(offset.dy) > 0.001)) {
        commitMove(id, offset.dx, offset.dy);
      }
      return;
    }

    // Text mode: tap detection
    if (mode === 'text' && textTapRef.current) {
      e.preventDefault();
      const up = toNormalized(e);
      const start = textTapRef.current;
      textTapRef.current = null;
      const dist = Math.sqrt((up.x - start.x) ** 2 + (up.y - start.y) ** 2);
      if (dist < 0.01) {
        if (activeText && activeText.text.trim()) {
          commitText(activeText);
        }
        setActiveText({ x: start.x, y: start.y, text: '' });
      }
      return;
    }

    if (!isDrawing.current) return;
    e.preventDefault();
    isDrawing.current = false;

    if (mode === 'ink') {
      const pts = [...livePoints];
      setLivePoints([]);
      if (pts.length >= 3) {
        pendingStrokes.current.push({
          points: pts,
          color: inkColor,
          width: INK_STROKE_WIDTH,
        });
      }
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        commitStrokes();
      }, 500);
    } else if (mode === 'highlight') {
      const start = hlStartRef.current;
      const end = toNormalized(e);
      hlStartRef.current = null;
      setHlLiveEnd(null);
      if (start) commitHighlight(start, end);
    } else if (mode === 'erase') {
      eraseStartRef.current = null;
      const ids = [...pendingDeletes.current];
      pendingDeletes.current = new Set();
      if (ids.length > 0) {
        // Brief fade, then commit deletes
        setTimeout(() => commitErases(ids), 150);
      }
    }
  }

  // Commit pending work / reset state on mode change
  useEffect(() => {
    if (pendingStrokes.current.length > 0) {
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      commitStrokes();
    }
    hlStartRef.current = null;
    setHlLiveEnd(null);
    setActiveText(prev => {
      if (prev && prev.text.trim()) commitText(prev);
      return null;
    });
    textTapRef.current = null;
    eraseStartRef.current = null;
    setHoveredId(null);
    dragRef.current = null;
    setDragOffset(null);
    setResizeBounds(null);
    // Commit any pending erases immediately on mode switch
    const eraseIds = [...pendingDeletes.current];
    pendingDeletes.current = new Set();
    if (eraseIds.length > 0) commitErases(eraseIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  if (canvasWidth === 0 || canvasHeight === 0) return null;

  // Filter annotations for current page
  const pageAnnotations = annotations.filter(a => {
    if (a.kind !== 'ink' && a.kind !== 'highlight' && a.kind !== 'text') return false;
    const anchor = a.anchorJson as { measureNumber?: number; page?: number; pageHint?: number };
    if (anchor.measureNumber != null) {
      const ml = measureLayout.find(m => m.measureNumber === anchor.measureNumber);
      return ml ? ml.page === currentPage : false;
    }
    return (anchor.page ?? anchor.pageHint) === currentPage;
  });

  const isInteractive = mode === 'ink' || mode === 'highlight' || mode === 'text' || mode === 'erase' || mode === 'select';

  // Build the live stroke SVG path (smoothed)
  const livePath = livePoints.length >= 2 ? smoothPath(livePoints, canvasWidth, canvasHeight) : '';

  // Build paths for pending (uncommitted) strokes (smoothed)
  const pendingPaths = pendingStrokes.current.map((s, i) => {
    if (s.points.length < 2) return null;
    const d = smoothPath(s.points, canvasWidth, canvasHeight);
    return (
      <path
        key={`pending-${i}`}
        d={d}
        stroke={s.color}
        strokeWidth={s.width * canvasWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
    );
  });

  return (
    <svg
      ref={svgRef}
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: isInteractive ? 'auto' : 'none',
        cursor: mode === 'select' ? (hoveredId ? 'pointer' : 'default') : isInteractive ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Saved annotations */}
      {pageAnnotations.map(a => {
        const isFading = fadingIds.has(a.id);
        const isDragging = dragRef.current?.type === 'body' && dragRef.current.annotationId === a.id && dragOffset;
        const isResizing = dragRef.current?.type === 'handle' && dragRef.current.annotationId === a.id && resizeBounds;
        let groupTransform: string | undefined;
        if (isDragging) {
          groupTransform = `translate(${dragOffset!.dx * canvasWidth}, ${dragOffset!.dy * canvasHeight})`;
        } else if (isResizing) {
          const ob = dragRef.current!.originalBounds;
          const rb = resizeBounds!;
          if (ob.w > 0 && ob.h > 0) {
            const sx = rb.w / ob.w;
            const sy = rb.h / ob.h;
            const tx = (rb.x - ob.x * sx) * canvasWidth;
            const ty = (rb.y - ob.y * sy) * canvasHeight;
            groupTransform = `matrix(${sx}, 0, 0, ${sy}, ${tx}, ${ty})`;
          }
        }
        return (
          <g key={a.id} style={{ opacity: isFading ? 0 : 1, transition: isFading ? 'opacity 0.15s ease-out' : undefined, cursor: isDragging ? 'grabbing' : undefined }} transform={groupTransform}>
            {a.kind === 'highlight' ? (
              <HighlightRenderer
                annotation={a}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            ) : a.kind === 'text' ? (
              <TextRenderer
                annotation={a}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            ) : (
              <InkRenderer
                annotation={a}
                measureLayout={measureLayout}
                currentPage={currentPage}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            )}
            {/* Yellow review dot for migrated annotations needing review */}
            {(a.contentJson as Record<string, unknown>)._needsReview === true && (() => {
              const b = getAnnotationBounds(a);
              if (!b) return null;
              return (
                <g>
                  <circle
                    cx={b.x * canvasWidth + b.w * canvasWidth + 4}
                    cy={b.y * canvasHeight - 4}
                    r={4}
                    fill="#eab308"
                    stroke="#16152a"
                    strokeWidth={1}
                  />
                  <title>This annotation was migrated and may need review</title>
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* Hover outline in select mode */}
      {hoveredId && hoveredId !== selectedAnnotationId && (() => {
        const ann = pageAnnotations.find(a => a.id === hoveredId);
        if (!ann) return null;
        const bounds = getAnnotationBounds(ann);
        if (!bounds) return null;
        return (
          <rect
            x={bounds.x * canvasWidth - 2}
            y={bounds.y * canvasHeight - 2}
            width={bounds.w * canvasWidth + 4}
            height={bounds.h * canvasHeight + 4}
            fill="none" stroke="rgba(124, 111, 247, 0.4)" strokeWidth={1.5}
            rx={2}
            style={{ pointerEvents: 'none' }}
          />
        );
      })()}

      {/* Selection overlay */}
      {selectedAnnotationId && (() => {
        const ann = pageAnnotations.find(a => a.id === selectedAnnotationId);
        if (!ann) return null;
        return (
          <SelectionOverlay
            annotation={ann}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            dragOffset={dragOffset}
            resizeBounds={resizeBounds}
            onBodyPointerDown={handleSelectionBodyDown}
            onHandlePointerDown={handleSelectionHandleDown}
            onDeleteClick={deleteSelectedAnnotation}
          />
        );
      })()}

      {/* Measure assignment badge + picker */}
      {(() => {
        if (!selectedAnnotationId || mode !== 'select') return null;
        const ann = pageAnnotations.find(a => a.id === selectedAnnotationId);
        if (!ann) return null;
        const anchor = ann.anchorJson as { measureNumber?: number };
        if (anchor.measureNumber == null) return null;
        const bounds = getAnnotationBounds(ann);
        if (!bounds) return null;

        // Position badge at bottom-left of selection
        const bx = (resizeBounds?.x ?? (bounds.x + (dragOffset?.dx ?? 0))) * canvasWidth;
        const by = (resizeBounds ? resizeBounds.y + resizeBounds.h : (bounds.y + bounds.h + (dragOffset?.dy ?? 0))) * canvasHeight;

        // Available measures on this page
        const pageMeasures = measureLayout
          .filter(m => m.page === currentPage)
          .sort((a, b) => a.measureNumber - b.measureNumber);

        return (
          <foreignObject
            x={bx - 8}
            y={by + 10}
            width={showMeasurePicker ? 160 : 80}
            height={showMeasurePicker ? Math.min(pageMeasures.length * 28 + 40, 220) : 28}
            style={{ overflow: 'visible' }}
            onPointerDown={e => e.stopPropagation()}
          >
            <div style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {/* Badge */}
              <button
                onClick={() => setShowMeasurePicker(p => !p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 24,
                  padding: '0 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(124, 111, 247, 0.4)',
                  background: '#1c1b32',
                  color: '#c4bcff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                m.{anchor.measureNumber}
                <span style={{ fontSize: 9, opacity: 0.7 }}>{showMeasurePicker ? '▲' : '▼'}</span>
              </button>

              {/* Picker dropdown */}
              {showMeasurePicker && (
                <div style={{
                  marginTop: 4,
                  background: '#16152a',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: 4,
                  maxHeight: 170,
                  overflowY: 'auto',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}>
                  {pageMeasures.map(m => (
                    <button
                      key={m.measureNumber}
                      onClick={() => {
                        commitReassignMeasure(selectedAnnotationId, m.measureNumber);
                        setShowMeasurePicker(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        height: 26,
                        padding: '0 8px',
                        borderRadius: 5,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        background: m.measureNumber === anchor.measureNumber ? 'rgba(124, 111, 247, 0.22)' : 'transparent',
                        color: m.measureNumber === anchor.measureNumber ? '#c4bcff' : '#888',
                      }}
                    >
                      Measure {m.measureNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </foreignObject>
        );
      })()}

      {/* Pending uncommitted strokes */}
      {pendingPaths}

      {/* Live stroke being drawn right now */}
      {livePath && (
        <path
          d={livePath}
          stroke={inkColor}
          strokeWidth={INK_STROKE_WIDTH * canvasWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Active text input — inline editable, no visible box */}
      {activeText && (
        <foreignObject
          x={activeText.x * canvasWidth}
          y={activeText.y * canvasHeight}
          width={canvasWidth - activeText.x * canvasWidth}
          height={canvasHeight - activeText.y * canvasHeight}
          onPointerDown={e => e.stopPropagation()}
        >
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <textarea
              autoFocus
              value={activeText.text}
              onChange={e => setActiveText(prev => prev ? { ...prev, text: e.target.value } : null)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (activeText.text.trim()) commitText(activeText);
                  setActiveText(null);
                }
                if (e.key === 'Escape') setActiveText(null);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: textColor,
                fontSize: fontSize * canvasHeight,
                fontFamily,
                lineHeight: 1.3,
                padding: 0,
                resize: 'none',
                minWidth: 60,
                minHeight: fontSize * canvasHeight + 4,
                width: Math.max(60, (activeText.text.length + 1) * fontSize * canvasHeight * 0.6),
                caretColor: textColor,
              }}
              placeholder="Type here..."
            />
            {/* Done / Cancel floating buttons */}
            <div style={{
              display: 'flex',
              gap: 4,
              marginTop: 4,
            }}>
              <button
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); }}
                onClick={() => {
                  if (activeText.text.trim()) commitText(activeText);
                  setActiveText(null);
                }}
                style={{
                  fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                  padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                  background: 'rgba(124,111,247,0.9)', color: '#fff',
                  border: 'none',
                }}
              >
                Done
              </button>
              <button
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); }}
                onClick={() => setActiveText(null)}
                style={{
                  fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                  padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.12)', color: '#999',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </foreignObject>
      )}

      {/* Live highlight rectangle preview */}
      {hlStartRef.current && hlLiveEnd && (() => {
        const s = hlStartRef.current!;
        const rx = Math.min(s.x, hlLiveEnd.x) * canvasWidth;
        const ry = Math.min(s.y, hlLiveEnd.y) * canvasHeight;
        const rw = Math.abs(hlLiveEnd.x - s.x) * canvasWidth;
        const rh = Math.abs(hlLiveEnd.y - s.y) * canvasHeight;
        const { color, opacity } = parseRgba(highlightColor);
        return (
          <rect
            x={rx} y={ry} width={rw} height={rh}
            fill={color} opacity={opacity} rx={2}
          />
        );
      })()}

      <style>{`
        @keyframes selectionFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .sel-delete-btn { color: #999; transition: color 0.12s; }
        .sel-delete-btn:hover { color: #DC2626; }
      `}</style>
    </svg>
  );
}
