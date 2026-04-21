interface Props {
  src: string;
  title: string;
  duration?: number | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src, title, duration }: Props) {
  return (
    <div style={{
      padding: '16px 20px',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--accent-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 28 28" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 11L6 17L10 17L15 21L15 7L10 11Z"/>
            <path d="M18 10.5C19.5 12 19.5 16 18 17.5"/>
            <path d="M20.5 8C23 11 23 17 20.5 20"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 14 }}>{title}</p>
          {duration != null && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDuration(duration)}</p>
          )}
        </div>
      </div>
      <audio
        controls
        preload="metadata"
        src={src}
        style={{ width: '100%', outline: 'none' }}
      />
    </div>
  );
}
