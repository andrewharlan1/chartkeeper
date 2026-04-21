import { ReactNode, useEffect, useState, useRef, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useDarkMode } from '../hooks/useDarkMode';
import { getEnsembles, createEnsemble } from '../api/ensembles';
import { getWorkspaceMembers } from '../api/workspaces';
import { getUnreadCount, getNotifications, markNotificationsRead, Notification as NotifType } from '../api/notifications';
import { Ensemble, WorkspaceMember } from '../types';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';
import { BackButton } from './BackButton';

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Module-level cache to avoid re-fetching on every Layout mount
let cachedEnsembles: Ensemble[] | null = null;
let cacheWorkspaceId: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

interface Props {
  children: ReactNode;
  title?: string;
  back?: { label: string; to: string };
  backTo?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}

function useImpersonation() {
  const [impersonateUserId, setImpersonateState] = useState<string | null>(
    () => localStorage.getItem('impersonateUserId'),
  );
  const [impersonateName, setImpersonateName] = useState<string | null>(
    () => localStorage.getItem('impersonateName'),
  );

  function startImpersonating(userId: string, name: string) {
    localStorage.setItem('impersonateUserId', userId);
    localStorage.setItem('impersonateName', name);
    setImpersonateState(userId);
    setImpersonateName(name);
  }

  function stopImpersonating() {
    localStorage.removeItem('impersonateUserId');
    localStorage.removeItem('impersonateName');
    setImpersonateState(null);
    setImpersonateName(null);
  }

  return { impersonateUserId, impersonateName, startImpersonating, stopImpersonating };
}

