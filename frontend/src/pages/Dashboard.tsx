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

// The API doesn't have a "list ensembles" endpoint — we store ensemble IDs in localStorage
// after joining/creating, so the dashboard reads from that list.
const ENSEMBLE_IDS_KEY = 'ensemble_ids';

function getStoredEnsembleIds(): string[] {
  try { return JSON.parse(localStorage.getItem(ENSEMBLE_IDS_KEY) ?? '[]'); }
  catch { return []; }
}

export function addEnsembleId(id: string) {
  const ids = getStoredEnsembleIds();
  if (!ids.includes(id)) localStorage.setItem(ENSEMBLE_IDS_KEY, JSON.stringify([...ids, id]));
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
    <Layout
      title="My Ensembles"
      actions={<Button onClick={() => setShowCreate(true)}>+ New Ensemble</Button>}
    >
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : ensembles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: 16 }}>No ensembles yet.</p>
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
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                textDecoration: 'none',
                transition: 'border-color 0.15s',
              }}
            >
              <span style={{ fontWeight: 500 }}>{e.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
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
