import { useState, FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { createEvent } from '../api/events';
import { ApiError } from '../api/client';

interface Props {
  ensembleId: string;
  onClose: () => void;
  onCreated: (eventId: string) => void;
}

const EVENT_TYPES = [
  { value: 'gig', label: 'Gig / performance' },
  { value: 'rehearsal', label: 'Rehearsal' },
  { value: 'recording', label: 'Recording' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'other', label: 'Other' },
] as const;

export function CreateEventModal({ ensembleId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [eventType, setEventType] = useState('gig');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !date) return;
    setError('');
    setCreating(true);
    try {
      // Combine date and time into ISO string
      const dateStr = time ? `${date}T${time}:00.000Z` : `${date}T12:00:00.000Z`;
      const { event } = await createEvent(ensembleId, {
        name: name.trim(),
        eventType,
        startsAt: new Date(dateStr).toISOString(),
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onCreated(event.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal title="New event" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            placeholder="e.g. Friday Night Gig"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Type</label>
            <select value={eventType} onChange={e => setEventType(e.target.value)}>
              {EVENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Location <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Blue Note" />
          </div>
        </div>

        <div className="form-group">
          <label>Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Soundcheck at 5 PM" />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={creating} disabled={!name.trim() || !date}>Create event</Button>
        </div>
      </form>
    </Modal>
  );
}
