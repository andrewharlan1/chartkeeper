import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getEnsemble, getMembers, inviteMember } from '../api/ensembles';
import { getChart, createChart, deleteChart } from '../api/charts';
import { useAuth } from '../hooks/useAuth';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../api/client';
import { addEnsembleId } from './Dashboard';
// Store chart IDs per ensemble in localStorage
function getChartIds(ensembleId) {
    try {
        return JSON.parse(localStorage.getItem(`charts:${ensembleId}`) ?? '[]');
    }
    catch {
        return [];
    }
}
function addChartId(ensembleId, chartId) {
    const ids = getChartIds(ensembleId);
    if (!ids.includes(chartId))
        localStorage.setItem(`charts:${ensembleId}`, JSON.stringify([...ids, chartId]));
}
export function EnsemblePage() {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [ensemble, setEnsemble] = useState(null);
    const [members, setMembers] = useState([]);
    const [charts, setCharts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('player');
    const [inviting, setInviting] = useState(false);
    const [inviteUrl, setInviteUrl] = useState('');
    const [inviteError, setInviteError] = useState('');
    const [deletingChart, setDeletingChart] = useState(null);
    const [showCreateChart, setShowCreateChart] = useState(false);
    const [chartTitle, setChartTitle] = useState('');
    const [chartComposer, setChartComposer] = useState('');
    const [creatingChart, setCreatingChart] = useState(false);
    const [chartError, setChartError] = useState('');
    const myRole = members.find(m => m.id === user?.id)?.role;
    useEffect(() => {
        if (!id)
            return;
        addEnsembleId(id);
        Promise.all([
            getEnsemble(id),
            getMembers(id),
        ]).then(([ensRes, memRes]) => {
            setEnsemble(ensRes.ensemble);
            setMembers(memRes.members);
            const chartIds = getChartIds(id);
            return Promise.all(chartIds.map(cid => getChart(cid).then(r => r.chart).catch(() => null)));
        }).then(chartResults => {
            setCharts(chartResults.filter(Boolean));
        }).catch(() => navigate('/'))
            .finally(() => setLoading(false));
    }, [id, navigate]);
    async function handleInvite(e) {
        e.preventDefault();
        if (!id)
            return;
        setInviteError('');
        setInviting(true);
        try {
            const { inviteUrl: url } = await inviteMember(id, inviteEmail, inviteRole);
            const fullUrl = `${window.location.origin}/signup?invite=${url.split('/').pop()}`;
            setInviteUrl(fullUrl);
        }
        catch (err) {
            setInviteError(err instanceof ApiError ? err.message : 'Something went wrong');
        }
        finally {
            setInviting(false);
        }
    }
    async function handleDeleteChart(chartId, title) {
        if (!confirm(`Delete "${title || 'Untitled'}"? This cannot be undone.`))
            return;
        setDeletingChart(chartId);
        try {
            await deleteChart(chartId);
            setCharts(prev => prev.filter(c => c.id !== chartId));
        }
        catch {
            alert('Failed to delete chart');
        }
        finally {
            setDeletingChart(null);
        }
    }
    async function handleCreateChart(e) {
        e.preventDefault();
        if (!id)
            return;
        setChartError('');
        setCreatingChart(true);
        try {
            const { chart } = await createChart({
                ensembleId: id,
                title: chartTitle.trim() || undefined,
                composer: chartComposer.trim() || undefined,
            });
            addChartId(id, chart.id);
            setCharts(prev => [chart, ...prev]);
            setShowCreateChart(false);
            setChartTitle('');
            setChartComposer('');
        }
        catch (err) {
            setChartError(err instanceof ApiError ? err.message : 'Something went wrong');
        }
        finally {
            setCreatingChart(false);
        }
    }
    if (loading)
        return _jsx(Layout, { children: _jsx("p", { style: { color: 'var(--text-muted)' }, children: "Loading\u2026" }) });
    if (!ensemble)
        return null;
    const isOwnerOrEditor = myRole === 'owner' || myRole === 'editor';
    return (_jsxs(Layout, { title: ensemble.name, back: { label: 'My Ensembles', to: '/' }, actions: isOwnerOrEditor ? (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", size: "sm", onClick: () => setShowInvite(true), children: "Invite member" }), _jsx(Button, { size: "sm", onClick: () => setShowCreateChart(true), children: "+ New chart" })] })) : undefined, children: [_jsxs("section", { style: { marginBottom: 36 }, children: [_jsx("h2", { style: { marginBottom: 14 }, children: "Members" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 1 }, children: members.map(m => (_jsxs("div", { style: {
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 16px', background: 'var(--surface)',
                                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                            }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontWeight: 500 }, children: m.name }), _jsx("span", { style: { color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }, children: m.email })] }), _jsx("span", { style: { color: 'var(--text-muted)', fontSize: 12, textTransform: 'capitalize' }, children: m.role })] }, m.id))) })] }), _jsxs("section", { children: [_jsx("h2", { style: { marginBottom: 14 }, children: "Charts" }), charts.length === 0 ? (_jsxs("p", { style: { color: 'var(--text-muted)' }, children: ["No charts yet.", isOwnerOrEditor ? ' Create one above.' : ''] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: charts.map(c => (_jsxs("div", { style: {
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '14px 20px', background: 'var(--surface)',
                                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                            }, children: [_jsxs(Link, { to: `/charts/${c.id}`, style: { flex: 1, color: 'var(--text)', textDecoration: 'none' }, children: [_jsx("span", { style: { fontWeight: 500 }, children: c.title ?? 'Untitled' }), c.composer && _jsx("span", { style: { color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }, children: c.composer })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { color: 'var(--text-muted)', fontSize: 12 }, children: "\u2192" }), myRole === 'owner' && (_jsx(Button, { variant: "ghost", size: "sm", loading: deletingChart === c.id, onClick: () => handleDeleteChart(c.id, c.title ?? ''), style: { color: 'var(--danger)' }, children: "Delete" }))] })] }, c.id))) }))] }), showInvite && (_jsx(Modal, { title: "Invite member", onClose: () => { setShowInvite(false); setInviteUrl(''); setInviteEmail(''); setInviteError(''); }, children: inviteUrl ? (_jsxs("div", { children: [_jsx("p", { style: { marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }, children: "Share this link with the invitee:" }), _jsx("div", { style: {
                                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                                padding: '10px 12px', fontSize: 12, wordBreak: 'break-all', color: 'var(--accent)',
                                marginBottom: 16,
                            }, children: inviteUrl }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [_jsx(Button, { variant: "secondary", onClick: () => navigator.clipboard.writeText(inviteUrl), children: "Copy" }), _jsx(Button, { onClick: () => { setShowInvite(false); setInviteUrl(''); setInviteEmail(''); }, children: "Done" })] })] })) : (_jsxs("form", { onSubmit: handleInvite, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Email" }), _jsx("input", { type: "email", value: inviteEmail, onChange: e => setInviteEmail(e.target.value), required: true, autoFocus: true })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Role" }), _jsxs("select", { value: inviteRole, onChange: e => setInviteRole(e.target.value), children: [_jsx("option", { value: "player", children: "Player (read-only)" }), _jsx("option", { value: "editor", children: "Editor (can push versions)" })] })] }), inviteError && _jsx("p", { className: "form-error", children: inviteError }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }, children: [_jsx(Button, { variant: "secondary", type: "button", onClick: () => setShowInvite(false), children: "Cancel" }), _jsx(Button, { type: "submit", loading: inviting, children: "Send invite" })] })] })) })), showCreateChart && (_jsx(Modal, { title: "New Chart", onClose: () => setShowCreateChart(false), children: _jsxs("form", { onSubmit: handleCreateChart, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Title" }), _jsx("input", { value: chartTitle, onChange: e => setChartTitle(e.target.value), autoFocus: true, placeholder: "e.g. Autumn Leaves" })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Composer" }), _jsx("input", { value: chartComposer, onChange: e => setChartComposer(e.target.value), placeholder: "optional" })] }), chartError && _jsx("p", { className: "form-error", children: chartError }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }, children: [_jsx(Button, { variant: "secondary", type: "button", onClick: () => setShowCreateChart(false), children: "Cancel" }), _jsx(Button, { type: "submit", loading: creatingChart, children: "Create" })] })] }) }))] }));
}
