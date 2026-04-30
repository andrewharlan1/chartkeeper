import { useState, useRef, useEffect } from 'react';
import { InstrumentSlot } from '../types';
import { InstrumentIcon, INSTRUMENT_LIST } from './InstrumentIcon';

export type InstrumentAssignment =
  | { existingSlotId: string }
  | { newInstrumentName: string };

interface Props {
  slots: InstrumentSlot[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Called when user creates new instruments inline — provides assignment objects for the API */
  onAssignmentsChange?: (assignments: InstrumentAssignment[]) => void;
  /** Render in compact mode for tray rows */
  compact?: boolean;
}

export function SlotAssignmentPicker({ slots, selectedIds, onChange, onAssignmentsChange, compact }: Props) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [newNames, setNewNames] = useState<string[]>([]); // locally-created names
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Notify parent of assignments whenever selection changes
  useEffect(() => {
    if (!onAssignmentsChange) return;
    const assignments: InstrumentAssignment[] = [
      ...selectedIds.map(id => ({ existingSlotId: id })),
      ...newNames.map(name => ({ newInstrumentName: name })),
    ];
    onAssignmentsChange(assignments);
  }, [selectedIds, newNames, onAssignmentsChange]);

  function toggle(slotId: string) {
    if (selectedIds.includes(slotId)) {
      onChange(selectedIds.filter(id => id !== slotId));
    } else {
      onChange([...selectedIds, slotId]);
    }
  }

  function addNewName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Check if it matches an existing slot (case-insensitive)
    const match = slots.find(s => s.name.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      if (!selectedIds.includes(match.id)) {
        onChange([...selectedIds, match.id]);
      }
      setQuery('');
      setShowDropdown(false);
      return;
    }

    // Check if already in newNames
    if (newNames.some(n => n.toLowerCase() === trimmed.toLowerCase())) {
      setQuery('');
      setShowDropdown(false);
      return;
    }

