import { useState, useEffect, FormEvent, DragEvent, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { uploadVersion, getVersions } from '../api/charts';
import { PartSummary, UploadEntry, PartType } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: PartType; label: string }[] = [
  { value: 'part',  label: 'Part' },
  { value: 'score', label: 'Score' },
  { value: 'audio', label: 'Audio' },
  { value: 'chart', label: 'Chord chart' },
  { value: 'link',  label: 'Link' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABELS: Record<PartType, string> = {
  score: 'Score', part: 'Part', audio: 'Audio',
  chart: 'Chord chart', link: 'Link', other: 'Other',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanizeName(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
}

function guessType(filename: string): PartType {
  const lower = filename.toLowerCase();
  if (lower.includes('score') || lower.includes('full score')) return 'score';
  if (lower.includes('chord') || lower.includes('lead sheet')) return 'chart';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(lower)) return 'audio';
  return 'part';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UploadVersion() {
  const { id: chartId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [versionName, setVersionName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [activeParts, setActiveParts] = useState<PartSummary[]>([]);
  // Carry-forward checklist: set of instrumentNames to inherit
  const [inheritChecked, setInheritChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!chartId) return;
    getVersions(chartId).then(res => {
      const active = res.versions.find(v => v.is_active);
      if (active) {
        setActiveParts(active.parts);
        setInheritChecked(new Set(active.parts.map(p => p.instrumentName)));
      }
    }).catch(() => {});
  }, [chartId]);

  function addFiles(fileList: FileList) {
    const added: UploadEntry[] = [];
    for (const file of Array.from(fileList)) {
      added.push({
        id: crypto.randomUUID(),
        file,
        name: humanizeName(file.name),
        type: guessType(file.name),
      });
    }
    setEntries(prev => [...prev, ...added]);
  }

  function addLink() {
    setEntries(prev => [...prev, { id: crypto.randomUUID(), name: '', type: 'link', url: '' }]);
  }

  function updateEntry(id: string, patch: Partial<Pick<UploadEntry, 'name' | 'type' | 'url'>>) {
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

  function toggleInherit(name: string) {
    setInheritChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!chartId || (entries.length === 0 && inheritChecked.size === 0)) return;

    const names = entries.map(e => e.name.trim());
    if (names.some(n => !n)) { setError('All files must have a name.'); return; }
    if (new Set(names).size !== names.length) { setError('Each file must have a unique name.'); return; }

    // Validate link entries have a URL
    const badLink = entries.find(e => e.type === 'link' && !e.url?.trim());
    if (badLink) { setError(`"${badLink.name || 'Unnamed link'}" is missing a URL.`); return; }

    setError('');
    setUploading(true);
    try {
      const uploadedNames = new Set(entries.map(e => e.name.trim()));
      const inheritedNames = [...inheritChecked].filter(n => !uploadedNames.has(n));
      await uploadVersion(chartId, entries, versionName.trim() || undefined, inheritedNames);
      navigate(`/charts/${chartId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const uploadedNames = new Set(entries.map(e => e.name.trim()));
  // Parts from active version that are candidates for carry-forward
  const carryForwardCandidates = activeParts.filter(p => !uploadedNames.has(p.instrumentName));
  const inheritedCount = carryForwardCandidates.filter(p => inheritChecked.has(p.instrumentName)).length;

  const canSubmit = entries.length > 0 || inheritedCount > 0;

  return (
    <Layout
      title="Upload New Version"
      back={{ label: 'Chart', to: `/charts/${chartId}` }}
    >
      <form onSubmit={handleSubmit} style={{ maxWidth: 620 }}>

        {/* Version name */}
        <div className="form-group">
          <label>Version name (optional)</label>
          <input
            value={versionName}
            onChange={e => setVersionName(e.target.value)}
            placeholder='e.g. "v2 – 2025-04-13" or "Post-recording edits" — auto-named if blank'
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Tip: include a date or version number so you can find it later.
          </p>
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
            marginBottom: 12,
          }}
        >
          <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
            Drop any PDF or audio files here, or click to browse
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Batch-select as many files as you like — name and classify each after adding
          </p>
          <input id="file-input" type="file" multiple accept=".pdf,.mp3,.wav,.m4a,.aac,.ogg,.flac,application/pdf,audio/*"
            onChange={handleFileInput} style={{ display: 'none' }} />
        </div>

        {/* Add link button */}
        <div style={{ marginBottom: entries.length > 0 ? 16 : 24, textAlign: 'right' }}>
          <button type="button" onClick={addLink} style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', fontSize: 13, padding: 0,
          }}>
            + Add a link (e.g. Ultimate Guitar, YouTube)
          </button>
        </div>

        {/* Uploaded file entries */}
        {entries.length > 0 && (
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(entry => (
              <div key={entry.id} style={{
                padding: '10px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 8, alignItems: 'center' }}>
                  <input
                    value={entry.name}
                    onChange={e => updateEntry(entry.id, { name: e.target.value })}
                    placeholder={entry.type === 'link' ? 'Name this link…' : 'Name this file…'}
                    style={{
                      width: '100%', background: 'var(--bg)',
                      border: '1px solid var(--border)', borderRadius: 4,
                      padding: '5px 8px', color: 'var(--text)', fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                  <select
                    value={entry.type}
                    onChange={e => updateEntry(entry.id, { type: e.target.value as PartType })}
                    style={{
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 13, height: 32,
                    }}
                  >
                    {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeEntry(entry.id)} style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 18, padding: '2px 6px', lineHeight: 1,
                  }}>×</button>
                </div>

                {/* URL input for link type */}
                {entry.type === 'link' && (
                  <input
                    value={entry.url ?? ''}
                    onChange={e => updateEntry(entry.id, { url: e.target.value })}
                    placeholder="https://…"
                    style={{
                      marginTop: 8, width: '100%', background: 'var(--bg)',
                      border: '1px solid var(--border)', borderRadius: 4,
                      padding: '5px 8px', color: 'var(--text)', fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                )}

                {/* File size note for non-link types */}
                {entry.file && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
                    {entry.file.name} · {(entry.file.size / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Carry-forward checklist */}
        {carryForwardCandidates.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
              Carry forward from current version (uncheck to drop):
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {carryForwardCandidates.map(p => (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', background: 'var(--bg)',
                  border: `1px ${inheritChecked.has(p.instrumentName) ? 'dashed' : 'solid'} var(--border)`,
                  borderRadius: 'var(--radius)', cursor: 'pointer',
                  opacity: inheritChecked.has(p.instrumentName) ? 1 : 0.5,
                  userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={inheritChecked.has(p.instrumentName)}
                    onChange={() => toggleInherit(p.instrumentName)}
                    style={{ width: 15, height: 15, accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, flex: 1 }}>{p.instrumentName}</span>
                  {p.partType !== 'part' && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {TYPE_LABELS[p.partType]}
                    </span>
                  )}
                </label>
              ))}
            </div>
            {carryForwardCandidates.length > 1 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setInheritChecked(new Set(carryForwardCandidates.map(p => p.instrumentName)))}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                  Select all
                </button>
                <button type="button" onClick={() => setInheritChecked(new Set())}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                  Deselect all
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

        <Button type="submit" disabled={!canSubmit} loading={uploading}>
          {uploading ? 'Uploading…' : (
            entries.length === 0 && inheritedCount === 0
              ? 'Add files or links above'
              : [
                  entries.length > 0 && `Upload ${entries.length} file${entries.length !== 1 ? 's' : ''}`,
                  inheritedCount > 0 && `${inheritedCount} carried forward`,
                ].filter(Boolean).join(' · ')
          )}
        </Button>
      </form>
    </Layout>
  );
}
