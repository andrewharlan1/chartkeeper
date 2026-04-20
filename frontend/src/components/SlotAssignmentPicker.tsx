import { InstrumentSlot } from '../types';
import { InstrumentIcon } from './InstrumentIcon';

interface Props {
  slots: InstrumentSlot[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function SlotAssignmentPicker({ slots, selectedIds, onChange }: Props) {
  if (slots.length === 0) return null;

  function toggle(slotId: string) {
    if (selectedIds.includes(slotId)) {
      onChange(selectedIds.filter(id => id !== slotId));
    } else {
      onChange([...selectedIds, slotId]);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
      {slots.map(slot => {
        const selected = selectedIds.includes(slot.id);
        return (
          <button
            key={slot.id}
            type="button"
            onClick={() => toggle(slot.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px',
              fontSize: 12,
              borderRadius: 99,
              border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              background: selected ? 'var(--accent-subtle)' : 'transparent',
              color: selected ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: selected ? 600 : 400,
              transition: 'all 0.12s',
            }}
          >
            <InstrumentIcon name={slot.name} size={14} />
            {slot.name}
          </button>
        );
      })}
    </div>
  );
}
