import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getChart, deleteChart, getChartVersionInstruments, InstrumentRow, InstrumentPart, InstrumentViewResponse } from '../api/charts';
import { getVersions, createVersion } from '../api/versions';
import { getEnsemble } from '../api/ensembles';
import { Chart as ChartType, Version } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ContentKindIcon, KIND_LABELS } from '../components/ContentKindIcon';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { ApiError } from '../api/client';

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [chart, setChart] = useState<ChartType | null>(null);
  const [ensembleName, setEnsembleName] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [instrumentData, setInstrumentData] = useState<InstrumentViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  const [showCreateVersion, setShowCreateVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [deletingChart, setDeletingChart] = useState(false);

  // Load chart and versions
  useEffect(() => {
    if (!id) return;
    Promise.all([
      getChart(id),
      getVersions(id),
    ]).then(async ([chartRes, versRes]) => {
      setChart(chartRes.chart);
      setVersions(versRes.versions);
      // Default to current version, or most recent
      const current = versRes.versions.find(v => v.isCurrent);
      const sorted = [...versRes.versions].sort((a, b) => b.sortOrder - a.sortOrder);
      setSelectedVersionId(current?.id ?? sorted[0]?.id ?? null);
      try {
        const { ensemble } = await getEnsemble(chartRes.chart.ensembleId);
        setEnsembleName(ensemble.name);
      } catch { /* breadcrumb will just be missing ensemble name */ }
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Load instrument data when selected version changes
  const loadInstruments = useCallback(async (chartId: string, versionId: string) => {
    setLoadingInstruments(true);
    try {
      const data = await getChartVersionInstruments(chartId, versionId);
      setInstrumentData(data);
    } catch {
      setInstrumentData(null);
    } finally {
      setLoadingInstruments(false);
    }
  }, []);

  useEffect(() => {
    if (!id || !selectedVersionId) return;
    loadInstruments(id, selectedVersionId);
  }, [id, selectedVersionId, loadInstruments]);

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setVersionError('');
    setCreatingVersion(true);
    try {
      const { version } = await createVersion({ chartId: id, name: versionName.trim() || 'New Version' });
      setVersions(prev => [version, ...prev]);
      setSelectedVersionId(version.id);
      setShowCreateVersion(false);
      setVersionName('');
    } catch (err) {
      setVersionError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreatingVersion(false);
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

  async function handleVersionChange(versionId: string) {
    setSelectedVersionId(versionId);
  }

  const sortedVersions = [...versions].sort((a, b) => b.sortOrder - a.sortOrder);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!chart) return null;

  return (
    <Layout
      title={chart.name}
      backTo={`/ensembles/${chart.ensembleId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${chart.ensembleId}` }] : []),
        { label: chart.name },
      ]}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => setShowCreateVersion(true)}>+ New version</Button>
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

      {/* Version selector */}
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
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Version:</label>
            <select
              value={selectedVersionId || ''}
              onChange={e => handleVersionChange(e.target.value)}
              style={{ fontSize: 14, padding: '6px 12px', borderRadius: 8, minWidth: 200 }}
            >
              {sortedVersions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
            {selectedVersion && (
              <Link to={`/charts/${id}/versions/${selectedVersion.id}`} style={{ fontSize: 13 }}>
                Open version detail
              </Link>
            )}
          </div>

          {/* Instrument rows */}
          {loadingInstruments ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading instruments...</p>
          ) : instrumentData ? (
            <>
              {instrumentData.instruments.length === 0 && instrumentData.scoreParts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <p style={{ marginBottom: 8 }}>No instruments defined yet.</p>
                  <Link to={`/ensembles/${chart.ensembleId}`}>
                    <Button variant="secondary">Add instruments to this ensemble</Button>
                  </Link>
                </div>
              ) : (
                <>
                  <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
                    Instruments in this ensemble
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {instrumentData.instruments.map(inst => (
                      <InstrumentCard
                        key={inst.slotId}
                        instrument={inst}
                        chartId={id!}
                        versionId={selectedVersionId!}
                      />
                    ))}
                  </div>

                  {/* Score section */}
                  {instrumentData.scoreParts.length > 0 && (
                    <>
                      <div style={{
                        borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 16, marginBottom: 12,
                      }}>
                        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0 }}>
                          Shared with everyone
                        </h3>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {instrumentData.scoreParts.map(sp => (
                          <div key={sp.partId} style={{
                            padding: '14px 18px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            display: 'flex', alignItems: 'center', gap: 12,
                          }}>
                            <ContentKindIcon kind={sp.kind as any} size={20} />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 500, fontSize: 14 }}>{sp.name}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                                {KIND_LABELS[sp.kind as keyof typeof KIND_LABELS] || sp.kind}
                              </span>
                              {sp.annotationCount > 0 && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                                  {sp.annotationCount} annotation{sp.annotationCount !== 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <Link to={`/charts/${id}/versions/${selectedVersionId}`}>
                              <Button size="sm" variant="secondary">Open</Button>
                            </Link>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          ) : null}
        </>
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

// ── Instrument Card Component ────────────────────────────────────────────────

function InstrumentCard({
  instrument, chartId, versionId,
}: {
  instrument: InstrumentRow;
  chartId: string;
  versionId: string;
}) {
  const { instrumentName, assignedUsers, currentParts, previousVersionParts } = instrument;
  const hasCurrent = currentParts.length > 0;
  const hasPrevious = previousVersionParts.length > 0;

  return (
    <div style={{
      padding: '16px 20px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      {/* Header: instrument name + assigned users */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: hasCurrent || hasPrevious ? 12 : 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'var(--accent-subtle)',
          border: '1px solid var(--accent-glow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)',
        }}>
          <InstrumentIcon name={instrumentName} size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{instrumentName}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 10 }}>
            {assignedUsers.length === 0
              ? '(unassigned)'
              : assignedUsers.map(u => u.name || 'Unknown').join(', ')}
          </span>
        </div>
      </div>

      {/* State A: Has content in current version */}
      {hasCurrent && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 48 }}>
          {currentParts.map(part => (
            <PartRow key={part.partId} part={part} chartId={chartId} versionId={versionId} />
          ))}
        </div>
      )}

      {/* State B: No content in current version, but has content in previous */}
      {!hasCurrent && hasPrevious && (
        <div style={{ marginLeft: 48 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
            No content in current version
          </p>
          <div style={{ opacity: 0.6 }}>
            {previousVersionParts.map(pp => (
              <div key={pp.partId} style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 4 }}>
                {pp.name} <span style={{ fontStyle: 'italic' }}>(from {pp.versionName})</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Link to={`/charts/${chartId}/upload`}>
              <Button size="sm" variant="secondary">Upload new part</Button>
            </Link>
          </div>
        </div>
      )}

      {/* State C: No content ever uploaded */}
      {!hasCurrent && !hasPrevious && (
        <div style={{ marginLeft: 48 }}>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic', marginBottom: 8 }}>
            No content yet
          </p>
          <Link to={`/charts/${chartId}/upload`}>
            <Button size="sm" variant="secondary">Upload part</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function PartRow({
  part, chartId, versionId,
}: {
  part: InstrumentPart;
  chartId: string;
  versionId: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <ContentKindIcon kind={part.kind as any} size={16} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{part.name}</span>
        {part.kind !== 'part' && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--text-faint)',
            background: 'var(--surface)', padding: '1px 6px',
            borderRadius: 6, marginLeft: 6,
          }}>
            {KIND_LABELS[part.kind as keyof typeof KIND_LABELS] || part.kind}
          </span>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
          {part.annotationCount} annotation{part.annotationCount !== 1 ? 's' : ''}
        </span>
        {part.diffStatus && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>
            {part.diffStatus.changedMeasureCount > 0
              ? `${part.diffStatus.changedMeasureCount} measure${part.diffStatus.changedMeasureCount !== 1 ? 's' : ''} changed`
              : 'no changes'}
          </span>
        )}
      </div>
      <Link to={`/charts/${chartId}/versions/${versionId}`}>
        <Button size="sm" variant="secondary">Open</Button>
      </Link>
    </div>
  );
}
