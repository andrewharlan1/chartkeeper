import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChart, getVersions, restoreVersion, deleteVersion, getAssignments, assignPart, unassignPart } from '../api/charts';
import { getMembers, getInstruments } from '../api/ensembles';
import { useAuth } from '../hooks/useAuth';
import { Chart as ChartType, ChartVersion, EnsembleInstrument, EnsembleMember, PartAssignment, OmrStatus } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { InstrumentIcon } from '../components/InstrumentIcon';
import { ApiError } from '../api/client';

function hasInProgressOmr(versions: ChartVersion[]): boolean {
  return versions.some(v =>
    v.parts.some(p => p.omrStatus === 'pending' || p.omrStatus === 'processing')
  );
}

// ── Instruments panel ─────────────────────────────────────────────────────────

interface InstrumentsPanelProps {
  chartId: string;
  instruments: EnsembleInstrument[];
  assignments: PartAssignment[];
  members: EnsembleMember[];
  activeVersion: ChartVersion | null;
  canEdit: boolean;
  onAssign: (a: PartAssignment) => void;
  onUnassign: (assignmentId: string) => void;
}

function InstrumentsPanel({
  chartId, instruments, assignments, members, activeVersion, canEdit, onAssign, onUnassign,
}: InstrumentsPanelProps) {
  const [open, setOpen] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null); // instrument name being assigned
  const [selectedUser, setSelectedUser] = useState<Record<string, string>>({}); // instrumentName → userId

  if (instruments.length === 0) return null;

  // Build a quick lookup: instrumentName → assignments[]
  const assignmentsByInstrument: Record<string, PartAssignment[]> = {};
  for (const a of assignments) {
    if (!assignmentsByInstrument[a.instrument_name]) assignmentsByInstrument[a.instrument_name] = [];
    assignmentsByInstrument[a.instrument_name].push(a);
  }

  // Active version's parts by instrument name
  const partsByInstrument: Record<string, { omrStatus: OmrStatus; partType: string }> = {};
  if (activeVersion) {
    for (const p of activeVersion.parts) {
      partsByInstrument[p.instrumentName] = { omrStatus: p.omrStatus, partType: p.partType ?? 'part' };
    }
  }

  async function handleAssign(instrumentName: string) {
    const userId = selectedUser[instrumentName];
    if (!userId) return;
    setAssigning(instrumentName);
    try {
      const { assignment } = await assignPart(chartId, instrumentName, userId);
      onAssign(assignment);
      setSelectedUser(prev => ({ ...prev, [instrumentName]: '' }));
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 24,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', color: 'var(--text)',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>Instruments</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div>
          {instruments.map((instr, idx) => {
            const instrAssignments = assignmentsByInstrument[instr.name] ?? [];
            const part = partsByInstrument[instr.name];
            const assignedIds = new Set(instrAssignments.map(a => a.user_id));
            const unassignedMembers = members.filter(m => !assignedIds.has(m.id));

            return (
              <div
                key={instr.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: idx < instruments.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                {/* Instrument name + part badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <InstrumentIcon name={instr.name} size={22} />
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{instr.name}</span>
                  {part ? (
                    <OmrBadge status={part.omrStatus} />
                  ) : (
                    <span style={{
                      fontSize: 11, padding: '2px 7px', background: 'var(--bg)',
                      border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)',
                    }}>No part</span>
                  )}
                </div>

                {/* Assigned players */}
                {instrAssignments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {instrAssignments.map(a => (
                      <span key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 99, padding: '2px 8px',
                      }}>
                        {a.user_name}
                        {canEdit && (
                          <button
                            onClick={() => unassignPart(chartId, a.id).then(() => onUnassign(a.id)).catch(() => {})}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
                          >×</button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* Assign dropdown */}
                {canEdit && unassignedMembers.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      value={selectedUser[instr.name] ?? ''}
                      onChange={e => setSelectedUser(prev => ({ ...prev, [instr.name]: e.target.value }))}
                      style={{
                        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
                        padding: '4px 6px', color: selectedUser[instr.name] ? 'var(--text)' : 'var(--text-muted)',
                        fontSize: 12,
                      }}
                    >
                      <option value="">Assign player…</option>
                      {unassignedMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!selectedUser[instr.name]}
                      loading={assigning === instr.name}
                      onClick={() => handleAssign(instr.name)}
                    >
                      Assign
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [chart, setChart] = useState<ChartType | null>(null);
  const [versions, setVersions] = useState<ChartVersion[]>([]);
  const [ensembleId, setEnsembleId] = useState('');
  const [myRole, setMyRole] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<EnsembleInstrument[]>([]);
  const [members, setMembers] = useState<EnsembleMember[]>([]);
  const [assignments, setAssignments] = useState<PartAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [deletingVersion, setDeletingVersion] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!id) return;
    const res = await getVersions(id).catch(() => null);
    if (!res) return;
    setVersions(res.versions);
    return res.versions;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    Promise.all([getChart(id), loadVersions()]).then(async ([chartRes]) => {
      setChart(chartRes.chart);
      const eid = chartRes.chart.ensemble_id;
      setEnsembleId(eid);
      const [membersRes, instrRes, assignRes] = await Promise.all([
        getMembers(eid).catch(() => ({ members: [] })),
        getInstruments(eid).catch(() => ({ instruments: [] })),
        getAssignments(id).catch(() => ({ assignments: [] })),
      ]);
      const me = membersRes.members.find(m => m.id === user?.id);
      setMyRole(me?.role ?? null);
      setMembers(membersRes.members);
      setInstruments(instrRes.instruments);
      setAssignments(assignRes.assignments);
    }).finally(() => setLoading(false));
  }, [id, loadVersions]);

  // Poll while any OMR jobs are in progress
  useEffect(() => {
    if (!hasInProgressOmr(versions)) return;
    const timer = setInterval(() => { loadVersions(); }, 5000);
    return () => clearInterval(timer);
  }, [versions, loadVersions]);

  async function handleRestore(versionId: string) {
    if (!id) return;
    if (!confirm('Restore this version as active? Players will be notified.')) return;
    setRestoring(versionId);
    setRestoreError('');
    try {
      await restoreVersion(id, versionId);
      await loadVersions();
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : 'Failed to restore');
    } finally {
      setRestoring(null);
    }
  }

  async function handleDeleteVersion(versionId: string, versionName: string) {
    if (!id) return;
    if (!confirm(`Delete "${versionName}"? This cannot be undone.`)) return;
    setDeletingVersion(versionId);
    try {
      await deleteVersion(id, versionId);
      await loadVersions();
    } catch (err) {
      setRestoreError(err instanceof ApiError ? err.message : 'Failed to delete version');
    } finally {
      setDeletingVersion(null);
    }
  }

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;
  if (!chart) return null;

  const canEdit = myRole === 'owner' || myRole === 'editor';
  const activeVersion = versions.find(v => v.is_active) ?? null;

  return (
    <Layout
      title={chart.title ?? 'Untitled'}
      back={{ label: 'Ensemble', to: `/ensembles/${ensembleId}` }}
      actions={
        canEdit ? (
          <Link to={`/charts/${id}/upload`}>
            <Button size="sm">+ Upload new version</Button>
          </Link>
        ) : undefined
      }
    >
      {chart.composer && <p style={{ color: 'var(--text-muted)', marginTop: -20, marginBottom: 24 }}>by {chart.composer}</p>}

      {restoreError && <p className="form-error" style={{ marginBottom: 16 }}>{restoreError}</p>}

      {/* Instruments panel */}
      <InstrumentsPanel
        chartId={id!}
        instruments={instruments}
        assignments={assignments}
        members={members}
        activeVersion={activeVersion}
        canEdit={canEdit}
        onAssign={a => setAssignments(prev => [...prev, a])}
        onUnassign={aid => setAssignments(prev => prev.filter(a => a.id !== aid))}
      />

      {/* Versions */}
      {versions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 16 }}>No versions yet.</p>
          {canEdit && <Link to={`/charts/${id}/upload`}><Button>Upload first version</Button></Link>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {versions.map(v => (
            <div
              key={v.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Link to={`/charts/${id}/versions/${v.id}`} style={{ fontWeight: 600, fontSize: 15 }}>
                    {v.version_name}
                  </Link>
                  <ActiveBadge active={v.is_active} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(v.created_at).toLocaleDateString()}
                    {v.created_by_name && ` · ${v.created_by_name}`}
                  </span>
                  {!v.is_active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={restoring === v.id}
                      onClick={() => handleRestore(v.id)}
                    >
                      Restore
                    </Button>
                  )}
                  {myRole === 'owner' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deletingVersion === v.id}
                      onClick={() => handleDeleteVersion(v.id, v.version_name)}
                      style={{ color: 'var(--danger)' }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {v.parts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {p.instrumentName}
                    </span>
                    <OmrBadge status={p.omrStatus} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
