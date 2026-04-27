import { useState, useEffect, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createVersion } from '../api/versions';
import { uploadPart, migrateFrom, InstrumentAssignment, MigrateFromResult } from '../api/parts';
import { getChart, getChartAnnotationSources, AnnotationSourceVersion } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { getInstrumentSlots } from '../api/instrumentSlots';
import { UploadEntry, PartKind, InstrumentSlot, ANNOTATABLE_KINDS } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { FileDropZone } from '../components/FileDropZone';
import { SlotAssignmentPicker } from '../components/SlotAssignmentPicker';
import { ContentKindIcon, KIND_LABELS } from '../components/ContentKindIcon';
import { PostUploadModal, UploadedPartInfo } from '../components/PostUploadModal';
import { ApiError } from '../api/client';

type MigrationEntry = UploadEntry & {
  migrationSourcePartId: string | null;
  showAllInstruments: boolean;
  instrumentAssignments: InstrumentAssignment[];
};

const ALL_KINDS: PartKind[] = ['part', 'score', 'chart', 'link', 'audio', 'other'];

/** File accept string for each kind */
const ACCEPT_BY_KIND: Record<PartKind, string> = {
  part: '.pdf,.musicxml,.mxl',
  score: '.pdf,.musicxml,.mxl',
  chart: '.pdf,.musicxml,.mxl',
  link: '',
  audio: '.mp3,.wav,.m4a,.ogg,.flac',
  other: '*',
};

/** Whether a file is needed for a kind */
function kindNeedsFile(kind: PartKind): boolean {
  return kind !== 'link';
}

function humanizeName(filename: string): string {
  return filename.replace(/\.(pdf|musicxml|mxl|mp3|wav|m4a|ogg|flac)$/i, '').replace(/[-_]/g, ' ').trim();
}

function guessKindFromFile(file: File): PartKind {
  const lower = file.name.toLowerCase();
  if (lower.includes('score')) return 'score';
  if (/\.(mp3|wav|m4a|ogg|flac)$/.test(lower)) return 'audio';
  return 'part';
}

/** Get audio duration using HTML5 Audio API */
function getAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      resolve(isFinite(audio.duration) ? Math.round(audio.duration) : undefined);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(audio.src);
    };
    audio.src = URL.createObjectURL(file);
  });
}

