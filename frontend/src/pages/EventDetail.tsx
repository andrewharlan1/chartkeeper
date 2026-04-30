import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getEvent, updateEvent, deleteEvent, addChartToEvent, removeChartFromEvent, reorderEventCharts, EventChart, Event as EventType } from '../api/events';
import { getCharts } from '../api/charts';
import { Chart } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import './EventDetail.css';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function isImminent(dateStr: string): boolean {
  const diff = new Date(dateStr).getTime() - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr).getTime() < Date.now();
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'past';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return `in ${Math.floor(diff / (1000 * 60))}m`;
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

const TYPE_LABELS: Record<string, string> = {
  gig: 'Gig / performance',
  rehearsal: 'Rehearsal',
  recording: 'Recording',
  workshop: 'Workshop',
  other: 'Other',
};

export function EventDetailPage() {
  const { id: ensembleId, eventId } = useParams<{ id: string; eventId: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventType | null>(null);
  const [charts, setCharts] = useState<EventChart[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [ensembleCharts, setEnsembleCharts] = useState<Chart[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editType, setEditType] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function loadEvent() {
    if (!eventId) return;
    try {
      const res = await getEvent(eventId);
      setEvent(res.event);
      setCharts(res.charts);
    } catch {
      navigate(`/ensembles/${ensembleId}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvent();
  }, [eventId]);

  // Load ensemble charts when entering add mode
  useEffect(() => {
    if (!addMode || !ensembleId) return;
    getCharts(ensembleId).then(r => setEnsembleCharts(r.charts)).catch(() => {});
  }, [addMode, ensembleId]);

  const chartIdsInEvent = useMemo(
    () => new Set(charts.map(c => c.chartId)),
    [charts],
  );

  const availableCharts = useMemo(
    () => ensembleCharts.filter(c => !chartIdsInEvent.has(c.id)),
    [ensembleCharts, chartIdsInEvent],
  );

  async function handleAddChart(chartId: string) {
    if (!eventId) return;
    setAdding(chartId);
    try {
      await addChartToEvent(eventId, chartId);
      await loadEvent();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already in event — just reload
        await loadEvent();
      } else {
        alert('Failed to add chart');
      }
    } finally {
      setAdding(null);
    }
  }

  async function handleRemoveChart(chartId: string) {
    if (!eventId) return;
    setRemoving(chartId);
    try {
      await removeChartFromEvent(eventId, chartId);
      setCharts(prev => prev.filter(c => c.chartId !== chartId));
    } catch {
      alert('Failed to remove chart');
    } finally {
      setRemoving(null);
    }
  }

  async function handleMoveChart(index: number, direction: -1 | 1) {
    if (!eventId) return;
    const newCharts = [...charts];
    const target = index + direction;
    if (target < 0 || target >= newCharts.length) return;
    [newCharts[index], newCharts[target]] = [newCharts[target], newCharts[index]];
    setCharts(newCharts);
    try {
      await reorderEventCharts(eventId, newCharts.map(c => c.chartId));
    } catch {
      // Revert on failure
      await loadEvent();
    }
  }

  async function handleSaveEdit() {
    if (!eventId) return;
    setSaving(true);
    setEditError('');
    try {
      const { event: updated } = await updateEvent(eventId, {
        name: editName.trim() || undefined,
        eventType: editType || undefined,
        location: editLocation.trim() || null,
        notes: editNotes.trim() || null,
      });
      setEvent(updated);
      setShowEdit(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!eventId || !event) return;
    if (!confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteEvent(eventId);
      navigate(`/ensembles/${ensembleId}`);
    } catch {
      alert('Failed to delete event');
      setDeleting(false);
    }
  }

  function openEditModal() {
    if (!event) return;
    setEditName(event.name);
    setEditLocation(event.location || '');
    setEditNotes(event.notes || '');
    setEditType(event.eventType);
    setShowEdit(true);
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!event) return null;

  const imminent = isImminent(event.startsAt);
  const past = isPast(event.startsAt);

  return (
    <Layout
      backTo={`/ensembles/${ensembleId}`}
      breadcrumbs={[
        { label: 'Ensembles', to: '/' },
        { label: '...', to: `/ensembles/${ensembleId}` },
        { label: 'Events' },
        { label: event.name },
      ]}
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <PermissionGate action="event.edit" ensembleId={ensembleId}>
            <Button variant="ghost" size="sm" onClick={openEditModal}>Edit</Button>
          </PermissionGate>
          {charts.length > 0 && (
            <Button size="sm" onClick={() => navigate(`/charts/${charts[0].chartId}`)}>
              Open setlist
            </Button>
          )}
        </div>
      }
    >
      {/* ── Event header ──────────────────────────────────────────────── */}
      <div className="event-head">
        <div className="ev-meta-row">
          {imminent && <span className="pill imminent">Today {'\u00B7'} {timeUntil(event.startsAt)}</span>}
          {past && <span className="pill past">Past</span>}
          <span>{formatDate(event.startsAt)} {'\u00B7'} {formatTime(event.startsAt)}</span>
          <span>{TYPE_LABELS[event.eventType] || event.eventType}</span>
        </div>
        <h1 className="ev-title">
          {event.name}
          {event.location && ` \u2014 ${event.location}`}
        </h1>
        {(event.location || event.notes) && (
          <div className="ev-foot">
            {event.location && <span>{'\uD83D\uDCCD'} {event.location}</span>}
            {event.notes && <span>{'\u00B7'} {event.notes}</span>}
          </div>
        )}
      </div>

      {/* ── Add charts mode ──────────────────────────────────────────── */}
      {addMode ? (
        <div className="add-charts-shell">
          <div className="add-charts-pane">
            <div className="add-pane-head">
              <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, margin: 0 }}>
                Ensemble charts
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Click to add to setlist
              </p>
            </div>
            {availableCharts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0' }}>
                All charts already in setlist
              </p>
            ) : (
              availableCharts.map(c => (
                <button
                  key={c.id}
                  className="add-chart-row"
                  onClick={() => handleAddChart(c.id)}
                  disabled={adding === c.id}
                >
                  <span className="acr-grip">{'\u22EE\u22EE'}</span>
                  <div>
                    <div className="acr-name">{c.name}</div>
                    {c.composer && <div className="acr-sub">{c.composer}</div>}
                  </div>
                  <span className="acr-action">{adding === c.id ? '...' : '+ Add'}</span>
                </button>
              ))
            )}
          </div>

          <div className="add-charts-pane setlist-pane">
            <div className="add-pane-head">
              <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 16, margin: 0 }}>
                Setlist {'\u00B7'} {event.name}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                {charts.length} charts
              </p>
            </div>
            {charts.length === 0 ? (
              <div className="drop-zone-empty">
                <p>No charts yet. Add from the left.</p>
              </div>
            ) : (
              charts.map((c, i) => (
                <div key={c.id} className="setlist-row">
                  <div className="sl-num">{i + 1}</div>
                  <div className="sl-info">
                    <div className="sl-name">{c.chartName}</div>
                  </div>
                  <div className="sl-actions">
                    <button
                      onClick={() => handleMoveChart(i, -1)}
                      disabled={i === 0}
                      className="sl-move"
                      title="Move up"
                    >{'\u2191'}</button>
                    <button
                      onClick={() => handleMoveChart(i, 1)}
                      disabled={i === charts.length - 1}
                      className="sl-move"
                      title="Move down"
                    >{'\u2193'}</button>
                    <button
                      onClick={() => handleRemoveChart(c.chartId)}
                      disabled={removing === c.chartId}
                      className="sl-remove"
                      title="Remove from setlist"
                    >{removing === c.chartId ? '...' : '\u00D7'}</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ position: 'absolute', top: -44, right: 0 }}>
            <Button variant="ghost" size="sm" onClick={() => setAddMode(false)}>Done</Button>
          </div>
        </div>
      ) : (
        /* ── Setlist section ────────────────────────────────────────── */
        <div style={{ marginTop: 32 }}>
          <div className="section-head">
            <h2 style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20, margin: 0, letterSpacing: '-0.015em' }}>
              Setlist {'\u00B7'} {charts.length} chart{charts.length !== 1 ? 's' : ''}
            </h2>
            <PermissionGate action="event.charts.add" ensembleId={ensembleId}>
              <Button variant="ghost" size="sm" onClick={() => setAddMode(true)}>Add charts</Button>
            </PermissionGate>
          </div>

          {charts.length === 0 ? (
            <div style={{
              padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
              border: '1px dashed var(--border)', borderRadius: 12, marginTop: 12,
            }}>
              <p>No charts in this setlist yet.</p>
              <PermissionGate action="event.charts.add" ensembleId={ensembleId}>
                <Button size="sm" onClick={() => setAddMode(true)} style={{ marginTop: 8 }}>Add charts</Button>
              </PermissionGate>
            </div>
          ) : (
            <div className="setlist-list">
              {charts.map((c, i) => (
                <div
                  key={c.id}
                  className="setlist-item"
                  onClick={() => navigate(`/charts/${c.chartId}`)}
                >
                  <div className="si-num">{i + 1}</div>
                  <div className="si-info">
                    <div className="si-name">{c.chartName}</div>
                    {c.chartComposer && <div className="si-sub">{c.chartComposer}</div>}
                  </div>
                  <div className="si-reorder">
                    <PermissionGate action="event.charts.reorder" ensembleId={ensembleId}>
                      <button
                        onClick={e => { e.stopPropagation(); handleMoveChart(i, -1); }}
                        disabled={i === 0}
                        className="si-move"
                      >{'\u2191'}</button>
                      <button
                        onClick={e => { e.stopPropagation(); handleMoveChart(i, 1); }}
                        disabled={i === charts.length - 1}
                        className="si-move"
                      >{'\u2193'}</button>
                    </PermissionGate>
                  </div>
                  <PermissionGate action="event.charts.add" ensembleId={ensembleId}>
                    <button
                      onClick={e => { e.stopPropagation(); handleRemoveChart(c.chartId); }}
                      disabled={removing === c.chartId}
                      className="si-remove"
                    >{removing === c.chartId ? '...' : '\u00D7'}</button>
                  </PermissionGate>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Delete event ──────────────────────────────────────────────── */}
      <PermissionGate action="event.delete" ensembleId={ensembleId}>
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px dashed var(--border)' }}>
          <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
            Delete event
          </Button>
        </div>
      </PermissionGate>

      {/* ── Edit modal ───────────────────────────────────────────────── */}
      {showEdit && (
        <Modal title="Edit event" onClose={() => setShowEdit(false)}>
          <div className="form-group">
            <label>Name</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Type</label>
              <select value={editType} onChange={e => setEditType(e.target.value)}>
                <option value="gig">Gig / performance</option>
                <option value="rehearsal">Rehearsal</option>
                <option value="recording">Recording</option>
                <option value="workshop">Workshop</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input value={editLocation} onChange={e => setEditLocation(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <input value={editNotes} onChange={e => setEditNotes(e.target.value)} />
          </div>
          {editError && <p className="form-error">{editError}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button variant="secondary" type="button" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleSaveEdit}>Save</Button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
