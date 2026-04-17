import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation } from '../api/annotations';
import { Annotation } from '../types';

// @ts-expect-error vite url import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }
interface Stroke { points: Point[]; color: string; width: number }
interface HighlightRect { x: number; y: number; w: number; h: number; color: string }
interface PageOverlay { strokes: Stroke[]; highlights: HighlightRect[] }
type Tool = 'pointer' | 'pen' | 'highlight';

interface ViewerProps {
  url: string;
  partId?: string;
  title?: string;
  changedMeasureBounds?: Record<number, unknown>;
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
      .then(r => setAnnotations(r.annotations.filter(a => a.content_type === 'text')))
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
        contentType: 'text',
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
            const measureNum = (a.anchor_json as { measureNumber?: number }).measureNumber;
            const pageNum = (a.anchor_json as { page?: number }).page;
            return (
              <div key={a.id} style={{
                padding: '7px 9px', marginBottom: 5,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${a.is_unresolved ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.06)'}`,
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
                    {a.is_unresolved && (
                      <p style={{ fontSize: 10, color: '#f5a623', marginBottom: 3 }}>⚠ Measure removed</p>
                    )}
                    <p style={{ fontSize: 12, color: '#ddd', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {(a.content_json as { text?: string }).text}
                    </p>
                    <p style={{ fontSize: 10, color: '#555', marginTop: 3 }}>{a.user_name}</p>
                  </div>
                  {a.user_id === currentUserId && (
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
  url, partId, title, currentUserId, onClose,
}: {
  url: string; partId?: string; title?: string; currentUserId?: string; onClose: () => void;
}) {
  const isDark = useIsDark();

  const pdfDocRef   = useRef<PDFDocumentProxy | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const renderingRef  = useRef(false);

  const [numPages, setNumPages]       = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading]         = useState(true);
  const [tool, setTool]               = useState<Tool>('pointer');
  const [color, setColor]             = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? DARK_PEN_COLORS[1] : LIGHT_PEN_COLORS[1]
  );
  const [hlColor, setHlColor]         = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? DARK_HL_COLORS[0] : LIGHT_HL_COLORS[0]
  );
  const [strokeWidth, setStrokeWidth] = useState(PEN_WIDTHS[0]);
  const [saving, setSaving]           = useState(false);
  const [hasUnsaved, setHasUnsaved]   = useState(false);
  const [notesOpen, setNotesOpen]     = useState(false);
  const [scoreInverted, setScoreInverted] = useState(isDark);
  const [anchorDialog, setAnchorDialog] = useState<{ pages: number[] } | null>(null);
  const [anchorChoice, setAnchorChoice] = useState<'page' | 'measure'>('page');
  const [measureHint, setMeasureHint]   = useState('');

  const pageOverlays      = useRef<Map<number, PageOverlay>>(new Map());
  const pageAnnotationIds = useRef<Map<number, string>>(new Map());
  const isDrawing         = useRef(false);
  const liveStroke        = useRef<Point[]>([]);
  const dragStart         = useRef<Point | null>(null);

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
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [url]);

  // ── Load existing annotations ───────────────────────────────────────────────
  useEffect(() => {
    if (!partId) return;
    getAnnotations(partId).then(r => {
      for (const ann of r.annotations) {
        if (ann.content_type !== 'ink' && ann.content_type !== 'highlight') continue;
        const pg = (ann.anchor_json as unknown as { page: number }).page;
        const existing = pageOverlays.current.get(pg) ?? { strokes: [], highlights: [] };

        if (ann.content_type === 'ink') {
          // Strokes AND highlights are both stored in the ink annotation content_json
          existing.strokes = (ann.content_json as { strokes?: Stroke[] }).strokes ?? [];
          existing.highlights = (ann.content_json as { highlights?: HighlightRect[] }).highlights ?? [];
          pageAnnotationIds.current.set(pg, ann.id);
        } else if (ann.content_type === 'highlight') {
          // Legacy separate highlight annotations
          existing.highlights = (ann.content_json as { highlights?: HighlightRect[] }).highlights ?? [];
        }
        pageOverlays.current.set(pg, existing);
      }
    }).catch(() => {});
  }, [partId]);

  // ── Redraw ──────────────────────────────────────────────────────────────────
  const redrawCanvas = useCallback((page: number, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  }, []);

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
        const scale = Math.min(availW / vp1.width, availH / vp1.height, 2.5);
        const vp = page.getViewport({ scale });
        const pdfC = pdfCanvasRef.current!;
        const drawC = drawCanvasRef.current!;
        pdfC.width = vp.width; pdfC.height = vp.height;
        drawC.width = vp.width; drawC.height = vp.height;
        await page.render({ canvasContext: pdfC.getContext('2d')!, viewport: vp }).promise;
        redrawCanvas(currentPage, drawC);
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
        if (existingId) {
          await updateAnnotation(existingId, contentJson);
        } else {
          const anchorJson: Record<string, unknown> = { page: pg };
          if (anchorType === 'measure' && measureHintVal && measureHintVal > 0) {
            anchorJson.measureHint = measureHintVal;
          }
          const { annotation } = await createAnnotation(partId, {
            anchorType,
            anchorJson,
            contentType: 'ink',
            contentJson,
          });
          pageAnnotationIds.current.set(pg, annotation.id);
        }
      }
      setHasUnsaved(false);
    } finally {
      setSaving(false);
    }
  }, [partId]);

  // Check whether any new (unsaved) pages exist
  function hasNewPages(): boolean {
    for (const [pg, overlay] of pageOverlays.current.entries()) {
      if (overlay.strokes.length === 0 && overlay.highlights.length === 0) continue;
      if (!pageAnnotationIds.current.has(pg)) return true;
    }
    return false;
  }

  // Called when user clicks Save button — always show anchor dialog
  function handleSaveClick() {
    if (!hasUnsaved || !partId) return;
    setAnchorChoice('page');
    setMeasureHint('');
    const newPages = [...pageOverlays.current.entries()]
      .filter(([pg, ov]) => (ov.strokes.length > 0 || ov.highlights.length > 0) && !pageAnnotationIds.current.has(pg))
      .map(([pg]) => pg);
    setAnchorDialog({ pages: newPages });
  }

  function confirmAnchorDialog() {
    const m = parseInt(measureHint);
    saveOverlays({ anchorType: anchorChoice, measureHintVal: m > 0 ? m : undefined });
    setAnchorDialog(null);
  }

  // Auto-save on close (always as 'page' to avoid blocking)
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
    if (tool === 'pointer') return;
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
      overlay.strokes.push({ points: [...liveStroke.current], color, width: strokeWidth });
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
        // Use brighter opacity for dark mode (score is inverted = dark background)
        const opacity = scoreInverted ? 'bb' : '66';
        overlay.highlights.push({
          x: Math.min(ds.x, pos.x), y: Math.min(ds.y, pos.y),
          w: Math.abs(w), h: Math.abs(h),
          color: hlColor + opacity,
        });
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

  function goToPage(n: number) {
    if (n < 1 || n > numPages || loading) return;
    setCurrentPage(n);
  }

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') goToPage(currentPage + 1);
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') goToPage(currentPage - 1);
      else if (ev.key === 'Escape') handleClose();
      else if (ev.key === 'p') setTool('pen');
      else if (ev.key === 'h') setTool('highlight');
      else if (ev.key === 'v') setTool('pointer');
      else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'z') { ev.preventDefault(); handleUndo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, numPages, hasUnsaved, tool]);

  const penPalette = isDark ? DARK_PEN_COLORS : LIGHT_PEN_COLORS;
  const hlPalette  = isDark ? DARK_HL_COLORS  : LIGHT_HL_COLORS;

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

        <button onClick={() => setTool('pointer')} style={tbBtn(tool === 'pointer')}>Pointer <span style={{ opacity: 0.4, fontSize: 9 }}>V</span></button>
        <button onClick={() => setTool('pen')} style={tbBtn(tool === 'pen')}>✏ Pen <span style={{ opacity: 0.4, fontSize: 9 }}>P</span></button>
        <button onClick={() => setTool('highlight')} style={tbBtn(tool === 'highlight')}>▬ Highlight <span style={{ opacity: 0.4, fontSize: 9 }}>H</span></button>

        {/* Color palette */}
        {(tool === 'pen' || tool === 'highlight') && (
          <>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
            {(tool === 'pen' ? penPalette : hlPalette).map(c => (
              <button key={c} onClick={() => tool === 'pen' ? setColor(c) : setHlColor(c)} style={{
                width: 16, height: 16, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                background: tool === 'highlight' ? c + '99' : c === '#1c1c28' ? '#e8e8e8' : c,
                outline: (tool === 'pen' ? color : hlColor) === c ? '2px solid #fff' : '2px solid transparent',
                outlineOffset: 2,
              }} />
            ))}
          </>
        )}

        {tool === 'pen' && (
          <>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
            {PEN_WIDTHS.map(w => (
              <button key={w} onClick={() => setStrokeWidth(w)} style={{
                width: 26, height: 26, borderRadius: 5, border: 'none', flexShrink: 0,
                background: strokeWidth === w ? 'rgba(255,255,255,0.1)' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: w * 2.5, height: w * 2.5, borderRadius: '50%', background: color === '#1c1c28' ? '#e8e8e8' : color }} />
              </button>
            ))}
          </>
        )}

        <button onClick={handleUndo} style={{
          ...tbBtn(false),
          fontSize: 11, padding: '3px 8px',
        }}>Undo <span style={{ opacity: 0.4, fontSize: 9 }}>⌘Z</span></button>

        <div style={{ flex: 1 }} />

        {/* Score dark mode toggle */}
        <button
          onClick={() => setScoreInverted(v => !v)}
          title={scoreInverted ? 'Light score' : 'Dark score'}
          style={{ ...tbBtn(scoreInverted), fontSize: 11 }}
        >
          {scoreInverted ? '☀ Light score' : '◑ Dark score'}
        </button>

        <button onClick={() => setNotesOpen(o => !o)} style={{ ...tbBtn(notesOpen), fontSize: 11 }}>
          ✎ Notes
        </button>

        {partId && (
          <button onClick={handleSaveClick} disabled={saving || !hasUnsaved} style={{
            background: hasUnsaved ? '#5b4cf5' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${hasUnsaved ? 'rgba(124,111,247,0.4)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 6, color: hasUnsaved ? '#fff' : '#444',
            cursor: hasUnsaved ? 'pointer' : 'default',
            fontSize: 11, fontWeight: 600, padding: '4px 12px', flexShrink: 0,
          }}>
            {saving ? '…' : hasUnsaved ? 'Save' : '✓ Saved'}
          </button>
        )}

        <button onClick={handleClose} style={{
          background: 'none', border: 'none', color: '#555',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px', flexShrink: 0,
        }}>×</button>
      </div>

      {/* ── Canvas + notes panel ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          ref={containerRef}
          style={{
            flex: 1, overflow: 'auto',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '28px 36px',
          }}
        >
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
                  cursor: tool !== 'pointer' ? 'crosshair' : 'default',
                  touchAction: 'none',
                }}
              />
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
            <p style={{ color: '#666', fontSize: 12, lineHeight: 1.5, marginBottom: 20 }}>
              How should these markings anchor to the score?
              {anchorDialog.pages.length > 0 && (
                <><br/><span style={{ color: '#555', fontSize: 11 }}>New annotation{anchorDialog.pages.length !== 1 ? 's' : ''} on page{anchorDialog.pages.length !== 1 ? 's' : ''} {anchorDialog.pages.map(p => `${p}`).join(', ')}</span></>
              )}
            </p>

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

export function PdfViewer({ url, partId, title }: ViewerProps) {
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
          title={title}
          currentUserId={currentUserId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
