import { useState, FormEvent } from 'react';
import { Button } from '../Button';

interface Props {
  isDirector: boolean;
  onSave: (mode: 'personal' | 'ensemble', label: string) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function SaveAsDialog({ isDirector, onSave, onCancel, saving }: Props) {
  const [mode, setMode] = useState<'preview' | 'personal' | 'ensemble'>('personal');
  const [label, setLabel] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'preview') {
      onCancel();
      return;
    }
    if (!label.trim()) return;
    onSave(mode, label.trim());
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }}>
      <div style={{
        background: 'var(--surface-raised, #fff)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '24px',
        maxWidth: 400,
        width: '90%',
        boxShadow: 'var(--shadow-lg, 0 4px 20px rgba(0,0,0,0.15))',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
          Save your edit
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="saveMode"
                checked={mode === 'preview'}
                onChange={() => setMode('preview')}
              />
              Preview only (discard when I leave)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                name="saveMode"
                checked={mode === 'personal'}
                onChange={() => setMode('personal')}
              />
              Save as personal version
            </label>
            {isDirector && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="saveMode"
                  checked={mode === 'ensemble'}
                  onChange={() => setMode('ensemble')}
                />
                Publish to ensemble
              </label>
            )}
          </div>

          {mode === 'personal' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Branch label
              </label>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder='e.g. "Concert pitch read"'
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              />
            </div>
          )}

          {mode === 'ensemble' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Version label
              </label>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder='e.g. "Down a step for concert"'
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={saving || (mode !== 'preview' && !label.trim())}>
              {saving ? 'Saving...' : mode === 'preview' ? 'Discard' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
