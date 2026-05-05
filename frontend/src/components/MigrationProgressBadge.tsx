import { useState, useEffect, useRef } from 'react';
import { getMigrationStatus, MigrationStatusResponse } from '../api/versions';

interface Props {
  versionId: string;
  onComplete?: () => void;
}

export function MigrationProgressBadge({ versionId, onComplete }: Props) {
  const [status, setStatus] = useState<MigrationStatusResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await getMigrationStatus(versionId);
        if (!active) return;
        setStatus(res);

        if (res.status === 'complete' || res.status === 'failed' || res.status === 'partial' || res.status === 'none') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (res.status === 'complete' && onCompleteRef.current) {
            onCompleteRef.current();
          }
        }
      } catch {
        // Silently fail — badge is non-critical
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 3000);

    return () => {
      active = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [versionId]);

  if (!status || status.status === 'none' || status.status === 'complete') return null;

  const processingCount = status.jobs.filter(j => j.status === 'processing' || j.status === 'pending').length;
  const totalCount = status.jobs.length;

  const label = status.status === 'failed'
    ? 'Migration failed'
    : status.status === 'partial'
      ? 'Migration partial'
      : `Processing: ${totalCount - processingCount}/${totalCount} sources`;

  const bgColor = status.status === 'failed' || status.status === 'partial'
    ? 'var(--danger, #ef4444)'
    : 'var(--accent, #3b82f6)';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bgColor, color: '#fff',
      borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {(status.status === 'pending' || status.status === 'processing') && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'pulse 1.5s infinite' }} />
      )}
      {label}
    </span>
  );
}
