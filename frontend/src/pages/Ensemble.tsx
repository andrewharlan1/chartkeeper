import { useEffect, useState, FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getEnsemble, deleteEnsemble } from '../api/ensembles';
import { getCharts, createChart, deleteChart } from '../api/charts';
import {
  getInstrumentSlots, createInstrumentSlot, deleteInstrumentSlot,
  getSlotAssignmentsByEnsemble, assignUserToSlot, unassignUserFromSlot, SlotAssignmentUser,
} from '../api/instrumentSlots';
import { getWorkspaceMembers, addWorkspaceMember, removeWorkspaceMember, seedDummyMembers } from '../api/workspaces';
import { Ensemble as EnsembleType, Chart, InstrumentSlot, WorkspaceMember } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { InstrumentIcon } from '../components/InstrumentIcon';

export function EnsemblePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [ensemble, setEnsemble] = useState<EnsembleType | null>(null);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
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

  // Slot assignments: slotId → assigned users
  const [slotAssignments, setSlotAssignments] = useState<Record<string, SlotAssignmentUser[]>>({});
  const [assignDropdownSlot, setAssignDropdownSlot] = useState<string | null>(null);

  const [showAddMember, setShowAddMember] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [memberIsDummy, setMemberIsDummy] = useState(true);
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [teamOpen, setTeamOpen] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getEnsemble(id),
      getCharts(id),
      getInstrumentSlots(id),
    ]).then(async ([ensRes, chartsRes, slotsRes]) => {
      setEnsemble(ensRes.ensemble);
      setCharts(chartsRes.charts);
      setSlots(slotsRes.instrumentSlots);
      // Load workspace members and slot assignments
      try {
        const [membersRes, assignRes] = await Promise.all([
          getWorkspaceMembers(ensRes.ensemble.workspaceId),
          getSlotAssignmentsByEnsemble(id!),
        ]);
        setMembers(membersRes.members);
        setSlotAssignments(assignRes.assignments);
      } catch { /* non-critical */ }
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
      setShowCreateChart(false);
      setChartName('');
      setChartComposer('');
      navigate(`/charts/${chart.id}/upload`);
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

  async function handleAssignUser(slotId: string, userId: string) {
    try {
      await assignUserToSlot(slotId, userId);
      const assigned = members.find(m => m.id === userId);
      if (assigned) {
        setSlotAssignments(prev => ({
          ...prev,
          [slotId]: [...(prev[slotId] || []), {
            userId: assigned.id, name: assigned.name, email: assigned.email, isDummy: assigned.isDummy,
          }],
        }));
      }
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to assign user');
    }
    setAssignDropdownSlot(null);
  }

  async function handleUnassignUser(slotId: string, userId: string) {
    try {
      await unassignUserFromSlot(slotId, userId);
      setSlotAssignments(prev => ({
        ...prev,
        [slotId]: (prev[slotId] || []).filter(a => a.userId !== userId),
      }));
    } catch {
      alert('Failed to remove assignment');
    }
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!ensemble) return;
    setMemberError('');
    setAddingMember(true);
    try {
      const { member } = await addWorkspaceMember(ensemble.workspaceId, {
        name: memberName.trim(),
        email: memberEmail.trim() || undefined,
        role: memberRole,
        isDummy: memberIsDummy,
      });
      setMembers(prev => [...prev, member]);
      setShowAddMember(false);
      setMemberName('');
      setMemberEmail('');
      setMemberRole('member');
      setMemberIsDummy(true);
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId: string, name: string | null) {
    if (!ensemble) return;
    if (!confirm(`Remove ${name || 'this member'} from the workspace?`)) return;
    setRemovingMember(userId);
    try {
      await removeWorkspaceMember(ensemble.workspaceId, userId);
      setMembers(prev => prev.filter(m => m.id !== userId));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to remove member');
    } finally {
      setRemovingMember(null);
    }
  }

  async function handleSeedDummies() {
    if (!ensemble) return;
    setSeeding(true);
    try {
      await seedDummyMembers(ensemble.workspaceId);
      const { members: m } = await getWorkspaceMembers(ensemble.workspaceId);
      setMembers(m);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to seed dummy users');
    } finally {
      setSeeding(false);
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
      backTo="/"
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
      {/* Charts */}
      <section style={{ marginBottom: 36 }}>
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
            {slots.map(slot => {
              const assigned = slotAssignments[slot.id] || [];
              const assignedIds = new Set(assigned.map(a => a.userId));
              const availableToAssign = members.filter(m => !assignedIds.has(m.id));

              return (
                <div key={slot.id} style={{
                  padding: '14px 18px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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

                  {/* Assigned users */}
                  <div style={{ marginTop: 8, marginLeft: 52, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {assigned.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>(unassigned)</span>
                    )}
                    {assigned.map(a => (
                      <span
                        key={a.userId}
                        onClick={() => handleUnassignUser(slot.id, a.userId)}
                        title={`Click to remove ${a.name || a.email} from ${slot.name}`}
                        style={{
                          fontSize: 12, padding: '2px 8px', borderRadius: 10,
                          background: a.isDummy ? 'var(--surface)' : 'var(--accent-subtle)',
                          border: `1px solid ${a.isDummy ? 'var(--border)' : 'var(--accent-glow)'}`,
                          cursor: 'pointer',
                        }}
                      >
                        {a.name || a.email}
                        {a.userId === user?.id && ' (you)'}
                      </span>
                    ))}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setAssignDropdownSlot(assignDropdownSlot === slot.id ? null : slot.id)}
                        style={{
                          background: 'none', border: '1px dashed var(--border)', borderRadius: 10,
                          padding: '2px 8px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)',
                        }}
                      >
                        + Assign
                      </button>
                      {assignDropdownSlot === slot.id && availableToAssign.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
                          background: 'var(--surface-raised)', border: '1px solid var(--border)',
                          borderRadius: 8, boxShadow: 'var(--shadow-md)', minWidth: 200, padding: 4,
                        }}>
                          {availableToAssign.map(m => (
                            <button
                              key={m.id}
                              onClick={() => handleAssignUser(slot.id, m.id)}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                background: 'none', border: 'none', padding: '6px 10px',
                                fontSize: 13, cursor: 'pointer', borderRadius: 6,
                              }}
                            >
                              {m.name || m.email}
                              {m.isDummy && <span style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 11 }}>dummy</span>}
                              <span style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 11 }}>{m.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* Members */}
      <section style={{ marginBottom: 36 }}>
        <button
          onClick={() => setTeamOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: teamOpen ? 14 : 0,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%',
          }}
        >
          <h2 style={{ margin: 0, flex: 1, textAlign: 'left' }}>
            Members <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>({members.length})</span>
          </h2>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{teamOpen ? '\u25BE' : '\u25B8'}</span>
        </button>

        {teamOpen && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {members.map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: m.isDummy ? 'var(--surface)' : 'var(--accent-subtle)',
                    border: `1px solid ${m.isDummy ? 'var(--border)' : 'var(--accent-glow)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 600, color: m.isDummy ? 'var(--text-muted)' : 'var(--accent)',
                  }}>
                    {(m.name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      {m.name || m.email}
                    </span>
                    {m.id === user?.id && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>(you)</span>
                    )}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>
                      {m.role}
                    </span>
                    {m.isDummy && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: 'var(--text-faint)',
                        background: 'var(--surface)', padding: '1px 6px',
                        borderRadius: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>
                        dummy
                      </span>
                    )}
                  </div>
                  {m.id !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.id, m.name)}
                      disabled={removingMember === m.id}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-faint)',
                        cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 5,
                      }}
                    >
                      {removingMember === m.id ? '...' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" onClick={() => setShowAddMember(true)}>+ Add team member</Button>
              <Button size="sm" variant="secondary" loading={seeding} onClick={handleSeedDummies}>
                Seed dummy users
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Add team member modal */}
      {showAddMember && (
        <Modal title="Add Team Member" onClose={() => setShowAddMember(false)}>
          <form onSubmit={handleAddMember}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                <input
                  type="radio"
                  checked={memberIsDummy}
                  onChange={() => setMemberIsDummy(true)}
                />
                Create dummy user (for testing)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, marginTop: 4 }}>
                <input
                  type="radio"
                  checked={!memberIsDummy}
                  onChange={() => setMemberIsDummy(false)}
                />
                Invite real user
              </label>
            </div>
            <div className="form-group">
              <label>Name</label>
              <input value={memberName} onChange={e => setMemberName(e.target.value)} autoFocus placeholder="e.g. Sarah Chen" />
            </div>
            <div className="form-group">
              <label>Email {memberIsDummy && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional for dummy)</span>}</label>
              <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder={memberIsDummy ? 'optional' : 'user@example.com'} type="email" />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select value={memberRole} onChange={e => setMemberRole(e.target.value as 'admin' | 'member' | 'viewer')}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            {memberError && <p className="form-error">{memberError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setShowAddMember(false)}>Cancel</Button>
              <Button type="submit" loading={addingMember} disabled={!memberName.trim()}>Add</Button>
            </div>
          </form>
        </Modal>
      )}

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
