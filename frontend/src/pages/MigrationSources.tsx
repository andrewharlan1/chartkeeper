import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChart, getChartMigrationSources, MigrationSourceVersion } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { migrateFrom } from '../api/parts';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { InstrumentIcon } from '../components/InstrumentIcon';
import './Upload.css';

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
      title="Configure Migrations"
      backTo={`/charts/${chartId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${ensembleId}` }] : []),
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: 'Migration Sources' },
      ]}
    >
      <div className="mig-review-head">
        <div className="mr-step">Step 2 of 2 &middot; upload &rarr; migrate &rarr; publish</div>
        <h1>Configure migrations</h1>
        <p>
          Each new part can pull annotations from a source. Defaults shown.
          Players can override per-annotation later.
        </p>
      </div>

      {/* Current version parts */}
      {currentVersion && currentVersion.parts.length > 0 && (
        <div className="mig-review-card" style={{ marginBottom: 24 }}>
          <div className="mr-header">
            <span></span>
            <span>Current part</span>
            <span>Migrate from</span>
            <span style={{ textAlign: 'right' }}>Annot.</span>
          </div>
          {currentVersion.parts.map(p => {
            return (
              <div className="mig-review-row" key={p.partId}>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <InstrumentIcon name={p.instrumentIcon} size={22} />
                </span>
                <div className="mr-name-cell">
                  <div className="mr-name">{p.instrumentName}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Show source options from previous versions */}
                  {sourceVersions.filter(v => v.parts.some(sp => sp.annotationCount > 0)).map(v =>
                    v.parts.filter(sp => sp.annotationCount > 0).map(sp => {
                      const isMatch = sp.instrumentName.toLowerCase() === p.instrumentName.toLowerCase();
                      const sourceResult = migrateResult[sp.partId];
                      return (
                        <div key={sp.partId} className={'mr-source-opt' + (isMatch ? ' selected' : '')}>
                          <InstrumentIcon name={sp.instrumentIcon} size={14} />
                          <span style={{ fontWeight: isMatch ? 500 : 400, color: isMatch ? 'var(--text)' : 'var(--text-muted)' }}>
                            {sp.instrumentName} &middot; {v.versionName}
                          </span>
                          <span className="mr-opt-meta">{sp.annotationCount} ann.</span>
                          {isMatch && !sourceResult && (
                            <Button
                              size="sm"
                              loading={migratingFrom === sp.partId}
                              onClick={() => handleMigrate(sp.partId, p.partId)}
                            >
                              Migrate
                            </Button>
                          )}
                          {sourceResult && sourceResult !== 'error' && (
                            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                              {sourceResult.migrated} migrated
                            </span>
                          )}
                          {sourceResult === 'error' && (
                            <span style={{ fontSize: 11, color: 'var(--danger, #e53e3e)' }}>failed</span>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div className="mr-source-opt">
                    <span style={{ width: 14, display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-muted)' }}>No migration</span>
                    <span className="mr-opt-meta">clean part</span>
                  </div>
                </div>
                <div className="mr-annot-count">{p.annotationCount}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Link to={`/charts/${chartId}/upload`}>
          <Button variant="secondary">&lsaquo; Back to upload</Button>
        </Link>
      </div>
    </Layout>
  );
}
