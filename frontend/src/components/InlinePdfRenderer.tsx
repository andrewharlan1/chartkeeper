import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getAnnotations } from '../api/annotations';
import { getMeasureLayout } from '../api/parts';
import { MeasureBounds, MeasureLayoutItem, FontFamily } from '../types';
import { AnnotationLayer } from './annotations/AnnotationLayer';
import { AnnotationMode } from '../hooks/useAnnotationMode';
import { DiffHighlightLayer } from './annotations/DiffHighlightLayer';
import { DiffBadge } from './annotations/DiffBadge';
import { NotePanel } from './NotePanel';

// @ts-expect-error vite url import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }
interface Stroke { points: Point[]; color: string; width: number; measure?: number }
interface HighlightRect { x: number; y: number; w: number; h: number; color: string; measure?: number }
interface PageOverlay { strokes: Stroke[]; highlights: HighlightRect[] }

// ── Auth fetch ────────────────────────────────────────────────────────────────

async function fetchPdfData(url: string): Promise<ArrayBuffer> {
  const token = localStorage.getItem('token');
  const apiUrl = url.startsWith('/parts') ? `/api${url}` : url;
  const res = await fetch(apiUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InlinePdfRendererProps {
  partId: string;
  pdfUrl: string;
  currentPage: number;
  zoomPercent: number;
  darkScore: boolean;
  annotationsVisible: boolean;
  showDiffHighlights: boolean;
  versionId?: string;
  changedMeasureBounds?: Record<number, MeasureBounds>;
  notesOpen?: boolean;
  onPageCount?: (n: number) => void;
  onPageRendered?: (page: number) => void;
  onZoomChange?: (zoom: number) => void;
  // Annotation state — owned by parent
  annotationMode: AnnotationMode;
  inkColor: string;
  onInkColorChange: (color: string) => void;
  textColor: string;
  onTextColorChange: (color: string) => void;
  highlightColor: string;
  onHighlightColorChange: (color: string) => void;
  fontSize: number;
  fontFamily: FontFamily;
  selectedAnnotationId: string | null;
  onSelectionChange: (id: string | null) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InlinePdfRenderer({
  partId,
  pdfUrl,
  currentPage,
  zoomPercent,
  darkScore,
  annotationsVisible,
  showDiffHighlights,
  versionId,
  changedMeasureBounds,
  notesOpen,
  onPageCount,
  onPageRendered,
  onZoomChange,
  annotationMode,
  inkColor,
  onInkColorChange,
  textColor,
  onTextColorChange,
  highlightColor,
  onHighlightColorChange,
  fontSize,
  fontFamily,
  selectedAnnotationId,
  onSelectionChange,
}: InlinePdfRendererProps) {

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderingRef = useRef(false);
  const fitScaleRef = useRef(1);

  const [loading, setLoading] = useState(true);
  const [measureLayout, setMeasureLayout] = useState<MeasureLayoutItem[]>([]);
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [showAnnotations, setShowAnnotations] = useState(true);
  const showAnnotationsRef = useRef(true);

  const measureAnnotationIdsRef = useRef<Map<number, string>>(new Map());
  const [diffInfo, setDiffInfo] = useState<{ count: number; comparedToVersionName: string; changelog: string } | null>(null);
  const [diffHighlightsEnabled, setDiffHighlightsEnabled] = useState(true);

  const pageOverlays = useRef<Map<number, PageOverlay>>(new Map());
  const pageAnnotationIds = useRef<Map<number, string>>(new Map());
  const pageAnnotationAnchors = useRef<Map<number, string>>(new Map());
  const currentPageRef = useRef(currentPage);

  // Sync annotationsVisible prop
  useEffect(() => {
    setShowAnnotations(annotationsVisible);
    showAnnotationsRef.current = annotationsVisible;
  }, [annotationsVisible]);

  // Keep page ref in sync
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  // ── Load PDF ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchPdfData(pdfUrl).then(data => {
      if (cancelled) return;
      return pdfjsLib.getDocument({ data }).promise;
    }).then(doc => {
      if (!doc || cancelled) return;
      pdfDocRef.current = doc;
      onPageCount?.(doc.numPages);
      setLoading(false);
    }).catch((err) => { console.error('[InlinePdfRenderer] PDF load error:', err); setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl]);

  // ── Load existing annotations ───────────────────────────────────────────────
  useEffect(() => {
    if (!partId) return;
    Promise.all([
      getAnnotations(partId),
      getMeasureLayout(partId).catch(() => ({ measureLayout: [] })),
    ]).then(([r, { measureLayout: ml }]) => {
      setMeasureLayout(ml);

      const measureToPage = new Map<number, number>();
      for (const item of ml) {
        if (!measureToPage.has(item.measureNumber)) {
          measureToPage.set(item.measureNumber, item.page);
        }
      }

      for (const ann of r.annotations) {
        if (ann.kind !== 'ink' && ann.kind !== 'highlight') continue;

        let pg: number | undefined;
        if (ann.anchorType === 'measure') {
          const anchor = ann.anchorJson as unknown as { measureNumber: number; pageHint?: number };
          pg = measureToPage.get(anchor.measureNumber) ?? anchor.pageHint;
          measureAnnotationIdsRef.current.set(anchor.measureNumber, ann.id);
        } else {
          const anchor = ann.anchorJson as unknown as { page?: number; pageHint?: number };
          pg = anchor.page ?? anchor.pageHint;
        }
        if (pg == null) continue;

        const existing = pageOverlays.current.get(pg) ?? { strokes: [], highlights: [] };

        if (ann.kind === 'ink') {
          const loadedStrokes = (ann.contentJson as { strokes?: Stroke[] }).strokes ?? [];
          const loadedHighlights = (ann.contentJson as { highlights?: HighlightRect[] }).highlights ?? [];

          if (ann.anchorType === 'measure') {
            const anchor = ann.anchorJson as unknown as {
              measureNumber: number;
              measureBounds?: { x: number; y: number; w: number; h: number };
            };
            for (const s of loadedStrokes) s.measure = anchor.measureNumber;
            for (const h of loadedHighlights) h.measure = anchor.measureNumber;

            const currentMeasure = ml.find(
              m => m.measureNumber === anchor.measureNumber && m.page === pg
            );
            if (currentMeasure && loadedStrokes.length > 0) {
              const allPts = loadedStrokes.flatMap(s => s.points);
              if (allPts.length > 0) {
                const cx = allPts.reduce((a, p) => a + p.x, 0) / allPts.length;
                const cy = allPts.reduce((a, p) => a + p.y, 0) / allPts.length;

                if (anchor.measureBounds) {
                  const oldCenterX = anchor.measureBounds.x + anchor.measureBounds.w / 2;
                  const oldCenterY = anchor.measureBounds.y + anchor.measureBounds.h / 2;
                  const newCenterX = currentMeasure.x + currentMeasure.w / 2;
                  const newCenterY = currentMeasure.y + currentMeasure.h / 2;
                  const dx = newCenterX - oldCenterX;
                  const dy = newCenterY - oldCenterY;
                  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                    for (const s of loadedStrokes) {
                      s.points = s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
                    }
                    for (const h of loadedHighlights) { h.x += dx; h.y += dy; }
                  }
                } else {
                  const inBounds =
                    cx >= currentMeasure.x && cx <= currentMeasure.x + currentMeasure.w &&
                    cy >= currentMeasure.y && cy <= currentMeasure.y + currentMeasure.h;
                  if (!inBounds) {
                    const newCenterX = currentMeasure.x + currentMeasure.w / 2;
                    const newCenterY = currentMeasure.y + currentMeasure.h / 2;
                    const dx = newCenterX - cx;
                    const dy = newCenterY - cy;
                    for (const s of loadedStrokes) {
                      s.points = s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
                    }
                    for (const h of loadedHighlights) { h.x += dx; h.y += dy; }
                  }
                }
              }
            }
          }

          existing.strokes.push(...loadedStrokes);
          existing.highlights.push(...loadedHighlights);
          pageAnnotationIds.current.set(pg, ann.id);
          pageAnnotationAnchors.current.set(pg, ann.anchorType);
        } else if (ann.kind === 'highlight') {
          existing.highlights = (ann.contentJson as { highlights?: HighlightRect[] }).highlights ?? [];
        }
        pageOverlays.current.set(pg, existing);
      }
      if (drawCanvasRef.current) {
        redrawCanvas(currentPageRef.current, drawCanvasRef.current);
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  // ── Redraw helper ──────────────────────────────────────────────────────────
  const redrawCanvas = useCallback((page: number, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Changed measure highlights (yellow, behind annotations)
    if (showDiffHighlights && changedMeasureBounds) {
      for (const [, bounds] of Object.entries(changedMeasureBounds)) {
        if (bounds.page !== page) continue;
        const px = bounds.x * canvas.width;
        const py = bounds.y * canvas.height;
        const pw = bounds.w * canvas.width;
        const ph = bounds.h * canvas.height;
        ctx.fillStyle = 'rgba(250,204,21,0.2)';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(250,204,21,0.75)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
      }
    }

    // Measure boxes (debug only — append ?debug-measures to URL)
    const debugMeasures = new URLSearchParams(window.location.search).has('debug-measures');
    if (debugMeasures && annotationMode !== 'read' && measureLayout.length > 0) {
      const MBOX_COLORS = [
        { fill: 'rgba(147,197,253,0.13)', border: 'rgba(96,165,250,0.45)' },
        { fill: 'rgba(167,243,208,0.13)', border: 'rgba(52,211,153,0.45)' },
        { fill: 'rgba(196,181,253,0.13)', border: 'rgba(139,92,246,0.45)' },
        { fill: 'rgba(253,186,186,0.13)', border: 'rgba(248,113,113,0.45)' },
        { fill: 'rgba(253,230,138,0.13)', border: 'rgba(251,191,36,0.45)' },
      ];
      const measuresOnPage = measureLayout.filter(m => m.page === page);

      const multiRestSkip = new Set<number>();
      for (const m of measuresOnPage) {
        if (m.multiRestCount && m.multiRestCount > 1) {
          for (let k = 1; k < m.multiRestCount; k++) {
            multiRestSkip.add(m.measureNumber + k);
          }
        }
      }

      let colorIdx = 0;
      for (let i = 0; i < measuresOnPage.length; i++) {
        const m = measuresOnPage[i];
        if (multiRestSkip.has(m.measureNumber)) continue;

        const c = MBOX_COLORS[colorIdx++ % MBOX_COLORS.length];
        const mx = m.x * canvas.width;
        const my = m.y * canvas.height;
        const mw = m.w * canvas.width;
        const mh = m.h * canvas.height;

        ctx.fillStyle = c.fill;
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mx, my, mw, mh);

        const label = m.multiRestCount && m.multiRestCount > 1
          ? `mm.${m.measureNumber}-${m.measureNumber + m.multiRestCount - 1}`
          : `m.${m.measureNumber}`;
        const fontSize = Math.max(8, Math.min(11, mh * 0.22));
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const tw = ctx.measureText(label).width;
        const pad = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(mx + 2, my + 2, tw + pad * 2, fontSize + pad * 2 - 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, mx + 2 + pad, my + fontSize + pad);
      }
    }

    const overlay = pageOverlays.current.get(page);
    if (!overlay) return;

    for (const hl of overlay.highlights) {
      ctx.fillStyle = hl.color;
      ctx.fillRect(hl.x * canvas.width, hl.y * canvas.height, hl.w * canvas.width, hl.h * canvas.height);
    }
    for (const stroke of overlay.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
      }
      ctx.stroke();
    }
  }, [showDiffHighlights, changedMeasureBounds, annotationMode, measureLayout]);

  // Keep a ref to the latest redrawCanvas so the PDF render effect can call it
  // without re-firing every time overlay deps change.
  const redrawRef = useRef(redrawCanvas);
  redrawRef.current = redrawCanvas;

  // ── Render PDF page ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !pdfDocRef.current) return;
    const render = async () => {
      if (renderingRef.current) return;
      renderingRef.current = true;
      try {
        const page = await pdfDocRef.current!.getPage(currentPage);
        const container = containerRef.current;
        if (!container) return;

        // Compute fitScale on first render / page change, cache for zoom steps
        const availW = container.clientWidth - 40;
        const availH = container.clientHeight - 24;
        const vp1 = page.getViewport({ scale: 1 });
        fitScaleRef.current = Math.min(availW / vp1.width, availH / vp1.height, 2.0);
        const scale = fitScaleRef.current * (zoomPercent / 100);
        const vp = page.getViewport({ scale });

        const pdfC = pdfCanvasRef.current!;
        const drawC = drawCanvasRef.current!;
        pdfC.width = vp.width;
        pdfC.height = vp.height;
        drawC.width = vp.width;
        drawC.height = vp.height;
        setCanvasDims({ w: vp.width, h: vp.height });

        await page.render({ canvasContext: pdfC.getContext('2d')!, viewport: vp }).promise;
        redrawRef.current(currentPage, drawC);
        onPageRendered?.(currentPage);
      } catch (err) {
        console.error('[InlinePdfRenderer] page render error:', err);
      } finally {
        renderingRef.current = false;
      }
    };
    render();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, zoomPercent, loading]);

  // Redraw overlay canvas when overlay-specific deps change (without re-rendering PDF)
  useEffect(() => {
    const drawC = drawCanvasRef.current;
    if (!drawC || loading) return;
    redrawCanvas(currentPageRef.current, drawC);
  }, [redrawCanvas, loading]);

  // Re-render on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (!loading && pdfDocRef.current) {
        // Recompute fitScale on resize, then re-render
        renderingRef.current = false;
        const render = async () => {
          if (renderingRef.current) return;
          renderingRef.current = true;
          try {
            const page = await pdfDocRef.current!.getPage(currentPageRef.current);
            const availW = container.clientWidth - 40;
            const availH = container.clientHeight - 24;
            const vp1 = page.getViewport({ scale: 1 });
            fitScaleRef.current = Math.min(availW / vp1.width, availH / vp1.height, 2.0);
            const scale = fitScaleRef.current * (zoomPercent / 100);
            const vp = page.getViewport({ scale });
            const pdfC = pdfCanvasRef.current!;
            const drawC = drawCanvasRef.current!;
            pdfC.width = vp.width;
            pdfC.height = vp.height;
            drawC.width = vp.width;
            drawC.height = vp.height;
            setCanvasDims({ w: vp.width, h: vp.height });
            await page.render({ canvasContext: pdfC.getContext('2d')!, viewport: vp }).promise;
            redrawRef.current(currentPageRef.current, drawC);
          } catch (err) {
            console.error('[InlinePdfRenderer] resize render error:', err);
          } finally {
            renderingRef.current = false;
          }
        };
        render();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, zoomPercent]);

  // ── Pinch-to-zoom on touch devices ────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onZoomChange) return;
    let startDist = 0;
    let startZoom = zoomPercent;

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = getDistance(e.touches);
        startZoom = zoomPercent;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        const dist = getDistance(e.touches);
        const ratio = dist / startDist;
        const newZoom = Math.round(Math.min(400, Math.max(25, startZoom * ratio)));
        onZoomChange(newZoom);
      }
    };
    const onTouchEnd = () => { startDist = 0; };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, zoomPercent, onZoomChange]);

  // Get current user ID for notes panel
  const currentUserId = (() => {
    try { return JSON.parse(atob(localStorage.getItem('token')?.split('.')[1] ?? '')).sub; }
    catch { return undefined; }
  })();

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '12px 20px 20px',
          position: 'relative',
        }}
      >
        {/* Diff badge */}
        {diffInfo && diffInfo.count > 0 && (
          <DiffBadge
            info={diffInfo}
            highlightsEnabled={diffHighlightsEnabled}
            onToggleHighlights={() => setDiffHighlightsEnabled(v => !v)}
          />
        )}

        {loading ? (
          <div style={{
            color: 'var(--ink-3)', marginTop: '20vh', fontSize: 13,
            fontFamily: 'var(--mono)',
          }}>Loading PDF...</div>
        ) : (
          <div style={{
            position: 'relative', borderRadius: 2,
            boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
          }}>
            {/* PDF canvas */}
            <canvas
              ref={pdfCanvasRef}
              style={{
                display: 'block',
                filter: darkScore ? 'invert(1)' : 'none',
                transition: 'filter 0.2s ease',
              }}
            />
            {/* Draw canvas — overlay for measure boxes & highlights */}
            <canvas
              ref={drawCanvasRef}
              style={{
                position: 'absolute', inset: 0,
                pointerEvents: 'none',
              }}
            />
            {/* Diff highlight layer */}
            {partId && (
              <DiffHighlightLayer
                partId={partId}
                versionId={versionId ?? ''}
                currentPage={currentPage}
                measureLayout={measureLayout}
                canvasWidth={canvasDims.w}
                canvasHeight={canvasDims.h}
                enabled={showAnnotations && diffHighlightsEnabled && showDiffHighlights}
                onDiffInfo={setDiffInfo}
              />
            )}
            {/* Annotation layer — SVG overlay */}
            {partId && showAnnotations && (
              <AnnotationLayer
                partId={partId}
                currentPage={currentPage}
                measureLayout={measureLayout}
                canvasWidth={canvasDims.w}
                canvasHeight={canvasDims.h}
                mode={annotationMode}
                inkColor={inkColor}
                highlightColor={highlightColor}
                textColor={textColor}
                fontSize={fontSize}
                fontFamily={fontFamily}
                selectedAnnotationId={selectedAnnotationId}
                onSelectionChange={onSelectionChange}
                onSaveStatusChange={() => {}}
                onInkColorChange={onInkColorChange}
                onTextColorChange={onTextColorChange}
                onHighlightColorChange={onHighlightColorChange}
              />
            )}
          </div>
        )}
      </div>

      {/* Notes panel */}
      {partId && notesOpen && (
        <NotePanel
          partId={partId}
          currentPage={currentPage}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}
