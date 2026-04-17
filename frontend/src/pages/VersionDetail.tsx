import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getVersion, deletePart, getAssignments, getChart, addPartToVersion } from '../api/charts';
import { getMembers } from '../api/ensembles';
import { getAnnotations, createAnnotation, deleteAnnotation } from '../api/annotations';
import { ChartVersion, Part, VersionDiff, PartDiff, PartAssignment, EnsembleMember, Annotation } from '../types';
import { Layout } from '../components/Layout';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { PdfViewer } from '../components/PdfViewer';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { ApiError } from '../api/client';

// ── Diff panel ────────────────────────────────────────────────────────────────

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

// ── Link viewer ───────────────────────────────────────────────────────────────

function LinkViewer({ url, name }: { url: string; name: string }) {
  const [embedMode, setEmbedMode] = useState(false);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: embedMode ? 10 : 0 }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent)', fontSize: 13, wordBreak: 'break-all' }}>
          {url}
        </a>
        <button
          onClick={() => setEmbedMode(m => !m)}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4,
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '3px 8px', whiteSpace: 'nowrap' }}>
          {embedMode ? 'Hide preview' : 'Preview in app'}
        </button>
      </div>
      {embedMode && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', height: 500 }}>
          <iframe
            src={url}
            title={name}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}
    </div>
  );
}

// ── Audio player ──────────────────────────────────────────────────────────────

function AudioPlayer({ pdfUrl }: { pdfUrl: string }) {
  // pdfUrl points to the same backend proxy — just uses it as audio src with auth
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const apiUrl = pdfUrl.startsWith('/parts') ? `/api${pdfUrl}` : pdfUrl;
    fetch(apiUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => setBlobUrl(URL.createObjectURL(blob)))
      .catch(() => {});
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl]);

  if (!blobUrl) return <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Loading audio…</div>;
  return (
    <audio controls src={blobUrl} style={{ marginTop: 8, width: '100%' }} />
  );
}

