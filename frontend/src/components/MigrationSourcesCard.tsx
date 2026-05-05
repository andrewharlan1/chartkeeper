import { useState } from 'react';
import { Button } from './Button';
import { MigrationSourcePicker, SelectedSource } from './MigrationSourcePicker';

interface Props {
  ensembleId: string;
  targetPartId: string;
  sources: SelectedSource[];
  onChange: (sources: SelectedSource[]) => void;
}

export function MigrationSourcesCard({ ensembleId, targetPartId, sources, onChange }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  function handleRemove(idx: number) {
    onChange(sources.filter((_, i) => i !== idx));
  }

  function handleAdd(source: SelectedSource) {
    onChange([...sources, source]);
  }

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: 12,
      marginTop: 12,
      background: 'var(--surface-raised)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          Migration sources
        </span>
        <Button variant="secondary" size="sm" onClick={() => setShowPicker(true)}>
          Add source
        </Button>
      </div>

      {sources.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          No sources selected. Annotations from selected sources will be copied to this part.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sources.map((s, i) => (
            <span
              key={`${s.sourcePartId}::${s.sourceVersionId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: s.isSameInstrument ? 'var(--accent-bg, rgba(59,130,246,0.1))' : 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12, padding: '3px 8px', fontSize: 11,
                color: 'var(--text)',
              }}
            >
              {s.partName} \u00B7 {s.versionLabel}
              <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>({s.annotationCount})</span>
              <button
                onClick={() => handleRemove(i)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2,
                }}
              >
                \u00D7
              </button>
            </span>
          ))}
        </div>
      )}

      {showPicker && (
        <MigrationSourcePicker
          ensembleId={ensembleId}
          targetPartId={targetPartId}
          alreadySelected={sources}
          onSelect={handleAdd}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
