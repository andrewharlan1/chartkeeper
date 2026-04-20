import { ReactNode, useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { getEnsembles, createEnsemble } from '../api/ensembles';
import { Ensemble } from '../types';

interface Props {
  children: ReactNode;
  title?: string;
  back?: { label: string; to: string };
  actions?: ReactNode;
}

export function Layout({ children, title, back, actions }: Props) {
  const { user, workspaceId, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPlayerView = location.pathname === '/my-parts';
  const [ensembles, setEnsembles] = useState<Ensemble[]>([]);
  const [showNewEnsemble, setShowNewEnsemble] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!user || !workspaceId) return;
    getEnsembles(workspaceId).then(r => setEnsembles(r.ensembles)).catch(() => {});
  }, [user, workspaceId]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const [createError, setCreateError] = useState('');

  async function handleCreateEnsemble(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (!workspaceId) {
      setCreateError('No workspace. Try signing out and back in.');
      return;
    }
    setCreateError('');
    setCreating(true);
    try {
      const { ensemble } = await createEnsemble(workspaceId, newName.trim());
      setEnsembles(prev => [...prev, ensemble]);
      setNewName('');
      setShowNewEnsemble(false);
      navigate(`/ensembles/${ensemble.id}`);
    } catch {
      setCreateError('Failed to create ensemble.');
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

      {/* Collapse toggle */}
      <button
        onClick={() => setSidebarOpen(o => !o)}
        title={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
        style={{
          position: 'fixed', top: 14,
          left: sidebarOpen ? 'calc(var(--sidebar-width) - 14px)' : 6,
          zIndex: 30,
          width: 24, height: 24, borderRadius: 99,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: 11, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'left 0.2s ease',
        }}
      >{sidebarOpen ? '\u2190' : '\u2192'}</button>

      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 'var(--sidebar-width)' : 0,
        minWidth: sidebarOpen ? 'var(--sidebar-width)' : 0,
        background: 'var(--sidebar-bg)',
        borderRight: sidebarOpen ? '1px solid var(--sidebar-border)' : 'none',
        display: 'flex', flexDirection: 'column',
        position: 'fixed', top: 0, left: 0, bottom: 0,
        zIndex: 20,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
      }}>

        {/* Sidebar banner */}
        <div style={{
          padding: '14px 14px 12px',
          background: 'linear-gradient(160deg, var(--accent-subtle) 0%, transparent 100%)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(145deg, #5b4cf5 0%, #38b2f5 100%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3.5, padding: '7px 6px',
              boxShadow: '0 2px 8px rgba(91,76,245,0.35)',
            }}>
              {[1, 0.6, 1].map((w, i) => (
                <div key={i} style={{ width: `${w * 14}px`, height: 1.5, background: '#fff', borderRadius: 1, opacity: 0.9 }} />
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                Scorva
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                music management
              </div>
            </div>
          </Link>
        </div>

        {/* View toggle */}
        <div style={{ padding: '10px 10px 8px' }}>
          <div style={{
            display: 'flex',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}>
            {[
              {
                to: '/', active: !isPlayerView, label: 'Band',
                icon: (
                  <svg width="13" height="11" viewBox="0 0 13 11" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="4.5" cy="2.5" r="2" fill="currentColor" opacity="0.9"/>
                    <path d="M0.5 10c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.9"/>
                    <circle cx="9.5" cy="2.5" r="1.6" fill="currentColor" opacity="0.6"/>
                    <path d="M6.5 10c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.6"/>
                  </svg>
                ),
              },
              {
                to: '/my-parts', active: isPlayerView, label: 'My parts',
                icon: (
                  <svg width="11" height="13" viewBox="0 0 11 13" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="5.5" cy="2.8" r="2.2" fill="currentColor"/>
                    <path d="M1 12c0-2.5 2-4.5 4.5-4.5S10 9.5 10 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
                  </svg>
                ),
              },
            ].map(item => (
              <Link key={item.to} to={item.to} style={{
                flex: 1, padding: '5px 0', textAlign: 'center',
                borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                background: item.active ? 'linear-gradient(135deg, #5b4cf5 0%, #1a9fd4 100%)' : 'transparent',
                color: item.active ? '#fff' : 'var(--text-muted)',
                boxShadow: item.active ? '0 2px 8px rgba(91,76,245,0.3)' : 'none',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
                {item.icon}
                {item.label}
              </Link>
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
                placeholder="Name..."
                autoFocus
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 6 }}
              />
              <button type="submit" disabled={creating || !newName.trim()} style={{
                background: 'var(--accent)', border: 'none', borderRadius: 6,
                color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                padding: '4px 9px', opacity: creating || !newName.trim() ? 0.5 : 1,
                fontFamily: 'inherit', flexShrink: 0,
              }}>
                {creating ? '...' : 'Add'}
              </button>
            </form>
          )}
          {createError && (
            <p style={{ fontSize: 11, color: 'var(--danger)', padding: '2px 6px' }}>{createError}</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>
            {ensembles.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 6px' }}>
                No ensembles yet
              </p>
            ) : (
              ensembles.map(ens => {
                const active = location.pathname.startsWith(`/ensembles/${ens.id}`);
                return (
                  <Link
                    key={ens.id}
                    to={`/ensembles/${ens.id}`}
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
                  >
                    {ens.name}
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
            <button
              onClick={() => setDark((d: boolean) => !d)}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                flex: 1,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 13, padding: '5px 0',
                transition: 'all var(--transition)', fontFamily: 'inherit',
              }}
            >
              {dark ? '\u2600' : '\u25D1'}
            </button>
            <button
              onClick={handleLogout}
              style={{
                flex: 2,
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 12, padding: '5px 0',
                transition: 'all var(--transition)', fontFamily: 'inherit',
              }}
            >Sign out</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ marginLeft: sidebarOpen ? 'var(--sidebar-width)' : 0, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', transition: 'margin-left 0.2s ease' }}>

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
                }}>
                  \u2190 {back.label}
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
