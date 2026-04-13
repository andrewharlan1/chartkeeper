import { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from './Button';

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

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          ChartKeeper
        </Link>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Band / My Parts toggle */}
            <div style={{
              display: 'flex', background: 'var(--bg)',
              border: '1px solid var(--border)', borderRadius: 6, padding: 2,
            }}>
              <Link to="/" style={{
                padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                textDecoration: 'none',
                background: !isPlayerView ? 'var(--accent)' : 'transparent',
                color: !isPlayerView ? '#fff' : 'var(--text-muted)',
                transition: 'background 0.15s, color 0.15s',
              }}>Band view</Link>
              <Link to="/my-parts" style={{
                padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                textDecoration: 'none',
                background: isPlayerView ? 'var(--accent)' : 'transparent',
                color: isPlayerView ? '#fff' : 'var(--text-muted)',
                transition: 'background 0.15s, color 0.15s',
              }}>My parts</Link>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>Sign out</Button>
          </div>
        )}
      </header>

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {(title || back || actions) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              {back && (
                <Link to={back.to} style={{ color: 'var(--text-muted)', fontSize: 13, display: 'block', marginBottom: 6 }}>
                  ← {back.label}
                </Link>
              )}
              {title && <h1>{title}</h1>}
            </div>
            {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
