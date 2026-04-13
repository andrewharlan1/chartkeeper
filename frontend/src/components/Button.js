import { jsx as _jsx } from "react/jsx-runtime";
const styles = {
    base: 'btn',
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    danger: 'btn-danger',
    ghost: 'btn-ghost',
    sm: 'btn-sm',
    md: 'btn-md',
};
export function Button({ variant = 'primary', size = 'md', loading = false, children, disabled, ...props }) {
    return (_jsx("button", { ...props, disabled: disabled || loading, className: [styles.base, styles[variant], styles[size], props.className].filter(Boolean).join(' '), style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: size === 'sm' ? '5px 10px' : '8px 16px',
            fontSize: size === 'sm' ? 12 : 14,
            fontWeight: 500,
            borderRadius: 'var(--radius)',
            border: variant === 'secondary' ? '1px solid var(--border)' : 'none',
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
            opacity: disabled || loading ? 0.6 : 1,
            background: variant === 'primary' ? 'var(--accent)' :
                variant === 'danger' ? 'var(--danger)' :
                    variant === 'secondary' ? 'var(--surface)' :
                        'transparent',
            color: variant === 'ghost' ? 'var(--text-muted)' : 'var(--text)',
            transition: 'opacity 0.15s, background 0.15s',
            ...props.style,
        }, children: loading ? '…' : children }));
}
