import { ReactNode } from 'react';
import { usePermission, Action } from '../hooks/usePermission';

interface Props {
  action: Action;
  ensembleId?: string;
  children: ReactNode;
  /** What to render when permission is denied. Default: nothing. */
  fallback?: ReactNode;
}

export function PermissionGate({ action, ensembleId, children, fallback = null }: Props) {
  const allowed = usePermission(action, ensembleId);
  return <>{allowed ? children : fallback}</>;
}
