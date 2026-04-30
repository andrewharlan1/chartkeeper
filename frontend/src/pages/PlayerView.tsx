import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyParts } from '../api/parts';
import { getMyEvents, MyEvent } from '../api/events';
import { PlayerPart } from '../types';
import { Layout } from '../components/Layout';
import { InstrumentIcon } from '../components/InstrumentIcon';
import './MyParts.css';

type Pivot = 'chart' | 'ensemble' | 'event';

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function PartRow({ p }: { p: PlayerPart }) {
  return (
    <Link
      to={`/charts/${p.chartId}/versions/${p.versionId}/parts/${p.partId}`}
      className="mp-row"
    >
      <div className="mp-icon">
        <InstrumentIcon name={p.partName} size={20} />
      </div>
      <div className="mp-info">
        <div className="mp-name">{p.partName}</div>
        <div className="mp-sub">{p.chartName}</div>
      </div>
      <span className="mp-version">{p.versionName}</span>
    </Link>
  );
}

export function PlayerView() {
  const [parts, setParts] = useState<PlayerPart[]>([]);
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pivot, setPivot] = useState<Pivot>('chart');

  useEffect(() => {
    Promise.all([
      getMyParts().catch(() => ({ parts: [] as PlayerPart[] })),
      getMyEvents().catch(() => ({ events: [] as MyEvent[] })),
    ]).then(([partsRes, eventsRes]) => {
      setParts(partsRes.parts);
      setEvents(eventsRes.events);
    }).catch(() => setError('Could not load your parts.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <Layout title="My Parts" backTo="/" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My Parts' }]}>
      <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="My Parts" backTo="/" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My Parts' }]}>
      <p style={{ color: 'var(--danger)' }}>{error}</p>
    </Layout>
  );

  return (
    <Layout title="My Parts" backTo="/" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'My Parts' }]}>
      {/* Pivot tabs */}
      <div className="my-parts-tabs">
        <button className={pivot === 'chart' ? 'active' : ''} onClick={() => setPivot('chart')}>
          By chart
        </button>
        <button className={pivot === 'ensemble' ? 'active' : ''} onClick={() => setPivot('ensemble')}>
          By ensemble
        </button>
        <button className={pivot === 'event' ? 'active' : ''} onClick={() => setPivot('event')}>
          By event
        </button>
      </div>

      {parts.length === 0 ? (
        <div className="mp-empty">
          <p>No parts yet.</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Parts assigned to you will appear here.</p>
        </div>
      ) : (
        <>
          {pivot === 'chart' && <ByChartView parts={parts} />}
          {pivot === 'ensemble' && <ByEnsembleView parts={parts} />}
          {pivot === 'event' && <ByEventView parts={parts} events={events} />}
        </>
      )}
    </Layout>
  );
}

function ByChartView({ parts }: { parts: PlayerPart[] }) {
  const byChart = groupBy(parts, p => p.chartId);
  return (
    <div>
      {[...byChart.entries()].map(([chartId, chartParts]) => (
        <div className="mp-group" key={chartId}>
          <div className="mp-group-head">
            {chartParts[0].chartName}
            <span className="mp-group-sub">{chartParts[0].versionName}</span>
          </div>
          {chartParts.map(p => <PartRow key={p.partId} p={p} />)}
        </div>
      ))}
    </div>
  );
}

function ByEnsembleView({ parts }: { parts: PlayerPart[] }) {
  const byEnsemble = groupBy(parts, p => p.ensembleId);
  return (
    <div>
      {[...byEnsemble.entries()].map(([ensembleId, ensembleParts]) => {
        const byChart = groupBy(ensembleParts, p => p.chartId);
        return (
          <div className="mp-group" key={ensembleId}>
            <div className="mp-group-head">{ensembleParts[0].ensembleName}</div>
            {[...byChart.entries()].map(([chartId, chartParts]) => (
              <div key={chartId} style={{ marginBottom: 16 }}>
                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)',
                  marginBottom: 6, letterSpacing: '0.04em',
                }}>
                  {chartParts[0].chartName} &middot; {chartParts[0].versionName}
                </div>
                {chartParts.map(p => <PartRow key={p.partId} p={p} />)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ByEventView({ parts, events }: { parts: PlayerPart[]; events: MyEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="mp-empty">
        <p>No upcoming events.</p>
        <p style={{ fontSize: 13, marginTop: 6 }}>Charts in event setlists will appear here grouped by event.</p>
      </div>
    );
  }

  // Build a chart→parts lookup
  const partsByChart = groupBy(parts, p => p.chartId);

  const now = Date.now();
  const sortedEvents = [...events].sort((a, b) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  return (
    <div>
      {sortedEvents.map(event => {
        const past = new Date(event.startsAt).getTime() < now;
        return (
          <div className="mp-group" key={event.id}>
            <div className="mp-event-head">
              <span className={`mp-event-pill${past ? ' past' : ''}`}>
                {past ? 'past' : 'upcoming'}
              </span>
              <span className="mp-event-name">{event.name}</span>
              <span className="mp-event-meta">
                {new Date(event.startsAt).toLocaleDateString()}
              </span>
            </div>
            {event.charts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
                No charts in setlist
              </div>
            ) : (
              event.charts
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((ec, i) => {
                  const myParts = partsByChart.get(ec.chartId) || [];
                  return (
                    <div key={ec.chartId} style={{ marginBottom: 12 }}>
                      <div style={{
                        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)',
                        marginBottom: 4, letterSpacing: '0.04em',
                      }}>
                        {i + 1}. {ec.chartName}
                      </div>
                      {myParts.length > 0 ? (
                        myParts.map(p => (
                          <Link
                            key={p.partId}
                            to={`/charts/${p.chartId}/versions/${p.versionId}/parts/${p.partId}?event=${event.id}`}
                            className="mp-row"
                          >
                            <div className="mp-icon">
                              <InstrumentIcon name={p.partName} size={20} />
                            </div>
                            <div className="mp-info">
                              <div className="mp-name">{p.partName}</div>
                              <div className="mp-sub">{p.chartName}</div>
                            </div>
                            <span className="mp-version">{p.versionName}</span>
                          </Link>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 14px' }}>
                          no assigned parts
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        );
      })}
    </div>
  );
}
