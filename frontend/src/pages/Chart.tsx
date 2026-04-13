import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChart, getVersions, restoreVersion } from '../api/charts';
import { useAuth } from '../hooks/useAuth';
import { Chart as ChartType, ChartVersion } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { ApiError } from '../api/client';

function hasInProgressOmr(versions: ChartVersion[]): boolean {
  return versions.some(v =>
    v.parts.some(p => p.omrStatus === 'pending' || p.omrStatus === 'processing')
  );
}

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [chart, setChart] = useState<ChartType | null>(null);
  const [versions, setVersions] = useState<ChartVersion[]>([]);
  const [ensembleId, setEnsembleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');

  const loadVersions = useCallback(async () => {
    if (!id) return;
    const res = await getVersions(id);
    setVersions(res.versions);
    return res.versions;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    Promise.all([getChart(id), loadVersions()]).then(([chartRes]) => {
      setChart(chartRes.chart);
      setEnsembleId(chartRes.chart.ensemble_id);
    }).finally(() => setLoading(false));
  }, [id, loadVersions]);

  // Poll while any OMR jobs are in progress
  useEffect(() => {
    if (!hasInProgressOmr(versions)) return;
    const timer = setInterval(() => { loadVersions(); }, 5000);
    return () => clearInterval(timer);
  }, [versions, loadVersions]);

  async function handleRestore(versionId: string) {
    if (!id) return;
    if (!confirm('Restore this version as active? Players will be notified.')) return;
    setRestoring(versionId);
    setRestoreError('');
    try {
      await restoreVersion(id, versionId);
      await loadVersions();
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : 'Failed to restore');
    } finally {
      setRestoring(null);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;
  if (!chart) return null;

  return (
    <Layout
      title={chart.title ?? 'Untitled'}
      back={{ label: 'Ensemble', to: `/ensembles/${ensembleId}` }}
      actions={
        <Link to={`/charts/${id}/upload`}>
          <Button size="sm">+ Upload new version</Button>
        </Link>
      }
    >
      {chart.composer && <p style={{ color: 'var(--text-muted)', marginTop: -20, marginBottom: 24 }}>by {chart.composer}</p>}

      {restoreError && <p className="form-error" style={{ marginBottom: 16 }}>{restoreError}</p>}

      {versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 16 }}>No versions yet.</p>
          <Link to={`/charts/${id}/upload`}><Button>Upload first version</Button></Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {versions.map(v => (
            <div
              key={v.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Link to={`/charts/${id}/versions/${v.id}`} style={{ fontWeight: 600, fontSize: 15 }}>
                    {v.version_name}
                  </Link>
                  <ActiveBadge active={v.is_active} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(v.created_at).toLocaleDateString()}
                    {v.created_by_name && ` · ${v.created_by_name}`}
                  </span>
                  {!v.is_active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={restoring === v.id}
                      onClick={() => handleRestore(v.id)}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {v.parts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {p.instrumentName.replace(/_/g, ' ')}
                    </span>
                    <OmrBadge status={p.omrStatus} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
