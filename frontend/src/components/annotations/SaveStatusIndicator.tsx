import { useEffect, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
}

export function SaveStatusIndicator({ status }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === 'idle') {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (status === 'saved') {
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (!visible) return null;

  const label =
    status === 'saving' ? 'Saving...' :
    status === 'saved' ? 'Saved \u2713' :
    status === 'error' ? 'Save failed' : '';

  const color =
    status === 'saving' ? 'var(--text-muted)' :
    status === 'saved' ? '#16A34A' :
    status === 'error' ? 'var(--danger)' : 'var(--text-muted)';

  return (
    <span style={{
      fontSize: 12,
      fontWeight: 500,
      color,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.3s',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
