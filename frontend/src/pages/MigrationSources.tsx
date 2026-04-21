import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getChart, getChartMigrationSources, MigrationSourceVersion } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { migrateFrom } from '../api/parts';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { InstrumentIcon } from '../components/InstrumentIcon';

export function MigrationSourcesPage() {
  const { id: chartId } = useParams<{ id: string }>();
  const [chartName, setChartName] = useState('');
  const [ensembleName, setEnsembleName] = useState('');
  const [ensembleId, setEnsembleId] = useState('');
  const [versions, setVersions] = useState<MigrationSourceVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [migratingFrom, setMigratingFrom] = useState<string | null>(null);
  const [migrateResult, setMigrateResult] = useState<Record<string, { migrated: number; flagged: number } | 'error'>>({});

  useEffect(() => {
    if (!chartId) return;
    Promise.all([
      getChart(chartId),
      getChartMigrationSources(chartId),
    ]).then(async ([{ chart }, { versions: v }]) => {
      setChartName(chart.name);
      setVersions(v);
      try {
        const { ensemble } = await getEnsemble(chart.ensembleId);
        setEnsembleName(ensemble.name);
        setEnsembleId(chart.ensembleId);
      } catch { /* partial breadcrumb */ }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [chartId]);

  // Current version is the most recent (first in list)
  const currentVersion = versions[0];
  const sourceVersions = versions.slice(1);

  async function handleMigrate(sourcePartId: string, targetPartId: string) {
    setMigratingFrom(sourcePartId);
    try {
      const result = await migrateFrom(targetPartId, sourcePartId);
      setMigrateResult(prev => ({ ...prev, [sourcePartId]: { migrated: result.migratedCount, flagged: result.flaggedCount } }));
    } catch {
      setMigrateResult(prev => ({ ...prev, [sourcePartId]: 'error' }));
    } finally {
      setMigratingFrom(null);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;

  return (
    <Layout
      title={`Migration Sources — ${chartName}`}
      backTo={`/charts/${chartId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${ensembleId}` }] : []),
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: 'Migration Sources' },
      ]}
    >
      {/* Current version */}
      {currentVersion && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>
            Current version: {currentVersion.versionName}
          </h2>
          {currentVersion.parts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No parts in current version.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {currentVersion.parts.map(p => (
                <div key={p.partId} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <InstrumentIcon name={p.instrumentIcon} size={20} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{p.instrumentName}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {p.annotationCount} annotation{p.annotationCount !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Available sources */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>Available sources</h2>
        {sourceVersions.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No previous versions with annotations.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {sourceVersions.filter(v => v.parts.some(p => p.annotationCount > 0)).map(v => (
              <div key={v.versionId}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                  {v.versionName}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {v.parts.filter(p => p.annotationCount > 0).map(p => {
                    const result = migrateResult[p.partId];
                    // Find matching target in current version
                    const target = currentVersion?.parts.find(cp =>
                      cp.instrumentName.toLowerCase() === p.instrumentName.toLowerCase()
                    );

                    return (
                      <div key={p.partId} style={{
                        padding: '12px 16px',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <InstrumentIcon name={p.instrumentIcon} size={22} />
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{p.instrumentName}</span>
                            <span style={{
                              fontSize: 11, padding: '2px 7px',
                              background: 'var(--accent-subtle)', border: '1px solid rgba(124,106,245,0.3)',
                              borderRadius: 99, color: 'var(--accent)',
                            }}>
                              {p.annotationCount} annotation{p.annotationCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {target && !result && (
                            <Button
                              size="sm"
                              loading={migratingFrom === p.partId}
                              onClick={() => handleMigrate(p.partId, target.partId)}
                            >
                              Migrate to current version
                            </Button>
                          )}
                          {result && result !== 'error' && (
                            <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                              Migrated {result.migrated}{result.flagged > 0 ? ` (${result.flagged} flagged)` : ''}
                            </span>
                          )}
                          {result === 'error' && (
                            <span style={{ fontSize: 12, color: 'var(--danger)' }}>Migration failed</span>
                          )}
                          {!target && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              No matching instrument in current version
                            </span>
                          )}
                        </div>
                        {/* Annotation previews */}
                        {p.annotationPreview.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {p.annotationPreview.map((preview, i) => (
                              <span key={i} style={{
                                fontSize: 11, padding: '2px 6px',
                                background: 'var(--bg)', border: '1px solid var(--border)',
                                borderRadius: 4, color: 'var(--text-muted)',
                              }}>
                                {preview.measureNumber != null ? `m.${preview.measureNumber} ` : ''}
                                {preview.content ? `"${preview.content.slice(0, 20)}${preview.content.length > 20 ? '...' : ''}"` : preview.kind}
                              </span>
                            ))}
                            {p.annotationCount > 3 && (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                +{p.annotationCount - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
