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

// Embedded web-page viewer for link-type parts
function WebViewer({ url, name }: { url: string; name: string }) {
  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', height: 420 }}>
      <div style={{
        padding: '6px 12px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap', marginLeft: 10 }}>
          Open ↗
        </a>
      </div>
      <iframe
        src={url}
        title={name}
        style={{ display: 'block', width: '100%', height: 'calc(100% - 33px)', border: 'none' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}

export function PlayerView() {
  const [parts, setParts] = useState<PlayerPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Track which chart cards are expanded (open by default)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getPlayerParts()
      .then(r => {
        setParts(r.parts);
        // Expand all charts by default
        const ids = new Set<string>(r.parts.map(p => p.chart_id));
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
              <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                {ensemble_name}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[...byChart.entries()].map(([chartId, chartParts]) => {
                  const { chart_title, version_name, version_number, version_id } = chartParts[0];
                  const isOpen = expanded.has(chartId);

                  return (
                    <div key={chartId} style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', overflow: 'hidden',
                    }}>
                      {/* Clickable chart header */}
                      <div
                        onClick={() => toggleChart(chartId)}
                        style={{
                          padding: '12px 18px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          cursor: 'pointer',
                          borderBottom: isOpen ? '1px solid var(--border)' : 'none',
                          background: isOpen ? 'var(--surface)' : 'var(--surface)',
                          userSelect: 'none',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 13, color: isOpen ? 'var(--accent)' : 'var(--text-muted)',
                            transition: 'transform 0.15s',
                            display: 'inline-block',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}>▶</span>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>
                              {chart_title ?? 'Untitled Chart'}
                            </span>
                            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                              {version_name ?? `Version ${version_number}`}
                            </span>
                          </div>
                        </div>
                        <Link
                          to={`/charts/${chartId}/versions/${version_id}`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}
                        >
                          Full version →
                        </Link>
                      </div>

                      {/* Parts — only shown when expanded */}
                      {isOpen && (
                        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {chartParts.map(p => (
                            <div key={p.assignment_id}>
                              <p style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                                {p.instrument_name}
                              </p>
                              {p.part_type === 'link' && p.url ? (
                                <WebViewer url={p.url} name={p.instrument_name} />
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
