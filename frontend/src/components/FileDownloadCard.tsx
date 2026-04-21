interface Props {
  fileUrl: string;
  name: string;
}

export function FileDownloadCard({ fileUrl, name }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '16px 20px',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3L7 25L21 25L21 9L15 3Z"/>
          <path d="M15 3L15 9L21 9"/>
          <line x1="10" y1="14" x2="18" y2="14"/>
          <line x1="10" y1="17.5" x2="18" y2="17.5"/>
          <line x1="10" y1="21" x2="15" y2="21"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14 }}>{name}</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>File attachment</p>
      </div>
      <a
        href={fileUrl}
        download
        style={{
          padding: '6px 14px', fontSize: 13, fontWeight: 500,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', color: 'var(--text)',
          textDecoration: 'none', cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
      >
        Download
      </a>
    </div>
  );
}
