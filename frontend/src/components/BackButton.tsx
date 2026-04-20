import { useNavigate } from 'react-router-dom';

interface Props {
  to?: string;
  label?: string;
}

export function BackButton({ to, label }: Props) {
  const navigate = useNavigate();
  const handleClick = () => {
    if (to) navigate(to);
    else navigate(-1);
  };
  return (
    <button
      onClick={handleClick}
      aria-label="Go back"
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 0',
        cursor: 'pointer',
        color: 'var(--text-muted)',
        fontSize: 14,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 0,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
      {label && <span style={{ fontSize: 14 }}>{label}</span>}
    </button>
  );
}
