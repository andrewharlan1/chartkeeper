import { useEffect, useState, useRef, useCallback, PointerEvent as ReactPointerEvent } from 'react';
import { MeasureLayoutItem, Annotation, Stroke, StrokePoint, InkContent, HighlightContent, TextContent, FontFamily } from '../../types';
import { getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation } from '../../api/annotations';
import { AnnotationMode } from '../../hooks/useAnnotationMode';
import { SaveStatus } from './SaveStatusIndicator';
import { InkRenderer } from './InkRenderer';
import { HighlightRenderer } from './HighlightRenderer';
import { TextRenderer } from './TextRenderer';
import { SelectionOverlay, getAnnotationBounds } from './SelectionOverlay';

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
  onSaveStatusChange: (status: SaveStatus) => void;
}

const INK_STROKE_WIDTH = 0.002; // normalized to page width
const ERASE_HIT_PAD = 0.008; // ~8px hit tolerance at 1000px canvas

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
  onSaveStatusChange,
}: Props) {
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
  const eraseHistory = useRef<Annotation[][]>([]);
  // Selection drag state
  const dragRef = useRef<{
    type: 'body' | 'handle';
    startPt: StrokePoint;
    originalBounds: { x: number; y: number; w: number; h: number };
    annotationId: string;
    handle?: string;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [resizeBounds, setResizeBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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

    // Group all stroke points by measure
    const byMeasure = new Map<number, Stroke[]>();
    for (const stroke of strokes) {
      const mid = stroke.points[Math.floor(stroke.points.length / 2)];
      const measureNum = findMeasure(mid.x, mid.y);

      const segments = new Map<number, StrokePoint[]>();
      for (const pt of stroke.points) {
        const m = findMeasure(pt.x, pt.y) ?? measureNum;
        if (m == null) continue;
        if (!segments.has(m)) segments.set(m, []);
        segments.get(m)!.push(pt);
      }

      for (const [m, pts] of segments) {
        if (pts.length < 2) continue;
        if (!byMeasure.has(m)) byMeasure.set(m, []);
        byMeasure.get(m)!.push({
          points: pts,
          color: stroke.color,
          width: stroke.width,
        });
      }
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
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  }, [partId, findMeasure, onSaveStatusChange]);

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
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  }, [partId, highlightColor, findMeasure, onSaveStatusChange]);

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
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  }, [textColor, fontSize, fontFamily, partId, findMeasure, onSaveStatusChange]);

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
    // Snapshot the annotations we're about to erase for undo
    const idSet = new Set(ids);
    const erased = annotations.filter(a => idSet.has(a.id));
    if (erased.length > 0) eraseHistory.current.push(erased);

    onSaveStatusChange('saving');
    try {
      await Promise.all(ids.map(id => deleteAnnotation(id)));
      setAnnotations(prev => prev.filter(a => !idSet.has(a.id)));
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
    setFadingIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, [annotations, onSaveStatusChange]);

  // Undo last erase — re-create the annotations on the server and restore locally
  const undoErase = useCallback(async () => {
    const batch = eraseHistory.current.pop();
    if (!batch || batch.length === 0) return;
    onSaveStatusChange('saving');
    try {
      const restored: Annotation[] = [];
      for (const a of batch) {
        const { annotation } = await createAnnotation(partId, {
          anchorType: a.anchorType,
          anchorJson: a.anchorJson,
          kind: a.kind,
          contentJson: a.contentJson,
        });
        restored.push(annotation);
      }
      setAnnotations(prev => [...prev, ...restored]);
      onSaveStatusChange('saved');
    } catch {
      onSaveStatusChange('error');
    }
  }, [partId, onSaveStatusChange]);

  // Delete the currently selected annotation (fade + API delete)
  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) return;
    const id = selectedAnnotationId;
    onSelectionChange(null);
    setFadingIds(prev => new Set(prev).add(id));
    setTimeout(() => commitErases([id]), 150);
  }, [selectedAnnotationId, onSelectionChange, commitErases]);

  // Get measure layout bounds for clamping during move/resize
  const getMeasureBounds = useCallback((annotation: Annotation) => {
    const anchor = annotation.anchorJson as { measureNumber?: number };
    if (anchor.measureNumber == null) return null;
    const ml = measureLayout.find(m => m.measureNumber === anchor.measureNumber && m.page === currentPage);
    return ml ? { x: ml.x, y: ml.y, w: ml.w, h: ml.h } : null;
  }, [measureLayout, currentPage]);

  // Clamp a drag offset so the annotation stays within its measure
  const clampOffset = useCallback((dx: number, dy: number, bounds: { x: number; y: number; w: number; h: number }, measure: { x: number; y: number; w: number; h: number }) => {
    const newX = bounds.x + dx;
    const newY = bounds.y + dy;
    const clampedX = Math.max(measure.x, Math.min(newX, measure.x + measure.w - bounds.w));
    const clampedY = Math.max(measure.y, Math.min(newY, measure.y + measure.h - bounds.h));
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

    // Optimistic local update
    setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, contentJson: updatedContent! } : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { contentJson: updatedContent });
      onSaveStatusChange('saved');
    } catch {
      // Revert on failure
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
    }
  }, [annotations, onSaveStatusChange]);

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

    setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, contentJson: updatedContent! } : a));
    onSaveStatusChange('saving');
    try {
      await updateAnnotation(annotationId, { contentJson: updatedContent });
      onSaveStatusChange('saved');
    } catch {
      setAnnotations(prev => prev.map(a => a.id === annotationId ? ann : a));
      onSaveStatusChange('error');
    }
  }, [annotations, onSaveStatusChange]);

  // Start a handle drag from SelectionOverlay
  const handleSelectionHandleDown = useCallback((e: React.PointerEvent, handle: string) => {
    if (!selectedAnnotationId) return;
    const ann = annotations.find(a => a.id === selectedAnnotationId);
    if (!ann) return;
    const bounds = getAnnotationBounds(ann);
    if (!bounds) return;

    const rect = svgRef.current!.getBoundingClientRect();
    const pt = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };

    dragRef.current = {
      type: 'handle',
      startPt: pt,
      originalBounds: bounds,
      annotationId: selectedAnnotationId,
      handle,
    };
    setResizeBounds(bounds);
    (svgRef.current as Element).setPointerCapture(e.pointerId);
  }, [selectedAnnotationId, annotations]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+Z undo erase
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (eraseHistory.current.length > 0) {
          e.preventDefault();
          undoErase();
        }
        return;
      }
      // Delete/Backspace — delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        if (activeText) return; // don't capture when editing text
        e.preventDefault();
        deleteSelectedAnnotation();
        return;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoErase, selectedAnnotationId, activeText, deleteSelectedAnnotation]);

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
      const { originalBounds: ob, handle } = dragRef.current;
      const dx = pt.x - dragRef.current.startPt.x;
      const dy = pt.y - dragRef.current.startPt.y;
      const minW = 10 / canvasWidth;
      const minH = 10 / canvasHeight;

      let nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
      // Shift key for aspect ratio lock
      const shiftKey = (e.nativeEvent as PointerEvent).shiftKey;
      const aspect = ob.w / (ob.h || 1);

      if (handle === 'se') { nw = ob.w + dx; nh = ob.h + dy; }
      else if (handle === 'nw') { nx = ob.x + dx; ny = ob.y + dy; nw = ob.w - dx; nh = ob.h - dy; }
      else if (handle === 'ne') { nw = ob.w + dx; ny = ob.y + dy; nh = ob.h - dy; }
      else if (handle === 'sw') { nx = ob.x + dx; nw = ob.w - dx; nh = ob.h + dy; }
      else if (handle === 'e') { nw = ob.w + dx; }
      else if (handle === 'w') { nx = ob.x + dx; nw = ob.w - dx; }
      else if (handle === 's') { nh = ob.h + dy; }
      else if (handle === 'n') { ny = ob.y + dy; nh = ob.h - dy; }

      // Enforce minimum size
      if (nw < minW) { if (handle?.includes('w')) nx = ob.x + ob.w - minW; nw = minW; }
      if (nh < minH) { if (handle?.includes('n')) ny = ob.y + ob.h - minH; nh = minH; }

      // Shift: lock aspect ratio for corner handles
      if (shiftKey && (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')) {
        if (nw / nh > aspect) { nw = nh * aspect; }
        else { nh = nw / aspect; }
      }

      // Clamp to measure bounds
      const ann = annotations.find(a => a.id === dragRef.current!.annotationId);
      if (ann) {
        const measure = getMeasureBounds(ann);
        if (measure) {
          nx = Math.max(measure.x, nx);
          ny = Math.max(measure.y, ny);
          nw = Math.min(nw, measure.x + measure.w - nx);
          nh = Math.min(nh, measure.y + measure.h - ny);
        }
      }

      setResizeBounds({ x: nx, y: ny, w: nw, h: nh });
      return;
    }
    // Body drag in select mode
    if (dragRef.current?.type === 'body') {
      e.preventDefault();
      const pt = toNormalized(e);
      let dx = pt.x - dragRef.current.startPt.x;
      let dy = pt.y - dragRef.current.startPt.y;
      // Clamp to measure bounds
      const ann = annotations.find(a => a.id === dragRef.current!.annotationId);
      if (ann) {
        const measure = getMeasureBounds(ann);
        if (measure) {
          ({ dx, dy } = clampOffset(dx, dy, dragRef.current.originalBounds, measure));
        }
      }
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
      if (pts.length >= 2) {
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

  // Build the live stroke SVG path
  let livePath = '';
  if (livePoints.length >= 2) {
    const [first, ...rest] = livePoints;
    livePath = `M ${first.x * canvasWidth} ${first.y * canvasHeight} ${rest.map(p => `L ${p.x * canvasWidth} ${p.y * canvasHeight}`).join(' ')}`;
  }

  // Build paths for pending (uncommitted) strokes
  const pendingPaths = pendingStrokes.current.map((s, i) => {
    if (s.points.length < 2) return null;
    const [first, ...rest] = s.points;
    const d = `M ${first.x * canvasWidth} ${first.y * canvasHeight} ${rest.map(p => `L ${p.x * canvasWidth} ${p.y * canvasHeight}`).join(' ')}`;
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
        const dragTransform = isDragging ? `translate(${dragOffset!.dx * canvasWidth}, ${dragOffset!.dy * canvasHeight})` : undefined;
        return (
          <g key={a.id} style={{ opacity: isFading ? 0 : 1, transition: isFading ? 'opacity 0.15s ease-out' : undefined, cursor: isDragging ? 'grabbing' : undefined }} transform={dragTransform}>
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
          />
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
      `}</style>
    </svg>
  );
}
