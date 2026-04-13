import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getVersion, deletePart } from '../api/charts';
import { ChartVersion, Part, VersionDiff, PartDiff } from '../types';
import { Layout } from '../components/Layout';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { PdfViewer } from '../components/PdfViewer';
import { ApiError } from '../api/client';

function DiffPanel({ diff, instrument }: { diff: PartDiff; instrument: string }) {
  const [open, setOpen] = useState(true);
  const { changedMeasures, changeDescriptions, structuralChanges } = diff;
  const totalChanges =
    changedMeasures.length +
    structuralChanges.insertedMeasures.length +
    structuralChanges.deletedMeasures.length;

  if (totalChanges === 0 && structuralChanges.sectionLabelChanges.length === 0) {
    return (
      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--success)' }}>
        No changes from previous version
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', color: 'var(--accent)',
          cursor: 'pointer', fontSize: 13, padding: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {open ? '▾' : '▸'}
        {totalChanges} change{totalChanges !== 1 ? 's' : ''} in {instrument} part
      </button>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
          {structuralChanges.insertedMeasures.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 4 }}>
              + {structuralChanges.insertedMeasures.length} measure{structuralChanges.insertedMeasures.length !== 1 ? 's' : ''} inserted
              (m.{structuralChanges.insertedMeasures.join(', m.')})
            </p>
          )}
          {structuralChanges.deletedMeasures.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 4 }}>
              − {structuralChanges.deletedMeasures.length} measure{structuralChanges.deletedMeasures.length !== 1 ? 's' : ''} deleted
            </p>
          )}
          {structuralChanges.sectionLabelChanges.map((s, i) => (
            <p key={i} style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{s}</p>
          ))}
          {changedMeasures.map(m => (
            <p key={m} style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              {changeDescriptions[m] ?? `m.${m}: changed`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionDetail() {
  const { id: chartId, vId } = useParams<{ id: string; vId: string }>();
  const [version, setVersion] = useState<ChartVersion | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingPart, setDeletingPart] = useState<string | null>(null);
  const [deletePartError, setDeletePartError] = useState('');

  const load = useCallback(async () => {
    if (!chartId || !vId) return;
    const res = await getVersion(chartId, vId);
    setVersion(res.version);
    setParts(res.parts);
    setDiff(res.diff);
  }, [chartId, vId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  async function handleDeletePart(partId: string, instrumentName: string) {
    if (!confirm(`Delete "${instrumentName}"? This cannot be undone.`)) return;
    setDeletingPart(partId);
    setDeletePartError('');
    try {
      await deletePart(partId);
      setParts(prev => prev.filter(p => p.id !== partId));
    } catch (err) {
      setDeletePartError(err instanceof ApiError ? err.message : 'Failed to delete part');
    } finally {
      setDeletingPart(null);
    }
  }

  // Poll while OMR is in progress
  useEffect(() => {
    const inProgress = parts.some(p => p.omr_status === 'pending' || p.omr_status === 'processing');
    if (!inProgress) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [parts, load]);

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;
  if (!version) return null;

  const diffParts = diff?.diff_json?.parts ?? {};
  const omrAllDone = parts.every(p => p.omr_status === 'complete' || p.omr_status === 'failed');

  return (
    <Layout
      title={version.version_name}
      back={{ label: 'Chart', to: `/charts/${chartId}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -20, marginBottom: 28 }}>
        <ActiveBadge active={version.is_active} />
        {version.created_by_name && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Pushed by {version.created_by_name} · {new Date(version.created_at).toLocaleDateString()}
          </span>
        )}
      </div>

      <section>
        <h2 style={{ marginBottom: 16 }}>Parts</h2>
        {deletePartError && <p className="form-error" style={{ marginBottom: 16 }}>{deletePartError}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {parts.map(p => {
            const partDiff = diffParts[p.instrument_name] ?? null;
            return (
              <div key={p.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '16px 18px',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>
                      {p.instrument_name}
                    </span>
                    {p.part_type === 'score' && (
                      <span style={{
                        fontSize: 11, padding: '2px 7px',
                        background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
                        borderRadius: 99, color: 'var(--accent)',
                      }}>Score</span>
                    )}
                    {p.part_type === 'other' && (
                      <span style={{
                        fontSize: 11, padding: '2px 7px',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 99, color: 'var(--text-muted)',
                      }}>Other</span>
                    )}
                    <OmrBadge status={p.omr_status} />
                    {p.inherited_from_part_id && (
                      <span style={{
                        fontSize: 11, padding: '2px 7px',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 99, color: 'var(--text-muted)',
                      }}>
                        carried from {p.inherited_from_version_name ?? `v${p.inherited_from_version_number}`}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={deletingPart === p.id}
                    onClick={() => handleDeletePart(p.id, p.instrument_name)}
                    style={{ color: 'var(--danger)' }}
                  >
                    Delete
                  </Button>
                </div>

                {/* PDF viewer thumbnail + fullscreen */}
                {p.pdfUrl ? (
                  <PdfViewer
                    url={p.pdfUrl}
                    title={`${p.instrument_name} — ${version.version_name}`}
                    changedMeasureBounds={partDiff?.changedMeasureBounds}
                    changeDescriptions={partDiff?.changeDescriptions}
                  />
                ) : (
                  <div style={{
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center',
                    color: 'var(--text-muted)', fontSize: 13,
                  }}>
                    PDF not available
                  </div>
                )}

                {/* Diff panel */}
                {partDiff ? (
                  <DiffPanel diff={partDiff} instrument={p.instrument_name} />
                ) : omrAllDone && !diff ? (
                  <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                    No diff available (first version or OMR unavailable)
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}
