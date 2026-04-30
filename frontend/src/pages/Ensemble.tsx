import { useEffect, useState, FormEvent, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getEnsemble, deleteEnsemble } from '../api/ensembles';
import { getCharts, createChart } from '../api/charts';
import {
  getInstrumentSlots, createInstrumentSlot, deleteInstrumentSlot,
  getSlotAssignmentsByEnsemble, assignUserToSlot, unassignUserFromSlot, SlotAssignmentUser,
} from '../api/instrumentSlots';
import { getWorkspaceMembers, addWorkspaceMember, removeWorkspaceMember, seedDummyMembers } from '../api/workspaces';
import { getEnsembleEvents, Event as EventType } from '../api/events';
import { Ensemble as EnsembleType, Chart, InstrumentSlot, WorkspaceMember } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { PermissionGate } from '../components/PermissionGate';
import { SidePanel, PanelSection } from '../components/SidePanel';
import './Ensemble.css';

type ChartTab = 'all' | 'active' | 'draft' | 'archived';

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = ['#7a8ba8', '#c8531c', '#5e7548', '#8b6e9e', '#b5894e', '#5a8a9e', '#a85a5a'];

function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const dateFormatted = d.toLocaleDateString('en-US', dateOptions);
  const timeFormatted = d.toLocaleTimeString('en-US', timeOptions);

  if (diffHours > 0 && diffHours < 24) {
    const hrs = Math.floor(diffHours);
    return `today \u00B7 ${timeFormatted} \u00B7 in ${hrs}h`;
  }
  if (diffMs < 0) {
    return `${dateFormatted} \u00B7 past`;
  }
  return `${dateFormatted} \u00B7 ${timeFormatted}`;
}

