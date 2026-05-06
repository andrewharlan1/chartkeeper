import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getNotifications, markNotificationRead, markAllNotificationsRead, Notification } from '../api/notifications';
import { useAuth } from '../hooks/useAuth';

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  markAsRead: () => {},
  markAllAsRead: () => {},
  refresh: () => {},
  loadMore: () => {},
  hasMore: false,
});

export function useNotifications() {
  return useContext(NotificationContext);
}

const POLL_INTERVAL_MS = 15_000;
const PAGE_SIZE = 50;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async (append = false, cursor?: string) => {
    if (!token) return;
    try {
      if (!append) setLoading(true);
      const result = await getNotifications({ limit: PAGE_SIZE, cursor });
      if (append) {
        setNotifications(prev => [...prev, ...result.notifications]);
      } else {
        setNotifications(result.notifications);
      }
      setUnreadCount(result.unreadCount);
      setNextCursor(result.nextCursor);
    } catch {
      // Silent fail for polling
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial load + polling fallback (no websocket exists)
  useEffect(() => {
    if (!token) return;
    fetchNotifications();
    pollRef.current = setInterval(() => fetchNotifications(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, fetchNotifications]);

  const markAsRead = useCallback((id: string) => {
    // Optimistic update
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n),
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
    markNotificationRead(id).catch(() => {
      // Rollback on failure
      fetchNotifications();
    });
  }, [fetchNotifications]);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {
      fetchNotifications();
    });
  }, [fetchNotifications]);

  const refresh = useCallback(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const loadMore = useCallback(() => {
    if (nextCursor) {
      fetchNotifications(true, nextCursor);
    }
  }, [nextCursor, fetchNotifications]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      markAsRead,
      markAllAsRead,
      refresh,
      loadMore,
      hasMore: !!nextCursor,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}
