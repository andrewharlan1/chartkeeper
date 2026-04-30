import { ReactNode, useEffect, useRef, useState } from 'react';

interface PanelSectionProps {
  title: string;
  count?: string | number;
  actionLabel?: string;
  onAction?: () => void;
  actionGated?: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function PanelSection({
  title, count, actionLabel, onAction, actionGated, children, defaultOpen = true,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '12px 16px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', transition: 'transform 0.15s', transform: open ? 'rotate(0)' : 'rotate(-90deg)' }}>
            {'\u25BE'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
          {count !== undefined && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{count}</span>
          )}
        </div>
        {actionLabel && !actionGated && (
          <span
            onClick={e => { e.stopPropagation(); onAction?.(); }}
            style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, cursor: 'pointer' }}
          >
            {actionLabel}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function SidePanel({ open, onClose, title, children }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: 'rgba(14,26,43,0.18)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, maxWidth: '100vw',
          background: 'var(--bg)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          animation: 'slideInRight 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 17, color: 'var(--text)' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1,
            }}
          >
            {'\u00D7'}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
