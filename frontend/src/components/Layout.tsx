import { ReactNode, useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { getMyEnsembles, createEnsemble } from '../api/ensembles';
import { Ensemble } from '../types';
import { addEnsembleId } from '../pages/Dashboard';

interface Props {
  children: ReactNode;
  title?: string;
  back?: { label: string; to: string };
  actions?: ReactNode;
}

export function Layout({ children, title, back, actions }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPlayerView = location.pathname === '/my-parts';
  const [ensembles, setEnsembles] = useState<Ensemble[]>([]);
  const [showNewEnsemble, setShowNewEnsemble] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dark, setDark] = useDarkMode();

  useEffect(() => {
    if (!user) return;
    getMyEnsembles().then(r => setEnsembles(r.ensembles)).catch(() => {});
  }, [user]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function handleCreateEnsemble(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { ensemble } = await createEnsemble(newName.trim());
      addEnsembleId(ensemble.id);
      setEnsembles(prev => [...prev, ensemble]);
      setNewName('');
      setShowNewEnsemble(false);
      navigate(`/ensembles/${ensemble.id}`);
    } finally {
      setCreating(false);
    }
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        {children}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside style={{
        width: 'var(--sidebar-width)', minWidth: 'var(--sidebar-width)',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex', flexDirection: 'column',
        position: 'fixed', top: 0, left: 0, bottom: 0,
        zIndex: 20,
      }}>

        {/* Brand */}
        <div style={{ padding: '16px 12px 10px' }}>
          <Link to="/" style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              transition: 'background var(--transition)',
            }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: 'linear-gradient(145deg, #5b4cf5 0%, #1a9fd4 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#fff',
                boxShadow: '0 2px 8px rgba(91,76,245,0.3)',
              }}>S</div>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', letterSpacing: '-0.03em' }}>
                Scorva
              </span>
            </div>
          </Link>
        </div>

        {/* View toggle */}
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{
            display: 'flex',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}>
            {[
              { to: '/', label: '♩ Band', active: !isPlayerView },
              { to: '/my-parts', label: '♪ My parts', active: isPlayerView },
            ].map(item => (
              <Link key={item.to} to={item.to} style={{
                flex: 1, padding: '5px 0', textAlign: 'center',
                borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                background: item.active ? 'linear-gradient(135deg, #5b4cf5 0%, #1a9fd4 100%)' : 'transparent',
                color: item.active ? '#fff' : 'var(--text-muted)',
                boxShadow: item.active ? '0 2px 8px rgba(91,76,245,0.3)' : 'none',
                transition: 'all 0.15s',
                letterSpacing: '-0.01em',
              }}>{item.label}</Link>
            ))}
          </div>
        </div>

        {/* Ensembles */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 6px 4px',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>Ensembles</span>
            <button
              onClick={() => setShowNewEnsemble(s => !s)}
              title="New ensemble"
              style={{
                width: 18, height: 18, borderRadius: 4,
                background: showNewEnsemble ? 'var(--accent)' : 'transparent',
                border: `1px solid ${showNewEnsemble ? 'var(--accent)' : 'var(--border)'}`,
                color: showNewEnsemble ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: 13, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all var(--transition)',
              }}
            >+</button>
          </div>

          {showNewEnsemble && (
            <form onSubmit={handleCreateEnsemble} style={{ padding: '3px 2px 7px', display: 'flex', gap: 4 }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Name…"
                autoFocus
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 6 }}
              />
              <button type="submit" disabled={creating || !newName.trim()} style={{
                background: 'var(--accent)', border: 'none', borderRadius: 6,
                color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                padding: '4px 9px', opacity: creating || !newName.trim() ? 0.5 : 1,
                fontFamily: 'inherit', flexShrink: 0,
              }}>
                {creating ? '…' : 'Add'}
              </button>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>
            {ensembles.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 6px' }}>
                No ensembles yet
              </p>
            ) : (
              ensembles.map(e => {
                const active = location.pathname.startsWith(`/ensembles/${e.id}`);
                return (
                  <Link
                    key={e.id}
                    to={`/ensembles/${e.id}`}
                    style={{
                      display: 'block', padding: '5px 9px',
                      borderRadius: 'var(--radius-xs)', fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                      background: active ? 'var(--accent-subtle)' : 'transparent',
                      textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      transition: 'all var(--transition)',
                    }}
                    onMouseEnter={e2 => {
                      if (!active) {
                        (e2.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
                        (e2.currentTarget as HTMLElement).style.color = 'var(--text)';
                      }
                    }}
                    onMouseLeave={e2 => {
                      if (!active) {
                        (e2.currentTarget as HTMLElement).style.background = 'transparent';
                        (e2.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                      }
                    }}
                  >
                    {e.name}
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Footer: dark mode + sign out */}
        <div style={{ padding: '8px 10px 14px', borderTop: '1px solid var(--sidebar-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
            {user.name || user.email}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Dark mode toggle */}
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                flex: 1,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 13, padding: '5px 0',
                transition: 'all var(--transition)', fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
              }}
            >
              {dark ? '☀' : '◑'}
            </button>
            {/* Sign out */}
            <button
              onClick={handleLogout}
              style={{
                flex: 2,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 12, padding: '5px 0',
                transition: 'all var(--transition)', fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(208,60,60,0.05)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >Sign out</button>
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <div style={{ marginLeft: 'var(--sidebar-width)', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        {(title || back || actions) && (
          <div style={{
            borderBottom: '1px solid var(--border)',
            padding: '0 32px',
            height: 52,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 10,
            background: 'var(--bg)',
            backdropFilter: 'blur(16px)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
              {back && (
                <Link to={back.to} style={{
                  color: 'var(--text-faint)', fontSize: 11, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none',
                  letterSpacing: '0.01em', transition: 'color var(--transition)',
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'}
                >
                  ← {back.label}
                </Link>
              )}
              {title && <h1>{title}</h1>}
            </div>
            {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
          </div>
        )}

        <main style={{ flex: 1, padding: '28px 32px', maxWidth: 860, width: '100%' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
