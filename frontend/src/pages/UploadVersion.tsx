import { useState, useEffect, FormEvent, DragEvent, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createVersion } from '../api/versions';
import { uploadPart } from '../api/parts';
import { getChart } from '../api/charts';
import { getEnsemble } from '../api/ensembles';
import { UploadEntry, PartKind } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';

function humanizeName(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
}

export function UploadVersion() {
  const { id: chartId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [chartName, setChartName] = useState('');
  const [ensembleName, setEnsembleName] = useState('');
  const [ensembleId, setEnsembleId] = useState('');

  useEffect(() => {
    if (!chartId) return;
    getChart(chartId).then(async ({ chart }) => {
      setChartName(chart.name);
      try {
        const { ensemble } = await getEnsemble(chart.ensembleId);
        setEnsembleName(ensemble.name);
        setEnsembleId(chart.ensembleId);
      } catch { /* breadcrumb will be partial */ }
    }).catch(() => {});
  }, [chartId]);

  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [versionName, setVersionName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  function addFiles(fileList: FileList) {
    const added: UploadEntry[] = [];
    for (const file of Array.from(fileList)) {
      const name = humanizeName(file.name);
      const kind: PartKind = name.toLowerCase().includes('score') ? 'score' : 'part';
      added.push({
        id: crypto.randomUUID(),
        file,
        name,
        kind,
        slotIds: [],
      });
    }
    setEntries(prev => [...prev, ...added]);
  }

  function updateEntry(id: string, patch: Partial<Pick<UploadEntry, 'name' | 'kind'>>) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
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

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        setProgress(`Uploading ${entry.name} (${i + 1}/${entries.length})...`);
        await uploadPart({
          versionId: version.id,
          name: entry.name.trim(),
          file: entry.file,
          kind: entry.kind,
          slotIds: entry.slotIds,
        });
      }

      navigate(`/charts/${chartId}`);
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
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => document.getElementById('file-input')?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            padding: '28px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
            transition: 'border-color 0.15s, background 0.15s',
            marginBottom: 16,
          }}
        >
          <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
            Drop PDF files here, or click to browse
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Select as many files as you like — name each after adding
          </p>
          <input id="file-input" type="file" multiple accept=".pdf,application/pdf"
            onChange={handleFileInput} style={{ display: 'none' }} />
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