export function Layout({ children, title, back, backTo, breadcrumbs, actions }: Props) {
  const { user, workspaceId, logout } = useAuth();
  const { impersonateUserId, impersonateName, startImpersonating, stopImpersonating } = useImpersonation();
  const navigate = useNavigate();
  const location = useLocation();
  const isPlayerView = location.pathname === '/my-parts';
  const [ensembles, setEnsembles] = useState<Ensemble[]>(
    cacheWorkspaceId === workspaceId && cachedEnsembles ? cachedEnsembles : [],
  );
  const [showNewEnsemble, setShowNewEnsemble] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fetchedRef = useRef(false);
  const [viewAsMembers, setViewAsMembers] = useState<WorkspaceMember[]>([]);
  const [showViewAs, setShowViewAs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifs, setNotifs] = useState<NotifType[]>([]);
  const [notifsLoaded, setNotifsLoaded] = useState(false);

  useEffect(() => {
    if (!user || !workspaceId) return;
    // Use cache if fresh enough
    if (cachedEnsembles && cacheWorkspaceId === workspaceId && Date.now() - cacheTime < CACHE_TTL) {
      setEnsembles(cachedEnsembles);
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getEnsembles(workspaceId).then(r => {
      cachedEnsembles = r.ensembles;
      cacheWorkspaceId = workspaceId;
      cacheTime = Date.now();
      setEnsembles(r.ensembles);
    }).catch(() => {});
  }, [user, workspaceId]);

  // Load members for "View as" once
  useEffect(() => {
    if (!workspaceId) return;
    getWorkspaceMembers(workspaceId).then(r => setViewAsMembers(r.members)).catch(() => {});
  }, [workspaceId]);

  // Poll unread notification count
  useEffect(() => {
    if (!user) return;
    const fetchCount = () => getUnreadCount().then(r => setUnreadCount(r.count)).catch(() => {});
    fetchCount();
    const timer = setInterval(fetchCount, 60_000);
    return () => clearInterval(timer);
  }, [user]);

  async function handleOpenNotifPanel() {
    setShowNotifPanel(prev => !prev);
    if (!notifsLoaded) {
      try {
        const r = await getNotifications(20);
        setNotifs(r.notifications);
        setNotifsLoaded(true);
      } catch { /* ignore */ }
    }
  }

  async function handleMarkAllRead() {
    await markNotificationsRead().catch(() => {});
    setNotifs(prev => prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function handleNotifClick(notif: NotifType) {
    if (!notif.readAt) {
      markNotificationsRead([notif.id]).catch(() => {});
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    setShowNotifPanel(false);
    // Navigate to the relevant chart/version
    const payload = notif.payload as { chartId?: string; versionId?: string; ensembleId?: string };
    if (payload.chartId && payload.versionId) {
      navigate(`/charts/${payload.chartId}/versions/${payload.versionId}`);
    } else if (payload.ensembleId) {
      navigate(`/ensembles/${payload.ensembleId}`);
    }
  }

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
      const updated = [...ensembles, ensemble];
      setEnsembles(updated);
      cachedEnsembles = updated;
      cacheTime = Date.now();
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

        {/* View As selector */}
        {viewAsMembers.length > 1 && (
          <div style={{ padding: '6px 10px 0', position: 'relative' }}>
            <button
              onClick={() => setShowViewAs(s => !s)}
              style={{
                width: '100%', padding: '5px 8px', fontSize: 11, fontWeight: 600,
                background: impersonateUserId ? 'var(--warning-subtle, #fef3cd)' : 'transparent',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
                color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              VIEW AS: {impersonateName || user.name || 'yourself'} {'\u25BE'}
            </button>
            {showViewAs && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 10, right: 10, marginBottom: 4,
                background: 'var(--surface-raised)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: 'var(--shadow-md)', padding: 4, zIndex: 50,
                maxHeight: 200, overflowY: 'auto',
              }}>
                <button
                  onClick={() => { stopImpersonating(); setShowViewAs(false); window.location.reload(); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: !impersonateUserId ? 'var(--accent-subtle)' : 'none',
                    border: 'none', padding: '5px 8px', fontSize: 12, cursor: 'pointer',
                    borderRadius: 5, fontFamily: 'inherit',
                  }}
                >
                  {user.name || user.email} (you)
                </button>
                {viewAsMembers.filter(m => m.id !== user.id).map(m => (
                  <button
                    key={m.id}
                    onClick={() => { startImpersonating(m.id, m.name || m.email); setShowViewAs(false); window.location.reload(); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: impersonateUserId === m.id ? 'var(--accent-subtle)' : 'none',
                      border: 'none', padding: '5px 8px', fontSize: 12, cursor: 'pointer',
                      borderRadius: 5, fontFamily: 'inherit',
                    }}
                  >
                    {m.name || m.email}
                    {m.isDummy && <span style={{ color: 'var(--text-faint)', marginLeft: 4, fontSize: 10 }}>dummy</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
        {(title || back || backTo || actions || breadcrumbs) && (
          <div style={{
            borderBottom: '1px solid var(--border)',
            padding: '0 32px',
            minHeight: 52,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 10,
            background: 'var(--bg)',
            backdropFilter: 'blur(16px)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              {backTo && <BackButton to={backTo} />}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '8px 0' }}>
              {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
              {!breadcrumbs && back && (
                <Link to={back.to} style={{
                  color: 'var(--text-faint)', fontSize: 11, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none',
                  letterSpacing: '0.01em', transition: 'color var(--transition)',
                }}>
                  ← {back.label}
                </Link>
              )}
              {title && <h1 style={{ margin: 0 }}>{title}</h1>}
            </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Notification bell */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={handleOpenNotifPanel}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                    fontSize: 18, color: 'var(--text-muted)', position: 'relative',
                  }}
                  title="Notifications"
                >
                  {'\uD83D\uDD14'}
                  {unreadCount > 0 && (
                    <span style={{
                      position: 'absolute', top: 0, right: 2,
                      background: 'var(--danger, #e53e3e)', color: '#fff',
                      fontSize: 10, fontWeight: 700, borderRadius: 10,
                      padding: '1px 5px', minWidth: 16, textAlign: 'center',
                      lineHeight: '14px',
                    }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                {showNotifPanel && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 8,
                    width: 360, maxHeight: 420, overflowY: 'auto',
                    background: 'var(--surface-raised)', border: '1px solid var(--border)',
                    borderRadius: 12, boxShadow: 'var(--shadow-lg, 0 4px 20px rgba(0,0,0,0.15))',
                    zIndex: 50, padding: 0,
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 12, color: 'var(--accent)', fontFamily: 'inherit',
                          }}
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    {notifs.length === 0 ? (
                      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No notifications
                      </div>
                    ) : (
                      notifs.map(n => {
                        const payload = n.payload as Record<string, string>;
                        const isUnread = !n.readAt;
                        let message = '';
                        if (n.kind === 'new_part_version') {
                          message = `${payload.chartName} updated — ${payload.partName}`;
                        } else if (n.kind === 'assignment_added') {
                          message = `You were assigned to ${payload.instrumentName}`;
                        } else {
                          message = 'Notification';
                        }
                        return (
                          <button
                            key={n.id}
                            onClick={() => handleNotifClick(n)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              background: isUnread ? 'var(--accent-subtle, rgba(59,130,246,0.05))' : 'none',
                              border: 'none', borderBottom: '1px solid var(--border)',
                              padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, marginTop: 3, flexShrink: 0 }}>
                                {isUnread ? '\u25CF' : '\u25CB'}
                              </span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: isUnread ? 600 : 400 }}>
                                  {message}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                                  {formatTimeAgo(n.createdAt)}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              {actions}
            </div>
          </div>
        )}

        {impersonateUserId && (
          <div style={{
            padding: '8px 32px', background: 'var(--warning-subtle, #fef3cd)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 13,
          }}>
            <span>
              Viewing as <strong>{impersonateName}</strong> (impersonating)
            </span>
            <button
              onClick={() => { stopImpersonating(); window.location.reload(); }}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                padding: '2px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Exit
            </button>
          </div>
        )}

        <main style={{ flex: 1, padding: '28px 32px', maxWidth: 860, width: '100%' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
