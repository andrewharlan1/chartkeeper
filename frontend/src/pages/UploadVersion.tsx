import { useState, useEffect, FormEvent, DragEvent, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { uploadVersion, getVersions } from '../api/charts';
import { PartSummary, UploadEntry, PartType } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';

function humanizeName(filename: string): string {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[-_]/g, ' ')
    .trim();
}

function guessType(filename: string): PartType {
  const lower = filename.toLowerCase();
  if (lower.includes('score') || lower.includes('full score')) return 'score';
  return 'part';
}

const TYPE_LABELS: Record<PartType, string> = {
  score: 'Score',
  part: 'Part',
  other: 'Other',
};

export function UploadVersion() {
  const { id: chartId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [versionName, setVersionName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [activeParts, setActiveParts] = useState<PartSummary[]>([]);

  useEffect(() => {
    if (!chartId) return;
    getVersions(chartId).then(res => {
      const active = res.versions.find(v => v.is_active);
      if (active) setActiveParts(active.parts);
    }).catch(() => {});
  }, [chartId]);

  function addFiles(fileList: FileList) {
    const added: UploadEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.includes('pdf')) continue;
      added.push({
        id: crypto.randomUUID(),
        file,
        name: humanizeName(file.name),
        type: guessType(file.name),
      });
    }
    setEntries(prev => [...prev, ...added]);
  }

  function updateEntry(id: string, patch: Partial<Pick<UploadEntry, 'name' | 'type'>>) {
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
    // Reset so the same file can be re-added if removed
    e.target.value = '';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!chartId || entries.length === 0) return;

    const names = entries.map(e => e.name.trim());
    if (names.some(n => !n)) {
      setError('All files must have a name.');
      return;
    }
    if (new Set(names).size !== names.length) {
      setError('Each file must have a unique name.');
      return;
    }

    setError('');
    setUploading(true);
    try {
      await uploadVersion(chartId, entries, versionName.trim() || undefined);
      navigate(`/charts/${chartId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const uploadedNames = new Set(entries.map(e => e.name.trim()));
  const inheritedParts = activeParts.filter(p => !uploadedNames.has(p.instrumentName));

  return (
    <Layout
      title="Upload New Version"
      back={{ label: 'Chart', to: `/charts/${chartId}` }}
    >
      <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
        <div className="form-group">
          <label>Version name (optional)</label>
          <input
            value={versionName}
            onChange={e => setVersionName(e.target.value)}
            placeholder='e.g. "Recording Session Draft" — auto-names if blank'
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
            padding: '32px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
            transition: 'border-color 0.15s, background 0.15s',
            marginBottom: entries.length > 0 ? 16 : 24,
          }}
        >
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            Drop PDF files here, or click to browse
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Score, parts, or other documents — name and classify each after adding
          </p>
          <input
            id="file-input"
            type="file"
            multiple
            accept=".pdf,application/pdf"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </div>

        {/* Uploaded files — editable */}
        {entries.length > 0 && (
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(entry => (
              <div key={entry.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px auto',
                gap: 8,
                alignItems: 'start',
                padding: '10px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}>
                <div>
                  <input
                    value={entry.name}
                    onChange={e => updateEntry(entry.id, { name: e.target.value })}
                    placeholder="Name this file…"
                    style={{
                      width: '100%',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '5px 8px',
                      color: 'var(--text)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                    {entry.file.name} · {(entry.file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <select
                  value={entry.type}
                  onChange={e => updateEntry(entry.id, { type: e.target.value as PartType })}
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                    color: 'var(--text)',
                    fontSize: 13,
                    height: 32,
                  }}
                >
                  <option value="part">Part</option>
                  <option value="score">Score</option>
                  <option value="other">Other</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: 18, padding: '4px 6px', lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Inherited parts preview */}
        {activeParts.length > 0 && inheritedParts.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              These will be carried forward unchanged:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {inheritedParts.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: 'var(--bg)',
                  border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
                  opacity: 0.7,
                }}>
                  <span style={{ fontSize: 13 }}>
                    {p.instrumentName}
                    {p.partType !== 'part' && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        {TYPE_LABELS[p.partType]}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>carried forward</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

        <Button type="submit" disabled={entries.length === 0} loading={uploading}>
          {uploading
            ? 'Uploading…'
            : entries.length === 0
              ? 'Add files to upload'
              : `Upload ${entries.length} file${entries.length !== 1 ? 's' : ''}${inheritedParts.length > 0 ? ` · ${inheritedParts.length} carried forward` : ''}`
          }
        </Button>
      </form>
    </Layout>
  );
}
