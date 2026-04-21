import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getVersion, getFlaggedCount } from '../api/versions';
import { getChart } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { getInstrumentSlots } from '../api/instrumentSlots';
import { getParts, deletePart, uploadPart } from '../api/parts';
import { getAnnotations, createAnnotation, deleteAnnotation } from '../api/annotations';
import { Version, Part, Annotation, AnnotationKind, ContentJson, InstrumentSlot, PartKind, ANNOTATABLE_KINDS } from '../types';
import { Layout } from '../components/Layout';
import { OmrBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { PartRenderer } from '../components/PartRenderer';
import { ContentKindIcon, KIND_LABELS } from '../components/ContentKindIcon';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { FileDropZone } from '../components/FileDropZone';
import { SlotAssignmentPicker, InstrumentAssignment } from '../components/SlotAssignmentPicker';
import { MigrationModal } from '../components/MigrationModal';
import { PartMigrationRow } from '../components/PartMigrationRow';
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

// ── Inline add part ──────────────────────────────────────────────────────────

const ALL_KINDS: PartKind[] = ['part', 'score', 'chart', 'link', 'audio', 'other'];

function humanizeName(filename: string): string {
  return filename.replace(/\.(pdf|musicxml|mxl|mp3|wav|m4a|ogg|flac)$/i, '').replace(/[-_]/g, ' ').trim();
}

function guessKindFromFile(file: File): PartKind {
  const lower = file.name.toLowerCase();
  if (lower.includes('score')) return 'score';
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(lower)) return 'audio';
  return 'part';
}

