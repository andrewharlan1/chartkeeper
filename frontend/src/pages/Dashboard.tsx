import { useEffect, useState, FormEvent, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEnsemble, createEnsemble, deleteEnsemble } from '../api/ensembles';
import { useAuth } from '../hooks/useAuth';
import { Ensemble } from '../types';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';

const ENSEMBLE_IDS_KEY = 'ensemble_ids';
const ENSEMBLE_ORDER_KEY = 'ensemble_order';

function getStoredEnsembleIds(): string[] {
  try { return JSON.parse(localStorage.getItem(ENSEMBLE_IDS_KEY) ?? '[]'); }
  catch { return []; }
}

export function addEnsembleId(id: string) {
  const ids = getStoredEnsembleIds();
  if (!ids.includes(id)) localStorage.setItem(ENSEMBLE_IDS_KEY, JSON.stringify([...ids, id]));
}

function removeEnsembleId(id: string) {
  const ids = getStoredEnsembleIds();
  localStorage.setItem(ENSEMBLE_IDS_KEY, JSON.stringify(ids.filter(i => i !== id)));
  try {
    const order: string[] = JSON.parse(localStorage.getItem(ENSEMBLE_ORDER_KEY) ?? '[]');
    localStorage.setItem(ENSEMBLE_ORDER_KEY, JSON.stringify(order.filter(i => i !== id)));
  } catch { /* ignore */ }
}

function getSavedOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ENSEMBLE_ORDER_KEY) ?? '[]'); }
  catch { return []; }
}

function applyOrder(ensembles: Ensemble[], order: string[]): Ensemble[] {
  if (!order.length) return ensembles;
  const map = new Map(ensembles.map(e => [e.id, e]));
  const ordered = order.map(id => map.get(id)).filter(Boolean) as Ensemble[];
  const rest = ensembles.filter(e => !order.includes(e.id));
  return [...ordered, ...rest];
}

function greeting(name: string | undefined): string {
  const h = new Date().getHours();
  const first = name?.split(' ')[0] ?? 'there';
  if (h < 12) return `Good morning, ${first}`;
  if (h < 17) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

// Deterministic gradient from ensemble name
function ensembleGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1},65%,50%) 0%, hsl(${h2},70%,45%) 100%)`;
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
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Drag-to-reorder state
  const dragId   = useRef<string | null>(null);
  const dragOver = useRef<string | null>(null);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    const ids = getStoredEnsembleIds();
    Promise.all(ids.map(id => getEnsemble(id).then(r => r.ensemble).catch(() => null)))
      .then(results => {
        const valid = results.filter(Boolean) as Ensemble[];
        const ordered = applyOrder(valid, getSavedOrder());
        setEnsembles(ordered);
      })
      .finally(() => setLoading(false));
  }, [user, navigate]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

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

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const ens = ensembles.find(e => e.id === id);
    if (!confirm(`Delete "${ens?.name ?? 'this ensemble'}"? This cannot be undone.`)) return;
    setDeletingId(id);
    setMenuOpen(null);
    try {
      await deleteEnsemble(id);
      removeEnsembleId(id);
      setEnsembles(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete ensemble');
    } finally {
      setDeletingId(null);
    }
  }

  function onDragStart(id: string) { dragId.current = id; }
  function onDragEnter(id: string) { dragOver.current = id; }
  function onDragEnd() {
    if (!dragId.current || !dragOver.current || dragId.current === dragOver.current) {
      dragId.current = null; dragOver.current = null; return;
    }
    setEnsembles(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(e => e.id === dragId.current);
      const toIdx   = arr.findIndex(e => e.id === dragOver.current);
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      localStorage.setItem(ENSEMBLE_ORDER_KEY, JSON.stringify(arr.map(e => e.id)));
      return arr;
    });
    dragId.current = null; dragOver.current = null;
  }

  return (
    <Layout actions={<Button onClick={() => setShowCreate(true)}>+ New Ensemble</Button>}>
      {/* ── Gradient greeting banner ── */}
      <div style={{
        borderRadius: 16, padding: '28px 32px', marginBottom: 32,
        background: 'var(--banner-gradient)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -20, top: -20, width: 160, height: 160, borderRadius: '50%', background: 'rgba(91,76,245,0.07)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', right: 60, bottom: -40, width: 100, height: 100, borderRadius: '50%', background: 'rgba(26,159,212,0.06)', pointerEvents: 'none' }} />
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--banner-label)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>Scorva</p>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--banner-text)', letterSpacing: '-0.04em', lineHeight: 1.2, marginBottom: 6 }}>
          {greeting(user?.name || user?.email)}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--banner-subtext)', fontWeight: 400 }}>
          {ensembles.length === 0 ? 'Create your first ensemble to get started.' : `${ensembles.length} ensemble${ensembles.length !== 1 ? 's' : ''} · Your music, organized.`}
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
            <div
              key={e.id}
              draggable
              onDragStart={() => onDragStart(e.id)}
              onDragEnter={() => onDragEnter(e.id)}
              onDragEnd={onDragEnd}
              onDragOver={ev => ev.preventDefault()}
              style={{
                position: 'relative',
                borderRadius: 12,
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden',
                background: 'var(--surface-raised)',
                opacity: deletingId === e.id ? 0.4 : 1,
                transition: 'opacity 0.15s',
                cursor: 'grab',
              }}
            >
              {/* Color banner strip */}
              <div style={{ height: 5, background: ensembleGradient(e.name) }} />

              <Link
                to={`/ensembles/${e.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 16px', color: 'var(--text)', textDecoration: 'none',
                }}
                onClick={ev => { if (menuOpen === e.id) ev.preventDefault(); }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: ensembleGradient(e.name),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, color: '#fff',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  }}>
                    {(e.name?.[0] ?? '?').toUpperCase()}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{e.name}</span>
                </div>

                {/* Options menu */}
                <div style={{ position: 'relative' }} onClick={ev => ev.preventDefault()}>
                  <button
                    onClick={ev => { ev.preventDefault(); ev.stopPropagation(); setMenuOpen(menuOpen === e.id ? null : e.id); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-faint)', fontSize: 18, lineHeight: 1,
                      padding: '4px 8px', borderRadius: 6,
                    }}
                    title="Options"
                  >⋮</button>

                  {menuOpen === e.id && (
                    <div
                      onClick={ev => ev.stopPropagation()}
                      style={{
                        position: 'absolute', right: 0, top: '100%', zIndex: 50,
                        background: 'var(--surface-raised)', border: '1px solid var(--border)',
                        borderRadius: 8, boxShadow: 'var(--shadow)', minWidth: 140,
                        padding: '4px 0', marginTop: 4,
                      }}
                    >
                      <button
                        onClick={ev => handleDelete(ev, e.id)}
                        disabled={deletingId === e.id}
                        style={{
                          width: '100%', padding: '8px 14px', textAlign: 'left',
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--danger)', fontSize: 13, fontFamily: 'inherit',
                        }}
                      >
                        Delete ensemble
                      </button>
                    </div>
                  )}
                </div>
              </Link>
            </div>
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
