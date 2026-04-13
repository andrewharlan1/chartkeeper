import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { signup } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';
export function Signup() {
    const { login: setAuth } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inviteToken = searchParams.get('invite') ?? undefined;
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const { token, user } = await signup({ email, name, password, inviteToken });
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
    return (_jsx("div", { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }, children: _jsxs("div", { style: { width: '100%', maxWidth: 380, padding: 32, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }, children: [_jsx("h1", { style: { marginBottom: 4, textAlign: 'center' }, children: "ChartKeeper" }), inviteToken && (_jsx("p", { style: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }, children: "You've been invited to join an ensemble." })), _jsxs("form", { onSubmit: handleSubmit, style: { marginTop: inviteToken ? 0 : 24 }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Name" }), _jsx("input", { value: name, onChange: e => setName(e.target.value), required: true, autoFocus: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Email" }), _jsx("input", { type: "email", value: email, onChange: e => setEmail(e.target.value), required: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Password" }), _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), required: true, minLength: 8 })] }), error && _jsx("p", { className: "form-error", children: error }), _jsx(Button, { type: "submit", loading: loading, style: { width: '100%', marginTop: 8 }, children: "Create account" })] }), _jsxs("p", { style: { textAlign: 'center', marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }, children: ["Already have an account? ", _jsx(Link, { to: "/login", children: "Sign in" })] })] }) }));
}
