import { useState, FormEvent, DragEvent, ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { uploadVersion } from '../api/charts';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';

export function UploadVersion() {
  const { id: chartId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [files, setFiles] = useState<Record<string, File>>({});
  const [versionName, setVersionName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function addFiles(fileList: FileList) {
    const next = { ...files };
    for (const file of Array.from(fileList)) {
      if (!file.type.includes('pdf')) continue;
      // Derive instrument name from filename: "trumpet part.pdf" → "trumpet_part"
      const instrument = file.name.replace(/\.pdf$/i, '').replace(/\s+/g, '_').toLowerCase();
      next[instrument] = file;
    }
    setFiles(next);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
  }

  function removeFile(instrument: string) {
    const next = { ...files };
    delete next[instrument];
    setFiles(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!chartId || Object.keys(files).length === 0) return;
    setError('');
    setUploading(true);
    try {
      await uploadVersion(chartId, files, versionName.trim() || undefined);
      navigate(`/charts/${chartId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const hasFiles = Object.keys(files).length > 0;

  return (
    <Layout
      title="Upload New Version"
      back={{ label: 'Chart', to: `/charts/${chartId}` }}
    >
      <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
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
            background: dragOver ? 'var(--accent)0a' : 'var(--surface)',
            transition: 'border-color 0.15s, background 0.15s',
            marginBottom: hasFiles ? 16 : 24,
          }}
        >
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
            Drop PDF files here, or click to browse
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            One PDF per instrument part. Filename becomes the instrument name.
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

        {/* File list */}
        {hasFiles && (
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(files).map(([instrument, file]) => (
              <div key={instrument} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              }}>
                <div>
                  <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>
                    {instrument.replace(/_/g, ' ')}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 10 }}>
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(instrument)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

        <Button
          type="submit"
          disabled={!hasFiles}
          loading={uploading}
        >
          {uploading ? 'Uploading…' : `Upload ${Object.keys(files).length || ''} part${Object.keys(files).length === 1 ? '' : 's'}`}
        </Button>
      </form>
    </Layout>
  );
}