// ── Assignments panel ─────────────────────────────────────────────────────────

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
      const { annotation } = await createAnnotation(partId, {
        anchorType: 'measure',
        anchorJson: { measureNumber: m },
        contentType: 'text',
        contentJson: { text: text.trim() },
      });
      setAnnotations(prev => [...prev, annotation].sort((a, b) => {
        const am = (a.anchor_json as { measureNumber?: number }).measureNumber ?? 0;
        const bm = (b.anchor_json as { measureNumber?: number }).measureNumber ?? 0;
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
        <span style={{ color: 'var(--accent)', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
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
          {/* Existing annotations */}
          {annotations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {annotations.map(a => {
                const measureNum = (a.anchor_json as { measureNumber?: number }).measureNumber;
                const isUnresolved = a.is_unresolved;
                return (
                  <div key={a.id} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '8px 10px',
                    background: isUnresolved ? 'rgba(251,191,36,0.06)' : 'var(--bg)',
                    border: `1px solid ${isUnresolved ? 'rgba(251,191,36,0.3)' : 'var(--border)'}`,
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
                      {isUnresolved && (
                        <p style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 3 }}>
                          ⚠ Measure was removed in this version
                        </p>
                      )}
                      <p style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>
                        {a.content_json.text}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {a.user_name}
                      </p>
                    </div>
                    {a.user_id === currentUserId && (
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {annotations.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>No annotations yet.</p>
          )}
          {/* Add new */}
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
              placeholder="Add a note…"
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

const TYPE_OPTIONS = [
  { value: 'part', label: 'Part' }, { value: 'score', label: 'Score' },
  { value: 'audio', label: 'Audio' }, { value: 'chart', label: 'Chord chart' },
  { value: 'link', label: 'Link' }, { value: 'other', label: 'Other' },
];

function AddFileButton({ chartId, versionId, onAdded }: {
  chartId: string; versionId: string; onAdded: (p: Part) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('part');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() { setName(''); setType('part'); setUrl(''); setFile(null); setErr(''); setOpen(false); }

  async function handleSave() {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (type === 'link' && !url.trim()) { setErr('URL is required.'); return; }
    if (type !== 'link' && !file) { setErr('Select a file.'); return; }
    setSaving(true); setErr('');
    try {
      const { part } = await addPartToVersion(chartId, versionId, { name: name.trim(), type, file: file ?? undefined, url: url.trim() || undefined });
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 8, marginBottom: 8 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name…"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 14 }} />
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 13 }}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {type === 'link' ? (
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }} />
      ) : (
        <div style={{ marginBottom: 8 }}>
          <input ref={fileInputRef} type="file" accept=".pdf,.mp3,.wav,.m4a,.aac,.ogg,.flac,application/pdf,audio/*"
            onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, color: 'var(--text-muted)' }} />
        </div>
      )}
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
  const [version, setVersion] = useState<ChartVersion | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<PartAssignment[]>([]);
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

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Load ensemble context + assignments
  useEffect(() => {
    if (!chartId) return;
    getChart(chartId).then(({ chart }) => {
        return Promise.all([
          getMembers(chart.ensemble_id).then(r => {
            const member = r.members.find((m: EnsembleMember) => m.id === user?.id);
            if (member) setMyRole(member.role);
          }).catch(() => {}),
          getAssignments(chartId).then(r => setAssignments(r.assignments)).catch(() => {}),
        ]);
      }).catch(() => {});
  }, [chartId]);

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
  const canEdit = myRole === 'owner' || myRole === 'editor';

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>Files</h2>
          {canEdit && <AddFileButton chartId={chartId!} versionId={vId!} onAdded={p => setParts(prev => [...prev, p])} />}
        </div>
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
                    <InstrumentIcon name={p.instrument_name} size={24} />
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{p.instrument_name}</span>
                    {p.part_type === 'score' && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.4)', borderRadius: 99, color: 'var(--accent)' }}>Score</span>
                    )}
                    {p.part_type === 'audio' && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.4)', borderRadius: 99, color: '#22c55e' }}>Audio</span>
                    )}
                    {p.part_type === 'chart' && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(251,191,36,0.12)',
                        border: '1px solid rgba(251,191,36,0.4)', borderRadius: 99, color: '#f59e0b' }}>Chord chart</span>
                    )}
                    {p.part_type === 'link' && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.08)',
                        border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }}>Link</span>
                    )}
                    {p.part_type === 'other' && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }}>Other</span>
                    )}
                    {p.part_type !== 'link' && p.part_type !== 'audio' && (
                      <OmrBadge status={p.omr_status} />
                    )}
                    {p.inherited_from_part_id && (
                      <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }}>
                        carried from {p.inherited_from_version_name ?? `v${p.inherited_from_version_number}`}
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <Button variant="ghost" size="sm" loading={deletingPart === p.id}
                      onClick={() => handleDeletePart(p.id, p.instrument_name)}
                      style={{ color: 'var(--danger)' }}>
                      Delete
                    </Button>
                  )}
                </div>

                {/* Content by type */}
                {p.part_type === 'link' && p.url ? (
                  <LinkViewer url={p.url} name={p.instrument_name} />
                ) : p.part_type === 'audio' && p.pdfUrl ? (
                  <AudioPlayer pdfUrl={p.pdfUrl} />
                ) : p.pdfUrl ? (
                  <PdfViewer
                    url={p.pdfUrl}
                    partId={p.id}
                    title={`${p.instrument_name} — ${version.version_name}`}
                    changedMeasureBounds={partDiff?.changedMeasureBounds}
                    changeDescriptions={partDiff?.changeDescriptions}
                  />
                ) : (
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center',
                    color: 'var(--text-muted)', fontSize: 13 }}>
                    File not available
                  </div>
                )}

                {/* Diff panel — only for PDF types */}
                {['score', 'part', 'chart', 'other'].includes(p.part_type) && (
                  partDiff ? (
                    <DiffPanel diff={partDiff} instrument={p.instrument_name} />
                  ) : omrAllDone && !diff ? (
                    <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                      No diff available (first version or OMR unavailable)
                    </p>
                  ) : null
                )}

                {/* Annotations */}
                <AnnotationPanel partId={p.id} currentUserId={user?.id ?? ''} />

                {/* Assigned players (display only — manage via ensemble instruments) */}
                {(() => {
                  const myAssignments = assignments.filter(a => a.instrument_name === p.instrument_name);
                  if (myAssignments.length === 0) return null;
                  return (
                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Players:</span>
                      {myAssignments.map(a => (
                        <span key={a.id} style={{
                          fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)',
                          borderRadius: 99, padding: '2px 9px', color: 'var(--text-muted)',
                        }}>{a.user_name}</span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}
