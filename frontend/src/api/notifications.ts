import { api } from './client';

export interface Notification {
  id: string;
  userId: string;
  kind: 'new_part_version' | 'assignment_added' | 'migration_complete';
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export function getNotifications(limit = 20): Promise<{ notifications: Notification[] }> {
  return api.get(`/notifications?limit=${limit}`);
}

export function getUnreadCount(): Promise<{ count: number }> {
  return api.get('/notifications/unread-count');
}

export function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  return api.post('/notifications/mark-read', ids ? { ids } : {});
}
