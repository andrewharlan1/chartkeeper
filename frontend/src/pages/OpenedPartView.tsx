import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { getPart } from '../api/parts';
import { getPartDiff, PartDiffData } from '../api/parts';
import { getVersion } from '../api/versions';
import { getChart } from '../api/charts';
import { getAnnotations } from '../api/annotations';
import { getEvent, EventChart } from '../api/events';
import { Part, Version, MeasureBounds, Annotation } from '../types';
import { InlinePdfRenderer } from '../components/InlinePdfRenderer';
import { MigrationProgressBadge } from '../components/MigrationProgressBadge';
import { useAnnotationMode, AnnotationMode } from '../hooks/useAnnotationMode';
import './PlayerView.css';

type ToolId = 'pen' | 'highlight' | 'text' | 'eraser';

const TOOL_TO_MODE: Record<ToolId, AnnotationMode> = {
  pen: 'ink', highlight: 'highlight', text: 'text', eraser: 'erase',
};
const MODE_TO_TOOL: Partial<Record<AnnotationMode, ToolId>> = {
  ink: 'pen', highlight: 'highlight', text: 'text', erase: 'eraser',
};

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

  // Annotation state — single source of truth
  const annState = useAnnotationMode();

  // View mode
  const [revealed, setRevealed] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askQuery, setAskQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoom, setZoom] = useState(100); // 50–200
  const [darkScore, setDarkScore] = useState(false);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);

  // Derived: active tool and color from annotation state
  const activeTool: ToolId = MODE_TO_TOOL[annState.mode] ?? 'pen';
  const activeColor = annState.inkColor;

  const setActiveTool = useCallback((tool: ToolId) => {
    annState.setMode(TOOL_TO_MODE[tool]);
  }, [annState]);

  const setActiveColor = useCallback((color: string) => {
    annState.setInkColor(color);
  }, [annState]);

  // Compute the effective annotation mode: read when in resting state, tool mode when revealed
  const effectiveAnnotationMode: AnnotationMode = revealed ? annState.mode : 'read';

  // When entering edit mode, activate the current tool; when leaving, go to read
  const toggleRevealed = useCallback((next: boolean) => {
    setRevealed(next);
    if (next) {
      // Entering edit mode — activate the current tool (default to ink/pen)
      if (annState.mode === 'read') annState.setMode('ink');
    } else {
      annState.setMode('read');
    }
  }, [annState]);

  // Banner state
  const [showDiffBanner, setShowDiffBanner] = useState(false);
  const [showMigBanner, setShowMigBanner] = useState(false);
  const [diffBannerCollapsed, setDiffBannerCollapsed] = useState(false);

  // Auto-hide chrome (resting state only)
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawingRef = useRef(false); // true when pointer is down on canvas
  const diffBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Auto-hide chrome (resting state) ──────────────────────────────────
  const resetIdleTimer = useCallback(() => {
    if (drawingRef.current) return; // don't reset while drawing
    setChromeVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setChromeVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (revealed) {
      // In edit mode, chrome is always visible (managed by rail/topbar)
      setChromeVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    // Start idle timer for resting state
    resetIdleTimer();
    const onActivity = () => resetIdleTimer();
    document.addEventListener('mousemove', onActivity);
    document.addEventListener('keydown', onActivity);
    document.addEventListener('touchstart', onActivity);
    return () => {
      document.removeEventListener('mousemove', onActivity);
      document.removeEventListener('keydown', onActivity);
      document.removeEventListener('touchstart', onActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [revealed, resetIdleTimer]);

  // Pause idle timer during active drawing
  const handlePointerDown = useCallback(() => {
    drawingRef.current = true;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  }, []);
  const handlePointerUp = useCallback(() => {
    drawingRef.current = false;
    resetIdleTimer();
  }, [resetIdleTimer]);

  // ── Diff banner → collapsed badge after 5 seconds ────────────────────
  useEffect(() => {
    if (showDiffBanner && !diffBannerCollapsed) {
      diffBannerTimerRef.current = setTimeout(() => setDiffBannerCollapsed(true), 5000);
      return () => { if (diffBannerTimerRef.current) clearTimeout(diffBannerTimerRef.current); };
    }
  }, [showDiffBanner, diffBannerCollapsed]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Escape closes Ask palette
    if (e.key === 'Escape' && askOpen) {
      setAskOpen(false);
      setAskQuery('');
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Cmd/Ctrl zoom (prevent browser zoom)
    if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setZoom(z => Math.min(400, z + 25));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '-') {
      e.preventDefault();
      setZoom(z => Math.max(25, z - 25));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault();
      setZoom(100);
      return;
    }
    if (e.key === 't' || e.key === 'T') {
      toggleRevealed(!revealed);
    } else if (e.key === '/') {
      e.preventDefault();
      setAskOpen(true);
    } else if (e.key === '=' || e.key === '+') {
      setZoom(z => Math.min(400, z + 25));
    } else if (e.key === '-') {
      setZoom(z => Math.max(25, z - 25));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      setCurrentPage(p => Math.min(totalPages, p + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      setCurrentPage(p => Math.max(1, p - 1));
    }
  }, [askOpen, totalPages, revealed, toggleRevealed]);

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

  // Transform string-keyed bounds to number-keyed for the renderer
  const numericBounds: Record<number, MeasureBounds> | undefined = diffData?.changedMeasureBounds
    ? Object.fromEntries(
        Object.entries(diffData.changedMeasureBounds).map(([k, v]) => [Number(k), v])
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
            <kbd>Enter</kbd> to submit · <kbd>Esc</kbd> to close
          </span>
          <span className="pv-pal-grow" />
        </div>
      </div>
    </>
  );

  // The InlinePdfRenderer is shared between both modes
  const pdfRenderer = pId ? (
    <InlinePdfRenderer
      partId={pId}
      pdfUrl={`/parts/${pId}/pdf`}
      currentPage={currentPage}
      zoomPercent={zoom}
      darkScore={darkScore}
      annotationsVisible={annotationsVisible}
      showDiffHighlights={true}
      versionId={vId}
      changedMeasureBounds={numericBounds}
      notesOpen={notesOpen}
      onPageCount={setTotalPages}
      onZoomChange={setZoom}
      annotationMode={effectiveAnnotationMode}
      inkColor={annState.inkColor}
      onInkColorChange={annState.setInkColor}
      textColor={annState.textColor}
      onTextColorChange={annState.setTextColor}
      highlightColor={annState.highlightColor}
      onHighlightColorChange={annState.setHighlightColor}
      fontSize={annState.fontSize}
      fontFamily={annState.fontFamily}
      selectedAnnotationId={annState.selectedAnnotationId}
      onSelectionChange={annState.setSelectedAnnotationId}
    />
  ) : null;

  const hasDiffStrip = !!(revealed && diffData && diffData.changedMeasures.length > 0);

  // Shortened version name for badge (resting state)
  const badgeLabel = diffData
    ? `${diffData.comparedToVersionName || 'prev'} · ${diffData.changedMeasures.length}\u2193`
    : '';

  // ── Single return — pdfRenderer always at stable tree position (child 0) ──
  return (
    <div
      className={`pv${revealed ? ' revealed' : ''}${hasDiffStrip ? ' has-strip' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* PDF content — always first child, stable React tree position */}
      <div className="pv-content">
        {pdfRenderer}
      </div>

      {/* ── Revealed chrome (annotation mode) ── */}
      {revealed && (
        <>
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
            {vId && (
              <MigrationProgressBadge
                versionId={vId}
                onComplete={() => {
                  // Auto-reload annotations when migration completes
                  if (pId) {
                    getAnnotations(pId).then(res => setAnnotations(res.annotations)).catch(() => {});
                  }
                }}
              />
            )}
            <span className="pv-tb-grow" />
            <div className="pv-tb-group">
              <span className="pv-tb-lbl">mode</span>
              <button className="pv-tbtn on">Edit</button>
              <button className="pv-tbtn" onClick={() => toggleRevealed(false)}>View</button>
            </div>
            <div className="pv-tb-group">
              <button
                className={`pv-tbtn${darkScore ? ' on' : ''}`}
                onClick={() => setDarkScore(v => !v)}
                title={darkScore ? 'Light score' : 'Dark score'}
              >
                {darkScore ? 'Light' : 'Dark'}
              </button>
              <button
                className={`pv-tbtn${!annotationsVisible ? ' on' : ''}`}
                onClick={() => setAnnotationsVisible(v => !v)}
                title={annotationsVisible ? 'Hide annotations' : 'Show annotations'}
              >
                {annotationsVisible ? 'Hide ann.' : 'Show ann.'}
              </button>
              <button
                className={`pv-tbtn${notesOpen ? ' on' : ''}`}
                onClick={() => setNotesOpen(v => !v)}
              >
                Notes
              </button>
            </div>
            <button className="pv-tb-close" onClick={() => toggleRevealed(false)}>
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
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>‹</button>
              <span>pg {currentPage}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>›</button>
            </div>
            <div className="pv-fs-zoom">
              <button onClick={() => setZoom(z => Math.max(25, z - 25))}>−</button>
              <input
                type="range"
                min={25}
                max={400}
                step={25}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="pv-zoom-slider"
              />
              <button onClick={() => setZoom(z => Math.min(400, z + 25))}>+</button>
              <span className="pv-zoom-pct">{zoom}%</span>
            </div>
          </div>
        </>
      )}

      {/* ── Resting chrome (auto-hide) ── */}
      {!revealed && (
        <>
          <div className={`pv-chrome${chromeVisible ? '' : ' hidden'}`}>
            {/* Diff banner (full) — shown until collapsed or dismissed */}
            {showDiffBanner && diffData && !diffBannerCollapsed && (
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
                  ×
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
                    next: {eventCharts[eventPosition + 1].chartName} ›
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
              ‹ {chartName}
            </Link>

            {/* Title overlay (floating, centered) */}
            <div className="pv-title-overlay">
              <h1>{chartName}</h1>
              <div className="pv-meta">{part.name} · {version.name}</div>
            </div>

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
              <button className="pv-pill tools" onClick={() => toggleRevealed(true)}>
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
          </div>

          {/* Diff badge pill (collapsed banner — always visible, outside chrome wrapper) */}
          {showDiffBanner && diffData && diffBannerCollapsed && (
            <button
              className="pv-diff-badge"
              onClick={() => setDiffBannerCollapsed(false)}
              title="Expand diff banner"
            >
              <span className="pv-dbb-dot" />
              <span>{badgeLabel}</span>
            </button>
          )}

          <div className={`pv-chrome${chromeVisible ? '' : ' hidden'}`}>
            <div className="pv-footer">
              <span>page {currentPage} of {totalPages}</span>
              <span>{part.name}</span>
            </div>
          </div>

          {/* Page-turn zones (always active, outside chrome wrapper) */}
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
        </>
      )}

      {/* Ask palette overlay */}
      {askPalette}
    </div>
  );
}
