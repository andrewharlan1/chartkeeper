interface Props {
  url: string;
  title: string;
}

export function LinkCard({ url, title }: Props) {
  let domain = '';
  try { domain = new URL(url).hostname; } catch { domain = url; }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 20px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        textDecoration: 'none',
        color: 'var(--text)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px var(--accent-glow)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 8,
        background: 'var(--accent-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12L12 8"/>
          <path d="M6 14C4.5 15.5 4.5 18 6.5 18.5C8.5 19 9.5 17.5 11 16L9.5 14.5C8 16 7.5 16.5 6.8 16C6 15.5 6.5 14.8 7.2 14"/>
          <path d="M14 6C15.5 4.5 15.5 2 13.5 1.5C11.5 1 10.5 2.5 9 4L10.5 5.5C12 4 12.5 3.5 13.2 4C14 4.5 13.5 5.2 12.8 6"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{title}</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {domain}
        </p>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3H13V10"/>
        <path d="M13 3L5 11"/>
      </svg>
    </a>
  );
}
