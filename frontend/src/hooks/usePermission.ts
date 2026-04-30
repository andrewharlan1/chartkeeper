import { useAuth } from './useAuth';

export type Action =
  | 'ensemble.edit'
  | 'ensemble.member.invite'
  | 'instrument.add'
  | 'instrument.reassign'
  | 'chart.create' | 'chart.edit' | 'chart.delete'
  | 'event.create' | 'event.edit' | 'event.delete'
  | 'event.charts.add' | 'event.charts.reorder'
  | 'version.push' | 'version.delete';

export function usePermission(_action: Action, _ensembleId?: string): boolean {
  const { user, role } = useAuth();
  if (!user) return false;
  // v1: workspace owner/admin can do everything writeable; member/viewer reads only.
  // _ensembleId param reserved for per-ensemble role refinement (deferred).
  return role === 'owner' || role === 'admin';
}
