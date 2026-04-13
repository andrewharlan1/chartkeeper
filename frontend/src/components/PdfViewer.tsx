import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import './PdfViewer.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  url: string;
  title?: string;
  // Changed measure bounds keyed by measure number (from diff)
  changedMeasureBounds?: Record<number, unknown>;
  // Human-readable descriptions for tooltip
  changeDescriptions?: Record<number, string>;
}

// ── Authenticated PDF fetch → ArrayBuffer ────────────────────────────────────

async function fetchPdfData(url: string): Promise<ArrayBuffer> {
  const token = localStorage.getItem('token');
  // url is like /parts/:id/pdf — prepend /api for the Vite proxy
  const apiUrl = url.startsWith('/parts') ? `/api${url}` : url;
  const res = await fetch(apiUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

// ── Thumbnail (first page preview) ───────────────────────────────────────────

interface ThumbnailProps {
  url: string;
  onClick: () => void;
}

export function PdfThumbnail({ url, onClick }: ThumbnailProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Only run once per url — don't restart on parent re-renders from polling
  const loadedUrl = useRef<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (loadedUrl.current === url) return;
    let cancelled = false;

    fetchPdfData(url)
      .then(data => {
        if (cancelled) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const blob = new Blob([data], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;
        loadedUrl.current = url;
        setBlobUrl(objectUrl);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[PdfThumbnail] error:', err);
        if (!cancelled) setError(true);
      });

    return () => { cancelled = true; };
  }, [url]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  if (error) return <div className="pdf-loading" style={{ cursor: 'pointer' }} onClick={onClick}>Could not load preview — click to open</div>;
  if (loading) return <div className="pdf-loading">Loading preview…</div>;

  return (
    <div className="pdf-thumbnail" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <iframe
        src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH`}
        title="PDF preview"
        className="pdf-thumbnail-iframe"
        tabIndex={-1}
      />
      <div className="pdf-thumbnail-overlay">
        <span className="pdf-thumbnail-label">View full screen</span>
      </div>
    </div>
  );
}

// ── Full viewer ───────────────────────────────────────────────────────────────

export function PdfViewer({ url, title, changeDescriptions }: Props) {
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const totalChanged = changeDescriptions ? Object.keys(changeDescriptions).length : 0;

  // Load PDF into blob URL when viewer opens
  useEffect(() => {
    if (!open || blobUrl) return;
    let cancelled = false;

    fetchPdfData(url).then(data => {
      if (cancelled) return;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blob = new Blob([data], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      blobUrlRef.current = objectUrl;
      setBlobUrl(objectUrl);
    });

    return () => { cancelled = true; };
  }, [open, url, blobUrl]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <PdfThumbnail url={url} onClick={() => setOpen(true)} />

      {open && (
        <div className="pdf-viewer-backdrop" onClick={() => setOpen(false)}>
          <div className="pdf-viewer-toolbar" onClick={e => e.stopPropagation()}>
            <div className="pdf-viewer-toolbar-left">
              <span className="pdf-viewer-title">{title ?? 'Part'}</span>
              {totalChanged > 0 && (
                <div className="pdf-diff-legend">
                  <div className="pdf-diff-legend-dot" />
                  {totalChanged} changed measure{totalChanged !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            <div className="pdf-viewer-toolbar-right">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>✕ Close</Button>
            </div>
          </div>

          <div className="pdf-viewer-iframe-wrap" onClick={e => e.stopPropagation()}>
            {blobUrl
              ? <iframe src={blobUrl} title={title ?? 'Part'} className="pdf-viewer-iframe" />
              : <div style={{ color: 'var(--text-muted)', padding: 40 }}>Loading…</div>
            }
          </div>
        </div>
      )}
    </>
  );
}
