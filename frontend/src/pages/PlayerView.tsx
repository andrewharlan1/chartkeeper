import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlayerParts } from '../api/charts';
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

  useEffect(() => {
    getPlayerParts()
      .then(r => setParts(r.parts))
      .catch(() => setError('Could not load your parts.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Layout title="My Parts"><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;

  if (error) return (
    <Layout title="My Parts">
      <p style={{ color: 'var(--danger)' }}>{error}</p>
    </Layout>
  );

  if (parts.length === 0) return (
    <Layout title="My Parts">
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
        <p style={{ marginBottom: 8 }}>No parts assigned to you yet.</p>
        <p style={{ fontSize: 13 }}>Ask your band leader to assign you to a part.</p>
      </div>
    </Layout>
  );

  // Group by ensemble → chart
  const byEnsemble = groupBy(parts, p => p.ensemble_id);

  return (
    <Layout title="My Parts">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {[...byEnsemble.entries()].map(([, ensembleParts]) => {
          const { ensemble_name } = ensembleParts[0];
          const byChart = groupBy(ensembleParts, p => p.chart_id);

          return (
            <section key={ensemble_name}>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: 'var(--text-muted)', fontWeight: 500 }}>
                {ensemble_name}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {[...byChart.entries()].map(([chartId, chartParts]) => {
                  const { chart_title, version_name, version_number, version_id } = chartParts[0];
                  return (
                    <div key={chartId} style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', overflow: 'hidden',
                    }}>
                      {/* Chart header */}
                      <div style={{
                        padding: '12px 18px', borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>
                            {chart_title ?? 'Untitled Chart'}
                          </span>
                          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                            {version_name ?? `Version ${version_number}`}
                          </span>
                        </div>
                        <Link
                          to={`/charts/${chartId}/versions/${version_id}`}
                          style={{ fontSize: 12, color: 'var(--accent)' }}
                        >
                          Full version →
                        </Link>
                      </div>

                      {/* Parts */}
                      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {chartParts.map(p => (
                          <div key={p.assignment_id}>
                            <p style={{ fontWeight: 500, marginBottom: 10 }}>{p.instrument_name}</p>
                            {p.part_type === 'link' && p.url ? (
                              <div>
                                <a href={p.url} target="_blank" rel="noopener noreferrer"
                                  style={{ color: 'var(--accent)', fontSize: 13 }}>
                                  {p.url}
                                </a>
                              </div>
                            ) : p.part_type === 'audio' && p.pdf_url ? (
                              <audio controls style={{ width: '100%' }}
                                src={`/api${p.pdf_url}?token=${localStorage.getItem('token') ?? ''}`} />
                            ) : p.pdf_url ? (
                              <PdfViewer
                                url={p.pdf_url}
                                title={`${p.instrument_name} — ${version_name}`}
                              />
                            ) : (
                              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>File not available</p>
                            )}
                          </div>
                        ))}
                      </div>
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
