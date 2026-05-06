import { Button } from '../Button';

interface RangeWarning {
  measure: number;
  pitch: string;
  reason: string;
}

interface Props {
  warnings: RangeWarning[];
  instrumentName?: string;
  onApplyAnyway: () => void;
  onCancel: () => void;
}

export function RangeWarningModal({ warnings, instrumentName, onApplyAnyway, onCancel }: Props) {
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
        maxWidth: 420,
        width: '90%',
        boxShadow: 'var(--shadow-lg, 0 4px 20px rgba(0,0,0,0.15))',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
          Range Warning
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          This change puts these notes outside {instrumentName ? `the ${instrumentName}'s` : "the instrument's"} playable range:
        </p>
        <div style={{
          maxHeight: 180,
          overflowY: 'auto',
          marginBottom: 16,
          padding: '8px 12px',
          background: 'var(--surface)',
          borderRadius: 6,
          fontSize: 12,
          fontFamily: 'var(--mono)',
        }}>
          {warnings.slice(0, 20).map((w, i) => (
            <div key={i} style={{ padding: '2px 0' }}>
              m.{w.measure}: {w.pitch} ({w.reason})
            </div>
          ))}
          {warnings.length > 20 && (
            <div style={{ color: 'var(--text-faint)', marginTop: 4 }}>
              ...and {warnings.length - 20} more
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={onApplyAnyway}>Apply anyway</Button>
        </div>
      </div>
    </div>
  );
}