    setNewNames(prev => [...prev, trimmed]);
    setQuery('');
    setShowDropdown(false);
  }

  function removeNewName(name: string) {
    setNewNames(prev => prev.filter(n => n !== name));
  }

  const lowerQuery = query.toLowerCase().trim();

  // Filter existing slots by query
  const filteredSlots = lowerQuery
    ? slots.filter(s => s.name.toLowerCase().includes(lowerQuery))
    : slots;

  // Suggestions from INSTRUMENT_LIST not in existing slots
  const existingNames = new Set(slots.map(s => s.name.toLowerCase()));
  const newNameSet = new Set(newNames.map(n => n.toLowerCase()));
  const suggestions = lowerQuery
    ? INSTRUMENT_LIST
        .filter(name => name.toLowerCase().includes(lowerQuery))
        .filter(name => !existingNames.has(name.toLowerCase()))
        .filter(name => !newNameSet.has(name.toLowerCase()))
        .slice(0, 5)
    : [];

  // Show "Create new" option if query doesn't match any existing slot or suggestion
  const exactMatch = slots.some(s => s.name.toLowerCase() === lowerQuery) ||
    newNames.some(n => n.toLowerCase() === lowerQuery) ||
    suggestions.some(s => s.toLowerCase() === lowerQuery);
  const showCreateOption = lowerQuery && !exactMatch;

  if (compact) {
    const selectedSlot = selectedIds.length > 0 ? slots.find(s => s.id === selectedIds[0]) : null;
    const label = selectedSlot
      ? selectedSlot.name
      : newNames.length > 0
        ? newNames[0]
        : null;
    return (
      <div ref={containerRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowDropdown(s => !s)}
          className={'slot-pill' + (label ? '' : ' unassigned')}
          style={{ fontSize: 11, padding: '4px 8px 4px 6px' }}
        >
          {label ? (
            <>
              <InstrumentIcon name={label} size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            </>
          ) : (
            <span>assign...</span>
          )}
          <span className="caret" style={{ fontSize: 9 }}>&blacktriangledown;</span>
        </button>
        {showDropdown && (
          <div style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 2, zIndex: 50,
            background: 'var(--surface-raised, var(--surface))', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: 200, overflowY: 'auto', width: 200,
          }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && showCreateOption) { e.preventDefault(); addNewName(query); } }}
                placeholder="Search..."
                autoFocus
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 12, color: 'var(--text)', padding: 0,
                }}
              />
            </div>
            {filteredSlots.map(slot => (
              <button
                key={slot.id}
                type="button"
                onClick={() => { onChange([slot.id]); setQuery(''); setShowDropdown(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '5px 8px', background: selectedIds.includes(slot.id) ? 'var(--accent-subtle)' : 'transparent',
                  border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <InstrumentIcon name={slot.name} size={14} />
                {slot.name}
              </button>
            ))}
            {suggestions.map(name => (
              <button
                key={`suggest-${name}`}
                type="button"
                onClick={() => addNewName(name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '5px 8px', background: 'transparent',
                  border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                + <strong>{name}</strong>
              </button>
            ))}
            {showCreateOption && (
              <button
                type="button"
                onClick={() => addNewName(query)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '5px 8px', background: 'transparent',
                  border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                + Create: <strong>{query.trim()}</strong>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ marginTop: 6, position: 'relative' }}>
      {/* Selected chips */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: selectedIds.length > 0 || newNames.length > 0 ? 6 : 0 }}>
        {selectedIds.map(id => {
          const slot = slots.find(s => s.id === id);
          if (!slot) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', fontSize: 12, borderRadius: 99,
                border: '1px solid var(--accent)', background: 'var(--accent-subtle)',
                color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              <InstrumentIcon name={slot.name} size={14} />
              {slot.name}
              <span style={{ marginLeft: 2, fontSize: 10 }}>{'\u00D7'}</span>
            </button>
          );
        })}
        {newNames.map(name => (
          <button
            key={`new-${name}`}
            type="button"
            onClick={() => removeNewName(name)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', fontSize: 12, borderRadius: 99,
              border: '1px dashed var(--accent)', background: 'rgba(99,102,241,0.06)',
              color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            <InstrumentIcon name={name} size={14} />
            {name}
            <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>new</span>
            <span style={{ marginLeft: 2, fontSize: 10 }}>{'\u00D7'}</span>
          </button>
        ))}
      </div>

      {/* Search input */}
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' && showCreateOption) {
            e.preventDefault();
            addNewName(query);
          }
        }}
        placeholder="Assign to instrument..."
        style={{
          width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontSize: 12,
          boxSizing: 'border-box',
        }}
      />

      {/* Dropdown */}
      {showDropdown && (filteredSlots.length > 0 || suggestions.length > 0 || showCreateOption) && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 2,
          zIndex: 50, background: 'var(--surface-raised, var(--surface))',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.15))',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {/* Existing slots */}
          {filteredSlots.map(slot => {
            const selected = selectedIds.includes(slot.id);
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => { toggle(slot.id); setQuery(''); setShowDropdown(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 10px', background: selected ? 'var(--accent-subtle)' : 'transparent',
                  border: 'none', cursor: 'pointer', color: selected ? 'var(--accent)' : 'var(--text)',
                  fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <InstrumentIcon name={slot.name} size={16} />
                {slot.name}
                {selected && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent)' }}>selected</span>}
              </button>
            );
          })}

          {/* Suggestions from known instruments (not in ensemble yet) */}
          {suggestions.length > 0 && filteredSlots.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
          )}
          {suggestions.map(name => (
            <button
              key={`suggest-${name}`}
              type="button"
              onClick={() => addNewName(name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 10px', background: 'transparent',
                border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <InstrumentIcon name={name} size={16} />
              <span>Create <strong>{name}</strong></span>
            </button>
          ))}

          {/* Create new option */}
          {showCreateOption && (
            <>
              {(filteredSlots.length > 0 || suggestions.length > 0) && (
                <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
              )}
              <button
                type="button"
                onClick={() => addNewName(query)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 10px', background: 'transparent',
                  border: 'none', cursor: 'pointer', color: 'var(--accent)',
                  fontSize: 12, fontFamily: 'inherit', textAlign: 'left', fontWeight: 500,
                }}
              >
                + Create new instrument: <strong>{query.trim()}</strong>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
