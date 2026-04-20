import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyParts } from '../api/parts';
import { PlayerPart } from '../types';
import { Layout } from '../components/Layout';
import { PdfViewer } from '../components/PdfViewer';

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export function PlayerView() {
  const [parts, setParts] = useState<PlayerPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getMyParts()
      .then(r => {
        setParts(r.parts);
        const ids = new Set<string>(r.parts.map((p: PlayerPart) => p.chartId));
        setExpanded(ids);
      })
      .catch(() => setError('Could not load your parts.'))
      .finally(() => setLoading(false));
  }, []);

  function toggleChart(chartId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(chartId)) next.delete(chartId);
      else next.add(chartId);
      return next;
    });
  }

  if (loading) return <Layout title="My Parts"><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;

  if (error) return (
    <Layout title="My Parts">
      <p style={{ color: 'var(--danger)' }}>{error}</p>
    </Layout>
  );

  if (parts.length === 0) return (
    <Layout title="My Parts">
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
        <p style={{ marginBottom: 8 }}>No parts yet.</p>
        <p style={{ fontSize: 13 }}>Upload parts to see them here.</p>
      </div>
    </Layout>
  );

  const byEnsemble = groupBy(parts, p => p.ensembleId);

  return (
    <Layout title="My Parts">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {[...byEnsemble.entries()].map(([, ensembleParts]) => {
          const { ensembleName } = ensembleParts[0];
          const byChart = groupBy(ensembleParts, p => p.chartId);

          return (
            <section key={ensembleName}>
              <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                {ensembleName}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[...byChart.entries()].map(([chartId, chartParts]) => {
                  const { chartName, versionName, versionId } = chartParts[0];
                  const isOpen = expanded.has(chartId);

                  return (
                    <div key={chartId} style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', overflow: 'hidden',
                    }}>
                      <div
                        onClick={() => toggleChart(chartId)}
                        style={{
                          padding: '12px 18px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderBottom: isOpen ? '1px solid var(--border)' : 'none',
                          userSelect: 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 13, color: isOpen ? 'var(--accent)' : 'var(--text-muted)',
                            transition: 'transform 0.15s',
                            display: 'inline-block',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}>{'\u25B6'}</span>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>
                              {chartName ?? 'Untitled Chart'}
                            </span>
                            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                              {versionName}
                            </span>
                          </div>
                        </div>
                        <Link
                          to={`/charts/${chartId}/versions/${versionId}`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}
                        >
                          Full version {'\u2192'}
                        </Link>
                      </div>

                      {isOpen && (
                        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {chartParts.map(p => (
                            <div key={p.partId}>
                              <p style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                                {p.partName}
                              </p>
                              <PdfViewer
                                url={`/parts/${p.partId}/pdf`}
                                title={`${p.partName} — ${versionName}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Layout>
  );
}
