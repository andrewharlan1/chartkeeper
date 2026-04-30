import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { getPart } from '../api/parts';
import { getVersion } from '../api/versions';
import { getChart } from '../api/charts';
import { getAnnotations } from '../api/annotations';
import { getEvent, EventChart } from '../api/events';
import { Part, Version, Annotation } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { PdfViewer } from '../components/PdfViewer';
import './PlayerHistory.css';
import './MyParts.css';

export function OpenedPartView() {
  const { id: chartId, vId, pId } = useParams<{ id: string; vId: string; pId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get('event');

  const [part, setPart] = useState<Part | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [chartName, setChartName] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(false);

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
    ]).then(([{ part: p }, { version: v }, { chart }, { annotations: anns }]) => {
      setPart(p);
      setVersion(v);
      setChartName(chart.name);
      setAnnotations(anns);
      // Show migration banner if there are migrated annotations
      const hasMigrated = anns.some(a =>
        (a.contentJson as Record<string, unknown>)?._needsReview === true
      );
      setShowBanner(hasMigrated);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [pId, vId, chartId]);

  // Load event context if navigated from event
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

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!part || !version) return null;

  const migratedCount = annotations.filter(a =>
    (a.contentJson as Record<string, unknown>)?._needsReview === true
  ).length;

  return (
    <Layout
      title={part.name}
      backTo={`/charts/${chartId}/versions/${vId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: version.name, to: `/charts/${chartId}/versions/${vId}` },
        { label: part.name },
      ]}
      actions={
        <>
          <Link to={`/charts/${chartId}/versions/${vId}/parts/${pId}/history`}>
            <Button size="sm" variant="secondary">History</Button>
          </Link>
          <Link to={`/charts/${chartId}/versions/${vId}/diff`}>
            <Button size="sm" variant="secondary">View diff</Button>
          </Link>
        </>
      }
    >
      <div className="player-frame">
        <div className="ipad-shell">
          <div className="ipad-screen">
            {/* iPad bar */}
            <div className="ipad-bar">
              <Link to={`/charts/${chartId}`} className="ib-crumb">
                &lsaquo; {chartName}
              </Link>
              <span style={{ color: 'var(--text-faint)' }}>&middot;</span>
              <span className="ib-part">
                <InstrumentIcon name={part.name} size={14} />
                {part.name}
              </span>
              <span className="ib-ver">{version.name}</span>
              <div className="ib-right">
                <span className="ib-sync">
                  <span className="ib-sync-dot" />
                  synced
                </span>
              </div>
            </div>

            {/* Event context bar */}
            {eventId && eventName && eventCharts.length > 0 && (
              <div className="event-ctx-bar">
                <span className="ecb-pill">setlist</span>
                <span className="ecb-name">{eventName}</span>
                <span className="ecb-pos">{eventPosition + 1} of {eventCharts.length}</span>
                {eventPosition < eventCharts.length - 1 && (
                  <button
                    className="ecb-next"
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
            {showBanner && migratedCount > 0 && (
              <div className="mig-banner">
                <div className="mb-icon">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 8 a5 5 0 0 1 10 0" />
                    <path d="M13 8 L15 6 M13 8 L11 6" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="mb-body">
                  <div className="mb-title">
                    {migratedCount} annotation{migratedCount !== 1 ? 's' : ''} migrated
                  </div>
                  <div className="mb-sub">
                    Director's proposal. You have final say &mdash; keep, hide, or delete per annotation.
                  </div>
                  <div className="mb-actions">
                    <Button size="sm" onClick={() => setShowBanner(false)}>Keep all</Button>
                    <Button size="sm" variant="secondary" onClick={() => setShowBanner(false)}>Dismiss</Button>
                  </div>
                </div>
              </div>
            )}

            {/* Main content area — PDF viewer */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div className="score-page-area">
                <PdfViewer
                  url={`/parts/${pId}/pdf`}
                  partId={pId!}
                  title={`${part.name} — ${version.name}`}
                />
              </div>
            </div>

            {/* Page turn bar */}
            <div className="page-turn-bar">
              <button>&lsaquo; prev</button>
              <span>page 1</span>
              <button>next &rsaquo;</button>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>
                foot pedal: space / arrow keys
              </span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