function isImminent(dateStr: string): boolean {
  const d = new Date(dateStr);
  const diffMs = d.getTime() - Date.now();
  return diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr).getTime() < Date.now();
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function EnsemblePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [ensemble, setEnsemble] = useState<EnsembleType | null>(null);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [slots, setSlots] = useState<InstrumentSlot[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [events, setEvents] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateChart, setShowCreateChart] = useState(false);
  const [chartName, setChartName] = useState('');
  const [chartComposer, setChartComposer] = useState('');
  const [creatingChart, setCreatingChart] = useState(false);
  const [chartError, setChartError] = useState('');

  const [newSlotName, setNewSlotName] = useState('');
  const [addingSlot, setAddingSlot] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [removingSlot, setRemovingSlot] = useState<string | null>(null);

  const [deletingEnsemble, setDeletingEnsemble] = useState(false);

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

  const [chartTab, setChartTab] = useState<ChartTab>('all');
  const [panelOpen, setPanelOpen] = useState(false);

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
      try {
        const [membersRes, assignRes, eventsRes] = await Promise.all([
          getWorkspaceMembers(ensRes.ensemble.workspaceId),
          getSlotAssignmentsByEnsemble(id!),
          getEnsembleEvents(id!),
        ]);
        setMembers(membersRes.members);
        setSlotAssignments(assignRes.assignments);
        setEvents(eventsRes.events);
      } catch { /* non-critical */ }
    }).catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Chart tab filtering
  const filteredCharts = useMemo(() => {
    if (chartTab === 'all') return charts;
    // TODO: charts don't have a status field yet — for now "all" shows everything
    return charts;
  }, [charts, chartTab]);

  const hasImminentEvent = events.some(e => isImminent(e.startsAt));

  // Slot → member mapping for roster
  const slotMemberMap = useMemo(() => {
    const map: Record<string, SlotAssignmentUser[]> = {};
    for (const slot of slots) {
      map[slot.id] = slotAssignments[slot.id] || [];
    }
    return map;
  }, [slots, slotAssignments]);

  // ── Handlers (unchanged from before) ──────────────────────────────────

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
      backTo="/"
      breadcrumbs={[
        { label: 'Ensembles', to: '/' },
        { label: ensemble.name },
      ]}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`panel-trigger-btn${panelOpen ? ' active' : ''}`}
            onClick={() => setPanelOpen(o => !o)}
          >
            {hasImminentEvent && <span className="panel-trigger-dot" />}
            Members & events
          </button>
          <PermissionGate action="chart.create" ensembleId={id}>
            <Button size="sm" onClick={() => setShowCreateChart(true)}>New chart</Button>
          </PermissionGate>
          <PermissionGate action="ensemble.edit" ensembleId={id}>
            <Button variant="ghost" size="sm" onClick={() => {/* settings placeholder */}}>Settings</Button>
          </PermissionGate>
        </div>
      }
    >
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="ensemble-hero">
        <div>
          <div className="eh-eyebrow">Ensemble</div>
          <h1 className="eh-title">{ensemble.name}</h1>
          <div className="eh-sub">
            {members.length} members
            <span className="dot">{'\u00B7'}</span>
            {slots.length} instruments
          </div>
        </div>
        <div className="eh-stats">
          <div className="eh-stat">
            <div className="num">{charts.length}</div>
            <div className="lbl">charts</div>
          </div>
          <div className="eh-stat">
            <div className="num">{members.length}</div>
            <div className="lbl">members</div>
          </div>
          <div className="eh-stat">
            <div className="num">{slots.length}</div>
            <div className="lbl">instruments</div>
          </div>
        </div>
      </div>

      {/* ── Charts section ─────────────────────────────────────────────── */}
      <div className="ensemble-section">
        <div className="es-head">
          <h2 className="es-title">Charts</h2>
          <div className="es-tabs">
            {(['all', 'active', 'draft', 'archived'] as ChartTab[]).map(tab => (
              <button
                key={tab}
                className={`es-tab${chartTab === tab ? ' active' : ''}`}
                onClick={() => setChartTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                <span className="ct">
                  {tab === 'all' ? charts.length : 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="charts-grid">
          {filteredCharts.map(c => (
            <Link
              key={c.id}
              to={`/charts/${c.id}`}
              className="chart-card"
            >
              <div className="cc-thumb">
                <div className="cc-thumb-page">
                  {[0, 1, 2].map(s => (
                    <div className="cc-system" key={s}>
                      {[0, 1, 2, 3, 4].map(l => <div className="cc-line" key={l} />)}
                    </div>
                  ))}
                </div>
              </div>
              <div className="cc-body">
                <div className="cc-row1">
                  <h3 className="cc-title">{c.name}</h3>
                </div>
                <div className="cc-meta">
                  {c.composer && <span>{c.composer}</span>}
                </div>
                <div className="cc-foot">
                  <span className="cc-when">{timeAgo(c.updatedAt)}</span>
                </div>
              </div>
            </Link>
          ))}

          {/* New chart card */}
          <PermissionGate action="chart.create" ensembleId={id}>
            <button
              className="chart-card new-card"
              onClick={() => setShowCreateChart(true)}
            >
              <div className="cc-newinner">
                <div className="cc-newicon">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 3 L8 13 M3 8 L13 8" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="cc-newlabel">New chart</div>
              </div>
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* ── Roster & Instruments ────────────────────────────────────────── */}
      <div className="ensemble-section">
        <div className="es-head">
          <h2 className="es-title">Roster & instruments</h2>
          <div className="es-tools">
            <PermissionGate action="ensemble.member.invite" ensembleId={id}>
              <Button variant="ghost" size="sm" onClick={() => setShowAddMember(true)}>Add member</Button>
            </PermissionGate>
            <PermissionGate action="instrument.add" ensembleId={id}>
              <Button variant="ghost" size="sm" onClick={() => {
                const name = prompt('Instrument name (e.g. Violin 1, Alto Sax):');
                if (name?.trim()) {
                  setNewSlotName(name.trim());
                  handleAddSlot({ preventDefault: () => {} } as FormEvent);
                }
              }}>Add instrument</Button>
            </PermissionGate>
          </div>
        </div>

        <div className="roster-card">
          {/* Score row — conductor/owner */}
          <div className="roster-row score-row">
            <div className="rr-instrument">
              <span className="icn"><InstrumentIcon name="score" size={20} /></span>
              <span className="lbl">
                Conductor's Score
                <span className="rr-tag">SCORE LANE</span>
              </span>
            </div>
            <div className="rr-member">
              <span className="rr-avatar conductor">
                {getInitials(user?.name ?? null)}
              </span>
              <div className="rr-name-block">
                <div className="rr-name">{user?.name || user?.email}</div>
                <div className="rr-role">conductor {'\u00B7'} ensemble owner</div>
              </div>
            </div>
            <div className="rr-actions">
              <Button variant="ghost" size="sm">Open</Button>
            </div>
          </div>

          {/* Instrument rows */}
          {slots.map(slot => {
            const assigned = slotMemberMap[slot.id] || [];
            const assignedIds = new Set(assigned.map(a => a.userId));
            const availableToAssign = members.filter(m => !assignedIds.has(m.id));

            return (
              <div className="roster-row" key={slot.id}>
                <div className="rr-instrument">
                  <span className="icn"><InstrumentIcon name={slot.name} size={20} /></span>
                  <span className="lbl">{slot.name}</span>
                </div>
                <div className="rr-member">
                  {assigned.length > 0 ? (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => handleUnassignUser(slot.id, assigned[0].userId)}
                      title={`Click to unassign ${assigned[0].name || assigned[0].email}`}
                    >
                      <span className="rr-avatar" style={{ background: avatarColor(slots.indexOf(slot)) }}>
                        {getInitials(assigned[0].name)}
                      </span>
                      <div className="rr-name-block">
                        <div className="rr-name">
                          {assigned[0].name || assigned[0].email}
                          {assigned[0].userId === user?.id && (
                            <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>(you)</span>
                          )}
                        </div>
                        <div className="rr-role">
                          {assigned.length > 1 ? `+${assigned.length - 1} more` : 'assigned'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>(unassigned)</span>
                  )}
                </div>
                <div className="rr-actions">
                  <PermissionGate action="instrument.reassign" ensembleId={id}>
                    <div style={{ position: 'relative' }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssignDropdownSlot(assignDropdownSlot === slot.id ? null : slot.id)}
                      >
                        Re-assign
                      </Button>
                      {assignDropdownSlot === slot.id && availableToAssign.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
                          background: 'var(--surface-raised)', border: '1px solid var(--border)',
                          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', minWidth: 200, padding: 4,
                        }}>
                          {availableToAssign.map(m => (
                            <button
                              key={m.id}
                              onClick={() => handleAssignUser(slot.id, m.id)}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                background: 'none', border: 'none', padding: '6px 10px',
                                fontSize: 13, cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit',
                              }}
                            >
                              {m.name || m.email}
                              {m.isDummy && <span style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 11 }}>dummy</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </PermissionGate>
                  <PermissionGate action="instrument.reassign" ensembleId={id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={removingSlot === slot.id}
                      onClick={() => handleRemoveSlot(slot.id, slot.name)}
                    >
                      Remove
                    </Button>
                  </PermissionGate>
                </div>
              </div>
            );
          })}

          {/* Add instrument row */}
          <PermissionGate action="instrument.add" ensembleId={id}>
            <form onSubmit={handleAddSlot} style={{ display: 'contents' }}>
              <button className="roster-add" type="button" onClick={() => {
                const name = prompt('Instrument name (e.g. Violin 1, Alto Sax):');
                if (name?.trim()) {
                  setNewSlotName(name.trim());
                  // Trigger the add after state update
                  setTimeout(async () => {
                    setSlotError('');
                    setAddingSlot(true);
                    try {
                      const { instrumentSlot } = await createInstrumentSlot({
                        ensembleId: id!,
                        name: name.trim(),
                      });
                      setSlots(prev => [...prev, instrumentSlot]);
                      setNewSlotName('');
                    } catch (err) {
                      setSlotError(err instanceof ApiError ? err.message : 'Something went wrong');
                    } finally {
                      setAddingSlot(false);
                    }
                  }, 0);
                }
              }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 3 L8 13 M3 8 L13 8" strokeLinecap="round" />
                </svg>
                <span>{addingSlot ? 'Adding...' : 'Add an instrument \u00B7 invite a member'}</span>
              </button>
            </form>
          </PermissionGate>
          {slotError && <div style={{ padding: '8px 22px', color: 'var(--danger)', fontSize: 12 }}>{slotError}</div>}
        </div>

        {/* Seed dummy users button for dev */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" loading={seeding} onClick={handleSeedDummies}>
            Seed dummy users
          </Button>
          <PermissionGate action="ensemble.edit" ensembleId={id}>
            <Button variant="danger" size="sm" loading={deletingEnsemble} onClick={handleDeleteEnsemble}>
              Delete ensemble
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* ── Side Panel: Members & Events ────────────────────────────────── */}
      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="Members & Events">
        <PanelSection
          title="Members"
          count={members.length}
          actionLabel="+ invite"
          onAction={() => { setPanelOpen(false); setShowAddMember(true); }}
        >
          {members.map((m, i) => (
            <div className="panel-member-row" key={m.id}>
              <div className="panel-avatar" style={{ background: avatarColor(i) }}>
                {getInitials(m.name)}
              </div>
              <div className="panel-member-info">
                <div className="panel-member-name">
                  {m.name || m.email}
                  {m.id === user?.id && (
                    <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>(you)</span>
                  )}
                </div>
                <div className="panel-member-role">{m.role}</div>
              </div>
              <span className="panel-member-stat">{m.role}</span>
              {m.id !== user?.id && (
                <button
                  onClick={() => handleRemoveMember(m.id, m.name)}
                  disabled={removingMember === m.id}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-faint)',
                    cursor: 'pointer', fontSize: 11, padding: '2px 4px', marginLeft: 4,
                  }}
                >
                  {removingMember === m.id ? '...' : '\u00D7'}
                </button>
              )}
            </div>
          ))}
        </PanelSection>

        <PanelSection
          title="Events"
          count={`${events.filter(e => !isPast(e.startsAt)).length} upcoming`}
          actionLabel="+ new"
          onAction={() => { /* Phase 5 will wire this to create-event modal */ }}
        >
          {events.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No events yet</p>
          ) : (
            events.map(evt => (
              <div
                key={evt.id}
                className={`event-mini${isImminent(evt.startsAt) ? ' imminent' : ''}${isPast(evt.startsAt) ? ' past' : ''}`}
              >
                <div className="em-date">{formatEventDate(evt.startsAt)}</div>
                <div className="em-name">
                  {evt.name}
                  {evt.location && ` \u2014 ${evt.location}`}
                </div>
                <div className="em-meta">{evt.eventType}</div>
              </div>
            ))
          )}
        </PanelSection>
      </SidePanel>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showAddMember && (
        <Modal title="Add Team Member" onClose={() => setShowAddMember(false)}>
          <form onSubmit={handleAddMember}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                <input type="radio" checked={memberIsDummy} onChange={() => setMemberIsDummy(true)} />
                Create dummy user (for testing)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, marginTop: 4 }}>
                <input type="radio" checked={!memberIsDummy} onChange={() => setMemberIsDummy(false)} />
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
