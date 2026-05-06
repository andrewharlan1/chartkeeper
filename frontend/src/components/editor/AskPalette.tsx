import { useState, FormEvent } from 'react';
import { parseEdit, ValidOperation } from '../../api/edits';
import { Button } from '../Button';

interface Props {
  partId: string;
  versionId: string;
  onOperation: (op: ValidOperation, naturalLanguage: string) => void;
}

export function AskPalette({ partId, versionId, onOperation }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await parseEdit({
        naturalLanguage: input.trim(),
        contextPartId: partId,
        contextVersionId: versionId,
      });

      if ('reason' in result) {
        setError((result as { op: 'unknown'; reason: string }).reason);
      } else {
        onOperation(result.op as ValidOperation, input.trim());
        setInput('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse command');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder='Type what you want to do... (e.g. "transpose down a step")'
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'inherit',
            background: 'var(--bg)',
            color: 'var(--text)',
          }}
        />
        <Button size="sm" variant="primary" disabled={loading || !input.trim()}>
          {loading ? 'Parsing...' : 'Submit'}
        </Button>
      </form>

      {error && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          background: 'rgba(200,83,28,0.06)',
          border: '1px solid rgba(200,83,28,0.2)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
        Examples: "transpose down a step", "up an octave", "change to trumpet in B-flat"
      </div>
    </div>
  );
}
