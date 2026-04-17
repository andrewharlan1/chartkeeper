import { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading = false, children, disabled, ...props }: Props) {
  const isDisabled = disabled || loading;

  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: 'inherit', fontWeight: 500,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.5 : 1,
    borderRadius: 'var(--radius-sm)',
    transition: 'background var(--transition), box-shadow var(--transition), opacity var(--transition)',
    whiteSpace: 'nowrap', flexShrink: 0,
    ...(size === 'sm' ? { padding: '5px 11px', fontSize: 12 } : { padding: '8px 16px', fontSize: 13 }),
  };

  const variantStyle: React.CSSProperties =
    variant === 'primary' ? {
      background: 'var(--accent)', color: '#fff', border: '1px solid transparent',
      boxShadow: '0 1px 4px var(--accent-glow)',
    } :
    variant === 'danger' ? {
      background: 'var(--danger)', color: '#fff', border: '1px solid transparent',
    } :
    variant === 'secondary' ? {
      background: 'var(--surface-raised)', color: 'var(--text)',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-sm)',
    } : {
      background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent',
    };

  return (
    <button {...props} disabled={isDisabled} style={{ ...base, ...variantStyle, ...props.style }}>
      {loading ? '…' : children}
    </button>
  );
}
