import { OmrStatus } from '../types';

const colors: Record<OmrStatus, string> = {
  pending: 'var(--pending)',
  processing: 'var(--accent)',
  complete: 'var(--success)',
  failed: 'var(--danger)',
};

const labels: Record<OmrStatus, string> = {
  pending: 'Pending',
  processing: 'Processing…',
  complete: 'Complete',
  failed: 'Failed',
};

export function OmrBadge({ status }: { status: OmrStatus }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.02em',
      background: colors[status] + '22',
      color: colors[status],
      border: `1px solid ${colors[status]}55`,
    }}>
      {labels[status]}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: 'var(--success)22',
      color: 'var(--success)',
      border: '1px solid var(--success)55',
    }}>
      Active
    </span>
  ) : null;
}
