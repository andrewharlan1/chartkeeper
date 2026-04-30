import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { createVersion, getVersions } from '../api/versions';
import { uploadPart, migrateFrom, InstrumentAssignment } from '../api/parts';
import { getChart, getChartAnnotationSources, AnnotationSourceVersion, getChartVersionInstruments } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { getInstrumentSlots } from '../api/instrumentSlots';
import { UploadEntry, PartKind, InstrumentSlot, ANNOTATABLE_KINDS, Version } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { FileDropZone } from '../components/FileDropZone';
import { SlotAssignmentPicker } from '../components/SlotAssignmentPicker';
import { ContentKindIcon, KIND_LABELS } from '../components/ContentKindIcon';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { PublishConfirmModal } from '../components/PublishConfirmModal';
import { ApiError } from '../api/client';
import './Upload.css';

type MigrationEntry = UploadEntry & {
  migrationSourcePartId: string | null;
  showAllInstruments: boolean;
  instrumentAssignments: InstrumentAssignment[];
};

type TargetMode = 'new' | 'current';

const ALL_KINDS: PartKind[] = ['part', 'score', 'chart', 'link', 'audio', 'other'];

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
  const [existingVersions, setExistingVersions] = useState<Version[]>([]);
  const [carryForwardInstruments, setCarryForwardInstruments] = useState<string[]>([]);

  // Target mode: new version or add to current
  const [target, setTarget] = useState<TargetMode>('new');

  useEffect(() => {
    if (!chartId) return;
    Promise.all([
      getChart(chartId),
      getVersions(chartId),
    ]).then(async ([{ chart }, { versions }]) => {
      setChartName(chart.name);
      setExistingVersions(versions);
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

        // Load carry-forward instruments from current version
        const currentVersion = versions.find(v => v.isCurrent) || versions[0];
        if (currentVersion) {
          try {
            const data = await getChartVersionInstruments(chartId, currentVersion.id);
            const names = data.instruments
              .filter(i => i.currentParts.length > 0)
              .map(i => i.instrumentName);
            setCarryForwardInstruments(names);
          } catch { /* instruments not loaded */ }
        }
      } catch { /* partial data */ }
    }).catch(() => {});
  }, [chartId]);

  const [entries, setEntries] = useState<MigrationEntry[]>([]);
  const [versionName, setVersionName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  // Publish confirm state
  const [publishResult, setPublishResult] = useState<{
    versionName: string;
    versionId: string;
    partsAdded: number;
    migrated: number;
  } | null>(null);

  const sortedVersions = [...existingVersions].sort((a, b) => b.sortOrder - a.sortOrder);
  const currentVersion = sortedVersions.find(v => v.isCurrent) || sortedVersions[0];
  const nextVersionNumber = sortedVersions.length + 1;
  const nextVersionLabel = `v${nextVersionNumber}`;

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
      return {
        id: crypto.randomUUID(), file, name, kind,
        slotIds: [], migrationSourcePartId: null,
        showAllInstruments: false, instrumentAssignments: [],
      };
    });
    setEntries(prev => [...prev, ...added]);
  }

  function addLinkEntry() {
    setEntries(prev => [...prev, {
      id: crypto.randomUUID(), file: null, name: '', kind: 'link' as PartKind,
      slotIds: [], linkUrl: '', migrationSourcePartId: null,
      showAllInstruments: false, instrumentAssignments: [],
    }]);
  }

  function updateEntry(id: string, patch: Partial<Pick<MigrationEntry, 'name' | 'kind' | 'slotIds' | 'migrationSourcePartId' | 'showAllInstruments' | 'linkUrl' | 'instrumentAssignments'>>) {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, ...patch };
      if ('slotIds' in patch && !('migrationSourcePartId' in patch)) {
        updated.migrationSourcePartId = getDefaultSource(updated.slotIds);
      }
      return updated;
    }));
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  // Which instruments from current version aren't being replaced by an upload
  const uploadedSlotNames = entries
    .flatMap(e => e.slotIds.map(sid => slots.find(s => s.id === sid)?.name))
    .filter(Boolean) as string[];
  const carriedForward = carryForwardInstruments.filter(n => !uploadedSlotNames.includes(n));

  async function handlePublish() {
    if (!chartId || entries.length === 0) return;

    const names = entries.map(e => e.name.trim());
    if (names.some(n => !n)) { setError('All entries must have a name.'); return; }
    if (new Set(names).size !== names.length) { setError('Each entry must have a unique name.'); return; }

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
      let versionId: string;
      let vName: string;

      if (target === 'current' && currentVersion) {
        versionId = currentVersion.id;
        vName = currentVersion.name;
        setProgress(`Adding to ${currentVersion.name}...`);
      } else {
        setProgress('Creating version...');
        const { version } = await createVersion({
          chartId,
          name: versionName.trim() || `Version ${nextVersionNumber}`,
        });
        versionId = version.id;
        vName = version.name;
      }

      let migratedCount = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setProgress(`Uploading ${entry.name} (${i + 1}/${entries.length})...`);

        let audioDurationSeconds: number | undefined;
        if (entry.kind === 'audio' && entry.file) {
          audioDurationSeconds = await getAudioDuration(entry.file);
        }

        const hasNewInstruments = entry.instrumentAssignments.some(a => 'newInstrumentName' in a);
        const { part } = await uploadPart({
          versionId,
          name: entry.name.trim(),
          file: entry.file,
          kind: entry.kind,
          slotIds: hasNewInstruments ? undefined : entry.slotIds,
          instrumentAssignments: hasNewInstruments ? entry.instrumentAssignments : undefined,
          linkUrl: entry.kind === 'link' ? entry.linkUrl : undefined,
          audioDurationSeconds,
        });

        // Run migration if source selected
        if (entry.migrationSourcePartId) {
          try {
            setProgress(`Migrating annotations for ${entry.name}...`);
            await migrateFrom(part.id, entry.migrationSourcePartId);
            migratedCount++;
          } catch {
            console.warn(`[UploadVersion] Migration failed for part ${part.id}`);
          }
        }
      }

      // Show publish confirm modal instead of navigating
      setPublishResult({
        versionName: vName,
        versionId,
        partsAdded: entries.length,
        migrated: migratedCount,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

  const showMigration = (kind: PartKind) => ANNOTATABLE_KINDS.includes(kind);
  const scoreEntries = entries.filter(e => e.kind === 'score');
  const hasScoreUpload = scoreEntries.length > 0;

  return (
    <Layout
      title="Upload"
      backTo={`/charts/${chartId}`}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        ...(ensembleName ? [{ label: ensembleName, to: `/ensembles/${ensembleId}` }] : []),
        ...(chartName ? [{ label: chartName, to: `/charts/${chartId}` }] : []),
        { label: 'Upload' },
      ]}
    >
      {/* Drop zone */}
      <div style={{ marginBottom: 16 }}>
        <FileDropZone
          onFiles={addFiles}
          accept=".pdf,.musicxml,.mxl,.mp3,.wav,.m4a,.ogg,.flac"
          hint="Drop PDFs, audio files, or other files"
        />
      </div>

      {entries.length > 0 && (
        <div className="upload-tray">
          {/* Dark header */}
          <div className="ut-head">
            <div className="ut-title">
              {uploading && <span className="pulse" />}
              {uploading ? `Uploading ${entries.length} file${entries.length !== 1 ? 's' : ''}...` : 'Upload'}
            </div>
            <div className="ut-meta">
              {entries.length} FILE{entries.length !== 1 ? 'S' : ''} &middot;{' '}
              {target === 'current'
                ? `ADD TO ${currentVersion?.name?.toUpperCase() || 'CURRENT'}`
                : `WILL CREATE ${nextVersionLabel.toUpperCase()}`
              }
            </div>
            <div className="ut-right">
              <Button size="sm" variant="secondary" onClick={() => setEntries([])}>Clear</Button>
            </div>
          </div>

          {/* Target bar — new version vs add to current */}
          {currentVersion && (
            <div className="target-bar">
              <span className="tb-label">Where does this go?</span>
              <div className="tb-seg">
                <button
                  className={target === 'current' ? 'on' : ''}
                  onClick={() => setTarget('current')}
                >
                  Add to current <span className="v">{currentVersion.name}</span>
                </button>
                <button
                  className={target === 'new' ? 'on' : ''}
                  onClick={() => setTarget('new')}
                >
                  Publish as new <span className="v">{nextVersionLabel}</span>
                </button>
              </div>
              <span className="tb-hint">
                {target === 'current'
                  ? 'fixing an upload \u00b7 players see no version bump'
                  : `composer changes \u00b7 players get ${nextVersionLabel} migration banner`
                }
              </span>
            </div>
          )}

          {/* Score preview — shown for score-kind uploads */}
          {hasScoreUpload && scoreEntries.map(entry => (
            <div className="score-tray-preview" key={entry.id}>
              <div className="stp-thumb">
                {[0, 1, 2].map(sys => (
                  <div key={sys}>
                    {[0, 1, 2, 3, 4].map(i => <div className="stp-line" key={i} />)}
                    <div className="stp-gap" />
                  </div>
                ))}
              </div>
              <div className="stp-meta">
                <div className="stp-eyebrow">Detected &middot; conductor's score</div>
                <h4>{entry.file?.name || entry.name}</h4>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {entry.file ? `${(entry.file.size / (1024 * 1024)).toFixed(2)} MB` : ''}
                </p>
              </div>
            </div>
          ))}

          {/* File rows */}
          <div className="ut-body">
            {entries.map(entry => (
              <div className={'ut-row' + (entry.kind === 'score' ? ' score-flagged' : '')} key={entry.id}>
                {/* PDF pill */}
                <div className="ut-pdf">
                  {entry.file ? entry.file.name.split('.').pop()?.toUpperCase().slice(0, 3) || 'PDF' : 'URL'}
                </div>

                {/* Filename cell */}
                <div className="ut-filecell">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <input
                      className="ut-filename"
                      value={entry.name}
                      onChange={e => updateEntry(entry.id, { name: e.target.value })}
                      placeholder="Name..."
                      style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
                    />
                    <div className="ut-filesize">
                      {entry.file ? `${(entry.file.size / 1024).toFixed(0)} KB` : entry.linkUrl || 'link'}
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="ut-arrow">&rarr;</div>

                {/* Slot assignment */}
                <div>
                  <SlotAssignmentPicker
                    slots={slots}
                    selectedIds={entry.slotIds}
                    onChange={ids => updateEntry(entry.id, { slotIds: ids })}
                    onAssignmentsChange={assignments => updateEntry(entry.id, { instrumentAssignments: assignments })}
                    compact
                  />
                </div>

                {/* Migration source */}
                <div>
                  {showMigration(entry.kind) && annotationSources.length > 0 ? (() => {
                    const options: { partId: string; label: string; sameSlot: boolean }[] = [];
                    for (const v of annotationSources) {
                      for (const p of v.parts) {
                        const sameSlot = entry.slotIds.length > 0 && entry.slotIds.some(s => p.slotIds.includes(s));
                        if (entry.showAllInstruments || sameSlot || entry.slotIds.length === 0) {
                          options.push({
                            partId: p.partId,
                            label: `${p.partName} \u00b7 ${v.versionName}`,
                            sameSlot,
                          });
                        }
                      }
                    }
                    const selectedLabel = options.find(o => o.partId === entry.migrationSourcePartId)?.label;
                    return (
                      <select
                        value={entry.migrationSourcePartId ?? '__none__'}
                        onChange={e => updateEntry(entry.id, { migrationSourcePartId: e.target.value === '__none__' ? null : e.target.value })}
                        style={{
                          width: '100%', padding: '5px 8px', fontSize: 11,
                          border: '1px solid var(--border)', borderRadius: 6,
                          background: 'var(--surface-raised, var(--surface))',
                          color: 'var(--text)', fontFamily: 'var(--mono)',
                        }}
                        title={selectedLabel || 'No migration'}
                      >
                        <option value="__none__">no migration</option>
                        {options.map(o => (
                          <option key={o.partId} value={o.partId}>{o.label}</option>
                        ))}
                      </select>
                    );
                  })() : (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>&mdash;</span>
                  )}
                </div>

                {/* Kind / Score toggle + remove */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={entry.kind}
                    onChange={e => updateEntry(entry.id, { kind: e.target.value as PartKind })}
                    style={{
                      background: 'transparent', border: 'none',
                      fontSize: 10, color: entry.kind === 'score' ? 'var(--accent)' : 'var(--text-muted)',
                      fontFamily: 'var(--mono)', cursor: 'pointer', width: 48,
                    }}
                  >
                    {ALL_KINDS.map(k => (
                      <option key={k} value={k}>{KIND_LABELS[k]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    style={{
                      background: 'none', border: 'none',
                      color: 'var(--text-faint)', cursor: 'pointer',
                      fontSize: 16, padding: '0 4px',
                    }}
                  >&times;</button>
                </div>
              </div>
            ))}
          </div>

          {/* Link entry */}
          {entries.some(e => e.kind === 'link') && entries.filter(e => e.kind === 'link').map(entry => (
            <div key={`link-${entry.id}`} style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
              <input
                value={entry.linkUrl ?? ''}
                onChange={e => updateEntry(entry.id, { linkUrl: e.target.value })}
                placeholder="https://..."
                type="url"
                style={{
                  width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '5px 8px', color: 'var(--text)', fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          {/* Carry-forward strip */}
          {target === 'new' && carriedForward.length > 0 && (
            <div className="carry-strip">
              <span className="carry-icons">
                {carriedForward.slice(0, 4).map(n => (
                  <InstrumentIcon key={n} name={n} size={16} />
                ))}
              </span>
              <span>
                <strong>{carriedForward.join(', ')}</strong>{' '}
                {carriedForward.length === 1 ? 'carries' : 'carry'} forward unchanged. No upload needed.
              </span>
            </div>
          )}

          {/* Migration review link */}
          {annotationSources.length > 0 && entries.some(e => showMigration(e.kind)) && (
            <div style={{ padding: '8px 18px', borderTop: '1px dashed var(--border)', fontSize: 12 }}>
              <Link to={`/charts/${chartId}/migration-sources`} style={{ color: 'var(--accent)' }}>
                Review migrations separately &rarr;
              </Link>
            </div>
          )}

          {/* Footer */}
          <div className="ut-foot">
            {target === 'new' && (
              <input
                className="ut-name-input"
                value={versionName}
                onChange={e => setVersionName(e.target.value)}
                placeholder="(optional) name this version"
              />
            )}
            <span style={{ flex: 1 }} />
            {target === 'new' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                auto-named: {nextVersionLabel}
              </span>
            )}
            <Button onClick={handlePublish} loading={uploading} disabled={entries.length === 0}>
              {target === 'current'
                ? `Add to ${currentVersion?.name || 'current'}`
                : `Publish ${nextVersionLabel}`
              }
            </Button>
          </div>

          {error && (
            <div style={{ padding: '8px 18px', background: 'rgba(229,62,62,0.06)', fontSize: 13, color: 'var(--danger, #e53e3e)' }}>
              {error}
            </div>
          )}
          {progress && !publishResult && (
            <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--accent)' }}>
              {progress}
            </div>
          )}
        </div>
      )}

      {/* Empty state — show add-link button */}
      {entries.length === 0 && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={addLinkEntry} style={{
            background: 'none', border: '1px dashed var(--border)', borderRadius: 8,
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            padding: '8px 14px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <ContentKindIcon kind="link" size={14} /> Add link (URL)
          </button>
        </div>
      )}

      {/* Publish confirmation modal */}
      {publishResult && (
        <PublishConfirmModal
          versionName={publishResult.versionName}
          stats={[
            { label: 'parts uploaded', count: publishResult.partsAdded },
            ...(carriedForward.length > 0 ? [{ label: 'carried forward', count: carriedForward.length }] : []),
            ...(publishResult.migrated > 0 ? [{ label: 'migrations run', count: publishResult.migrated }] : []),
          ]}
          onDone={() => navigate(`/charts/${chartId}`)}
          onViewDiff={() => navigate(`/charts/${chartId}/versions/${publishResult.versionId}`)}
        />
      )}
    </Layout>
  );
}
