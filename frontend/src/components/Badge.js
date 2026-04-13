import { jsx as _jsx } from "react/jsx-runtime";
const colors = {
    pending: 'var(--pending)',
    processing: 'var(--accent)',
    complete: 'var(--success)',
    failed: 'var(--danger)',
};
const labels = {
    pending: 'Pending',
    processing: 'Processing…',
    complete: 'Complete',
    failed: 'Failed',
};
export function OmrBadge({ status }) {
    return (_jsx("span", { style: {
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.02em',
            background: colors[status] + '22',
            color: colors[status],
            border: `1px solid ${colors[status]}55`,
        }, children: labels[status] }));
}
export function ActiveBadge({ active }) {
    return active ? (_jsx("span", { style: {
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--success)22',
            color: 'var(--success)',
            border: '1px solid var(--success)55',
        }, children: "Active" })) : null;
}
