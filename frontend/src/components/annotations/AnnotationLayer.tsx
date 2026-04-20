import { useEffect, useState, useRef, useCallback, PointerEvent as ReactPointerEvent } from 'react';
import { MeasureLayoutItem, Annotation, Stroke, StrokePoint, InkContent, HighlightContent } from '../../types';
import { getAnnotations, createAnnotation } from '../../api/annotations';
import { AnnotationMode, Tool } from '../../hooks/useAnnotationMode';
import { SaveStatus } from './SaveStatusIndicator';
import { InkRenderer } from './InkRenderer';
import { HighlightRenderer } from './HighlightRenderer';

interface Props {
  partId: string;
  currentPage: number;
  measureLayout: MeasureLayoutItem[];
  canvasWidth: number;
  canvasHeight: number;
  mode: AnnotationMode;
  tool: Tool;
  inkColor: string;
  highlightColor: string;
  textColor: string;
  onSaveStatusChange: (status: SaveStatus) => void;
}

const INK_STROKE_WIDTH = 0.002; // normalized to page width

function parseRgba(rgba: string): { color: string; opacity: number } {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: m[4] ? parseFloat(m[4]) : 1 };
  return { color: rgba, opacity: 1 };
}

export function AnnotationLayer({
  partId,
  currentPage,
  measureLayout,
  canvasWidth,
  canvasHeight,
  mode,
  tool,
  inkColor,
  highlightColor,
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
      // Determine which measure the stroke's midpoint falls in
      const mid = stroke.points[Math.floor(stroke.points.length / 2)];
      const measureNum = findMeasure(mid.x, mid.y);

      // Split: group points by which measure they fall in
      const segments = new Map<number, StrokePoint[]>();
      for (const pt of stroke.points) {
        const m = findMeasure(pt.x, pt.y) ?? measureNum;
        if (m == null) continue;
        if (!segments.has(m)) segments.set(m, []);
        segments.get(m)!.push(pt);
      }

      for (const [m, pts] of segments) {
        if (pts.length < 2) continue; // skip single-point fragments
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
        // Compute tight bounding box
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

    // Skip tiny accidental drags
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

  // Pointer handlers
  function handlePointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (mode !== 'draw' || (tool !== 'ink' && tool !== 'highlight')) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const pt = toNormalized(e);

    if (tool === 'ink') {
      // Cancel any pending commit — new stroke extends the session
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      setLivePoints([pt]);
    } else {
      hlStartRef.current = pt;
      setHlLiveEnd(pt);
    }
  }

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!isDrawing.current) return;
    e.preventDefault();
    const pt = toNormalized(e);
    if (tool === 'ink') {
      setLivePoints(prev => [...prev, pt]);
    } else if (tool === 'highlight') {
      setHlLiveEnd(pt);
    }
  }

  function handlePointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (!isDrawing.current) return;
    e.preventDefault();
    isDrawing.current = false;

    if (tool === 'ink') {
      // Collect the finished stroke
      const pts = [...livePoints];
      setLivePoints([]);
      if (pts.length >= 2) {
        pendingStrokes.current.push({
          points: pts,
          color: inkColor,
          width: INK_STROKE_WIDTH,
        });
      }

      // Start 500ms commit timer
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        commitStrokes();
      }, 500);
    } else if (tool === 'highlight') {
      const start = hlStartRef.current;
      const end = toNormalized(e);
      hlStartRef.current = null;
      setHlLiveEnd(null);
      if (start) commitHighlight(start, end);
    }
  }

  // Commit ink / reset highlight on mode/tool change
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tool]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  if (canvasWidth === 0 || canvasHeight === 0) return null;

  // Filter annotations for current page
  const pageAnnotations = annotations.filter(a => {
    if (a.kind !== 'ink' && a.kind !== 'highlight') return false;
    const anchor = a.anchorJson as { measureNumber?: number; page?: number; pageHint?: number };
    if (anchor.measureNumber != null) {
      const ml = measureLayout.find(m => m.measureNumber === anchor.measureNumber);
      return ml ? ml.page === currentPage : false;
    }
    return (anchor.page ?? anchor.pageHint) === currentPage;
  });

  const isDrawMode = mode === 'draw' && (tool === 'ink' || tool === 'highlight');

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
        pointerEvents: isDrawMode ? 'auto' : 'none',
        cursor: isDrawMode ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Saved annotations */}
      {pageAnnotations.map(a =>
        a.kind === 'highlight' ? (
          <HighlightRenderer
            key={a.id}
            annotation={a}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        ) : (
          <InkRenderer
            key={a.id}
            annotation={a}
            measureLayout={measureLayout}
            currentPage={currentPage}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
        )
      )}

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
    </svg>
  );
}
