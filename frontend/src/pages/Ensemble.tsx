import { useEffect, useState, FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getEnsemble, getMembers, inviteMember } from '../api/ensembles';
import { getChart, createChart, deleteChart } from '../api/charts';
import { useAuth } from '../hooks/useAuth';
import { Ensemble as EnsembleType, EnsembleMember, Chart } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { addEnsembleId } from './Dashboard';

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

  const myRole = members.find(m => m.id === user?.id)?.role;

  useEffect(() => {
    if (!id) return;
    addEnsembleId(id);
    Promise.all([
      getEnsemble(id),
      getMembers(id),
    ]).then(([ensRes, memRes]) => {
      setEnsemble(ensRes.ensemble);
      setMembers(memRes.members);
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

  if (loading) return <Layout><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Layout>;
  if (!ensemble) return null;

  const isOwnerOrEditor = myRole === 'owner' || myRole === 'editor';

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
