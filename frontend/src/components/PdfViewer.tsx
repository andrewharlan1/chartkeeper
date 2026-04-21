import { useEffect, useRef, useState, useCallback } from 'react';
import './PdfViewer.css';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation } from '../api/annotations';
import { getMeasureLayout } from '../api/parts';
import { Annotation, MeasureBounds, MeasureLayoutItem } from '../types';
import { AnnotationToolbar } from './annotations/AnnotationToolbar';
import { AnnotationLayer } from './annotations/AnnotationLayer';
import { useAnnotationMode } from '../hooks/useAnnotationMode';
import { SaveStatus } from './annotations/SaveStatusIndicator';
import { DiffHighlightLayer } from './annotations/DiffHighlightLayer';
import { DiffBadge } from './annotations/DiffBadge';
import { useToast } from './Toast';

// @ts-expect-error vite url import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }
interface Stroke { points: Point[]; color: string; width: number; measure?: number }
interface HighlightRect { x: number; y: number; w: number; h: number; color: string; measure?: number }
interface PageOverlay { strokes: Stroke[]; highlights: HighlightRect[] }
type Tool = 'pointer' | 'pen' | 'highlight';

interface ViewerProps {
  url: string;
  partId?: string;
  versionId?: string;
  title?: string;
  changedMeasureBounds?: Record<number, MeasureBounds>;
  changeDescriptions?: Record<number, string>;
}

// ── Dark mode detector ────────────────────────────────────────────────────────

function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

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

// ── Thumbnail ─────────────────────────────────────────────────────────────────

