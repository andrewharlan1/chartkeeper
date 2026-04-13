import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChart, getVersions, restoreVersion, deleteVersion } from '../api/charts';
import { getMembers } from '../api/ensembles';
import { useAuth } from '../hooks/useAuth';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { ApiError } from '../api/client';
function hasInProgressOmr(versions) {
    return versions.some(v => v.parts.some(p => p.omrStatus === 'pending' || p.omrStatus === 'processing'));
}
export function ChartPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const [chart, setChart] = useState(null);
    const [versions, setVersions] = useState([]);
    const [ensembleId, setEnsembleId] = useState('');
    const [myRole, setMyRole] = useState(null);
    const [loading, setLoading] = useState(true);
    const [restoring, setRestoring] = useState(null);
    const [restoreError, setRestoreError] = useState('');
    const [deletingVersion, setDeletingVersion] = useState(null);
    const loadVersions = useCallback(async () => {
        if (!id)
            return;
        const res = await getVersions(id);
        setVersions(res.versions);
        return res.versions;
    }, [id]);
    useEffect(() => {
        if (!id)
            return;
        Promise.all([getChart(id), loadVersions()]).then(async ([chartRes]) => {
            setChart(chartRes.chart);
            const eid = chartRes.chart.ensemble_id;
            setEnsembleId(eid);
            const membersRes = await getMembers(eid).catch(() => ({ members: [] }));
            const me = membersRes.members.find(m => m.id === user?.id);
            setMyRole(me?.role ?? null);
        }).finally(() => setLoading(false));
    }, [id, loadVersions]);
    // Poll while any OMR jobs are in progress
    useEffect(() => {
        if (!hasInProgressOmr(versions))
            return;
        const timer = setInterval(() => { loadVersions(); }, 5000);
        return () => clearInterval(timer);
    }, [versions, loadVersions]);
    async function handleRestore(versionId) {
        if (!id)
            return;
        if (!confirm('Restore this version as active? Players will be notified.'))
            return;
        setRestoring(versionId);
        setRestoreError('');
        try {
            await restoreVersion(id, versionId);
            await loadVersions();
        }
        catch (err) {
            setRestoreError(err instanceof ApiError ? err.message : 'Failed to restore');
        }
        finally {
            setRestoring(null);
        }
    }
    async function handleDeleteVersion(versionId, versionName) {
        if (!id)
            return;
        if (!confirm(`Delete "${versionName}"? This cannot be undone.`))
            return;
        setDeletingVersion(versionId);
        try {
            await deleteVersion(id, versionId);
            await loadVersions();
        }
        catch (err) {
            setRestoreError(err instanceof ApiError ? err.message : 'Failed to delete version');
        }
        finally {
            setDeletingVersion(null);
        }
    }
    if (loading)
        return _jsx(Layout, { children: _jsx("p", { style: { color: 'var(--text-muted)' }, children: "Loading\u2026" }) });
    if (!chart)
        return null;
    return (_jsxs(Layout, { title: chart.title ?? 'Untitled', back: { label: 'Ensemble', to: `/ensembles/${ensembleId}` }, actions: _jsx(Link, { to: `/charts/${id}/upload`, children: _jsx(Button, { size: "sm", children: "+ Upload new version" }) }), children: [chart.composer && _jsxs("p", { style: { color: 'var(--text-muted)', marginTop: -20, marginBottom: 24 }, children: ["by ", chart.composer] }), restoreError && _jsx("p", { className: "form-error", style: { marginBottom: 16 }, children: restoreError }), versions.length === 0 ? (_jsxs("div", { style: { textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }, children: [_jsx("p", { style: { marginBottom: 16 }, children: "No versions yet." }), _jsx(Link, { to: `/charts/${id}/upload`, children: _jsx(Button, { children: "Upload first version" }) })] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: versions.map(v => (_jsxs("div", { style: {
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: '16px 20px',
                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx(Link, { to: `/charts/${id}/versions/${v.id}`, style: { fontWeight: 600, fontSize: 15 }, children: v.version_name }), _jsx(ActiveBadge, { active: v.is_active })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsxs("span", { style: { color: 'var(--text-muted)', fontSize: 12 }, children: [new Date(v.created_at).toLocaleDateString(), v.created_by_name && ` · ${v.created_by_name}`] }), !v.is_active && (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", size: "sm", loading: restoring === v.id, onClick: () => handleRestore(v.id), children: "Restore" }), myRole === 'owner' && (_jsx(Button, { variant: "ghost", size: "sm", loading: deletingVersion === v.id, onClick: () => handleDeleteVersion(v.id, v.version_name), style: { color: 'var(--danger)' }, children: "Delete" }))] }))] })] }), _jsx("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: v.parts.map(p => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [_jsx("span", { style: { fontSize: 13, color: 'var(--text-muted)', textTransform: 'capitalize' }, children: p.instrumentName.replace(/_/g, ' ') }), _jsx(OmrBadge, { status: p.omrStatus })] }, p.id))) })] }, v.id))) }))] }));
}
