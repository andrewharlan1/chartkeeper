import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPart, getParts } from '../api/parts';
import { getVersions } from '../api/versions';
import { getChart } from '../api/charts';
import { Part } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import './PlayerHistory.css';

interface HistoryEntry {
  versionId: string;
  versionName: string;
  createdAt: string;
  kind: 'current' | 'changed' | 'added' | 'carried' | 'ghost';
  description: string;
  isCurrent: boolean;
}

export function PartHistoryPage() {
  const { id: chartId, vId, pId } = useParams<{ id: string; vId: string; pId: string }>();

  const [part, setPart] = useState<Part | null>(null);
  const [chartName, setChartName] = useState('');
  const [currentVersionName, setCurrentVersionName] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pId || !vId || !chartId) return;

    Promise.all([
      getPart(pId),
      getChart(chartId),
      getVersions(chartId),
    ]).then(async ([{ part: p }, { chart }, { versions }]) => {
      setPart(p);
      setChartName(chart.name);

      const sorted = [...versions].sort((a, b) => b.sortOrder - a.sortOrder);
      const currentVer = sorted.find(v => v.id === vId);
      setCurrentVersionName(currentVer?.name || '');

      // Build history entries by checking which versions have this part's instrument
      const historyEntries: HistoryEntry[] = [];

      for (const ver of sorted) {
        try {
          const { parts } = await getParts(ver.id);
          const matchingPart = parts.find(pp => pp.name === p.name);

          if (matchingPart) {
            const isViewedVersion = ver.id === vId;
            historyEntries.push({
              versionId: ver.id,
              versionName: ver.name,
              createdAt: ver.createdAt,
              kind: isViewedVersion ? 'current' : 'carried',
              description: isViewedVersion ? 'currently viewing' : 'part exists in this version',
              isCurrent: isViewedVersion,
            });
          } else {
            historyEntries.push({
              versionId: ver.id,
              versionName: ver.name,
              createdAt: ver.createdAt,
              kind: 'ghost',
              description: `${p.name} didn't exist yet`,
              isCurrent: false,
            });
          }
        } catch {
          historyEntries.push({
            versionId: ver.id,
            versionName: ver.name,
            createdAt: ver.createdAt,
            kind: 'ghost',
            description: 'could not load',
            isCurrent: false,
          });
        }
      }

      setEntries(historyEntries);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, [pId, vId, chartId]);

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!part) return null;

  return (
    <Layout
      title={`${part.name} — History`}
      backTo={`/charts/${chartId}/versions/${vId}/parts/${pId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: currentVersionName, to: `/charts/${chartId}/versions/${vId}` },
        { label: part.name, to: `/charts/${chartId}/versions/${vId}/parts/${pId}` },
        { label: 'History' },
      ]}
    >
      <div className="history-shell">
        {/* Preview pane */}
        <div className="history-preview">
          <div className="hp-label">
            Showing &middot; {part.name} at {currentVersionName}
          </div>
          <h2>{chartName}</h2>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 24, minHeight: 300,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            {/* Decorative score representation */}
            {[0, 1, 2, 3].map(sys => (
              <div key={sys} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
                {[0, 1, 2, 3, 4].map(line => (
                  <div key={line} style={{ height: 1, background: 'var(--text-muted)', opacity: 0.25 }} />
                ))}
              </div>
            ))}
            <div style={{
              textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 10,
              color: 'var(--text-faint)', marginTop: 'auto',
            }}>
              page 1 &middot; {part.name.toLowerCase().replace(/ /g, '')}.pdf
            </div>
          </div>
        </div>

        {/* History rail */}
        <div className="history-rail">
          <div className="hr-title">Version history &middot; {part.name}</div>

          {entries.map((entry, i) => (
            <div
              key={entry.versionId}
              className={
                'h-entry' +
                (entry.isCurrent ? ' cur' : '') +
                (entry.kind === 'ghost' ? ' ghost' : '') +
                (entry.kind === 'changed' ? ' changed' : '') +
                (entry.kind === 'added' ? ' added' : '')
              }
            >
              <div className="dot-col">
                <div className="he-dot" />
                {i < entries.length - 1 && <div className="he-line" />}
              </div>
              <div className="he-body">
                <div>
                  <span className="he-vlabel">{entry.versionName}</span>
                  <span className="he-when">
                    &middot; {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="he-desc">{entry.description}</div>
                {entry.kind !== 'ghost' && !entry.isCurrent && (
                  <div style={{ marginTop: 6 }}>
                    <Link to={`/charts/${chartId}/versions/${entry.versionId}`}>
                      <Button size="sm" variant="secondary">Open at {entry.versionName}</Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{
            marginTop: 16, padding: '10px 12px',
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)',
            borderTop: '1px solid var(--border)',
          }}>
            history is per-part &middot; scoped to {part.name}
          </div>
        </div>
      </div>
    </Layout>
  );
}