export function PdfThumbnail({ url, onClick }: { url: string; onClick?: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const blobRef = useRef<string | null>(null);
  const loadedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (loadedUrl.current === url) return;
    setLoading(true);
    fetchPdfData(url)
      .then(data => {
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        const obj = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        blobRef.current = obj;
        loadedUrl.current = url;
        setBlobUrl(obj);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
    return () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const placeholder = (text: string) => (
    <div style={{
      height: 200, background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 12,
    }}>{text}</div>
  );

  if (loading) return placeholder('Loading…');
  if (error || !blobUrl) return placeholder('Preview unavailable');

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', cursor: onClick ? 'pointer' : 'default',
        borderRadius: 'var(--radius-sm)', overflow: 'hidden',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
      }}
    >
      <iframe
        src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH`}
        style={{ display: 'block', width: '100%', height: 200, border: 'none', pointerEvents: 'none' }}
        title="PDF preview"
      />
      {onClick && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.1)';
            const hint = e.currentTarget.querySelector('.hint') as HTMLElement;
            if (hint) hint.style.opacity = '1';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            const hint = e.currentTarget.querySelector('.hint') as HTMLElement;
            if (hint) hint.style.opacity = '0';
          }}
        >
          <span className="hint" style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, fontWeight: 500,
            padding: '5px 12px', borderRadius: 99, opacity: 0, transition: 'opacity 0.12s',
            pointerEvents: 'none',
          }}>Open fullscreen</span>
        </div>
      )}
    </div>
  );
}

// ── Note panel ────────────────────────────────────────────────────────────────

function NotePanel({
  partId, currentPage, currentUserId,
}: {
  partId: string; currentPage: number; currentUserId?: string;
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [measure, setMeasure] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    getAnnotations(partId)
      .then(r => setAnnotations(r.annotations.filter(a => a.kind === 'text')))
      .catch(() => {});
  }, [partId]);

  async function handleAdd() {
    if (!text.trim()) return;
    const m = parseInt(measure);
    setSaving(true);
    try {
      const { annotation } = await createAnnotation(partId, {
        anchorType: m > 0 ? 'measure' : 'page',
        anchorJson: m > 0 ? { measureNumber: m } : { page: currentPage },
        kind: 'text',
        contentJson: { text: text.trim() },
      });
      setAnnotations(prev => [...prev, annotation]);
      setMeasure('');
      setText('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={{
      width: 252, flexShrink: 0,
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      background: '#0c0c18',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '11px 14px 9px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Notes
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {annotations.length === 0 ? (
          <p style={{ fontSize: 12, color: '#444', padding: '4px 2px' }}>No notes yet.</p>
        ) : (
          annotations.map(a => {
            const measureNum = (a.anchorJson as { measureNumber?: number }).measureNumber;
            const pageNum = (a.anchorJson as { page?: number }).page;
            return (
              <div key={a.id} style={{
                padding: '7px 9px', marginBottom: 5,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${(a.contentJson as Record<string, unknown>)._needsReview ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    {(measureNum || pageNum) && (
                      <span style={{
                        display: 'inline-block', fontSize: 10, fontWeight: 700,
                        background: 'rgba(124,111,247,0.12)', border: '1px solid rgba(124,111,247,0.2)',
                        borderRadius: 3, padding: '1px 5px', color: '#9184f9', marginBottom: 4,
                      }}>
                        {measureNum ? `m.${measureNum}` : `p.${pageNum}`}
                      </span>
                    )}
                    {(a.contentJson as Record<string, unknown>)._needsReview === true && (
                      <p style={{ fontSize: 10, color: '#f5a623', marginBottom: 3 }}>⚠ Measure removed</p>
                    )}
                    <p style={{ fontSize: 12, color: '#ddd', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {(a.contentJson as { text?: string }).text}
                    </p>
                    <p style={{ fontSize: 10, color: '#555', marginTop: 3 }}>{a.ownerName}</p>
                  </div>
                  {a.ownerUserId === currentUserId && (
                    <button
                      onClick={() => handleDelete(a.id)}
                      disabled={deleting === a.id}
                      style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}
                    >×</button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: '8px 10px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
          <input
            type="number"
            value={measure}
            onChange={e => setMeasure(e.target.value)}
            placeholder="m."
            min={1}
            style={{
              width: 44, padding: '5px 6px', fontSize: 11,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 5, color: '#ccc', flexShrink: 0, boxShadow: 'none',
            }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            style={{
              flex: 1, padding: '5px 8px', fontSize: 12, resize: 'none',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 5, color: '#ccc', boxShadow: 'none',
            }}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={saving || !text.trim()}
          style={{
            width: '100%', padding: '6px 0', fontSize: 12, fontWeight: 600,
            background: text.trim() ? '#5b4cf5' : 'rgba(255,255,255,0.05)',
            border: 'none', borderRadius: 5, color: text.trim() ? '#fff' : '#555',
            cursor: text.trim() ? 'pointer' : 'default', fontFamily: 'inherit',
          }}
        >
          {saving ? '…' : 'Add note'}
        </button>
      </div>
    </div>
  );
}

// ── Fullscreen Viewer ─────────────────────────────────────────────────────────

const LIGHT_PEN_COLORS  = ['#1c1c28', '#5b4cf5', '#e53535', '#0a9e6e', '#d97706', '#f97316'];
const DARK_PEN_COLORS   = ['#ffffff', '#a89af7', '#ff6b6b', '#3ee8a0', '#ffb347', '#ff9f43'];
const LIGHT_HL_COLORS   = ['#ffe066', '#a8f0c6', '#a8d8f0', '#f0a8d8', '#f0cda8'];
const DARK_HL_COLORS    = ['#ffd700', '#00ff7f', '#00cfff', '#ff69b4', '#ff8c00'];
const PEN_WIDTHS = [1.5, 3, 5];

function tbBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(124,111,247,0.2)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? 'rgba(124,111,247,0.4)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 6, color: active ? '#c4bcff' : '#777',
    cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '4px 10px',
    transition: 'all 0.1s', whiteSpace: 'nowrap' as const,
  };
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, color: disabled ? '#2a2a2a' : '#999',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 16, lineHeight: 1, padding: '3px 11px',
  };
}

function FullscreenViewer({
  url, partId, versionId, title, currentUserId, changedMeasureBounds, onClose,
}: {
  url: string; partId?: string; versionId?: string; title?: string; currentUserId?: string;
  changedMeasureBounds?: Record<number, MeasureBounds>;
  onClose: () => void;
}) {
  const isDark = useIsDark();
  const { showToast } = useToast();
  const annotationMode = useAnnotationMode();
  const [annSaveStatus, setAnnSaveStatus] = useState<SaveStatus>('idle');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedAnnotationKind, setSelectedAnnotationKind] = useState<'ink' | 'text' | 'highlight' | null>(null);
  const annLayerRef = useRef<{ undo: () => void; redo: () => void } | null>(null);

  const pdfDocRef   = useRef<PDFDocumentProxy | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const renderingRef  = useRef(false);

  const [numPages, setNumPages]       = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading]         = useState(true);
  const [tool]               = useState<Tool>('pointer');
  const [color]             = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? DARK_PEN_COLORS[1] : LIGHT_PEN_COLORS[1]
  );
  const [hlColor]         = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? DARK_HL_COLORS[0] : LIGHT_HL_COLORS[0]
  );
  const [strokeWidth] = useState(PEN_WIDTHS[0]);
  const [, setSaving]           = useState(false);
  const [hasUnsaved, setHasUnsaved]   = useState(false);
  const [notesOpen, setNotesOpen]     = useState(false);
  const [scoreInverted, setScoreInverted] = useState(isDark);
  const [anchorDialog, setAnchorDialog] = useState<{ pages: number[] } | null>(null);
  const [anchorChoice, setAnchorChoice] = useState<'page' | 'measure'>('measure');
  const [measureHint, setMeasureHint]   = useState('');
  const hasChanges = changedMeasureBounds && Object.keys(changedMeasureBounds).length > 0;
  const [showChanges, setShowChanges]   = useState(true);
  const [mode, setMode]                 = useState<'view' | 'edit'>('view');
  const [measureLayout, setMeasureLayout] = useState<MeasureLayoutItem[]>([]);
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [showToolbar, setShowToolbar] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const showAnnotationsRef = useRef(true);

  // Guard: prevent switching to drawing modes when annotations are hidden
  const guardedSetMode = useCallback((newMode: typeof annotationMode.mode) => {
    if (!showAnnotationsRef.current && newMode !== 'read') {
      showToast('Annotations are hidden. Tap the eye icon to show them.');
      return;
    }
    annotationMode.setMode(newMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);
  const measureAnnotationIdsRef = useRef<Map<number, string>>(new Map());
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [diffInfo, setDiffInfo] = useState<{ count: number; comparedToVersionName: string; changelog: string } | null>(null);
  const [diffHighlightsEnabled, setDiffHighlightsEnabled] = useState(true);

  const pageOverlays           = useRef<Map<number, PageOverlay>>(new Map());
  const pageAnnotationIds      = useRef<Map<number, string>>(new Map());
  const pageAnnotationAnchors  = useRef<Map<number, string>>(new Map()); // pg → anchorType
  const currentPageRef         = useRef(1);
  const isDrawing         = useRef(false);
  const liveStroke        = useRef<Point[]>([]);
  const dragStart         = useRef<Point | null>(null);

  // Keep ref in sync
  useEffect(() => { showAnnotationsRef.current = showAnnotations; }, [showAnnotations]);

  // Offline detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, []);

  // Sync score invert when dark mode changes
  useEffect(() => { setScoreInverted(isDark); }, [isDark]);

  // ── Load PDF ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchPdfData(url).then(data => {
      if (cancelled) return;
      return pdfjsLib.getDocument({ data }).promise;
    }).then(doc => {
      if (!doc || cancelled) return;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
      setLoading(false);
    }).catch((err) => { console.error('[PdfViewer] PDF load error:', err); setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  // ── Load existing annotations ───────────────────────────────────────────────
  useEffect(() => {
    if (!partId) return;
    Promise.all([
      getAnnotations(partId),
      getMeasureLayout(partId).catch(() => ({ measureLayout: [] })),
    ]).then(([r, { measureLayout: ml }]) => {
      // Store measure layout for edit mode rendering
      setMeasureLayout(ml);

      // Build measure → page lookup from the current version's OMR data
      const measureToPage = new Map<number, number>();
      for (const item of ml) {
        if (!measureToPage.has(item.measureNumber)) {
          measureToPage.set(item.measureNumber, item.page);
        }
      }

      for (const ann of r.annotations) {
        if (ann.kind !== 'ink' && ann.kind !== 'highlight') continue;

        // Resolve the page: for measure anchors, use the live measure layout
        // (correct for current version) instead of stale pageHint
        let pg: number | undefined;
        if (ann.anchorType === 'measure') {
          const anchor = ann.anchorJson as unknown as { measureNumber: number; pageHint?: number };
          pg = measureToPage.get(anchor.measureNumber) ?? anchor.pageHint;
          // Track measure → annotation ID for edit mode saves
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

          // Tag loaded strokes with their measure number if from a measure annotation
          if (ann.anchorType === 'measure') {
            const anchor = ann.anchorJson as unknown as {
              measureNumber: number;
              measureBounds?: { x: number; y: number; w: number; h: number };
            };
            for (const s of loadedStrokes) s.measure = anchor.measureNumber;
            for (const h of loadedHighlights) h.measure = anchor.measureNumber;

            // ── Client-side stroke relocation ──────────────────────────────
            // If the strokes aren't positioned at the measure's CURRENT location,
            // shift them there. This handles:
            //   - Migrated annotations where backend didn't relocate strokes
            //   - Annotations on versions where the measure layout changed
            const currentMeasure = ml.find(
              m => m.measureNumber === anchor.measureNumber && m.page === pg
            );
            if (currentMeasure && loadedStrokes.length > 0) {
              const allPts = loadedStrokes.flatMap(s => s.points);
              if (allPts.length > 0) {
                // Compute stroke centroid
                const cx = allPts.reduce((a, p) => a + p.x, 0) / allPts.length;
                const cy = allPts.reduce((a, p) => a + p.y, 0) / allPts.length;

                // Deterministic path: use stored measureBounds from save time
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
                    console.log(`[PdfViewer] Relocated m.${anchor.measureNumber} strokes via stored bounds (dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)})`);
                  }
                } else {
                  // Heuristic path: if stroke centroid is outside the current
                  // measure bounds, shift strokes to the measure center
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
                    console.log(`[PdfViewer] Relocated m.${anchor.measureNumber} strokes via centroid heuristic (dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)})`);
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


  // ── Redraw ──────────────────────────────────────────────────────────────────
  // Helper: find which measure a point (0-1 coords) falls in on a given page
  const findMeasureForPoint = useCallback((px: number, py: number, page: number): number | null => {
    // Check containment first
    for (const m of measureLayout) {
      if (m.page !== page) continue;
      if (px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) {
        return m.measureNumber;
      }
    }
    // Fall back to nearest measure on this page
    let nearest: number | null = null;
    let minDist = Infinity;
    for (const m of measureLayout) {
      if (m.page !== page) continue;
      const cx = m.x + m.w / 2;
      const cy = m.y + m.h / 2;
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist < minDist) { minDist = dist; nearest = m.measureNumber; }
    }
    return nearest;
  }, [measureLayout]);

  const redrawCanvas = useCallback((page: number, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Changed measure highlights (yellow, behind annotations) ──────────────
    if (showChanges && changedMeasureBounds) {
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

    // ── Measure boxes (edit mode) ────────────────────────────────────────────
    if (mode === 'edit' && measureLayout.length > 0) {
      const MBOX_COLORS = [
        { fill: 'rgba(147,197,253,0.13)', border: 'rgba(96,165,250,0.45)' },
        { fill: 'rgba(167,243,208,0.13)', border: 'rgba(52,211,153,0.45)' },
        { fill: 'rgba(196,181,253,0.13)', border: 'rgba(139,92,246,0.45)' },
        { fill: 'rgba(253,186,186,0.13)', border: 'rgba(248,113,113,0.45)' },
        { fill: 'rgba(253,230,138,0.13)', border: 'rgba(251,191,36,0.45)' },
      ];
      const measuresOnPage = measureLayout.filter(m => m.page === page);

      // Build a set of measure numbers to skip (non-first measures in multi-rest spans)
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
        if (multiRestSkip.has(m.measureNumber)) continue; // skip non-first multi-rest measures

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

        // Measure number label — "mm.1-14" for multi-rest, "m.39" for normal
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
  }, [showChanges, changedMeasureBounds, mode, measureLayout]);

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
        const availW = container.clientWidth - 80;
        const availH = container.clientHeight - 40;
        const vp1 = page.getViewport({ scale: 1 });
        // Cap scale at 2.0 to avoid canvas memory limits on large/complex scores
        const scale = Math.min(availW / vp1.width, availH / vp1.height, 2.0);
        const vp = page.getViewport({ scale });
        const pdfC = pdfCanvasRef.current!;
        const drawC = drawCanvasRef.current!;
        pdfC.width = vp.width; pdfC.height = vp.height;
        drawC.width = vp.width; drawC.height = vp.height;
        setCanvasDims({ w: vp.width, h: vp.height });
        await page.render({ canvasContext: pdfC.getContext('2d')!, viewport: vp }).promise;
        redrawCanvas(currentPage, drawC);
      } catch (err) {
        console.error('[PdfViewer] page render error:', err);
      } finally {
        renderingRef.current = false;
      }
    };
    render();
  }, [currentPage, loading, redrawCanvas]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveOverlays = useCallback(async (opts?: { anchorType: 'page' | 'measure'; measureHintVal?: number }) => {
    if (!partId) return;
    const { anchorType = 'page', measureHintVal } = opts ?? {};
    setSaving(true);
    try {
      for (const [pg, overlay] of pageOverlays.current.entries()) {
        if (overlay.strokes.length === 0 && overlay.highlights.length === 0) continue;
        const existingId = pageAnnotationIds.current.get(pg);
        const contentJson = {
          strokes: overlay.strokes,
          highlights: overlay.highlights,
        } as Record<string, unknown>;
        const shouldUpgrade =
          existingId &&
          anchorType === 'measure' && measureHintVal && measureHintVal > 0 &&
          pageAnnotationAnchors.current.get(pg) !== 'measure';

        if (existingId && !shouldUpgrade) {
          await updateAnnotation(existingId, { contentJson });
        } else {
          // Create new annotation (either fresh, or upgrading page anchor → measure anchor)
          if (existingId) await deleteAnnotation(existingId);
          const isMeasure = anchorType === 'measure' && measureHintVal != null && measureHintVal > 0;
          const anchorJson = isMeasure
            ? { measureNumber: measureHintVal!, pageHint: pg }
            : { page: pg };
          const { annotation } = await createAnnotation(partId, {
            anchorType: isMeasure ? 'measure' : 'page',
            anchorJson,
            kind: 'ink',
            contentJson,
          });
          pageAnnotationIds.current.set(pg, annotation.id);
          pageAnnotationAnchors.current.set(pg, isMeasure ? 'measure' : 'page');
        }
      }
      setHasUnsaved(false);
    } finally {
      setSaving(false);
    }
  }, [partId]);

  // Edit-mode save: group strokes by measure and save one annotation per measure
  const saveEditMode = useCallback(async () => {
    if (!partId) return;
    setSaving(true);
    try {
      for (const [pg, overlay] of pageOverlays.current.entries()) {
        // Group strokes and highlights by their tagged measure
        const groups = new Map<number, { strokes: Stroke[], highlights: HighlightRect[] }>();

        for (const stroke of overlay.strokes) {
          const m = stroke.measure;
          if (m == null) continue;
          if (!groups.has(m)) groups.set(m, { strokes: [], highlights: [] });
          groups.get(m)!.strokes.push(stroke);
        }
        for (const hl of overlay.highlights) {
          const m = hl.measure;
          if (m == null) continue;
          if (!groups.has(m)) groups.set(m, { strokes: [], highlights: [] });
          groups.get(m)!.highlights.push(hl);
        }

        // Save each measure group as a measure-anchored annotation
        for (const [measureNum, data] of groups.entries()) {
          if (data.strokes.length === 0 && data.highlights.length === 0) continue;
          const existingId = measureAnnotationIdsRef.current.get(measureNum);
          const contentJson = { strokes: data.strokes, highlights: data.highlights };

          if (existingId) {
            await updateAnnotation(existingId, { contentJson });
          } else {
            // Store measure bounds at save time for deterministic relocation on load
            const mItem = measureLayout.find(m => m.measureNumber === measureNum && m.page === pg);
            const anchorJson = {
              measureNumber: measureNum,
              pageHint: pg,
              ...(mItem ? { measureBounds: { x: mItem.x, y: mItem.y, w: mItem.w, h: mItem.h } } : {}),
            } as { measureNumber: number; pageHint?: number };
            const { annotation } = await createAnnotation(partId, {
              anchorType: 'measure',
              anchorJson,
              kind: 'ink',
              contentJson,
            });
            measureAnnotationIdsRef.current.set(measureNum, annotation.id);
          }
        }

        // Handle any untagged strokes (drawn outside measure boxes) as page-anchored
        const untaggedStrokes = overlay.strokes.filter(s => s.measure == null);
        const untaggedHighlights = overlay.highlights.filter(h => h.measure == null);
        if (untaggedStrokes.length > 0 || untaggedHighlights.length > 0) {
          const existingId = pageAnnotationIds.current.get(pg);
          const contentJson = { strokes: untaggedStrokes, highlights: untaggedHighlights };
          if (existingId && pageAnnotationAnchors.current.get(pg) === 'page') {
            await updateAnnotation(existingId, { contentJson });
          } else {
            const { annotation } = await createAnnotation(partId, {
              anchorType: 'page',
              anchorJson: { page: pg },
              kind: 'ink',
              contentJson,
            });
            pageAnnotationIds.current.set(pg, annotation.id);
            pageAnnotationAnchors.current.set(pg, 'page');
          }
        }
      }
      setHasUnsaved(false);
    } finally {
      setSaving(false);
    }
  }, [partId]);

  // Save click: legacy edit mode — retained for old canvas drawing pipeline
  // @ts-expect-error unused while old edit toolbar is removed
  async function handleSaveClick() {
    if (!hasUnsaved || !partId) return;

    // Edit mode with measure layout → auto-anchor, no dialog
    if (mode === 'edit' && measureLayout.length > 0) {
      await saveEditMode();
      return;
    }

    // Open dialog for user to select anchor type
    const newPages = [...pageOverlays.current.entries()]
      .filter(([pg, ov]) => (ov.strokes.length > 0 || ov.highlights.length > 0) && !pageAnnotationIds.current.has(pg))
      .map(([pg]) => pg);
    setAnchorChoice('measure');
    setMeasureHint('');
    setAnchorDialog({ pages: newPages });
  }

  function confirmAnchorDialog() {
    const m = parseInt(measureHint, 10);
    if (m > 0) {
      saveOverlays({ anchorType: 'measure', measureHintVal: m });
    } else {
      saveOverlays({ anchorType: 'page' });
    }
    setAnchorDialog(null);
  }

  async function handleClose() {
    if (hasUnsaved && partId) await saveOverlays();
    onClose();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  function getPos(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const r = drawCanvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== 'edit' || tool === 'pointer') return;
    e.preventDefault();
    isDrawing.current = true;
    const pos = getPos(e);
    if (tool === 'pen') liveStroke.current = [pos];
    else if (tool === 'highlight') dragStart.current = pos;
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    const pos = getPos(e);
    const canvas = drawCanvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    if (tool === 'pen') {
      liveStroke.current.push(pos);
      const pts = liveStroke.current;
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const p = pts[pts.length - 2], c = pts[pts.length - 1];
        ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
        ctx.lineTo(c.x * canvas.width, c.y * canvas.height);
        ctx.stroke();
      }
    } else if (tool === 'highlight' && dragStart.current) {
      redrawCanvas(currentPage, canvas);
      const ds = dragStart.current;
      ctx.fillStyle = hlColor + '70';
      ctx.fillRect(
        ds.x * canvas.width, ds.y * canvas.height,
        (pos.x - ds.x) * canvas.width, (pos.y - ds.y) * canvas.height
      );
    }
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement> | null) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const canvas = drawCanvasRef.current!;

    if (tool === 'pen' && liveStroke.current.length >= 2) {
      const pg = currentPage;
      const overlay = pageOverlays.current.get(pg) ?? { strokes: [], highlights: [] };
      const newStroke: Stroke = { points: [...liveStroke.current], color, width: strokeWidth };

      // In edit mode, auto-detect which measure this stroke belongs to
      if (mode === 'edit' && measureLayout.length > 0) {
        const pts = newStroke.points;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const m = findMeasureForPoint(cx, cy, pg);
        if (m != null) newStroke.measure = m;
      }

      overlay.strokes.push(newStroke);
      pageOverlays.current.set(pg, overlay);
      liveStroke.current = [];
      setHasUnsaved(true);
    } else if (tool === 'highlight' && dragStart.current && e) {
      const pos = getPos(e);
      const ds = dragStart.current;
      const w = pos.x - ds.x, h = pos.y - ds.y;
      if (Math.abs(w) > 0.005 && Math.abs(h) > 0.005) {
        const pg = currentPage;
        const overlay = pageOverlays.current.get(pg) ?? { strokes: [], highlights: [] };
        const opacity = scoreInverted ? 'bb' : '66';
        const newHl: HighlightRect = {
          x: Math.min(ds.x, pos.x), y: Math.min(ds.y, pos.y),
          w: Math.abs(w), h: Math.abs(h),
          color: hlColor + opacity,
        };

        // In edit mode, auto-detect which measure this highlight belongs to
        if (mode === 'edit' && measureLayout.length > 0) {
          const m = findMeasureForPoint(newHl.x + newHl.w / 2, newHl.y + newHl.h / 2, pg);
          if (m != null) newHl.measure = m;
        }

        overlay.highlights.push(newHl);
        pageOverlays.current.set(pg, overlay);
        redrawCanvas(currentPage, canvas);
        setHasUnsaved(true);
      }
      dragStart.current = null;
    }
  }

  function handleUndo() {
    const overlay = pageOverlays.current.get(currentPage);
    if (!overlay) return;
    if (tool === 'highlight' && overlay.highlights.length > 0) {
      overlay.highlights.pop();
    } else if (overlay.strokes.length > 0) {
      overlay.strokes.pop();
    } else return;
    pageOverlays.current.set(currentPage, { ...overlay });
    redrawCanvas(currentPage, drawCanvasRef.current!);
    setHasUnsaved(true);
  }

  // @ts-expect-error legacy edit mode — retained for old canvas drawing pipeline
  const [deletingAnnotation, setDeletingAnnotation] = useState(false);

  // @ts-expect-error legacy edit mode — retained for old canvas drawing pipeline
  async function handleDeleteAnnotation() {
    const annId = pageAnnotationIds.current.get(currentPage);
    if (!annId) return;
    setDeletingAnnotation(true);
    try {
      await deleteAnnotation(annId);
      pageAnnotationIds.current.delete(currentPage);
      pageAnnotationAnchors.current.delete(currentPage);
      pageOverlays.current.delete(currentPage);
      redrawCanvas(currentPage, drawCanvasRef.current!);
      setHasUnsaved(false);
    } finally {
      setDeletingAnnotation(false);
    }
  }

  function goToPage(n: number) {
    if (n < 1 || n > numPages || loading) return;
    currentPageRef.current = n;
    setCurrentPage(n);
  }

  useEffect(() => {
    function isTyping(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
    }

    function onKey(ev: KeyboardEvent) {
      // Page navigation (always active)
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { goToPage(currentPage + 1); return; }
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { goToPage(currentPage - 1); return; }

      // Escape cascade: deselect → read mode → close viewer
      if (ev.key === 'Escape') {
        if (isTyping()) return; // let inputs handle their own Escape
        if (annotationMode.selectedAnnotationId) {
          annotationMode.setSelectedAnnotationId(null);
        } else if (annotationMode.mode !== 'read') {
          annotationMode.setMode('read');
        } else {
          handleClose();
        }
        return;
      }

      // Modifier combos
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'e') {
        ev.preventDefault();
        setMode(m => m === 'edit' ? 'view' : 'edit');
        return;
      }
      if (mode === 'edit' && (ev.metaKey || ev.ctrlKey) && ev.key === 'z') {
        ev.preventDefault();
        handleUndo();
        return;
      }

      // Annotation mode hotkeys — skip when typing in inputs or with modifiers
      if (isTyping() || ev.metaKey || ev.ctrlKey || ev.altKey) return;

      switch (ev.key.toLowerCase()) {
        case 'v': guardedSetMode('select'); break;
        case 'p': guardedSetMode('ink'); break;
        case 'h': guardedSetMode('highlight'); break;
        case 't': guardedSetMode('text'); break;
        case 'e': guardedSetMode('erase'); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, numPages, hasUnsaved, tool, mode, annotationMode.mode, annotationMode.selectedAnnotationId, guardedSetMode]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#080812', display: 'flex', flexDirection: 'column' }}>
      {/* ── Toolbar ── */}
      <div style={{
        height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 14px', background: '#0b0b18',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ color: '#bbb', fontWeight: 600, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {title}
        </span>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} style={navBtn(currentPage <= 1)}>‹</button>
        <span style={{ color: '#555', fontSize: 12, minWidth: 52, textAlign: 'center', flexShrink: 0 }}>
          {loading ? '…' : `${currentPage} / ${numPages}`}
        </span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} style={navBtn(currentPage >= numPages)}>›</button>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Old edit mode tools removed — annotation toolbar handles all modes now */}

        <div style={{ flex: 1 }} />

        {/* Changed measures toggle — only shown when diff data is present */}
        {hasChanges && (
          <button
            onClick={() => setShowChanges(v => !v)}
            title={showChanges ? 'Hide changed measures' : 'Show changed measures'}
            style={{ ...tbBtn(showChanges), fontSize: 11 }}
          >
            {showChanges ? '◆ Changes on' : '◇ Changes off'}
          </button>
        )}

        {/* Score dark mode toggle */}
        <button
          onClick={() => setScoreInverted(v => !v)}
          title={scoreInverted ? 'Light score' : 'Dark score'}
          style={{ ...tbBtn(scoreInverted), fontSize: 11 }}
        >
          {scoreInverted ? '☀ Light score' : '◑ Dark score'}
        </button>

        <button onClick={() => setNotesOpen(o => !o)} style={{ ...tbBtn(notesOpen), fontSize: 11 }}>
          Notes
        </button>

        {/* Pencil toggle — show/hide annotation toolbar */}
        {partId && (
          <button
            onClick={() => setShowToolbar(v => !v)}
            title={showToolbar ? 'Hide annotation tools' : 'Show annotation tools'}
            style={{
              background: showToolbar ? 'rgba(124,111,247,0.18)' : 'transparent',
              border: showToolbar ? '1px solid rgba(124,111,247,0.35)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, cursor: 'pointer', padding: 4, flexShrink: 0,
              color: showToolbar ? '#a89af7' : '#666',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}
          >
            <svg width={20} height={20} viewBox="0 0 28 28" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 4.5L23 10L10 23H4.5V17.5L17.5 4.5Z" />
              <path d="M15 7L20.5 12.5" />
              <path d="M4.5 23L8 19.5" strokeWidth="1.3" />
            </svg>
          </button>
        )}

        {/* Eye toggle — show/hide annotations on score */}
        {partId && (
          <button
            onClick={() => setShowAnnotations(v => !v)}
            title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
            style={{
              background: showAnnotations ? 'rgba(124,111,247,0.18)' : 'transparent',
              border: showAnnotations ? '1px solid rgba(124,111,247,0.35)' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, cursor: 'pointer', padding: 4, flexShrink: 0,
              color: showAnnotations ? '#a89af7' : '#666',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}
          >
            <svg width={20} height={20} viewBox="0 0 28 28" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              {showAnnotations ? (
                <>
                  <path d="M14 8C8 8 4 14 4 14C4 14 8 20 14 20C20 20 24 14 24 14C24 14 20 8 14 8Z" />
                  <circle cx="14" cy="14" r="3.5" />
                </>
              ) : (
                <>
                  <path d="M14 8C8 8 4 14 4 14C4 14 8 20 14 20C20 20 24 14 24 14C24 14 20 8 14 8Z" />
                  <line x1="6" y1="6" x2="22" y2="22" />
                </>
              )}
            </svg>
          </button>
        )}

        <button onClick={handleClose} style={{
          background: 'none', border: 'none', color: '#555',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px', flexShrink: 0,
        }}>×</button>
      </div>

      {/* Offline banner */}
      {isOffline && (
        <div style={{
          padding: '6px 14px',
          background: 'rgba(234, 179, 8, 0.12)',
          borderBottom: '1px solid rgba(234, 179, 8, 0.3)',
          color: '#eab308',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'center',
          flexShrink: 0,
        }}>
          You're offline — changes won't save until you reconnect.
        </div>
      )}

      {/* ── Canvas + notes panel ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          ref={containerRef}
          style={{
            flex: 1, overflow: 'auto',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '16px 36px 28px',
            position: 'relative',
          }}
        >
          {/* Diff badge — shows changed measure count */}
          {diffInfo && diffInfo.count > 0 && (
            <DiffBadge
              info={diffInfo}
              highlightsEnabled={diffHighlightsEnabled}
              onToggleHighlights={() => setDiffHighlightsEnabled(v => !v)}
            />
          )}
          {/* Annotation toolbar — floating over the score */}
          {partId && showToolbar && (
            <AnnotationToolbar
              mode={annotationMode.mode}
              onModeChange={guardedSetMode}
              inkColor={annotationMode.inkColor}
              onInkColorChange={annotationMode.setInkColor}
              textColor={annotationMode.textColor}
              onTextColorChange={annotationMode.setTextColor}
              highlightColor={annotationMode.highlightColor}
              onHighlightColorChange={annotationMode.setHighlightColor}
              fontSize={annotationMode.fontSize}
              onFontSizeChange={annotationMode.setFontSize}
              fontFamily={annotationMode.fontFamily}
              onFontFamilyChange={annotationMode.setFontFamily}
              saveStatus={annSaveStatus}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => annLayerRef.current?.undo()}
              onRedo={() => annLayerRef.current?.redo()}
              selectedAnnotationKind={selectedAnnotationKind}
            />
          )}
          {loading ? (
            <div style={{ color: '#444', marginTop: '20vh', fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ position: 'relative', borderRadius: 2, boxShadow: '0 8px 48px rgba(0,0,0,0.7)' }}>
              {/* PDF canvas — invert(1) for dark score mode */}
              <canvas
                ref={pdfCanvasRef}
                style={{
                  display: 'block',
                  filter: scoreInverted ? 'invert(1)' : 'none',
                  transition: 'filter 0.2s ease',
                }}
              />
              {/* Draw canvas — NOT inverted, sits on top */}
              <canvas
                ref={drawCanvasRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={e => isDrawing.current && onMouseUp(e)}
                style={{
                  position: 'absolute', inset: 0,
                  cursor: mode === 'edit' && tool !== 'pointer' ? 'crosshair' : 'default',
                  touchAction: 'none',
                }}
              />
              {/* Diff highlight layer — yellow overlays on changed measures */}
              {partId && (
                <DiffHighlightLayer
                  partId={partId}
                  versionId={versionId ?? ''}
                  currentPage={currentPage}
                  measureLayout={measureLayout}
                  canvasWidth={canvasDims.w}
                  canvasHeight={canvasDims.h}
                  enabled={showAnnotations && diffHighlightsEnabled}
                  onDiffInfo={setDiffInfo}
                />
              )}
              {/* Annotation layer — SVG overlay for Part B annotation system */}
              {partId && showAnnotations && (
                <AnnotationLayer
                  partId={partId}
                  currentPage={currentPage}
                  measureLayout={measureLayout}
                  canvasWidth={canvasDims.w}
                  canvasHeight={canvasDims.h}
                  mode={annotationMode.mode}
                  inkColor={annotationMode.inkColor}
                  highlightColor={annotationMode.highlightColor}
                  textColor={annotationMode.textColor}
                  fontSize={annotationMode.fontSize}
                  fontFamily={annotationMode.fontFamily}
                  selectedAnnotationId={annotationMode.selectedAnnotationId}
                  onSelectionChange={annotationMode.setSelectedAnnotationId}
                  onSelectedKindChange={setSelectedAnnotationKind}
                  onSaveStatusChange={setAnnSaveStatus}
                  onHistoryChange={(cu, cr, undo, redo) => {
                    setCanUndo(cu);
                    setCanRedo(cr);
                    annLayerRef.current = { undo, redo };
                  }}
                  onInkColorChange={annotationMode.setInkColor}
                  onTextColorChange={annotationMode.setTextColor}
                  onHighlightColorChange={annotationMode.setHighlightColor}
                />
              )}
            </div>
          )}
        </div>

        {partId && notesOpen && (
          <NotePanel
            partId={partId}
            currentPage={currentPage}
            currentUserId={currentUserId}
          />
        )}
      </div>

      {/* ── Anchor dialog ── */}
      {anchorDialog && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#131320', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12, padding: '24px 28px', width: 360,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          }}>
            <h3 style={{ color: '#eee', fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Save annotations</h3>
            <p style={{ color: '#666', fontSize: 12, lineHeight: 1.5, marginBottom: anchorChoice === 'measure' && measureHint ? 8 : 20 }}>
              How should these markings anchor to the score?
              {anchorDialog.pages.length > 0 && (
                <><br/><span style={{ color: '#555', fontSize: 11 }}>New annotation{anchorDialog.pages.length !== 1 ? 's' : ''} on page{anchorDialog.pages.length !== 1 ? 's' : ''} {anchorDialog.pages.map(p => `${p}`).join(', ')}</span></>
              )}
            </p>
            {anchorChoice === 'measure' && measureHint && (
              <p style={{ color: '#9184f9', fontSize: 11, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ background: 'rgba(124,111,247,0.12)', border: '1px solid rgba(124,111,247,0.25)', borderRadius: 4, padding: '2px 7px', fontWeight: 700 }}>
                  m.{measureHint}
                </span>
                auto-detected — correct if needed
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {/* Page option */}
              <button
                onClick={() => setAnchorChoice('page')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 2, padding: '11px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: anchorChoice === 'page' ? 'rgba(124,111,247,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${anchorChoice === 'page' ? 'rgba(124,111,247,0.35)' : 'rgba(255,255,255,0.07)'}`,
                  transition: 'all 0.1s',
                }}
              >
                <span style={{ color: anchorChoice === 'page' ? '#c4bcff' : '#bbb', fontSize: 13, fontWeight: 600 }}>
                  Tie to page
                </span>
                <span style={{ color: '#555', fontSize: 11, lineHeight: 1.4 }}>
                  Stays at the same position on this page. Best for layout-stable parts.
                </span>
              </button>

              {/* Measure option */}
              <button
                onClick={() => setAnchorChoice('measure')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 2, padding: '11px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: anchorChoice === 'measure' ? 'rgba(124,111,247,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${anchorChoice === 'measure' ? 'rgba(124,111,247,0.35)' : 'rgba(255,255,255,0.07)'}`,
                  transition: 'all 0.1s',
                }}
              >
                <span style={{ color: anchorChoice === 'measure' ? '#c4bcff' : '#bbb', fontSize: 13, fontWeight: 600 }}>
                  Tie to measure
                </span>
                <span style={{ color: '#555', fontSize: 11, lineHeight: 1.4 }}>
                  Follows this musical moment across version updates, even if page layout changes.
                </span>
              </button>
            </div>

            {anchorChoice === 'measure' && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ color: '#555', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, display: 'block' }}>
                  Starting measure number
                </label>
                <input
                  type="number"
                  min={1}
                  value={measureHint}
                  onChange={e => setMeasureHint(e.target.value)}
                  placeholder="e.g. 12"
                  autoFocus
                  style={{
                    width: '100%', padding: '7px 10px', fontSize: 13,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: '#eee', boxShadow: 'none',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setAnchorDialog(null)}
                style={{
                  padding: '7px 16px', fontSize: 12, fontWeight: 500, borderRadius: 6,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#666', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmAnchorDialog}
                disabled={anchorChoice === 'measure' && (!measureHint || parseInt(measureHint) < 1)}
                style={{
                  padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                  background: '#5b4cf5', border: '1px solid rgba(124,111,247,0.4)',
                  color: '#fff', cursor: 'pointer',
                  opacity: (anchorChoice === 'measure' && (!measureHint || parseInt(measureHint) < 1)) ? 0.4 : 1,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function PdfViewer({ url, partId, versionId, title, changedMeasureBounds }: ViewerProps) {
  const [open, setOpen] = useState(false);

  const currentUserId = (() => {
    try { return JSON.parse(atob(localStorage.getItem('token')?.split('.')[1] ?? '')).sub; }
    catch { return undefined; }
  })();

  return (
    <>
      <PdfThumbnail url={url} onClick={() => setOpen(true)} />
      {open && (
        <FullscreenViewer
          url={url}
          partId={partId}
          versionId={versionId}
          title={title}
          currentUserId={currentUserId}
          changedMeasureBounds={changedMeasureBounds}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
