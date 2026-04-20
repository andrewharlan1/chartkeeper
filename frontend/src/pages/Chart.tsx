import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getChart, deleteChart } from '../api/charts';
import { getVersions, createVersion, deleteVersion } from '../api/versions';
import { getParts } from '../api/parts';
import { getEnsemble } from '../api/ensembles';
import { Chart as ChartType, Version, Part } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { OmrBadge } from '../components/Badge';
import { ApiError } from '../api/client';

interface VersionWithParts extends Version {
  parts: Part[];
}

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [chart, setChart] = useState<ChartType | null>(null);
  const [ensembleName, setEnsembleName] = useState('');
  const [versions, setVersions] = useState<VersionWithParts[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateVersion, setShowCreateVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');

  const [deletingVersion, setDeletingVersion] = useState<string | null>(null);
  const [deletingChart, setDeletingChart] = useState(false);

  const loadVersions = useCallback(async (chartId: string) => {
    const { versions: vers } = await getVersions(chartId);
    const withParts = await Promise.all(
      vers.map(async (v) => {
        const { parts } = await getParts(v.id).catch(() => ({ parts: [] as Part[] }));
        return { ...v, parts };
      }),
    );
    setVersions(withParts);
    return withParts;
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getChart(id),
      loadVersions(id),
    ]).then(async ([chartRes]) => {
      setChart(chartRes.chart);
      try {
        const { ensemble } = await getEnsemble(chartRes.chart.ensembleId);
        setEnsembleName(ensemble.name);
      } catch { /* breadcrumb will just be missing ensemble name */ }
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, loadVersions, navigate]);

  // Poll while any OMR jobs are in progress
  useEffect(() => {
    const hasInProgress = versions.some(v =>
      v.parts.some(p => p.omrStatus === 'pending' || p.omrStatus === 'processing'),
    );
    if (!hasInProgress || !id) return;
    const timer = setInterval(() => loadVersions(id), 5000);
    return () => clearInterval(timer);
  }, [versions, id, loadVersions]);

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setVersionError('');
    setCreatingVersion(true);
    try {
      const { version } = await createVersion({ chartId: id, name: versionName.trim() || 'New Version' });
      setVersions(prev => [{ ...version, parts: [] }, ...prev]);
      setShowCreateVersion(false);
      setVersionName('');
    } catch (err) {
      setVersionError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreatingVersion(false);
    }
  }

  async function handleDeleteVersion(versionId: string, name: string) {
    if (!confirm(`Delete version "${name}"? This cannot be undone.`)) return;
    setDeletingVersion(versionId);
    try {
      await deleteVersion(versionId);
      setVersions(prev => prev.filter(v => v.id !== versionId));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete version');
    } finally {
      setDeletingVersion(null);
    }
  }

  async function handleDeleteChart() {
    if (!id || !chart) return;
    if (!confirm(`Delete "${chart.name}"? All versions and parts will be deleted.`)) return;
    setDeletingChart(true);
    try {
      await deleteChart(id);
      navigate(`/ensembles/${chart.ensembleId}`);
    } catch {
      alert('Failed to delete chart.');
      setDeletingChart(false);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!chart) return null;

  return (
    <Layout
      title={chart.name}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${chart.ensembleId}` }] : []),
        { label: chart.name },
      ]}
      actions={
        <>
          <Button size="sm" onClick={() => setShowCreateVersion(true)}>+ New version</Button>
          <Link to={`/charts/${id}/upload`}>
            <Button variant="secondary" size="sm">Upload parts</Button>
          </Link>
          <Button variant="danger" size="sm" loading={deletingChart} onClick={handleDeleteChart}>
            Delete chart
          </Button>
        </>
      }
    >
      {chart.composer && <p style={{ color: 'var(--text-muted)', marginTop: -20, marginBottom: 24 }}>by {chart.composer}</p>}

      {/* Versions */}
      {versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 8 }}>No versions yet.</p>
          <p style={{ fontSize: 13, marginBottom: 20 }}>Upload PDFs to create the first version of this chart.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link to={`/charts/${id}/upload`}>
              <Button>Upload parts</Button>
            </Link>
            <Button variant="secondary" onClick={() => setShowCreateVersion(true)}>Create empty version</Button>
          </div>
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
                    {v.name}
                  </Link>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {v.parts.length} part{v.parts.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={deletingVersion === v.id}
                    onClick={() => handleDeleteVersion(v.id, v.name)}
                    style={{ color: 'var(--danger)' }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {v.parts.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {v.parts.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{p.name}</span>
                      <OmrBadge status={p.omrStatus} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create version modal */}
      {showCreateVersion && (
        <Modal title="New Version" onClose={() => setShowCreateVersion(false)}>
          <form onSubmit={handleCreateVersion}>
            <div className="form-group">
              <label>Version Name</label>
              <input value={versionName} onChange={e => setVersionName(e.target.value)} autoFocus placeholder="e.g. v2, Revised, March rehearsal" />
            </div>
            {versionError && <p className="form-error">{versionError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setShowCreateVersion(false)}>Cancel</Button>
              <Button type="submit" loading={creatingVersion}>Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
