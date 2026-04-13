import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';
export function Login() {
    const { login: setAuth } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { token, user } = await login({ email, password });
            setAuth(token, user);
            navigate('/');
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Something went wrong');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsx("div", { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }, children: _jsxs("div", { style: { width: '100%', maxWidth: 380, padding: 32, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }, children: [_jsx("h1", { style: { marginBottom: 24, textAlign: 'center' }, children: "ChartKeeper" }), _jsxs("form", { onSubmit: handleSubmit, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Email" }), _jsx("input", { type: "email", value: email, onChange: e => setEmail(e.target.value), required: true, autoFocus: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Password" }), _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), required: true })] }), error && _jsx("p", { className: "form-error", children: error }), _jsx(Button, { type: "submit", loading: loading, style: { width: '100%', marginTop: 8 }, children: "Sign in" })] }), _jsxs("p", { style: { textAlign: 'center', marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }, children: ["No account? ", _jsx(Link, { to: "/signup", children: "Sign up" })] })] }) }));
}
