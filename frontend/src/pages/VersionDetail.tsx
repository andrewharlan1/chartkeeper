import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getVersion } from '../api/versions';
import { getChart } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { getParts, deletePart, uploadPart } from '../api/parts';
import { getAnnotations, createAnnotation, deleteAnnotation } from '../api/annotations';
import { Version, Part, Annotation, AnnotationKind, ContentJson } from '../types';
import { Layout } from '../components/Layout';
import { OmrBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { PdfViewer } from '../components/PdfViewer';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { ApiError } from '../api/client';

// ── Annotation panel ──────────────────────────────────────────────────────────

function AnnotationPanel({ partId, currentUserId }: { partId: string; currentUserId: string }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [open, setOpen] = useState(false);
  const [measure, setMeasure] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getAnnotations(partId).then(r => setAnnotations(r.annotations)).catch(() => {});
  }, [partId, open]);

  async function handleAdd() {
    const m = parseInt(measure);
    if (!text.trim() || !m || m < 1) return;
    setSaving(true);
    try {
      const contentJson: ContentJson = {
        text: text.trim(),
        fontSize: 0.15,
        color: '#333333',
        fontWeight: 'normal' as const,
        fontStyle: 'normal' as const,
        boundingBox: { x: 0.5, y: 0.1, widthPageUnits: 0.08, heightPageUnits: 0.02 },
      };
      const { annotation } = await createAnnotation(partId, {
        anchorType: 'measure',
        anchorJson: { measureNumber: m },
        kind: 'text' as AnnotationKind,
        contentJson,
      });
      setAnnotations(prev => [...prev, annotation].sort((a, b) => {
        const am = (a.anchorJson as { measureNumber?: number }).measureNumber ?? 0;
        const bm = (b.anchorJson as { measureNumber?: number }).measureNumber ?? 0;
        return am - bm;
      }));
      setMeasure('');
      setText('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: 0,
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        <span style={{ color: 'var(--accent)', fontSize: 13 }}>{open ? '\u25BE' : '\u25B8'}</span>
        Notes & annotations
        {annotations.length > 0 && !open && (
          <span style={{
            background: 'var(--accent-subtle)', border: '1px solid rgba(124,106,245,0.3)',
            borderRadius: 99, padding: '1px 7px', fontSize: 11, color: 'var(--accent)',
          }}>{annotations.length}</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {annotations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {annotations.map(a => {
                const measureNum = (a.anchorJson as { measureNumber?: number }).measureNumber;
                const needsReview = (a.contentJson as Record<string, unknown>)._needsReview === true;
                const displayText = (a.contentJson as { text?: string }).text;
                return (
                  <div key={a.id} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '8px 10px',
                    background: needsReview ? 'rgba(251,191,36,0.06)' : 'var(--bg)',
                    border: `1px solid ${needsReview ? 'rgba(251,191,36,0.3)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {measureNum && (
                      <span style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 700,
                        background: 'var(--accent-subtle)', border: '1px solid rgba(124,106,245,0.3)',
                        borderRadius: 4, padding: '2px 6px', color: 'var(--accent)',
                        marginTop: 1,
                      }}>m.{measureNum}</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {needsReview && (
                        <p style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 3 }}>
                          Needs review after migration
                        </p>
                      )}
                      {displayText && (
                        <p style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>
                          {displayText}
                        </p>
                      )}
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {a.ownerName ?? 'Unknown'} {'\u00B7'} {a.kind}
                      </p>
                    </div>
                    {a.ownerUserId === currentUserId && (
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
                      >{'\u00D7'}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {annotations.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>No annotations yet.</p>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              value={measure}
              onChange={e => setMeasure(e.target.value)}
              placeholder="m."
              min={1}
              style={{ width: 54, padding: '6px 8px', fontSize: 12, flexShrink: 0 }}
            />
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Add a note..."
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}
            />
            <Button size="sm" loading={saving} disabled={!text.trim() || !measure} onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add file inline ───────────────────────────────────────────────────────────

function AddFileButton({ versionId, onAdded }: {
  versionId: string; onAdded: (p: Part) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function reset() { setName(''); setFile(null); setErr(''); setOpen(false); }

  async function handleSave() {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (!file) { setErr('Select a file.'); return; }
    setSaving(true); setErr('');
    try {
      const { part } = await uploadPart({ versionId, name: name.trim(), file });
      onAdded(part);
      reset();
    } catch {
      setErr('Failed to add file.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 6,
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1,
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} title="Add file to this version">+</button>
    );
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '14px 16px', width: '100%', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Part name..."
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 14 }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <input type="file" accept=".pdf,application/pdf"
          onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
      </div>
      {err && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" loading={saving} onClick={handleSave}>Add</Button>
        <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function VersionDetail() {
  const { id: chartId, vId } = useParams<{ id: string; vId: string }>();
  const { user } = useAuth();
  const [version, setVersion] = useState<Version | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingPart, setDeletingPart] = useState<string | null>(null);
  const [deletePartError, setDeletePartError] = useState('');
  const [chartName, setChartName] = useState('');
  const [ensembleName, setEnsembleName] = useState('');
  const [ensembleId, setEnsembleId] = useState('');

  const load = useCallback(async () => {
    if (!vId) return;
    const [verRes, partsRes] = await Promise.all([
      getVersion(vId),
      getParts(vId),
    ]);
    setVersion(verRes.version);
    setParts(partsRes.parts);
  }, [vId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Fetch parent names for breadcrumbs
    if (chartId) {
      getChart(chartId).then(async ({ chart }) => {
        setChartName(chart.name);
        try {
          const { ensemble } = await getEnsemble(chart.ensembleId);
          setEnsembleName(ensemble.name);
          setEnsembleId(chart.ensembleId);
        } catch { /* breadcrumb will be partial */ }
      }).catch(() => {});
    }
  }, [load, chartId]);

  // Poll while OMR is in progress
  useEffect(() => {
    const inProgress = parts.some(p => p.omrStatus === 'pending' || p.omrStatus === 'processing');
    if (!inProgress) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [parts, load]);

  async function handleDeletePart(partId: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
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

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!version) return null;

  return (
    <Layout
      title={version.name}
      backTo={`/charts/${chartId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${ensembleId}` }] : []),
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: version.name },
      ]}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -20, marginBottom: 28 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {new Date(version.createdAt).toLocaleDateString()}
        </span>
      </div>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>Parts</h2>
          <AddFileButton versionId={vId!} onAdded={p => setParts(prev => [...prev, p])} />
        </div>
        {deletePartError && <p className="form-error" style={{ marginBottom: 16 }}>{deletePartError}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {parts.length === 0 && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
              No parts uploaded yet.
            </p>
          )}
          {parts.map(p => (
            <div key={p.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '16px 18px',
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <InstrumentIcon name={p.name} size={24} />
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</span>
                  {p.kind === 'score' && (
                    <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.15)',
                      border: '1px solid rgba(99,102,241,0.4)', borderRadius: 99, color: 'var(--accent)' }}>Score</span>
                  )}
                  <OmrBadge status={p.omrStatus} />
                </div>
                <Button variant="ghost" size="sm" loading={deletingPart === p.id}
                  onClick={() => handleDeletePart(p.id, p.name)}
                  style={{ color: 'var(--danger)' }}>
                  Delete
                </Button>
              </div>

              {/* PDF viewer */}
              <PdfViewer
                url={`/parts/${p.id}/pdf`}
                partId={p.id}
                title={`${p.name} — ${version.name}`}
              />

              {/* Annotations */}
              <AnnotationPanel partId={p.id} currentUserId={user?.id ?? ''} />
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
