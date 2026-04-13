import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { uploadVersion, getVersions } from '../api/charts';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';
// ── Types ─────────────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
    { value: 'part', label: 'Part' },
    { value: 'score', label: 'Score' },
    { value: 'audio', label: 'Audio' },
    { value: 'chart', label: 'Chord chart' },
    { value: 'link', label: 'Link' },
    { value: 'other', label: 'Other' },
];
const TYPE_LABELS = {
    score: 'Score', part: 'Part', audio: 'Audio',
    chart: 'Chord chart', link: 'Link', other: 'Other',
};
// ── Helpers ───────────────────────────────────────────────────────────────────
function humanizeName(filename) {
    return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ').trim();
}
function guessType(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('score') || lower.includes('full score'))
        return 'score';
    if (lower.includes('chord') || lower.includes('lead sheet'))
        return 'chart';
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(lower))
        return 'audio';
    return 'part';
}
// ── Component ─────────────────────────────────────────────────────────────────
export function UploadVersion() {
    const { id: chartId } = useParams();
    const navigate = useNavigate();
    const [entries, setEntries] = useState([]);
    const [versionName, setVersionName] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [activeParts, setActiveParts] = useState([]);
    // Carry-forward checklist: set of instrumentNames to inherit
    const [inheritChecked, setInheritChecked] = useState(new Set());
    useEffect(() => {
        if (!chartId)
            return;
        getVersions(chartId).then(res => {
            const active = res.versions.find(v => v.is_active);
            if (active) {
                setActiveParts(active.parts);
                setInheritChecked(new Set(active.parts.map(p => p.instrumentName)));
            }
        }).catch(() => { });
    }, [chartId]);
    function addFiles(fileList) {
        const added = [];
        for (const file of Array.from(fileList)) {
            added.push({
                id: crypto.randomUUID(),
                file,
                name: humanizeName(file.name),
                type: guessType(file.name),
            });
        }
        setEntries(prev => [...prev, ...added]);
    }
    function addLink() {
        setEntries(prev => [...prev, { id: crypto.randomUUID(), name: '', type: 'link', url: '' }]);
    }
    function updateEntry(id, patch) {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }
    function removeEntry(id) {
        setEntries(prev => prev.filter(e => e.id !== id));
    }
    function handleDrop(e) {
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
    }
    function handleFileInput(e) {
        if (e.target.files)
            addFiles(e.target.files);
        e.target.value = '';
    }
    function toggleInherit(name) {
        setInheritChecked(prev => {
            const next = new Set(prev);
            if (next.has(name))
                next.delete(name);
            else
                next.add(name);
            return next;
        });
    }
    async function handleSubmit(e) {
        e.preventDefault();
        if (!chartId || (entries.length === 0 && inheritChecked.size === 0))
            return;
        const names = entries.map(e => e.name.trim());
        if (names.some(n => !n)) {
            setError('All files must have a name.');
            return;
        }
        if (new Set(names).size !== names.length) {
            setError('Each file must have a unique name.');
            return;
        }
        // Validate link entries have a URL
        const badLink = entries.find(e => e.type === 'link' && !e.url?.trim());
        if (badLink) {
            setError(`"${badLink.name || 'Unnamed link'}" is missing a URL.`);
            return;
        }
        setError('');
        setUploading(true);
        try {
            const uploadedNames = new Set(entries.map(e => e.name.trim()));
            const inheritedNames = [...inheritChecked].filter(n => !uploadedNames.has(n));
            await uploadVersion(chartId, entries, versionName.trim() || undefined, inheritedNames);
            navigate(`/charts/${chartId}`);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Upload failed');
        }
        finally {
            setUploading(false);
        }
    }
    const uploadedNames = new Set(entries.map(e => e.name.trim()));
    // Parts from active version that are candidates for carry-forward
    const carryForwardCandidates = activeParts.filter(p => !uploadedNames.has(p.instrumentName));
    const inheritedCount = carryForwardCandidates.filter(p => inheritChecked.has(p.instrumentName)).length;
    const canSubmit = entries.length > 0 || inheritedCount > 0;
    return (_jsx(Layout, { title: "Upload New Version", back: { label: 'Chart', to: `/charts/${chartId}` }, children: _jsxs("form", { onSubmit: handleSubmit, style: { maxWidth: 620 }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { children: "Version name (optional)" }), _jsx("input", { value: versionName, onChange: e => setVersionName(e.target.value), placeholder: 'e.g. "v2 \u2013 2025-04-13" or "Post-recording edits" \u2014 auto-named if blank' }), _jsx("p", { style: { fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }, children: "Tip: include a date or version number so you can find it later." })] }), _jsxs("div", { onDrop: handleDrop, onDragOver: e => { e.preventDefault(); setDragOver(true); }, onDragLeave: () => setDragOver(false), onClick: () => document.getElementById('file-input')?.click(), style: {
                        border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        padding: '28px 24px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: dragOver ? 'rgba(99,102,241,0.06)' : 'var(--surface)',
                        transition: 'border-color 0.15s, background 0.15s',
                        marginBottom: 12,
                    }, children: [_jsx("p", { style: { color: 'var(--text-muted)', marginBottom: 4 }, children: "Drop any PDF or audio files here, or click to browse" }), _jsx("p", { style: { color: 'var(--text-muted)', fontSize: 12 }, children: "Batch-select as many files as you like \u2014 name and classify each after adding" }), _jsx("input", { id: "file-input", type: "file", multiple: true, accept: ".pdf,.mp3,.wav,.m4a,.aac,.ogg,.flac,application/pdf,audio/*", onChange: handleFileInput, style: { display: 'none' } })] }), _jsx("div", { style: { marginBottom: entries.length > 0 ? 16 : 24, textAlign: 'right' }, children: _jsx("button", { type: "button", onClick: addLink, style: {
                            background: 'none', border: 'none', color: 'var(--accent)',
                            cursor: 'pointer', fontSize: 13, padding: 0,
                        }, children: "+ Add a link (e.g. Ultimate Guitar, YouTube)" }) }), entries.length > 0 && (_jsx("div", { style: { marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }, children: entries.map(entry => (_jsxs("div", { style: {
                            padding: '10px 12px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                        }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 8, alignItems: 'center' }, children: [_jsx("input", { value: entry.name, onChange: e => updateEntry(entry.id, { name: e.target.value }), placeholder: entry.type === 'link' ? 'Name this link…' : 'Name this file…', style: {
                                            width: '100%', background: 'var(--bg)',
                                            border: '1px solid var(--border)', borderRadius: 4,
                                            padding: '5px 8px', color: 'var(--text)', fontSize: 14,
                                            boxSizing: 'border-box',
                                        } }), _jsx("select", { value: entry.type, onChange: e => updateEntry(entry.id, { type: e.target.value }), style: {
                                            background: 'var(--bg)', border: '1px solid var(--border)',
                                            borderRadius: 4, padding: '6px 8px', color: 'var(--text)', fontSize: 13, height: 32,
                                        }, children: TYPE_OPTIONS.map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) }), _jsx("button", { type: "button", onClick: () => removeEntry(entry.id), style: {
                                            background: 'none', border: 'none', color: 'var(--text-muted)',
                                            cursor: 'pointer', fontSize: 18, padding: '2px 6px', lineHeight: 1,
                                        }, children: "\u00D7" })] }), entry.type === 'link' && (_jsx("input", { value: entry.url ?? '', onChange: e => updateEntry(entry.id, { url: e.target.value }), placeholder: "https://\u2026", style: {
                                    marginTop: 8, width: '100%', background: 'var(--bg)',
                                    border: '1px solid var(--border)', borderRadius: 4,
                                    padding: '5px 8px', color: 'var(--text)', fontSize: 13,
                                    boxSizing: 'border-box',
                                } })), entry.file && (_jsxs("p", { style: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }, children: [entry.file.name, " \u00B7 ", (entry.file.size / 1024).toFixed(0), " KB"] }))] }, entry.id))) })), carryForwardCandidates.length > 0 && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("p", { style: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }, children: "Carry forward from current version (uncheck to drop):" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: carryForwardCandidates.map(p => (_jsxs("label", { style: {
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px', background: 'var(--bg)',
                                    border: `1px ${inheritChecked.has(p.instrumentName) ? 'dashed' : 'solid'} var(--border)`,
                                    borderRadius: 'var(--radius)', cursor: 'pointer',
                                    opacity: inheritChecked.has(p.instrumentName) ? 1 : 0.5,
                                    userSelect: 'none',
                                }, children: [_jsx("input", { type: "checkbox", checked: inheritChecked.has(p.instrumentName), onChange: () => toggleInherit(p.instrumentName), style: { width: 15, height: 15, accentColor: 'var(--accent)', flexShrink: 0 } }), _jsx("span", { style: { fontSize: 13, flex: 1 }, children: p.instrumentName }), p.partType !== 'part' && (_jsx("span", { style: { fontSize: 11, color: 'var(--text-muted)' }, children: TYPE_LABELS[p.partType] }))] }, p.id))) }), carryForwardCandidates.length > 1 && (_jsxs("div", { style: { marginTop: 8, display: 'flex', gap: 12 }, children: [_jsx("button", { type: "button", onClick: () => setInheritChecked(new Set(carryForwardCandidates.map(p => p.instrumentName))), style: { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0 }, children: "Select all" }), _jsx("button", { type: "button", onClick: () => setInheritChecked(new Set()), style: { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }, children: "Deselect all" })] }))] })), error && _jsx("p", { className: "form-error", style: { marginBottom: 16 }, children: error }), _jsx(Button, { type: "submit", disabled: !canSubmit, loading: uploading, children: uploading ? 'Uploading…' : (entries.length === 0 && inheritedCount === 0
                        ? 'Add files or links above'
                        : [
                            entries.length > 0 && `Upload ${entries.length} file${entries.length !== 1 ? 's' : ''}`,
                            inheritedCount > 0 && `${inheritedCount} carried forward`,
                        ].filter(Boolean).join(' · ')) })] }) }));
}
