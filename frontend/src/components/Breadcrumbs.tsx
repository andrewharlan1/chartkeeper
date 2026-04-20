import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface Props {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: Props) {
  return (
    <nav style={{ fontSize: 13, color: 'var(--text-muted)' }} aria-label="Breadcrumb">
      {items.map((item, idx) => (
        <span key={idx}>
          {item.to ? (
            <Link to={item.to} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              {item.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{item.label}</span>
          )}
          {idx < items.length - 1 && (
            <span style={{ color: 'var(--text-faint)', margin: '0 6px' }}>/</span>
          )}
        </span>
      ))}
    </nav>
  );
}
