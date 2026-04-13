import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from './Button';
export function Layout({ children, title, back, actions }) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isPlayerView = location.pathname === '/my-parts';
    function handleLogout() {
        logout();
        navigate('/login');
    }
    return (_jsxs("div", { style: { minHeight: '100vh', display: 'flex', flexDirection: 'column' }, children: [_jsxs("header", { style: {
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
                }, children: [_jsx(Link, { to: "/", style: { fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.01em' }, children: "ChartKeeper" }), user && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 12 }, children: [_jsxs("div", { style: {
                                    display: 'flex', background: 'var(--bg)',
                                    border: '1px solid var(--border)', borderRadius: 6, padding: 2,
                                }, children: [_jsx(Link, { to: "/", style: {
                                            padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                                            textDecoration: 'none',
                                            background: !isPlayerView ? 'var(--accent)' : 'transparent',
                                            color: !isPlayerView ? '#fff' : 'var(--text-muted)',
                                            transition: 'background 0.15s, color 0.15s',
                                        }, children: "Band view" }), _jsx(Link, { to: "/my-parts", style: {
                                            padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                                            textDecoration: 'none',
                                            background: isPlayerView ? 'var(--accent)' : 'transparent',
                                            color: isPlayerView ? '#fff' : 'var(--text-muted)',
                                            transition: 'background 0.15s, color 0.15s',
                                        }, children: "My parts" })] }), _jsx("span", { style: { color: 'var(--text-muted)', fontSize: 13 }, children: user.email }), _jsx(Button, { variant: "ghost", size: "sm", onClick: handleLogout, children: "Sign out" })] }))] }), _jsxs("main", { style: { flex: 1, padding: '32px 24px', maxWidth: 900, width: '100%', margin: '0 auto' }, children: [(title || back || actions) && (_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }, children: [_jsxs("div", { children: [back && (_jsxs(Link, { to: back.to, style: { color: 'var(--text-muted)', fontSize: 13, display: 'block', marginBottom: 6 }, children: ["\u2190 ", back.label] })), title && _jsx("h1", { children: title })] }), actions && _jsx("div", { style: { display: 'flex', gap: 8 }, children: actions })] })), children] })] }));
}
