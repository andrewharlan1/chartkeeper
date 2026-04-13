import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlayerParts } from '../api/charts';
import { Layout } from '../components/Layout';
import { PdfViewer } from '../components/PdfViewer';
function groupBy(arr, key) {
    const map = new Map();
    for (const item of arr) {
        const k = key(item);
        if (!map.has(k))
            map.set(k, []);
        map.get(k).push(item);
    }
    return map;
}
export function PlayerView() {
    const [parts, setParts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        getPlayerParts()
            .then(r => setParts(r.parts))
            .catch(() => setError('Could not load your parts.'))
            .finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx(Layout, { title: "My Parts", children: _jsx("p", { style: { color: 'var(--text-muted)' }, children: "Loading\u2026" }) });
    if (error)
        return (_jsx(Layout, { title: "My Parts", children: _jsx("p", { style: { color: 'var(--danger)' }, children: error }) }));
    if (parts.length === 0)
        return (_jsx(Layout, { title: "My Parts", children: _jsxs("div", { style: { textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }, children: [_jsx("p", { style: { marginBottom: 8 }, children: "No parts assigned to you yet." }), _jsx("p", { style: { fontSize: 13 }, children: "Ask your band leader to assign you to a part." })] }) }));
    // Group by ensemble → chart
    const byEnsemble = groupBy(parts, p => p.ensemble_id);
    return (_jsx(Layout, { title: "My Parts", children: _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 32 }, children: [...byEnsemble.entries()].map(([, ensembleParts]) => {
                const { ensemble_name } = ensembleParts[0];
                const byChart = groupBy(ensembleParts, p => p.chart_id);
                return (_jsxs("section", { children: [_jsx("h2", { style: { fontSize: 16, marginBottom: 16, color: 'var(--text-muted)', fontWeight: 500 }, children: ensemble_name }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 20 }, children: [...byChart.entries()].map(([chartId, chartParts]) => {
                                const { chart_title, version_name, version_number, version_id } = chartParts[0];
                                return (_jsxs("div", { style: {
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius)', overflow: 'hidden',
                                    }, children: [_jsxs("div", { style: {
                                                padding: '12px 18px', borderBottom: '1px solid var(--border)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontWeight: 600, fontSize: 15 }, children: chart_title ?? 'Untitled Chart' }), _jsx("span", { style: { marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }, children: version_name ?? `Version ${version_number}` })] }), _jsx(Link, { to: `/charts/${chartId}/versions/${version_id}`, style: { fontSize: 12, color: 'var(--accent)' }, children: "Full version \u2192" })] }), _jsx("div", { style: { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }, children: chartParts.map(p => (_jsxs("div", { children: [_jsx("p", { style: { fontWeight: 500, marginBottom: 10 }, children: p.instrument_name }), p.part_type === 'link' && p.url ? (_jsx("div", { children: _jsx("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--accent)', fontSize: 13 }, children: p.url }) })) : p.part_type === 'audio' && p.pdf_url ? (_jsx("audio", { controls: true, style: { width: '100%' }, src: `/api${p.pdf_url}?token=${localStorage.getItem('token') ?? ''}` })) : p.pdf_url ? (_jsx(PdfViewer, { url: p.pdf_url, title: `${p.instrument_name} — ${version_name}` })) : (_jsx("p", { style: { fontSize: 13, color: 'var(--text-muted)' }, children: "File not available" }))] }, p.assignment_id))) })] }, chartId));
                            }) })] }, ensemble_name));
            }) }) }));
}