function InlineAddPart({ versionId, ensembleId, hasParts, onAdded }: {
  versionId: string;
  ensembleId: string;
  hasParts: boolean;
  onAdded: (p: Part) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PartKind>('part');
  const [linkUrl, setLinkUrl] = useState('');
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<InstrumentAssignment[]>([]);
  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!ensembleId) return;
    getInstrumentSlots(ensembleId).then(r => setSlots(r.instrumentSlots)).catch(() => {});
  }, [ensembleId]);

  function reset() {
    setFile(null);
    setName('');
    setKind('part');
    setLinkUrl('');
    setSlotIds([]);
    setAssignments([]);
    setErr('');
    setOpen(false);
  }

  function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setName(humanizeName(f.name));
    setKind(guessKindFromFile(f));
  }

  async function handleUpload() {
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (kind === 'link' && !linkUrl.trim()) { setErr('URL is required for links.'); return; }
    if (kind !== 'link' && !file) { setErr('Select a file.'); return; }
    setUploading(true);
    setErr('');
    try {
      const hasNewInstruments = assignments.some(a => 'newInstrumentName' in a);
      const { part } = await uploadPart({
        versionId,
        name: name.trim(),
        file: file,
        kind,
        slotIds: hasNewInstruments ? undefined : (slotIds.length > 0 ? slotIds : undefined),
        instrumentAssignments: hasNewInstruments ? assignments : undefined,
        linkUrl: kind === 'link' ? linkUrl : undefined,
      });
      onAdded(part);
      reset();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  // State 1: collapsed button (only when parts exist)
  const showCollapsed = hasParts && !open && !file && kind !== 'link';
  // State 2: form visible
  const showForm = !hasParts || open || !!file || kind === 'link';

  if (showCollapsed) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
        padding: '12px 0', width: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 6, fontFamily: 'inherit',
        transition: 'border-color 0.15s, color 0.15s',
      }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add part
      </button>
    );
  }

  if (!showForm) return null;

  const hasContent = !!file || kind === 'link';

  if (hasContent) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)', padding: '16px 18px',
      }}>
        {/* Drop zone for re-selection (file-based kinds) */}
        {kind !== 'link' && (
          <FileDropZone
            onFiles={handleFiles}
            accept=".pdf,.musicxml,.mxl,.mp3,.wav,.m4a,.ogg,.flac"
            multiple={false}
            label={file?.name ?? 'Drop a file or click to browse'}
            hint="Drop a different file to replace, or click to browse"
          />
        )}

        {/* URL input (link kind) */}
        {kind === 'link' && (
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              URL
            </label>
            <input
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://..."
              type="url"
              style={{
                width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '6px 10px', color: 'var(--text)', fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Name field */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name..."
            style={{
              width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '6px 10px', color: 'var(--text)', fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Kind selector */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Kind</label>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as PartKind)}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontSize: 13,
            }}
          >
            {ALL_KINDS.map(k => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* Slot assignment */}
        {slots.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
              Assign to instruments
            </label>
            <SlotAssignmentPicker slots={slots} selectedIds={slotIds} onChange={setSlotIds} onAssignmentsChange={setAssignments} />
          </div>
        )}

        {/* Error */}
        {err && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</p>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button size="sm" loading={uploading} onClick={handleUpload}>Upload</Button>
          <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
        </div>
      </div>
    );
  }

  // No file selected yet — show drop zone
  return (
    <div>
      <FileDropZone
        onFiles={handleFiles}
        accept=".pdf,.musicxml,.mxl,.mp3,.wav,.m4a,.ogg,.flac"
        multiple={false}
        label="Drop a file here or click to browse"
        hint="Add a part, audio file, or other content to this version"
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <button
          type="button"
          onClick={() => { setKind('link'); setOpen(true); }}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0,
          }}
        >
          + Add a link instead
        </button>
        {hasParts && <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function VersionDetail() {
  const { id: chartId, vId } = useParams<{ id: string; vId: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const [version, setVersion] = useState<Version | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingPart, setDeletingPart] = useState<string | null>(null);
  const [deletePartError, setDeletePartError] = useState('');
  const [showMigration, setShowMigration] = useState(false);
  const [migrationFlagged, setMigrationFlagged] = useState(
    () => (location.state as { migrationFlagged?: number } | null)?.migrationFlagged ?? 0,
  );
  const flaggedDismissedRef = useRef(false);
  const [chartName, setChartName] = useState('');
  const [ensembleName, setEnsembleName] = useState('');
  const [ensembleId, setEnsembleId] = useState('');

  const load = useCallback(async () => {
    if (!vId) return;
    const [verRes, partsRes, flaggedRes] = await Promise.all([
      getVersion(vId),
      getParts(vId),
      getFlaggedCount(vId).catch(() => ({ flaggedCount: 0 })),
    ]);
    setVersion(verRes.version);
    setParts(partsRes.parts);
    if (flaggedRes.flaggedCount > 0 && !flaggedDismissedRef.current) setMigrationFlagged(flaggedRes.flaggedCount);
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
        <Button variant="ghost" size="sm" onClick={() => setShowMigration(true)}>
          Migrate annotations
        </Button>
      </div>

      {migrationFlagged > 0 && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(234, 179, 8, 0.08)',
          border: '1px solid rgba(234, 179, 8, 0.25)',
          borderRadius: 'var(--radius)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, color: '#eab308' }}>
            {migrationFlagged} annotation{migrationFlagged !== 1 ? 's' : ''} may have shifted to unexpected positions — review them in the part viewer.
          </span>
          <button
            onClick={() => { flaggedDismissedRef.current = true; setMigrationFlagged(0); }}
            style={{ background: 'none', border: 'none', color: '#eab308', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
          >
            {'\u00D7'}
          </button>
        </div>
      )}

      <section>
        <h2 style={{ marginBottom: 16 }}>Parts</h2>
        {deletePartError && <p className="form-error" style={{ marginBottom: 16 }}>{deletePartError}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  {p.kind !== 'part' && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.15)',
                      border: '1px solid rgba(99,102,241,0.4)', borderRadius: 99, color: 'var(--accent)',
                    }}>
                      <ContentKindIcon kind={p.kind} size={12} />
                      {KIND_LABELS[p.kind]}
                    </span>
                  )}
                  <OmrBadge status={p.omrStatus} />
                </div>
                <Button variant="ghost" size="sm" loading={deletingPart === p.id}
                  onClick={() => handleDeletePart(p.id, p.name)}
                  style={{ color: 'var(--danger)' }}>
                  Delete
                </Button>
              </div>

              {/* Content renderer — switches based on kind */}
              <PartRenderer
                part={p}
                versionId={vId}
                title={`${p.name} — ${version.name}`}
              />

              {/* Migration row + Annotations — only for annotatable kinds */}
              {ANNOTATABLE_KINDS.includes(p.kind) && (
                <>
                  <PartMigrationRow
                    partId={p.id}
                    partName={p.name}
                    chartId={chartId!}
                    annotationCount={0}
                    onMigrated={load}
                  />
                  <AnnotationPanel partId={p.id} currentUserId={user?.id ?? ''} />
                </>
              )}
            </div>
          ))}

          {/* Inline add part */}
          <InlineAddPart
            versionId={vId!}
            ensembleId={ensembleId}
            hasParts={parts.length > 0}
            onAdded={p => setParts(prev => [...prev, p])}
          />
        </div>
      </section>

      {showMigration && version && (
        <MigrationModal
          versionId={version.id}
          versionName={version.name}
          onClose={() => setShowMigration(false)}
          onComplete={(results) => {
            setShowMigration(false);
            const flagged = results.reduce((s, r) => s + r.flagged, 0);
            if (flagged > 0) setMigrationFlagged(flagged);
            load();
          }}
        />
      )}
    </Layout>
  );
}
