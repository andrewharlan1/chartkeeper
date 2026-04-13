import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getVersion, deletePart, getAssignments, assignPart, unassignPart, getChart } from '../api/charts';
import { getMembers } from '../api/ensembles';
import { Layout } from '../components/Layout';
import { OmrBadge, ActiveBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { PdfViewer } from '../components/PdfViewer';
import { ApiError } from '../api/client';
// ── Diff panel ────────────────────────────────────────────────────────────────
function DiffPanel({ diff, instrument }) {
    const [open, setOpen] = useState(true);
    const { changedMeasures, changeDescriptions, structuralChanges } = diff;
    const totalChanges = changedMeasures.length +
        structuralChanges.insertedMeasures.length +
        structuralChanges.deletedMeasures.length;
    if (totalChanges === 0 && structuralChanges.sectionLabelChanges.length === 0) {
        return (_jsx("div", { style: { marginTop: 10, fontSize: 13, color: 'var(--success)' }, children: "No changes from previous version" }));
    }
    return (_jsxs("div", { style: { marginTop: 10 }, children: [_jsxs("button", { onClick: () => setOpen(o => !o), style: {
                    background: 'none', border: 'none', color: 'var(--accent)',
                    cursor: 'pointer', fontSize: 13, padding: 0,
                    display: 'flex', alignItems: 'center', gap: 4,
                }, children: [open ? '▾' : '▸', totalChanges, " change", totalChanges !== 1 ? 's' : '', " in ", instrument, " part"] }), open && (_jsxs("div", { style: { marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--border)' }, children: [structuralChanges.insertedMeasures.length > 0 && (_jsxs("p", { style: { fontSize: 13, color: 'var(--warning)', marginBottom: 4 }, children: ["+ ", structuralChanges.insertedMeasures.length, " measure", structuralChanges.insertedMeasures.length !== 1 ? 's' : '', " inserted (m.", structuralChanges.insertedMeasures.join(', m.'), ")"] })), structuralChanges.deletedMeasures.length > 0 && (_jsxs("p", { style: { fontSize: 13, color: 'var(--danger)', marginBottom: 4 }, children: ["\u2212 ", structuralChanges.deletedMeasures.length, " measure", structuralChanges.deletedMeasures.length !== 1 ? 's' : '', " deleted"] })), structuralChanges.sectionLabelChanges.map((s, i) => (_jsx("p", { style: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }, children: s }, i))), changedMeasures.map(m => (_jsx("p", { style: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }, children: changeDescriptions[m] ?? `m.${m}: changed` }, m)))] }))] }));
}
// ── Link viewer ───────────────────────────────────────────────────────────────
function LinkViewer({ url, name }) {
    const [embedMode, setEmbedMode] = useState(false);
    return (_jsxs("div", { style: { marginTop: 8 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: embedMode ? 10 : 0 }, children: [_jsx("a", { href: url, target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--accent)', fontSize: 13, wordBreak: 'break-all' }, children: url }), _jsx("button", { onClick: () => setEmbedMode(m => !m), style: { background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '3px 8px', whiteSpace: 'nowrap' }, children: embedMode ? 'Hide preview' : 'Preview in app' })] }), embedMode && (_jsx("div", { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', height: 500 }, children: _jsx("iframe", { src: url, title: name, style: { width: '100%', height: '100%', border: 'none', display: 'block' }, sandbox: "allow-scripts allow-same-origin allow-forms allow-popups" }) }))] }));
}
// ── Audio player ──────────────────────────────────────────────────────────────
function AudioPlayer({ pdfUrl }) {
    // pdfUrl points to the same backend proxy — just uses it as audio src with auth
    const [blobUrl, setBlobUrl] = useState(null);
    useEffect(() => {
        const token = localStorage.getItem('token');
        const apiUrl = pdfUrl.startsWith('/parts') ? `/api${pdfUrl}` : pdfUrl;
        fetch(apiUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
            .then(r => r.blob())
            .then(blob => setBlobUrl(URL.createObjectURL(blob)))
            .catch(() => { });
        return () => { if (blobUrl)
            URL.revokeObjectURL(blobUrl); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdfUrl]);
    if (!blobUrl)
        return _jsx("div", { style: { color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }, children: "Loading audio\u2026" });
    return (_jsx("audio", { controls: true, src: blobUrl, style: { marginTop: 8, width: '100%' } }));
}
function AssignmentsPanel({ chartId, ensembleId, instrumentName, assignments, onAssign, onUnassign, canEdit }) {
    const [members, setMembers] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [assigning, setAssigning] = useState(false);
    const myAssignments = assignments.filter(a => a.instrument_name === instrumentName);
    useEffect(() => {
        if (!canEdit)
            return;
        getMembers(ensembleId).then(r => setMembers(r.members)).catch(() => { });
    }, [ensembleId, canEdit]);
    async function handleAssign() {
        if (!selectedUserId)
            return;
        setAssigning(true);
        try {
            const { assignment } = await assignPart(chartId, instrumentName, selectedUserId);
            onAssign(assignment);
            setSelectedUserId('');
        }
        finally {
            setAssigning(false);
        }
    }
    const assignedIds = new Set(myAssignments.map(a => a.user_id));
    const unassigned = members.filter(m => !assignedIds.has(m.id));
    return (_jsxs("div", { style: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }, children: [_jsx("p", { style: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }, children: "Assigned players" }), myAssignments.length === 0 ? (_jsx("p", { style: { fontSize: 13, color: 'var(--text-muted)' }, children: "No one assigned" })) : (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, children: myAssignments.map(a => (_jsxs("span", { style: {
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 99, padding: '3px 10px', fontSize: 13,
                    }, children: [a.user_name, canEdit && (_jsx("button", { onClick: () => onUnassign(a.id), style: {
                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
                            }, children: "\u00D7" }))] }, a.id))) })), canEdit && unassigned.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsxs("select", { value: selectedUserId, onChange: e => setSelectedUserId(e.target.value), style: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
                            padding: '5px 8px', color: selectedUserId ? 'var(--text)' : 'var(--text-muted)', fontSize: 13 }, children: [_jsx("option", { value: "", children: "Assign to\u2026" }), unassigned.map(m => (_jsxs("option", { value: m.id, children: [m.name, " (", m.role, ")"] }, m.id)))] }), _jsx(Button, { variant: "secondary", size: "sm", disabled: !selectedUserId, loading: assigning, onClick: handleAssign, children: "Assign" })] }))] }));
}
// ── Main page ─────────────────────────────────────────────────────────────────
export function VersionDetail() {
    const { id: chartId, vId } = useParams();
    const { user } = useAuth();
    const [version, setVersion] = useState(null);
    const [parts, setParts] = useState([]);
    const [diff, setDiff] = useState(null);
    const [ensembleId, setEnsembleId] = useState(null);
    const [myRole, setMyRole] = useState(null);
    const [assignments, setAssignments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deletingPart, setDeletingPart] = useState(null);
    const [deletePartError, setDeletePartError] = useState('');
    const load = useCallback(async () => {
        if (!chartId || !vId)
            return;
        const res = await getVersion(chartId, vId);
        setVersion(res.version);
        setParts(res.parts);
        setDiff(res.diff);
    }, [chartId, vId]);
    useEffect(() => {
        load().finally(() => setLoading(false));
    }, [load]);
    // Load ensemble context + assignments
    useEffect(() => {
        if (!chartId)
            return;
        getChart(chartId).then(({ chart }) => {
            setEnsembleId(chart.ensemble_id);
            return Promise.all([
                getMembers(chart.ensemble_id).then(r => {
                    const member = r.members.find(m => m.id === user?.id);
                    if (member)
                        setMyRole(member.role);
                }).catch(() => { }),
                getAssignments(chartId).then(r => setAssignments(r.assignments)).catch(() => { }),
            ]);
        }).catch(() => { });
    }, [chartId]);
    async function handleDeletePart(partId, instrumentName) {
        if (!confirm(`Delete "${instrumentName}"? This cannot be undone.`))
            return;
        setDeletingPart(partId);
        setDeletePartError('');
        try {
            await deletePart(partId);
            setParts(prev => prev.filter(p => p.id !== partId));
        }
        catch (err) {
            setDeletePartError(err instanceof ApiError ? err.message : 'Failed to delete part');
        }
        finally {
            setDeletingPart(null);
        }
    }
    // Poll while OMR is in progress
    useEffect(() => {
        const inProgress = parts.some(p => p.omr_status === 'pending' || p.omr_status === 'processing');
        if (!inProgress)
            return;
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [parts, load]);
    if (loading)
        return _jsx(Layout, { children: _jsx("p", { style: { color: 'var(--text-muted)' }, children: "Loading\u2026" }) });
    if (!version)
        return null;
    const diffParts = diff?.diff_json?.parts ?? {};
    const omrAllDone = parts.every(p => p.omr_status === 'complete' || p.omr_status === 'failed');
    const canEdit = myRole === 'owner' || myRole === 'editor';
    return (_jsxs(Layout, { title: version.version_name, back: { label: 'Chart', to: `/charts/${chartId}` }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: -20, marginBottom: 28 }, children: [_jsx(ActiveBadge, { active: version.is_active }), version.created_by_name && (_jsxs("span", { style: { color: 'var(--text-muted)', fontSize: 13 }, children: ["Pushed by ", version.created_by_name, " \u00B7 ", new Date(version.created_at).toLocaleDateString()] }))] }), _jsxs("section", { children: [_jsx("h2", { style: { marginBottom: 16 }, children: "Files" }), deletePartError && _jsx("p", { className: "form-error", style: { marginBottom: 16 }, children: deletePartError }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 16 }, children: parts.map(p => {
                            const partDiff = diffParts[p.instrument_name] ?? null;
                            return (_jsxs("div", { style: {
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius)', padding: '16px 18px',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontWeight: 600, fontSize: 15 }, children: p.instrument_name }), p.part_type === 'score' && (_jsx("span", { style: { fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.15)',
                                                            border: '1px solid rgba(99,102,241,0.4)', borderRadius: 99, color: 'var(--accent)' }, children: "Score" })), p.part_type === 'audio' && (_jsx("span", { style: { fontSize: 11, padding: '2px 7px', background: 'rgba(34,197,94,0.12)',
                                                            border: '1px solid rgba(34,197,94,0.4)', borderRadius: 99, color: '#22c55e' }, children: "Audio" })), p.part_type === 'chart' && (_jsx("span", { style: { fontSize: 11, padding: '2px 7px', background: 'rgba(251,191,36,0.12)',
                                                            border: '1px solid rgba(251,191,36,0.4)', borderRadius: 99, color: '#f59e0b' }, children: "Chord chart" })), p.part_type === 'link' && (_jsx("span", { style: { fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.08)',
                                                            border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }, children: "Link" })), p.part_type === 'other' && (_jsx("span", { style: { fontSize: 11, padding: '2px 7px', background: 'var(--surface)',
                                                            border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }, children: "Other" })), p.part_type !== 'link' && p.part_type !== 'audio' && (_jsx(OmrBadge, { status: p.omr_status })), p.inherited_from_part_id && (_jsxs("span", { style: { fontSize: 11, padding: '2px 7px', background: 'var(--surface)',
                                                            border: '1px solid var(--border)', borderRadius: 99, color: 'var(--text-muted)' }, children: ["carried from ", p.inherited_from_version_name ?? `v${p.inherited_from_version_number}`] }))] }), canEdit && (_jsx(Button, { variant: "ghost", size: "sm", loading: deletingPart === p.id, onClick: () => handleDeletePart(p.id, p.instrument_name), style: { color: 'var(--danger)' }, children: "Delete" }))] }), p.part_type === 'link' && p.url ? (_jsx(LinkViewer, { url: p.url, name: p.instrument_name })) : p.part_type === 'audio' && p.pdfUrl ? (_jsx(AudioPlayer, { pdfUrl: p.pdfUrl })) : p.pdfUrl ? (_jsx(PdfViewer, { url: p.pdfUrl, title: `${p.instrument_name} — ${version.version_name}`, changedMeasureBounds: partDiff?.changedMeasureBounds, changeDescriptions: partDiff?.changeDescriptions })) : (_jsx("div", { style: { background: 'var(--bg)', border: '1px solid var(--border)',
                                            borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center',
                                            color: 'var(--text-muted)', fontSize: 13 }, children: "File not available" })), ['score', 'part', 'chart', 'other'].includes(p.part_type) && (partDiff ? (_jsx(DiffPanel, { diff: partDiff, instrument: p.instrument_name })) : omrAllDone && !diff ? (_jsx("p", { style: { marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }, children: "No diff available (first version or OMR unavailable)" })) : null), ensembleId && (_jsx(AssignmentsPanel, { chartId: chartId, ensembleId: ensembleId, instrumentName: p.instrument_name, assignments: assignments, onAssign: a => setAssignments(prev => [...prev, a]), onUnassign: async (id) => {
                                            await unassignPart(chartId, id).catch(() => { });
                                            setAssignments(prev => prev.filter(a => a.id !== id));
                                        }, canEdit: canEdit }))] }, p.id));
                        }) })] })] }));
}