export function UploadVersion() {
  const { id: chartId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [chartName, setChartName] = useState('');
  const [ensembleName, setEnsembleName] = useState('');
  const [ensembleId, setEnsembleId] = useState('');
  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [annotationSources, setAnnotationSources] = useState<AnnotationSourceVersion[]>([]);

  useEffect(() => {
    if (!chartId) return;
    getChart(chartId).then(async ({ chart }) => {
      setChartName(chart.name);
      try {
        const [{ ensemble }, { instrumentSlots }, { sources }] = await Promise.all([
          getEnsemble(chart.ensembleId),
          getInstrumentSlots(chart.ensembleId),
          getChartAnnotationSources(chartId),
        ]);
        setEnsembleName(ensemble.name);
        setEnsembleId(chart.ensembleId);
        setSlots(instrumentSlots);
        setAnnotationSources(sources);
      } catch { /* breadcrumb / slots will be partial */ }
    }).catch(() => {});
  }, [chartId]);

  const [entries, setEntries] = useState<MigrationEntry[]>([]);
  const [versionName, setVersionName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  // Post-upload modal state
  const [showPostUpload, setShowPostUpload] = useState(false);
  const [uploadedParts, setUploadedParts] = useState<UploadedPartInfo[]>([]);
  const [uploadMigrationResults, setUploadMigrationResults] = useState<MigrateFromResult[]>([]);
  const [uploadedVersionId, setUploadedVersionId] = useState('');
  const [uploadedVersionName, setUploadedVersionName] = useState('');

  function getDefaultSource(entrySlotIds: string[]): string | null {
    for (const v of annotationSources) {
      for (const p of v.parts) {
        if (entrySlotIds.some(s => p.slotIds.includes(s))) return p.partId;
      }
    }
    return null;
  }

  function addFiles(files: File[]) {
    const added: MigrationEntry[] = files.map(file => {
      const name = humanizeName(file.name);
      const kind = guessKindFromFile(file);
      return { id: crypto.randomUUID(), file, name, kind, slotIds: [], migrationSourcePartId: null, showAllInstruments: false, instrumentAssignments: [] };
    });
    setEntries(prev => [...prev, ...added]);
  }

  function addLinkEntry() {
    setEntries(prev => [...prev, {
      id: crypto.randomUUID(), file: null, name: '', kind: 'link' as PartKind,
      slotIds: [], linkUrl: '', migrationSourcePartId: null, showAllInstruments: false, instrumentAssignments: [],
    }]);
  }

  function updateEntry(id: string, patch: Partial<Pick<MigrationEntry, 'name' | 'kind' | 'slotIds' | 'migrationSourcePartId' | 'showAllInstruments' | 'linkUrl' | 'instrumentAssignments'>>) {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, ...patch };
      // Auto-update migration default when slot assignment changes
      if ('slotIds' in patch && !('migrationSourcePartId' in patch)) {
        updated.migrationSourcePartId = getDefaultSource(updated.slotIds);
      }
      return updated;
    }));
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!chartId || entries.length === 0) return;

    const names = entries.map(e => e.name.trim());
    if (names.some(n => !n)) { setError('All entries must have a name.'); return; }
    if (new Set(names).size !== names.length) { setError('Each entry must have a unique name.'); return; }

    // Validate link entries have URLs
    for (const entry of entries) {
      if (entry.kind === 'link' && !entry.linkUrl?.trim()) {
        setError(`"${entry.name || 'Untitled link'}" needs a URL.`);
        return;
      }
      if (kindNeedsFile(entry.kind) && !entry.file) {
        setError(`"${entry.name || 'Untitled'}" needs a file.`);
        return;
      }
    }

    setError('');
    setUploading(true);
    try {
      setProgress('Creating version...');
      const { version } = await createVersion({
        chartId,
        name: versionName.trim() || `Version ${new Date().toLocaleDateString()}`,
      });

      const partsUploaded: { entryId: string; partId: string; name: string; kind: PartKind }[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setProgress(`Uploading ${entry.name} (${i + 1}/${entries.length})...`);

        // Extract audio duration for audio files
        let audioDurationSeconds: number | undefined;
        if (entry.kind === 'audio' && entry.file) {
          audioDurationSeconds = await getAudioDuration(entry.file);
        }

        const hasNewInstruments = entry.instrumentAssignments.some(a => 'newInstrumentName' in a);
        const { part } = await uploadPart({
          versionId: version.id,
          name: entry.name.trim(),
          file: entry.file,
          kind: entry.kind,
          slotIds: hasNewInstruments ? undefined : entry.slotIds,
          instrumentAssignments: hasNewInstruments ? entry.instrumentAssignments : undefined,
          linkUrl: entry.kind === 'link' ? entry.linkUrl : undefined,
          audioDurationSeconds,
        });
        partsUploaded.push({ entryId: entry.id, partId: part.id, name: entry.name.trim(), kind: entry.kind });
      }

      // Run migrations for entries that have a source selected
      const migrationsToRun = entries
        .filter(entry => entry.migrationSourcePartId != null)
        .map(entry => ({
          targetPartId: partsUploaded.find(u => u.entryId === entry.id)?.partId,
          sourcePartId: entry.migrationSourcePartId!,
        }))
        .filter((m): m is { targetPartId: string; sourcePartId: string } => m.targetPartId != null);

      const migrationResultsList: MigrateFromResult[] = [];
      if (migrationsToRun.length > 0) {
        setProgress(`Migrating annotations (${migrationsToRun.length} part${migrationsToRun.length !== 1 ? 's' : ''})...`);
        for (const m of migrationsToRun) {
          try {
            const result = await migrateFrom(m.targetPartId, m.sourcePartId);
            migrationResultsList.push(result);
          } catch {
            console.warn(`[UploadVersion] Migration failed for part ${m.targetPartId}`);
          }
        }
      }

      const resolvedName = versionName.trim() || `Version ${new Date().toLocaleDateString()}`;
      setUploadedParts(partsUploaded.map(p => ({ partId: p.partId, name: p.name, kind: p.kind })));
      setUploadMigrationResults(migrationResultsList);
      setUploadedVersionId(version.id);
      setUploadedVersionName(resolvedName);
      setShowPostUpload(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  const showMigration = (kind: PartKind) => ANNOTATABLE_KINDS.includes(kind);

  return (
    <Layout
      title="Upload New Version"
      backTo={`/charts/${chartId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${ensembleId}` }] : []),
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: 'Upload' },
      ]}
    >
      <form onSubmit={handleSubmit} style={{ maxWidth: 620 }}>

        {/* Version name */}
        <div className="form-group">
          <label>Version name (optional)</label>
          <input
            value={versionName}
            onChange={e => setVersionName(e.target.value)}
            placeholder='e.g. "v2" or "Post-recording edits" — auto-named if blank'
          />
        </div>

        {/* Drop zone for file-based entries */}
        <div style={{ marginBottom: 16 }}>
          <FileDropZone
            onFiles={addFiles}
            accept=".pdf,.musicxml,.mxl,.mp3,.wav,.m4a,.ogg,.flac"
            hint="Drop PDFs, audio files, or other files — name each after adding"
          />
        </div>

        {/* Add link button */}
        <div style={{ marginBottom: 16 }}>
          <button type="button" onClick={addLinkEntry} style={{
            background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            padding: '8px 14px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <ContentKindIcon kind="link" size={14} /> Add link (URL)
          </button>
        </div>

        {/* Entries */}
        {entries.length > 0 && (
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(entry => (
              <div key={entry.id} style={{
                padding: '10px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 8, alignItems: 'center' }}>
                  <input
                    value={entry.name}
                    onChange={e => updateEntry(entry.id, { name: e.target.value })}
                    placeholder="Name this entry..."
                    style={{
                      width: '100%', background: 'var(--bg)',
                      border: '1px solid var(--border)', borderRadius: 4,
                      padding: '5px 8px', color: 'var(--text)', fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                  <select
                    value={entry.kind}
                    onChange={e => updateEntry(entry.id, { kind: e.target.value as PartKind })}
                    style={{
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 13, height: 32,
                    }}
                  >
                    {ALL_KINDS.map(k => (
                      <option key={k} value={k}>{KIND_LABELS[k]}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeEntry(entry.id)} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 18, padding: '2px 6px', lineHeight: 1,
                  }}>{'\u00D7'}</button>
                </div>

                {/* File info (for file-based kinds) */}
                {entry.file && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
                    {entry.file.name} {'\u00B7'} {(entry.file.size / 1024).toFixed(0)} KB
                  </p>
                )}

                {/* URL input (for link kind) */}
                {entry.kind === 'link' && (
                  <div style={{ marginTop: 6 }}>
                    <input
                      value={entry.linkUrl ?? ''}
                      onChange={e => updateEntry(entry.id, { linkUrl: e.target.value })}
                      placeholder="https://..."
                      type="url"
                      style={{
                        width: '100%', background: 'var(--bg)',
                        border: '1px solid var(--border)', borderRadius: 4,
                        padding: '5px 8px', color: 'var(--text)', fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}

                {/* File type mismatch warning */}
                {entry.file && entry.kind !== 'other' && (() => {
                  const accept = ACCEPT_BY_KIND[entry.kind];
                  if (!accept || accept === '*') return null;
                  const exts = accept.split(',');
                  const fileName = entry.file.name.toLowerCase();
                  const matches = exts.some(ext => fileName.endsWith(ext));
                  if (matches) return null;
                  return (
                    <p style={{ fontSize: 11, color: 'var(--warning, #eab308)', marginTop: 4, marginBottom: 0 }}>
                      File type may not match the selected kind. Expected: {accept}
                    </p>
                  );
                })()}

                <SlotAssignmentPicker
                  slots={slots}
                  selectedIds={entry.slotIds}
                  onChange={ids => updateEntry(entry.id, { slotIds: ids })}
                  onAssignmentsChange={assignments => updateEntry(entry.id, { instrumentAssignments: assignments })}
                />

                {/* Migration source picker — only for annotatable kinds */}
                {showMigration(entry.kind) && annotationSources.length > 0 && (() => {
                  const options: { partId: string; label: string; sameSlot: boolean }[] = [];
                  for (const v of annotationSources) {
                    for (const p of v.parts) {
                      const sameSlot = entry.slotIds.length > 0 && entry.slotIds.some(s => p.slotIds.includes(s));
                      if (entry.showAllInstruments || sameSlot || entry.slotIds.length === 0) {
                        options.push({
                          partId: p.partId,
                          label: `${p.partName} — ${v.versionName} (${p.annotationCount} ann.)`,
                          sameSlot,
                        });
                      }
                    }
                  }
                  if (options.length === 0 && !entry.showAllInstruments) return null;
                  const crossInstrument = entry.migrationSourcePartId != null && !options.find(o => o.partId === entry.migrationSourcePartId)?.sameSlot;

                  return (
                    <div style={{ marginTop: 8 }}>
                      <label style={{
                        display: 'block', fontSize: 10, fontWeight: 700,
                        color: 'var(--text-muted)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 4,
                      }}>
                        Migrate annotations from
                      </label>
                      <select
                        value={entry.migrationSourcePartId ?? '__none__'}
                        onChange={e => updateEntry(entry.id, { migrationSourcePartId: e.target.value === '__none__' ? null : e.target.value })}
                        style={{
                          width: '100%', background: 'var(--bg)',
                          border: '1px solid var(--border)', borderRadius: 4,
                          padding: '5px 8px', color: 'var(--text)', fontSize: 12,
                          boxSizing: 'border-box',
                        }}
                      >
                        {options.map(o => (
                          <option key={o.partId} value={o.partId}>{o.label}</option>
                        ))}
                        <option value="__none__">None — start fresh</option>
                      </select>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <input
                          type="checkbox"
                          id={`cross-${entry.id}`}
                          checked={entry.showAllInstruments}
                          onChange={e => updateEntry(entry.id, { showAllInstruments: e.target.checked })}
                          style={{ margin: 0 }}
                        />
                        <label htmlFor={`cross-${entry.id}`} style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                          Also migrate from other instruments
                        </label>
                      </div>
                      {crossInstrument && entry.migrationSourcePartId && (
                        <p style={{ fontSize: 10, color: 'var(--accent)', marginTop: 4, marginBottom: 0 }}>
                          Migrating from a different instrument — positions will be remapped by measure
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}
        {progress && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{progress}</p>}

        <Button type="submit" disabled={entries.length === 0} loading={uploading}>
          {uploading ? 'Uploading...' : entries.length === 0
            ? 'Add files or links above'
            : `Upload ${entries.length} item${entries.length !== 1 ? 's' : ''}`}
        </Button>
      </form>

      {showPostUpload && (
        <PostUploadModal
          chartId={chartId!}
          versionId={uploadedVersionId}
          versionName={uploadedVersionName}
          parts={uploadedParts}
          migrationResults={uploadMigrationResults}
          onGoToChart={() => navigate(`/charts/${chartId}/versions/${uploadedVersionId}`)}
        />
      )}
    </Layout>
  );
}
