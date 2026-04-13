import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { MeasureBounds } from '../types';
import { Button } from './Button';
import './PdfViewer.css';

// Point the worker at the bundled file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

// Amber highlight colour for changed measures
const HIGHLIGHT_FILL = 'rgba(255, 193, 60, 0.25)';
const HIGHLIGHT_STROKE = 'rgba(255, 193, 60, 0.8)';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  url: string;
  title?: string;
  // Changed measure bounds keyed by measure number (from diff)
  changedMeasureBounds?: Record<number, MeasureBounds>;
  // Human-readable descriptions for tooltip
  changeDescriptions?: Record<number, string>;
}

// ── Overlay drawing ───────────────────────────────────────────────────────────

function drawOverlay(
  canvas: HTMLCanvasElement,
  viewport: pdfjsLib.PageViewport,
  pageNum: number,
  changedMeasureBounds: Record<number, MeasureBounds>,
  scale: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const [, bounds] of Object.entries(changedMeasureBounds)) {
    const b = bounds as MeasureBounds;
    if (b.page !== pageNum) continue;

    // PDF coordinate origin is bottom-left; canvas is top-left
    const x = b.x * scale;
    const y = viewport.height - (b.y + b.h) * scale;
    const w = b.w * scale;
    const h = b.h * scale;

    ctx.fillStyle = HIGHLIGHT_FILL;
    ctx.strokeStyle = HIGHLIGHT_STROKE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.stroke();
  }
}

// ── Single page renderer ──────────────────────────────────────────────────────

interface PageProps {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  scale: number;
  changedMeasureBounds?: Record<number, MeasureBounds>;
}

function PdfPage({ pdf, pageNum, scale, changedMeasureBounds }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (!canvas || !overlay || cancelled) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      overlay.width = viewport.width;
      overlay.height = viewport.height;

      // Cancel any in-flight render for this page
      renderTaskRef.current?.cancel();

      const ctx = canvas.getContext('2d')!;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch (e: unknown) {
        if ((e as Error)?.name === 'RenderingCancelledException') return;
        throw e;
      }

      if (cancelled) return;

      if (changedMeasureBounds) {
        drawOverlay(overlay, viewport, pageNum, changedMeasureBounds, scale);
      }
    }

    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdf, pageNum, scale, changedMeasureBounds]);

  return (
    <div className="pdf-page-wrapper">
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <canvas ref={overlayRef} className="pdf-overlay-canvas" />
    </div>
  );
}

// ── Authenticated PDF fetch → blob URL ───────────────────────────────────────

async function fetchPdfBlobUrl(url: string): Promise<string> {
  const token = localStorage.getItem('token');
  // url is like /parts/:id/pdf — prepend /api for the Vite proxy
  const apiUrl = url.startsWith('/parts') ? `/api${url}` : url;
  const res = await fetch(apiUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Thumbnail (first page preview) ───────────────────────────────────────────

interface ThumbnailProps {
  url: string;
  onClick: () => void;
}

export function PdfThumbnail({ url, onClick }: ThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    fetchPdfBlobUrl(url)
      .then(blob => {
        blobUrl = blob;
        return pdfjsLib.getDocument(blob).promise;
      })
      .then(async (pdf) => {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.4 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        if (!cancelled) setLoading(false);
      })
      .catch(() => { if (!cancelled) setError(true); });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  if (error) return <div className="pdf-loading" style={{ cursor: 'pointer' }} onClick={onClick}>Could not load preview — click to open</div>;
  if (loading) return <div className="pdf-loading">Loading preview…</div>;

  return (
    <div className="pdf-thumbnail" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <canvas ref={canvasRef} />
      <div className="pdf-thumbnail-overlay">
        <span className="pdf-thumbnail-label">View full screen</span>
      </div>
    </div>
  );
}

// ── Full viewer ───────────────────────────────────────────────────────────────

export function PdfViewer({ url, title, changedMeasureBounds, changeDescriptions }: Props) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.4);
  const [open, setOpen] = useState(false);

  const hasOverlay = changedMeasureBounds && Object.keys(changedMeasureBounds).length > 0;
  const totalChanged = changeDescriptions ? Object.keys(changeDescriptions).length : 0;

  // Load PDF when viewer opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let blobUrl: string | null = null;

    fetchPdfBlobUrl(url).then(blob => {
      blobUrl = blob;
      return pdfjsLib.getDocument(blob).promise;
    }).then((doc) => {
      if (cancelled) return;
      setPdf(doc);
      setNumPages(doc.numPages);
    });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [open, url]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const zoomIn = useCallback(() => setScale(s => Math.min(s + 0.2, 3)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(s - 0.2, 0.4)), []);

  return (
    <>
      <PdfThumbnail url={url} onClick={() => setOpen(true)} />

      {open && (
        <div className="pdf-viewer-backdrop" onClick={() => setOpen(false)}>
          <div className="pdf-viewer-toolbar" onClick={e => e.stopPropagation()}>
            <div className="pdf-viewer-toolbar-left">
              <span className="pdf-viewer-title">{title ?? 'Part'}</span>
              <span className="pdf-viewer-page-info">{numPages} page{numPages !== 1 ? 's' : ''}</span>
              {hasOverlay && (
                <div className="pdf-diff-legend">
                  <div className="pdf-diff-legend-dot" />
                  {totalChanged} changed measure{totalChanged !== 1 ? 's' : ''} highlighted
                </div>
              )}
            </div>
            <div className="pdf-viewer-toolbar-right">
              <Button variant="secondary" size="sm" onClick={zoomOut}>−</Button>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 40, textAlign: 'center' }}>
                {Math.round(scale * 100)}%
              </span>
              <Button variant="secondary" size="sm" onClick={zoomIn}>+</Button>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>✕ Close</Button>
            </div>
          </div>

          <div className="pdf-viewer-pages" onClick={e => e.stopPropagation()}>
            {pdf && Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
              <PdfPage
                key={pageNum}
                pdf={pdf}
                pageNum={pageNum}
                scale={scale}
                changedMeasureBounds={changedMeasureBounds}
              />
            ))}
            {!pdf && <div style={{ color: 'var(--text-muted)', padding: 40 }}>Loading…</div>}
          </div>
        </div>
      )}
    </>
  );
}
