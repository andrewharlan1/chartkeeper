import { useState, useEffect, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createVersion } from '../api/versions';
import { uploadPart, migrateFrom } from '../api/parts';
import { getChart, getChartAnnotationSources, AnnotationSourceVersion } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { getInstrumentSlots } from '../api/instrumentSlots';
import { UploadEntry, PartKind, InstrumentSlot } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { FileDropZone } from '../components/FileDropZone';
import { SlotAssignmentPicker } from '../components/SlotAssignmentPicker';
import { ApiError } from '../api/client';

type MigrationEntry = UploadEntry & {
  migrationSourcePartId: string | null;
  showAllInstruments: boolean;
};

function humanizeName(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
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
      const kind: PartKind = name.toLowerCase().includes('score') ? 'score' : 'part';
      return { id: crypto.randomUUID(), file, name, kind, slotIds: [], migrationSourcePartId: null, showAllInstruments: false };
    });
    setEntries(prev => [...prev, ...added]);
  }

  function updateEntry(id: string, patch: Partial<Pick<MigrationEntry, 'name' | 'kind' | 'slotIds' | 'migrationSourcePartId' | 'showAllInstruments'>>) {
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
    if (names.some(n => !n)) { setError('All files must have a name.'); return; }
    if (new Set(names).size !== names.length) { setError('Each file must have a unique name.'); return; }

    setError('');
    setUploading(true);
    try {
      setProgress('Creating version...');
      const { version } = await createVersion({
        chartId,
        name: versionName.trim() || `Version ${new Date().toLocaleDateString()}`,
      });

      const uploadedParts: { entryId: string; partId: string }[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setProgress(`Uploading ${entry.name} (${i + 1}/${entries.length})...`);
        const { part } = await uploadPart({
          versionId: version.id,
          name: entry.name.trim(),
          file: entry.file,
          kind: entry.kind,
          slotIds: entry.slotIds,
        });
        uploadedParts.push({ entryId: entry.id, partId: part.id });
      }

      // Run migrations for entries that have a source selected
      const migrationsToRun = entries
        .filter(entry => entry.migrationSourcePartId != null)
        .map(entry => ({
          targetPartId: uploadedParts.find(u => u.entryId === entry.id)?.partId,
          sourcePartId: entry.migrationSourcePartId!,
        }))
        .filter((m): m is { targetPartId: string; sourcePartId: string } => m.targetPartId != null);

      if (migrationsToRun.length > 0) {
        setProgress(`Migrating annotations (${migrationsToRun.length} part${migrationsToRun.length !== 1 ? 's' : ''})...`);
        const migrationErrors: string[] = [];
        for (const m of migrationsToRun) {
          try {
            await migrateFrom(m.targetPartId, m.sourcePartId);
          } catch {
            migrationErrors.push(m.targetPartId);
          }
        }
        if (migrationErrors.length > 0) {
          // Non-blocking: navigate anyway, show warning on the version page
          console.warn(`[UploadVersion] Migration failed for ${migrationErrors.length} part(s)`);
        }
      }

      navigate(`/charts/${chartId}/versions/${version.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

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

        {/* Drop zone */}
        <div style={{ marginBottom: 16 }}>
          <FileDropZone
            onFiles={addFiles}
            hint="Select as many files as you like — name each after adding"
          />
        </div>

        {/* File entries */}
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
                    placeholder="Name this file..."
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
                    <option value="part">Part</option>
                    <option value="score">Score</option>
                  </select>
                  <button type="button" onClick={() => removeEntry(entry.id)} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 18, padding: '2px 6px', lineHeight: 1,
                  }}>{'\u00D7'}</button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
                  {entry.file.name} {'\u00B7'} {(entry.file.size / 1024).toFixed(0)} KB
                </p>
                <SlotAssignmentPicker
                  slots={slots}
                  selectedIds={entry.slotIds}
                  onChange={ids => updateEntry(entry.id, { slotIds: ids })}
                />
                {/* Migration source picker — only when annotated previous parts exist */}
                {annotationSources.length > 0 && (() => {
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
            ? 'Add files above'
            : `Upload ${entries.length} file${entries.length !== 1 ? 's' : ''}`}
        </Button>
      </form>
    </Layout>
  );
}
