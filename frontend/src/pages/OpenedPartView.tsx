import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { getPart } from '../api/parts';
import { getPartDiff, PartDiffData } from '../api/parts';
import { getVersion } from '../api/versions';
import { getChart } from '../api/charts';
import { getAnnotations } from '../api/annotations';
import { getEvent, EventChart } from '../api/events';
import { Part, Version, Annotation, MeasureBounds } from '../types';
import { PdfViewer } from '../components/PdfViewer';
import './PlayerView.css';

type ToolId = 'pen' | 'highlight' | 'text' | 'eraser';

const SWATCHES = ['#2c5fa0', '#c8531c', '#1a1d24', '#2f8d57', '#7c3aed'];

export function OpenedPartView() {
  const { id: chartId, vId, pId } = useParams<{ id: string; vId: string; pId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get('event');

  const [part, setPart] = useState<Part | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [chartName, setChartName] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [diffData, setDiffData] = useState<PartDiffData | null>(null);
  const [loading, setLoading] = useState(true);

  // View mode
  const [revealed, setRevealed] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askQuery, setAskQuery] = useState('');
  const [activeTool, setActiveTool] = useState<ToolId>('pen');
  const [activeColor, setActiveColor] = useState(SWATCHES[0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(1); // PdfViewer will eventually report this
  const [zoom, setZoom] = useState(100); // 50–200

  // Banner state
  const [showDiffBanner, setShowDiffBanner] = useState(false);
  const [showMigBanner, setShowMigBanner] = useState(false);

  // Event context
  const [eventName, setEventName] = useState('');
  const [eventCharts, setEventCharts] = useState<EventChart[]>([]);
  const [eventPosition, setEventPosition] = useState(0);

  useEffect(() => {
    if (!pId || !vId || !chartId) return;
    Promise.all([
      getPart(pId),
      getVersion(vId),
      getChart(chartId),
      getAnnotations(pId),
      getPartDiff(pId).catch(() => null),
    ]).then(([{ part: p }, { version: v }, { chart }, { annotations: anns }, diff]) => {
      setPart(p);
      setVersion(v);
      setChartName(chart.name);
      setAnnotations(anns);
      if (diff && diff.changedMeasures.length > 0) {
        setDiffData(diff);
        setShowDiffBanner(true);
      }
      const hasMigrated = anns.some(a =>
        (a.contentJson as Record<string, unknown>)?._needsReview === true
      );
      setShowMigBanner(hasMigrated);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [pId, vId, chartId]);

  // Load event context
  useEffect(() => {
    if (!eventId) return;
    getEvent(eventId).then(({ event, charts }) => {
      setEventName(event.name);
      const sorted = [...charts].sort((a, b) => a.sortOrder - b.sortOrder);
      setEventCharts(sorted);
      const pos = sorted.findIndex(c => c.chartId === chartId);
      setEventPosition(pos >= 0 ? pos : 0);
    }).catch(() => {});
  }, [eventId, chartId]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Escape closes Ask palette
    if (e.key === 'Escape' && askOpen) {
      setAskOpen(false);
      setAskQuery('');
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 't' || e.key === 'T') {
      setRevealed(r => !r);
    } else if (e.key === '/') {
      e.preventDefault();
      setAskOpen(true);
    } else if (e.key === '=' || e.key === '+') {
      setZoom(z => Math.min(200, z + 10));
    } else if (e.key === '-') {
      setZoom(z => Math.max(50, z - 10));
    } else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setZoom(100);
    }
  }, [askOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) {
    return (
      <div className="pv" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 12 }}>Loading...</p>
      </div>
    );
  }
  if (!part || !version) return null;

  const migratedCount = annotations.filter(a =>
    (a.contentJson as Record<string, unknown>)?._needsReview === true
  ).length;

  const diffSummary = diffData
    ? `${diffData.changedMeasures.length} measure${diffData.changedMeasures.length !== 1 ? 's' : ''} changed`
    : '';

  // Transform string-keyed bounds to number-keyed for PdfViewer
  const numericBounds: Record<number, MeasureBounds> | undefined = diffData?.changedMeasureBounds
    ? Object.fromEntries(
        Object.entries(diffData.changedMeasureBounds).map(([k, v]) => [Number(k), v])
      )
    : undefined;
  const changeDescs: Record<number, string> | undefined = diffData?.changeDescriptions
    ? Object.fromEntries(
        Object.entries(diffData.changeDescriptions).map(([k, v]) => [Number(k), v])
      )
    : undefined;

  // ── Ask palette overlay (shared across both modes) ──
  const askPalette = askOpen && (
    <>
      <div className="pv-scrim" onClick={() => { setAskOpen(false); setAskQuery(''); }} />
      <div className="pv-palette">
        <div className="pv-pal-row input">
          <span className="pv-pal-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M 3 3 H 13 A 1.6 1.6 0 0 1 14.6 4.6 V 9.5 A 1.6 1.6 0 0 1 13 11.1 H 7.6 L 5 14 L 5.7 11.1 H 3 A 1.6 1.6 0 0 1 1.4 9.5 V 4.6 A 1.6 1.6 0 0 1 3 3 Z" />
              <line x1="4.5" y1="6.3" x2="11.4" y2="6.3" strokeWidth="1.1" strokeLinecap="round" />
              <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="pv-pal-input"
            placeholder="Add crescendo at bar 12..."
            value={askQuery}
            onChange={e => setAskQuery(e.target.value)}
            autoFocus
          />
          <span className="pv-pal-esc">esc</span>
        </div>
        <div className="pv-pal-foot">
          <span className="pv-pal-hint">
            <kbd>Enter</kbd> to submit &middot; <kbd>Esc</kbd> to close
          </span>
          <span className="pv-pal-grow" />
        </div>
      </div>
    </>
  );

  // ── Revealed (annotation mode) ──
  if (revealed) {
    return (
      <div className="pv revealed">
        {/* Top bar */}
        <div className="pv-topbar">
          <div className="pv-crumbs">
            <Link to={`/charts/${chartId}`}>{chartName}</Link>
            <span className="pv-sep">/</span>
            <span className="pv-cur">{part.name}</span>
          </div>
          <span className="pv-ver-pill">
            <span className="pv-vp-dot" />
            {version.name}
          </span>
          <span className="pv-tb-grow" />
          <div className="pv-tb-group">
            <span className="pv-tb-lbl">mode</span>
            <button className="pv-tbtn on">Edit</button>
            <button className="pv-tbtn" onClick={() => setRevealed(false)}>View</button>
          </div>
          <button className="pv-tb-close" onClick={() => setRevealed(false)}>
            Done
          </button>
        </div>

        {/* Diff strip */}
        {diffData && diffData.changedMeasures.length > 0 && (
          <div className="pv-strip">
            <span className="pv-st-dot" />
            <span>{diffSummary} vs {diffData.comparedToVersionName}</span>
            <span className="pv-st-grow" />
            <button
              className="pv-st-cta"
              onClick={() => navigate(`/charts/${chartId}/versions/${vId}/diff`)}
            >
              View diff
            </button>
          </div>
        )}

        {/* Body: rail + content + footstrip */}
        <div className="pv-revealed-body">
          {/* Left rail */}
          <div className="pv-rail">
            <button
              className={`pv-tool${activeTool === 'pen' ? ' on' : ''}`}
              onClick={() => setActiveTool('pen')}
              title="Pen"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
                <path d="M11 2.5L13.5 5L5 13.5L2 14L2.5 11Z" />
              </svg>
            </button>
            <button
              className={`pv-tool${activeTool === 'highlight' ? ' on' : ''}`}
              onClick={() => setActiveTool('highlight')}
              title="Highlight"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="3" y="2" width="10" height="12" rx="1" />
                <rect x="4" y="9" width="8" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
              </svg>
            </button>
            <button
              className={`pv-tool${activeTool === 'text' ? ' on' : ''}`}
              onClick={() => setActiveTool('text')}
              title="Text"
            >
              T
            </button>
            <button
              className={`pv-tool${activeTool === 'eraser' ? ' on' : ''}`}
              onClick={() => setActiveTool('eraser')}
              title="Eraser"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M5 14h8M3.5 10.5l6-6 3 3-6 6-3.5.5.5-3.5z" />
              </svg>
            </button>

            <div className="pv-rail-div" />

            {/* Color swatches */}
            {SWATCHES.map(color => (
              <button
                key={color}
                className={`pv-swatch${activeColor === color ? ' on' : ''}`}
                style={{ background: color }}
                onClick={() => setActiveColor(color)}
              />
            ))}

            {/* Page indicator */}
            <div className="pv-rail-pg">
              <span className="pv-pg-n">{currentPage}</span>
              <span className="pv-pg-d">of {totalPages}</span>
            </div>
          </div>

          {/* PDF content area */}
          <div className="pv-revealed-content">
            <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}>
              <PdfViewer
                url={`/parts/${pId}/pdf`}
                partId={pId!}
                versionId={vId}
                title={`${part.name} — ${version.name}`}
                changedMeasureBounds={numericBounds}
                changeDescriptions={changeDescs}
              />
            </div>
          </div>

          {/* Bottom strip */}
          <div className="pv-footstrip">
            <div className="pv-thumbs">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  className={`pv-thumb${currentPage === i + 1 ? ' on' : ''}`}
                  onClick={() => setCurrentPage(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="pv-fs-nav">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>&lsaquo;</button>
              <span>pg {currentPage}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>&rsaquo;</button>
            </div>
            <div className="pv-fs-zoom">
              <button onClick={() => setZoom(z => Math.max(50, z - 10))}>−</button>
              <input
                type="range"
                min={50}
                max={200}
                step={10}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="pv-zoom-slider"
              />
              <button onClick={() => setZoom(z => Math.min(200, z + 10))}>+</button>
              <span className="pv-zoom-pct">{zoom}%</span>
            </div>
          </div>
        </div>

        {/* Ask palette overlay */}
        {askPalette}
      </div>
    );
  }

  // ── Resting state ──
  return (
    <div className="pv">
      {/* Diff banner */}
      {showDiffBanner && diffData && (
        <div className="pv-diff-banner">
          <span className="pv-db-dot" />
          <span className="pv-db-version">{diffData.comparedToVersionName || 'New version'}</span>
          <span className="pv-db-text">{diffSummary}</span>
          <span className="pv-db-grow" />
          <button
            className="pv-db-cta"
            onClick={() => navigate(`/charts/${chartId}/versions/${vId}/diff`)}
          >
            View changes
          </button>
          <button className="pv-db-dismiss" onClick={() => setShowDiffBanner(false)}>
            &times;
          </button>
        </div>
      )}

      {/* Event context bar */}
      {eventId && eventName && eventCharts.length > 0 && (
        <div className="pv-event-bar">
          <span className="pv-eb-pill">setlist</span>
          <span className="pv-eb-name">{eventName}</span>
          <span className="pv-eb-pos">{eventPosition + 1} of {eventCharts.length}</span>
          {eventPosition < eventCharts.length - 1 && (
            <button
              className="pv-eb-next"
              onClick={() => {
                const next = eventCharts[eventPosition + 1];
                navigate(`/charts/${next.chartId}?event=${eventId}`);
              }}
            >
              next: {eventCharts[eventPosition + 1].chartName} &rsaquo;
            </button>
          )}
        </div>
      )}

      {/* Migration banner */}
      {showMigBanner && migratedCount > 0 && (
        <div className="pv-mig-banner">
          <div className="pv-mb-icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8 a5 5 0 0 1 10 0" />
              <path d="M13 8 L15 6 M13 8 L11 6" strokeLinecap="round" />
            </svg>
          </div>
          <div className="pv-mb-body">
            <div className="pv-mb-title">
              {migratedCount} annotation{migratedCount !== 1 ? 's' : ''} migrated
            </div>
            <div className="pv-mb-sub">
              Director's proposal. You have final say.
            </div>
            <div className="pv-mb-actions">
              <button className="primary" onClick={() => setShowMigBanner(false)}>Keep all</button>
              <button onClick={() => setShowMigBanner(false)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Back button */}
      <Link className="pv-back" to={`/charts/${chartId}/versions/${vId}`}>
        &lsaquo; {chartName}
      </Link>

      {/* Pills: Ask + Tools */}
      <div className="pv-pills">
        <button className="pv-pill ask" onClick={() => setAskOpen(true)}>
          <span className="pv-pill-glyph">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M 3 3 H 13 A 1.6 1.6 0 0 1 14.6 4.6 V 9.5 A 1.6 1.6 0 0 1 13 11.1 H 7.6 L 5 14 L 5.7 11.1 H 3 A 1.6 1.6 0 0 1 1.4 9.5 V 4.6 A 1.6 1.6 0 0 1 3 3 Z" />
              <line x1="4.5" y1="6.3" x2="11.4" y2="6.3" strokeWidth="1.1" strokeLinecap="round" />
              <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </span>
          <span className="pv-pill-label">Ask</span>
          <span className="pv-pill-kbd">/</span>
        </button>
        <button className="pv-pill tools" onClick={() => setRevealed(true)}>
          <span className="pv-pill-glyph">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
              <path d="M 11 2.5 L 13.5 5 L 5 13.5 L 2 14 L 2.5 11 Z" />
              <line x1="9.5" y1="4" x2="12" y2="6.5" />
            </svg>
          </span>
          <span className="pv-pill-label">Tools</span>
          <span className="pv-pill-kbd">T</span>
        </button>
      </div>

      {/* Title block */}
      <div className={`pv-title-block${!showDiffBanner ? ' no-banner' : ''}`}>
        <h1>{chartName}</h1>
        <div className="pv-meta">{part.name} &middot; {version.name}</div>
      </div>

      {/* Main content: PDF viewer */}
      <div className="pv-content">
        <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.15s ease' }}>
          <PdfViewer
            url={`/parts/${pId}/pdf`}
            partId={pId!}
            title={`${part.name} — ${version.name}`}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="pv-footer">
        <span>page {currentPage}</span>
        <span>{part.name}</span>
      </div>

      {/* Page-turn zones */}
      <div
        className="pv-turnzone left"
        title="Previous page"
        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
      />
      <div
        className="pv-turnzone right"
        title="Next page"
        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
      />

      {/* Ask palette overlay */}
      {askPalette}
    </div>
  );
}
