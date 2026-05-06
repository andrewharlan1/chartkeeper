import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext';
import { NotificationRow } from '../components/notifications/NotificationRow';
import { Notification, NotificationEventType } from '../api/notifications';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';

type Filter = 'all' | 'unread' | NotificationEventType;

const FILTER_LABELS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'version_published', label: 'Published' },
  { value: 'migration_complete', label: 'Migration' },
  { value: 'migration_failed', label: 'Failed' },
  { value: 'annotation_flagged', label: 'Flagged' },
  { value: 'member_added', label: 'Members' },
  { value: 'version_opened', label: 'Opened' },
];

export function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, loadMore, hasMore } = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');

  function handleClick(n: Notification) {
    if (!n.readAt) markAsRead(n.id);
    if (n.deepLink) navigate(`${n.deepLink}?from=notification`);
  }

  const filtered = notifications.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.readAt;
    return n.eventType === filter;
  });

  if (loading && notifications.length === 0) return (
    <Layout title="Notifications" backTo="/" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}>
      <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
    </Layout>
  );

  return (
    <Layout
      title="Notifications"
      backTo="/"
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {unreadCount > 0 && (
            <Button size="sm" variant="secondary" onClick={markAllAsRead}>
              Mark all read
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => navigate('/settings/notifications')}>
            Preferences
          </Button>
        </div>
      }
    >
      {/* Filter chips */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap',
      }}>
        {FILTER_LABELS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              background: filter === f.value ? 'var(--accent)' : 'var(--surface)',
              color: filter === f.value ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === f.value ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              padding: '4px 14px',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>{'\uD83D\uDD14'}</div>
          {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map(n => (
            <NotificationRow key={n.id} notification={n} onClick={handleClick} />
          ))}
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Button size="sm" variant="secondary" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </Layout>
  );
}
