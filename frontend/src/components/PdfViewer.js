import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import './PdfViewer.css';
// ── Authenticated PDF fetch → ArrayBuffer ────────────────────────────────────
async function fetchPdfData(url) {
    const token = localStorage.getItem('token');
    // url is like /parts/:id/pdf — prepend /api for the Vite proxy
    const apiUrl = url.startsWith('/parts') ? `/api${url}` : url;
    const res = await fetch(apiUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok)
        throw new Error(`PDF fetch failed: ${res.status}`);
    return res.arrayBuffer();
}
export function PdfThumbnail({ url, onClick }) {
    const [blobUrl, setBlobUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    // Only run once per url — don't restart on parent re-renders from polling
    const loadedUrl = useRef(null);
    const blobUrlRef = useRef(null);
    useEffect(() => {
        if (loadedUrl.current === url)
            return;
        let cancelled = false;
        fetchPdfData(url)
            .then(data => {
            if (cancelled)
                return;
            if (blobUrlRef.current)
                URL.revokeObjectURL(blobUrlRef.current);
            const blob = new Blob([data], { type: 'application/pdf' });
            const objectUrl = URL.createObjectURL(blob);
            blobUrlRef.current = objectUrl;
            loadedUrl.current = url;
            setBlobUrl(objectUrl);
            setLoading(false);
        })
            .catch((err) => {
            console.error('[PdfThumbnail] error:', err);
            if (!cancelled)
                setError(true);
        });
        return () => { cancelled = true; };
    }, [url]);
    // Revoke blob URL on unmount
    useEffect(() => {
        return () => {
            if (blobUrlRef.current)
                URL.revokeObjectURL(blobUrlRef.current);
        };
    }, []);
    if (error)
        return _jsx("div", { className: "pdf-loading", style: { cursor: 'pointer' }, onClick: onClick, children: "Could not load preview \u2014 click to open" });
    if (loading)
        return _jsx("div", { className: "pdf-loading", children: "Loading preview\u2026" });
    return (_jsxs("div", { className: "pdf-thumbnail", onClick: onClick, role: "button", tabIndex: 0, onKeyDown: e => e.key === 'Enter' && onClick(), children: [_jsx("iframe", { src: `${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH`, title: "PDF preview", className: "pdf-thumbnail-iframe", tabIndex: -1 }), _jsx("div", { className: "pdf-thumbnail-overlay", children: _jsx("span", { className: "pdf-thumbnail-label", children: "View full screen" }) })] }));
}
// ── Full viewer ───────────────────────────────────────────────────────────────
export function PdfViewer({ url, title, changeDescriptions }) {
    const [open, setOpen] = useState(false);
    const [blobUrl, setBlobUrl] = useState(null);
    const blobUrlRef = useRef(null);
    const totalChanged = changeDescriptions ? Object.keys(changeDescriptions).length : 0;
    // Load PDF into blob URL when viewer opens
    useEffect(() => {
        if (!open || blobUrl)
            return;
        let cancelled = false;
        fetchPdfData(url).then(data => {
            if (cancelled)
                return;
            if (blobUrlRef.current)
                URL.revokeObjectURL(blobUrlRef.current);
            const blob = new Blob([data], { type: 'application/pdf' });
            const objectUrl = URL.createObjectURL(blob);
            blobUrlRef.current = objectUrl;
            setBlobUrl(objectUrl);
        });
        return () => { cancelled = true; };
    }, [open, url, blobUrl]);
    // Revoke blob URL on unmount
    useEffect(() => {
        return () => {
            if (blobUrlRef.current)
                URL.revokeObjectURL(blobUrlRef.current);
        };
    }, []);
    // Close on Escape
    useEffect(() => {
        if (!open)
            return;
        function handler(e) { if (e.key === 'Escape')
            setOpen(false); }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);
    return (_jsxs(_Fragment, { children: [_jsx(PdfThumbnail, { url: url, onClick: () => setOpen(true) }), open && (_jsxs("div", { className: "pdf-viewer-backdrop", onClick: () => setOpen(false), children: [_jsxs("div", { className: "pdf-viewer-toolbar", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "pdf-viewer-toolbar-left", children: [_jsx("span", { className: "pdf-viewer-title", children: title ?? 'Part' }), totalChanged > 0 && (_jsxs("div", { className: "pdf-diff-legend", children: [_jsx("div", { className: "pdf-diff-legend-dot" }), totalChanged, " changed measure", totalChanged !== 1 ? 's' : ''] }))] }), _jsx("div", { className: "pdf-viewer-toolbar-right", children: _jsx(Button, { variant: "secondary", size: "sm", onClick: () => setOpen(false), children: "\u2715 Close" }) })] }), _jsx("div", { className: "pdf-viewer-iframe-wrap", onClick: e => e.stopPropagation(), children: blobUrl
                            ? _jsx("iframe", { src: blobUrl, title: title ?? 'Part', className: "pdf-viewer-iframe" })
                            : _jsx("div", { style: { color: 'var(--text-muted)', padding: 40 }, children: "Loading\u2026" }) })] }))] }));
}
