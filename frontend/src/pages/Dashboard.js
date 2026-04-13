import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getEnsemble } from '../api/ensembles';
import { createEnsemble } from '../api/ensembles';
import { useAuth } from '../hooks/useAuth';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
// The API doesn't have a "list ensembles" endpoint — we store ensemble IDs in localStorage
// after joining/creating, so the dashboard reads from that list.
const ENSEMBLE_IDS_KEY = 'ensemble_ids';
function getStoredEnsembleIds() {
    try {
        return JSON.parse(localStorage.getItem(ENSEMBLE_IDS_KEY) ?? '[]');
    }
    catch {
        return [];
    }
}
export function addEnsembleId(id) {
    const ids = getStoredEnsembleIds();
    if (!ids.includes(id))
        localStorage.setItem(ENSEMBLE_IDS_KEY, JSON.stringify([...ids, id]));
}
export function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [ensembles, setEnsembles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
        const ids = getStoredEnsembleIds();
        Promise.all(ids.map(id => getEnsemble(id).then(r => r.ensemble).catch(() => null)))
            .then(results => setEnsembles(results.filter(Boolean)))
            .finally(() => setLoading(false));
    }, [user, navigate]);
    async function handleCreate(e) {
        e.preventDefault();
        setCreateError('');
        setCreating(true);
        try {
            const { ensemble } = await createEnsemble(newName.trim());
            addEnsembleId(ensemble.id);
            setEnsembles(prev => [ensemble, ...prev]);
            setShowCreate(false);
            setNewName('');
        }
        catch (err) {
            setCreateError(err instanceof ApiError ? err.message : 'Something went wrong');
        }
        finally {
            setCreating(false);
        }
    }
    return (_jsxs(Layout, { title: "My Ensembles", actions: _jsx(Button, { onClick: () => setShowCreate(true), children: "+ New Ensemble" }), children: [loading ? (_jsx("p", { style: { color: 'var(--text-muted)' }, children: "Loading\u2026" })) : ensembles.length === 0 ? (_jsxs("div", { style: { textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }, children: [_jsx("p", { style: { marginBottom: 16 }, children: "No ensembles yet." }), _jsx(Button, { onClick: () => setShowCreate(true), children: "Create your first ensemble" })] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: ensembles.map(e => (_jsxs(Link, { to: `/ensembles/${e.id}`, style: {
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
                    }, children: [_jsx("span", { style: { fontWeight: 500 }, children: e.name }), _jsx("span", { style: { color: 'var(--text-muted)', fontSize: 12 }, children: "\u2192" })] }, e.id))) })), showCreate && (_jsx(Modal, { title: "New Ensemble", onClose: () => setShowCreate(false), children: _jsxs("form", { onSubmit: handleCreate, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Name" }), _jsx("input", { value: newName, onChange: e => setNewName(e.target.value), required: true, autoFocus: true, placeholder: "e.g. Monday Night Big Band" })] }), createError && _jsx("p", { className: "form-error", children: createError }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }, children: [_jsx(Button, { variant: "secondary", type: "button", onClick: () => setShowCreate(false), children: "Cancel" }), _jsx(Button, { type: "submit", loading: creating, children: "Create" })] })] }) }))] }));
}
