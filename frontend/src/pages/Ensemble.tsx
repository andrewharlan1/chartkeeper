import { useEffect, useState, FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getEnsemble, deleteEnsemble } from '../api/ensembles';
import { getCharts, createChart, deleteChart } from '../api/charts';
import { getInstrumentSlots, createInstrumentSlot, deleteInstrumentSlot } from '../api/instrumentSlots';
import { Ensemble as EnsembleType, Chart, InstrumentSlot } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { InstrumentIcon } from '../components/InstrumentIcon';

export function EnsemblePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ensemble, setEnsemble] = useState<EnsembleType | null>(null);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateChart, setShowCreateChart] = useState(false);
  const [chartName, setChartName] = useState('');
  const [chartComposer, setChartComposer] = useState('');
  const [creatingChart, setCreatingChart] = useState(false);
  const [chartError, setChartError] = useState('');
  const [deletingChart, setDeletingChart] = useState<string | null>(null);

  const [newSlotName, setNewSlotName] = useState('');
  const [addingSlot, setAddingSlot] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [removingSlot, setRemovingSlot] = useState<string | null>(null);
  const [slotsOpen, setSlotsOpen] = useState(true);

  const [deletingEnsemble, setDeletingEnsemble] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getEnsemble(id),
      getCharts(id),
      getInstrumentSlots(id),
    ]).then(([ensRes, chartsRes, slotsRes]) => {
      setEnsemble(ensRes.ensemble);
      setCharts(chartsRes.charts);
      setSlots(slotsRes.instrumentSlots);
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  async function handleCreateChart(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setChartError('');
    setCreatingChart(true);
    try {
      const { chart } = await createChart({
        ensembleId: id,
        name: chartName.trim() || 'Untitled',
        composer: chartComposer.trim() || undefined,
      });
      setCharts(prev => [chart, ...prev]);
      setShowCreateChart(false);
      setChartName('');
      setChartComposer('');
    } catch (err) {
      setChartError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreatingChart(false);
    }
  }

  async function handleDeleteChart(chartId: string, name: string) {
    if (!confirm(`Delete "${name || 'Untitled'}"? This cannot be undone.`)) return;
    setDeletingChart(chartId);
    try {
      await deleteChart(chartId);
      setCharts(prev => prev.filter(c => c.id !== chartId));
    } catch {
      alert('Failed to delete chart');
    } finally {
      setDeletingChart(null);
    }
  }

  async function handleAddSlot(e: FormEvent) {
    e.preventDefault();
    if (!id || !newSlotName.trim()) return;
    setSlotError('');
    setAddingSlot(true);
    try {
      const { instrumentSlot } = await createInstrumentSlot({
        ensembleId: id,
        name: newSlotName.trim(),
      });
      setSlots(prev => [...prev, instrumentSlot]);
      setNewSlotName('');
    } catch (err) {
      setSlotError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setAddingSlot(false);
    }
  }

  async function handleRemoveSlot(slotId: string, name: string) {
    if (!confirm(`Remove "${name}" from this ensemble's instrument list?`)) return;
    setRemovingSlot(slotId);
    try {
      await deleteInstrumentSlot(slotId);
      setSlots(prev => prev.filter(s => s.id !== slotId));
    } catch {
      alert('Failed to remove instrument');
    } finally {
      setRemovingSlot(null);
    }
  }

  async function handleDeleteEnsemble() {
    if (!id || !ensemble) return;
    if (!confirm(`Permanently delete "${ensemble.name}"? This cannot be undone.`)) return;
    setDeletingEnsemble(true);
    try {
      await deleteEnsemble(id);
      navigate('/');
    } catch {
      alert('Failed to delete ensemble.');
      setDeletingEnsemble(false);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading...</p></Layout>;
  if (!ensemble) return null;

  return (
    <Layout
      title={ensemble.name}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        { label: ensemble.name },
      ]}
      actions={
        <>
          <Button size="sm" onClick={() => setShowCreateChart(true)}>+ New chart</Button>
          <Button variant="danger" size="sm" loading={deletingEnsemble} onClick={handleDeleteEnsemble}>
            Delete ensemble
          </Button>
        </>
      }
    >
      {/* Instrument Slots */}
      <section style={{ marginBottom: 36 }}>
        <button
          onClick={() => setSlotsOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: slotsOpen ? 14 : 0,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%',
          }}
        >
          <h2 style={{ margin: 0, flex: 1, textAlign: 'left' }}>
            Instruments <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>({slots.length})</span>
          </h2>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{slotsOpen ? '\u25BE' : '\u25B8'}</span>
        </button>

        {slotsOpen && slots.length === 0 && (
          <p style={{ color: 'var(--text-muted)', marginBottom: 12, fontSize: 14 }}>
            No instruments yet. Add your lineup below.
          </p>
        )}

        {slotsOpen && slots.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {slots.map(slot => (
              <div key={slot.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 18px',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                  background: 'var(--accent-subtle)',
                  border: '1px solid var(--accent-glow)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent)',
                }}>
                  <InstrumentIcon name={slot.name} size={24} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{slot.name}</span>
                  {slot.section && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>{slot.section}</span>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveSlot(slot.id, slot.name)}
                  disabled={removingSlot === slot.id}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-faint)',
                    cursor: 'pointer', fontSize: 13, padding: '3px 6px', borderRadius: 5,
                  }}
                >
                  {removingSlot === slot.id ? '...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}

        {slotsOpen && (
          <>
            <form onSubmit={handleAddSlot} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                <select
                  value={newSlotName}
                  onChange={e => setNewSlotName(e.target.value)}
                  style={{ width: 220, fontSize: 13, borderRadius: 8, padding: '7px 10px', flexShrink: 0 }}
                >
                  <option value="">Pick from list...</option>
                  <optgroup label="Strings">
                    {['Violin', 'Violin 1', 'Violin 2', 'Viola', 'Cello', 'Double Bass', 'Harp'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Guitar & Bass">
                    {['Electric Guitar', 'Acoustic Guitar', 'Bass Guitar', 'Upright Bass', 'Banjo', 'Ukulele'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Keys">
                    {['Piano', 'Keyboard', 'Organ', 'Rhodes', 'Synthesizer', 'Accordion'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Brass">
                    {['Trumpet', 'Trumpet 1', 'Trumpet 2', 'Flugelhorn', 'Trombone', 'Bass Trombone', 'French Horn', 'Tuba', 'Euphonium'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Woodwinds">
                    {['Alto Saxophone', 'Tenor Saxophone', 'Baritone Saxophone', 'Soprano Saxophone', 'Flute', 'Piccolo', 'Oboe', 'Clarinet', 'Bass Clarinet', 'Bassoon'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Percussion">
                    {['Drums', 'Drum Kit', 'Snare Drum', 'Timpani', 'Marimba', 'Vibraphone', 'Xylophone', 'Congas'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                  <optgroup label="Vocals">
                    {['Vocals', 'Lead Vocals', 'Backup Vocals', 'Soprano', 'Alto', 'Tenor', 'Baritone', 'Bass', 'Choir'].map(n => <option key={n}>{n}</option>)}
                  </optgroup>
                </select>
                <input
                  value={newSlotName}
                  onChange={e => setNewSlotName(e.target.value)}
                  placeholder="or type custom name..."
                  style={{ flex: 1, fontSize: 13, borderRadius: 8 }}
                />
              </div>
              <Button type="submit" loading={addingSlot} disabled={!newSlotName.trim()}>
                Add
              </Button>
            </form>
            {slotError && <p className="form-error" style={{ marginTop: 4 }}>{slotError}</p>}
          </>
        )}
      </section>

      {/* Charts */}
      <section>
        <h2 style={{ marginBottom: 14 }}>Charts</h2>
        {charts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No charts yet. Create one above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {charts.map(c => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 20px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                }}
              >
                <Link
                  to={`/charts/${c.id}`}
                  style={{ flex: 1, color: 'var(--text)', textDecoration: 'none' }}
                >
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  {c.composer && <span style={{ color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }}>{c.composer}</span>}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{'\u2192'}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={deletingChart === c.id}
                    onClick={() => handleDeleteChart(c.id, c.name)}
                    style={{ color: 'var(--danger)' }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create chart modal */}
      {showCreateChart && (
        <Modal title="New Chart" onClose={() => setShowCreateChart(false)}>
          <form onSubmit={handleCreateChart}>
            <div className="form-group">
              <label>Name</label>
              <input value={chartName} onChange={e => setChartName(e.target.value)} autoFocus placeholder="e.g. Autumn Leaves" />
            </div>
            <div className="form-group">
              <label>Composer</label>
              <input value={chartComposer} onChange={e => setChartComposer(e.target.value)} placeholder="optional" />
            </div>
            {chartError && <p className="form-error">{chartError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setShowCreateChart(false)}>Cancel</Button>
              <Button type="submit" loading={creatingChart}>Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
