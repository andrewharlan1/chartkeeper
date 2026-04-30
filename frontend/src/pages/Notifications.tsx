import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNotifications, markNotificationsRead, Notification } from '../api/notifications';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';

type Filter = 'all' | 'my-parts';

function notifMessage(n: Notification): { title: string; sub: string; link: string | null } {
  const payload = n.payload as Record<string, string>;
  switch (n.kind) {
    case 'new_part_version':
      return {
        title: `New version uploaded for ${payload.chartName || 'a chart'}`,
        sub: 'Your annotations have been preserved and migrated.',
        link: payload.chartId ? `/charts/${payload.chartId}` : null,
      };
    case 'assignment_added':
      return {
        title: `You were assigned to ${payload.instrumentName || 'an instrument'}`,
        sub: payload.chartName ? `In ${payload.chartName}` : 'Check your parts.',
        link: payload.partId && payload.versionId && payload.chartId
          ? `/charts/${payload.chartId}/versions/${payload.versionId}/parts/${payload.partId}`
          : null,
      };
    case 'migration_complete':
      return {
        title: `Annotations migrated for ${payload.partName || 'a part'}`,
        sub: `${payload.migratedCount || '0'} annotations carried forward. Review when ready.`,
        link: payload.partId && payload.versionId && payload.chartId
          ? `/charts/${payload.chartId}/versions/${payload.versionId}/parts/${payload.partId}`
          : null,
      };
    default:
      return { title: 'Notification', sub: '', link: null };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    getNotifications(100)
      .then(r => setNotifs(r.notifications))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleMarkAllRead() {
    await markNotificationsRead().catch(() => {});
    setNotifs(prev => prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
  }

  function handleClick(n: Notification) {
    if (!n.readAt) {
      markNotificationsRead([n.id]).catch(() => {});
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
    }
    const { link } = notifMessage(n);
    if (link) navigate(`${link}?from=notification`);
  }

  const filtered = filter === 'my-parts'
    ? notifs.filter(n => n.kind === 'assignment_added' || n.kind === 'new_part_version')
    : notifs;

  const unreadCount = notifs.filter(n => !n.readAt).length;

  if (loading) return (
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
        unreadCount > 0 ? (
          <Button size="sm" variant="secondary" onClick={handleMarkAllRead}>
            Mark all read
          </Button>
        ) : undefined
      }
    >
      {/* Filter chips */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20,
      }}>
        {(['all', 'my-parts'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--surface)',
              color: filter === f ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 999,
              padding: '4px 14px',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {f === 'all' ? 'All' : 'Only my parts'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          No notifications yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filtered.map(n => {
            const { title, sub } = notifMessage(n);
            const isUnread = !n.readAt;
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 14px',
                  background: isUnread ? 'rgba(200,83,28,0.04)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'background 0.12s',
                }}
              >
                {/* Actor icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 999,
                  background: isUnread ? 'rgba(200,83,28,0.12)' : 'var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14,
                  color: isUnread ? 'var(--accent)' : 'var(--text-faint)',
                  flexShrink: 0,
                }}>
                  {n.kind === 'new_part_version' ? '\u2191' : n.kind === 'assignment_added' ? '+' : '\u2192'}
                </div>

                {/* Body */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: isUnread ? 600 : 400,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {title}
                  </div>
                  {sub && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {sub}
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 10.5,
                  color: 'var(--text-faint)', whiteSpace: 'nowrap',
                }}>
                  {timeAgo(n.createdAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
