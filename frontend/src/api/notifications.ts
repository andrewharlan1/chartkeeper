import { api } from './client';

export type NotificationEventType =
  | 'version_published'
  | 'migration_complete'
  | 'migration_failed'
  | 'annotation_flagged'
  | 'member_added'
  | 'role_changed'
  | 'ensemble_renamed'
  | 'version_opened';

export interface Notification {
  id: string;
  eventType: NotificationEventType;
  ensembleId?: string;
  ensembleName?: string;
  payload: Record<string, unknown>;
  clusterCount: number;
  readAt: string | null;
  createdAt: string;
  deepLink?: string;
}

export interface NotificationPreferences {
  masterEmailEnabled: boolean;
  preferences: Record<NotificationEventType, {
    inAppEnabled: boolean;
    emailEnabled: boolean;
  }>;
}

export function getNotifications(opts?: {
  limit?: number;
  cursor?: string;
  eventType?: string;
  unreadOnly?: boolean;
}): Promise<{
  notifications: Notification[];
  unreadCount: number;
  nextCursor?: string;
}> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.eventType) params.set('eventType', opts.eventType);
  if (opts?.unreadOnly) params.set('unreadOnly', 'true');
  const qs = params.toString();
  return api.get(`/notifications${qs ? `?${qs}` : ''}`);
}

export function getUnreadCount(): Promise<{ count: number }> {
  return api.get('/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<{ notification: Notification }> {
  return api.post(`/notifications/${id}/read`, {});
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return api.post('/notifications/read-all', {});
}

// Backward compat
export function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  return api.post('/notifications/mark-read', ids ? { ids } : {});
}

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return api.get('/notifications/preferences');
}

export function updateNotificationPreferences(data: {
  masterEmailEnabled?: boolean;
  preferences?: Partial<Record<NotificationEventType, {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
  }>>;
}): Promise<NotificationPreferences> {
  return api.patch('/notifications/preferences', data);
}
