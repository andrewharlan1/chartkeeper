import { useEffect, useState, FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getEnsemble, getMembers, inviteMember, getInstruments, addInstrument, removeInstrument, assignInstrumentMember, unassignInstrumentMember, getInstrumentAssignments } from '../api/ensembles';
import { getChart, createChart, deleteChart } from '../api/charts';
import { useAuth } from '../hooks/useAuth';
import { Ensemble as EnsembleType, EnsembleMember, Chart, EnsembleInstrument, EnsembleInstrumentAssignment } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { addEnsembleId } from './Dashboard';
import { InstrumentIcon, INSTRUMENT_LIST } from '../components/InstrumentIcon';

// Store chart IDs per ensemble in localStorage
function getChartIds(ensembleId: string): string[] {
  try { return JSON.parse(localStorage.getItem(`charts:${ensembleId}`) ?? '[]'); }
  catch { return []; }
}
function addChartId(ensembleId: string, chartId: string) {
  const ids = getChartIds(ensembleId);
  if (!ids.includes(chartId)) localStorage.setItem(`charts:${ensembleId}`, JSON.stringify([...ids, chartId]));
}

export function EnsemblePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ensemble, setEnsemble] = useState<EnsembleType | null>(null);
  const [members, setMembers] = useState<EnsembleMember[]>([]);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [instruments, setInstruments] = useState<EnsembleInstrument[]>([]);
  const [instrAssignments, setInstrAssignments] = useState<Record<string, EnsembleInstrumentAssignment[]>>({});
  const [assigningInstr, setAssigningInstr] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'player'>('player');
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteError, setInviteError] = useState('');

  const [deletingChart, setDeletingChart] = useState<string | null>(null);

  const [showCreateChart, setShowCreateChart] = useState(false);
  const [chartTitle, setChartTitle] = useState('');
  const [chartComposer, setChartComposer] = useState('');
  const [creatingChart, setCreatingChart] = useState(false);
  const [chartError, setChartError] = useState('');

  // Instrument management
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [addingInstrument, setAddingInstrument] = useState(false);
  const [instrumentError, setInstrumentError] = useState('');
  const [removingInstrument, setRemovingInstrument] = useState<string | null>(null);

  const myRole = members.find(m => m.id === user?.id)?.role;
  const isOwnerOrEditor = myRole === 'owner' || myRole === 'editor';

  useEffect(() => {
    if (!id) return;
    addEnsembleId(id);
    Promise.all([
      getEnsemble(id),
      getMembers(id),
      getInstruments(id),
    ]).then(([ensRes, memRes, instrRes]) => {
      setEnsemble(ensRes.ensemble);
      setMembers(memRes.members);
      setInstruments(instrRes.instruments);
      // Load assignments for each instrument
      Promise.all(
        instrRes.instruments.map((instr: EnsembleInstrument) =>
          getInstrumentAssignments(id!, instr.id)
            .then(r => ({ id: instr.id, assignments: r.assignments }))
            .catch(() => ({ id: instr.id, assignments: [] }))
        )
      ).then(results => {
        const map: Record<string, EnsembleInstrumentAssignment[]> = {};
        results.forEach(r => { map[r.id] = r.assignments; });
        setInstrAssignments(map);
      });
      const chartIds = getChartIds(id);
      return Promise.all(chartIds.map(cid => getChart(cid).then(r => r.chart).catch(() => null)));
    }).then(chartResults => {
      setCharts(chartResults.filter(Boolean) as Chart[]);
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setInviteError('');
    setInviting(true);
    try {
      const { inviteUrl: url } = await inviteMember(id, inviteEmail, inviteRole);
      const fullUrl = `${window.location.origin}/signup?invite=${url.split('/').pop()}`;
      setInviteUrl(fullUrl);
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setInviting(false);
    }
  }

  async function handleDeleteChart(chartId: string, title: string) {
    if (!confirm(`Delete "${title || 'Untitled'}"? This cannot be undone.`)) return;
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

  async function handleCreateChart(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setChartError('');
    setCreatingChart(true);
    try {
      const { chart } = await createChart({
        ensembleId: id,
        title: chartTitle.trim() || undefined,
        composer: chartComposer.trim() || undefined,
      });
      addChartId(id, chart.id);
      setCharts(prev => [chart, ...prev]);
      setShowCreateChart(false);
      setChartTitle('');
      setChartComposer('');
    } catch (err) {
      setChartError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreatingChart(false);
    }
  }

  async function handleAddInstrument(e: FormEvent) {
    e.preventDefault();
    if (!id || !newInstrumentName.trim()) return;
    setInstrumentError('');
    setAddingInstrument(true);
    try {
      const { instrument } = await addInstrument(id, newInstrumentName.trim());
      setInstruments(prev => [...prev, instrument]);
      setNewInstrumentName('');
    } catch (err) {
      setInstrumentError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setAddingInstrument(false);
    }
  }

  async function handleAssignMember(instrId: string) {
    if (!id) return;
    const userId = selectedMember[instrId];
    if (!userId) return;
    setAssigningInstr(instrId);
    try {
      const { assignment } = await assignInstrumentMember(id, instrId, userId);
      setInstrAssignments(prev => ({ ...prev, [instrId]: [...(prev[instrId] ?? []), assignment] }));
      setSelectedMember(prev => ({ ...prev, [instrId]: '' }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigningInstr(null);
    }
  }

  async function handleUnassignMember(instrId: string, assignmentId: string) {
    if (!id) return;
    try {
      await unassignInstrumentMember(id, instrId, assignmentId);
      setInstrAssignments(prev => ({ ...prev, [instrId]: (prev[instrId] ?? []).filter(a => a.id !== assignmentId) }));
    } catch { /* ignore */ }
  }

  async function handleRemoveInstrument(instrumentId: string, name: string) {
    if (!id) return;
    if (!confirm(`Remove "${name}" from this ensemble's instrument list?`)) return;
    setRemovingInstrument(instrumentId);
    try {
      await removeInstrument(id, instrumentId);
      setInstruments(prev => prev.filter(i => i.id !== instrumentId));
    } catch {
      alert('Failed to remove instrument');
    } finally {
      setRemovingInstrument(null);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;
  if (!ensemble) return null;

  return (
    <Layout
      title={ensemble.name}
      back={{ label: 'My Ensembles', to: '/' }}
      actions={
        isOwnerOrEditor ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowInvite(true)}>Invite member</Button>
            <Button size="sm" onClick={() => setShowCreateChart(true)}>+ New chart</Button>
          </>
        ) : undefined
      }
    >
      {/* Members */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ marginBottom: 14 }}>Members</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            }}>
              <div>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }}>{m.email}</span>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, textTransform: 'capitalize' }}>{m.role}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Instruments */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={{ marginBottom: 14 }}>Instruments</h2>
        {instruments.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginBottom: 12, fontSize: 14 }}>
            No instruments yet.{isOwnerOrEditor ? ' Add your lineup below.' : ''}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {instruments.map(instr => {
              const assignments = instrAssignments[instr.id] ?? [];
              const assignedIds = new Set(assignments.map(a => a.user_id));
              const unassignedMembers = members.filter(m => !assignedIds.has(m.id));
              return (
                <div key={instr.id} style={{
                  padding: '14px 18px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  boxShadow: 'var(--shadow-sm)',
                }}>
                  {/* Header: icon + name + remove */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: assignments.length > 0 || (isOwnerOrEditor && unassignedMembers.length > 0) ? 10 : 0 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: 'var(--accent-subtle)',
                      border: '1px solid var(--accent-glow)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--accent)',
                    }}>
                      <InstrumentIcon name={instr.name} size={24} />
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{instr.name}</span>
                    {isOwnerOrEditor && (
                      <button
                        onClick={() => handleRemoveInstrument(instr.id, instr.name)}
                        disabled={removingInstrument === instr.id}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-faint)',
                          cursor: 'pointer', fontSize: 13, padding: '3px 6px',
                          borderRadius: 5, transition: 'color 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--danger)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'}
                      >
                        {removingInstrument === instr.id ? '…' : 'Remove'}
                      </button>
                    )}
                  </div>

                  {/* Assigned members */}
                  {assignments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: isOwnerOrEditor && unassignedMembers.length > 0 ? 8 : 0 }}>
                      {assignments.map(a => (
                        <span key={a.id} style={{
                          display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                          background: 'var(--accent-subtle)', border: '1px solid rgba(124,106,245,0.25)',
                          borderRadius: 99, padding: '3px 10px', color: 'var(--text)',
                          fontWeight: 500,
                        }}>
                          {a.user_name}
                          {isOwnerOrEditor && (
                            <button onClick={() => handleUnassignMember(instr.id, a.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Assign dropdown */}
                  {isOwnerOrEditor && unassignedMembers.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        value={selectedMember[instr.id] ?? ''}
                        onChange={e => setSelectedMember(prev => ({ ...prev, [instr.id]: e.target.value }))}
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: selectedMember[instr.id] ? 'var(--text)' : 'var(--text-muted)', fontSize: 12, width: 'auto' }}
                      >
                        <option value="">Assign member…</option>
                        {unassignedMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                      <Button size="sm" variant="secondary" disabled={!selectedMember[instr.id]} loading={assigningInstr === instr.id} onClick={() => handleAssignMember(instr.id)}>
                        Assign
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add instrument — searchable combobox */}
        {isOwnerOrEditor && (
          <form onSubmit={handleAddInstrument} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <input
                list="instrument-suggestions"
                value={newInstrumentName}
                onChange={e => setNewInstrumentName(e.target.value)}
                placeholder="Add instrument… (type or pick from list)"
                style={{ width: '100%', borderRadius: 10, fontSize: 14 }}
              />
              <datalist id="instrument-suggestions">
                {INSTRUMENT_LIST.map(name => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {instrumentError && <p className="form-error" style={{ marginTop: 4 }}>{instrumentError}</p>}
            </div>
            <Button type="submit" loading={addingInstrument} disabled={!newInstrumentName.trim()}>
              Add
            </Button>
          </form>
        )}
      </section>

      {/* Charts */}
      <section>
        <h2 style={{ marginBottom: 14 }}>Charts</h2>
        {charts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No charts yet.{isOwnerOrEditor ? ' Create one above.' : ''}</p>
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
                  <span style={{ fontWeight: 500 }}>{c.title ?? 'Untitled'}</span>
                  {c.composer && <span style={{ color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }}>{c.composer}</span>}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                  {myRole === 'owner' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deletingChart === c.id}
                      onClick={() => handleDeleteChart(c.id, c.title ?? '')}
                      style={{ color: 'var(--danger)' }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Invite modal */}
      {showInvite && (
        <Modal title="Invite member" onClose={() => { setShowInvite(false); setInviteUrl(''); setInviteEmail(''); setInviteError(''); }}>
          {inviteUrl ? (
            <div>
              <p style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                Share this link with the invitee:
              </p>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 12px', fontSize: 12, wordBreak: 'break-all', color: 'var(--accent)',
                marginBottom: 16,
              }}>
                {inviteUrl}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy</Button>
                <Button onClick={() => { setShowInvite(false); setInviteUrl(''); setInviteEmail(''); }}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'editor' | 'player')}>
                  <option value="player">Player (read-only)</option>
                  <option value="editor">Editor (can push versions)</option>
                </select>
              </div>
              {inviteError && <p className="form-error">{inviteError}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <Button variant="secondary" type="button" onClick={() => setShowInvite(false)}>Cancel</Button>
                <Button type="submit" loading={inviting}>Send invite</Button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Create chart modal */}
      {showCreateChart && (
        <Modal title="New Chart" onClose={() => setShowCreateChart(false)}>
          <form onSubmit={handleCreateChart}>
            <div className="form-group">
              <label>Title</label>
              <input value={chartTitle} onChange={e => setChartTitle(e.target.value)} autoFocus placeholder="e.g. Autumn Leaves" />
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
