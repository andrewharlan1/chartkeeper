import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
export function Modal({ title, onClose, children }) {
    useEffect(() => {
        function handler(e) {
            if (e.key === 'Escape')
                onClose();
        }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);
    return (_jsx("div", { onClick: onClose, style: {
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100,
        }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: {
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 24,
                minWidth: 400,
                maxWidth: 560,
                width: '100%',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }, children: [_jsx("h2", { children: title }), _jsx("button", { onClick: onClose, style: { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }, children: "\u00D7" })] }), children] }) }));
}
