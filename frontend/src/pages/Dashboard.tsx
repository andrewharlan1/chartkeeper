import { useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEnsemble } from '../api/ensembles';
import { createEnsemble } from '../api/ensembles';
import { useAuth } from '../hooks/useAuth';
import { Ensemble } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';

const ENSEMBLE_IDS_KEY = 'ensemble_ids';

function getStoredEnsembleIds(): string[] {
  try { return JSON.parse(localStorage.getItem(ENSEMBLE_IDS_KEY) ?? '[]'); }
  catch { return []; }
}

export function addEnsembleId(id: string) {
  const ids = getStoredEnsembleIds();
  if (!ids.includes(id)) localStorage.setItem(ENSEMBLE_IDS_KEY, JSON.stringify([...ids, id]));
}

function greeting(name: string | undefined): string {
  const h = new Date().getHours();
  const first = name?.split(' ')[0] ?? 'there';
  if (h < 12) return `Good morning, ${first}`;
  if (h < 17) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ensembles, setEnsembles] = useState<Ensemble[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    const ids = getStoredEnsembleIds();
    Promise.all(ids.map(id => getEnsemble(id).then(r => r.ensemble).catch(() => null)))
      .then(results => setEnsembles(results.filter(Boolean) as Ensemble[]))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const { ensemble } = await createEnsemble(newName.trim());
      addEnsembleId(ensemble.id);
      setEnsembles(prev => [ensemble, ...prev]);
      setShowCreate(false);
      setNewName('');
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Layout actions={<Button onClick={() => setShowCreate(true)}>+ New Ensemble</Button>}>
      {/* ── Gradient greeting banner ── */}
      <div style={{
        borderRadius: 16,
        padding: '28px 32px',
        marginBottom: 32,
        background: 'var(--banner-gradient)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle decorative circles */}
        <div style={{
          position: 'absolute', right: -20, top: -20,
          width: 160, height: 160, borderRadius: '50%',
          background: 'rgba(91,76,245,0.07)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: 60, bottom: -40,
          width: 100, height: 100, borderRadius: '50%',
          background: 'rgba(26,159,212,0.06)', pointerEvents: 'none',
        }} />
        <p style={{
          fontSize: 13, fontWeight: 600, color: 'var(--banner-label)',
          letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6,
        }}>Scorva</p>
        <h1 style={{
          fontSize: 28, fontWeight: 800, color: 'var(--banner-text)',
          letterSpacing: '-0.04em', lineHeight: 1.2, marginBottom: 6,
        }}>
          {greeting(user?.name || user?.email)}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--banner-subtext)', fontWeight: 400 }}>
          {ensembles.length === 0
            ? 'Create your first ensemble to get started.'
            : `${ensembles.length} ensemble${ensembles.length !== 1 ? 's' : ''} · Your music, organized.`}
        </p>
      </div>

      {/* ── Ensemble list ── */}
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : ensembles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 16, fontSize: 15 }}>No ensembles yet.</p>
          <Button onClick={() => setShowCreate(true)}>Create your first ensemble</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ensembles.map(e => (
            <Link
              key={e.id}
              to={`/ensembles/${e.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                color: 'var(--text)',
                textDecoration: 'none',
                boxShadow: 'var(--shadow-sm)',
                transition: 'box-shadow 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e2 => {
                (e2.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)';
                (e2.currentTarget as HTMLElement).style.borderColor = 'var(--accent-glow)';
              }}
              onMouseLeave={e2 => {
                (e2.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)';
                (e2.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'linear-gradient(135deg, #5b4cf5 0%, #1a9fd4 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(91,76,245,0.25)',
                }}>
                  {(e.name?.[0] ?? '?').toUpperCase()}
                </div>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{e.name}</span>
              </div>
              <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>→</span>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Ensemble" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} required autoFocus placeholder="e.g. Monday Night Big Band" />
            </div>
            {createError && <p className="form-error">{createError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" loading={creating}>Create</Button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
