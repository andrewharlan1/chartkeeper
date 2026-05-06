import { Notification, NotificationEventType } from '../../api/notifications';

const EVENT_ICONS: Record<NotificationEventType, string> = {
  version_published: '\u2191',   // ↑
  migration_complete: '\u2192',  // →
  migration_failed: '\u26A0',   // ⚠
  annotation_flagged: '\u2691', // ⚑
  member_added: '+',
  role_changed: '\u21C4',       // ⇄
  ensemble_renamed: '\u270E',   // ✎
  version_opened: '\u25C9',     // ◉
};

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

export function getNotificationTitle(n: Notification): string {
  const p = n.payload as Record<string, unknown>;
  const chartName = (p.chartName as string) || 'a chart';
  const versionName = (p.versionName as string) || '';
  const count = n.clusterCount;

  switch (n.eventType) {
    case 'version_published': {
      const partNames = p.partNames as string[] | undefined;
      if (count > 1 && partNames && partNames.length > 1) {
        return `${count} parts published for ${chartName}${versionName ? ` ${versionName}` : ''}`;
      }
      const partName = (p.partName as string) || 'a part';
      return `New version of ${partName} published${versionName ? ` (${versionName})` : ''}`;
    }
    case 'migration_complete': {
      const added = (p.annotationsAdded as number) || 0;
      const succeeded = (p.sourcesSucceeded as number) || 0;
      const failed = (p.sourcesFailed as number) || 0;
      let text = `Migration finished: ${added} annotation${added !== 1 ? 's' : ''} added`;
      if (failed > 0) text += ` (${failed} source${failed !== 1 ? 's' : ''} failed)`;
      else if (succeeded > 1) text += ` from ${succeeded} sources`;
      return text;
    }
    case 'migration_failed': {
      return `Migration failed for ${chartName}`;
    }
    case 'annotation_flagged': {
      return `Annotation flagged for review in ${chartName}`;
    }
    case 'member_added': {
      const instrumentName = (p.instrumentName as string) || 'an instrument';
      const ensembleName = n.ensembleName || (p.ensembleName as string) || '';
      return `You were assigned to ${instrumentName}${ensembleName ? ` in ${ensembleName}` : ''}`;
    }
    case 'role_changed': {
      const newRole = (p.newRole as string) || 'a new role';
      const ensembleName = n.ensembleName || (p.ensembleName as string) || '';
      return `Your role changed to ${newRole}${ensembleName ? ` in ${ensembleName}` : ''}`;
    }
    case 'ensemble_renamed': {
      const oldName = (p.oldName as string) || '';
      const newName = (p.newName as string) || '';
      return `Ensemble renamed: ${oldName} \u2192 ${newName}`;
    }
    case 'version_opened': {
      const openerNames = (p.openerNames as string[]) || [];
      const openerName = (p.openerName as string) || 'A player';
      if (count > 1 && openerNames.length > 1) {
        return `${count} players opened ${chartName}${versionName ? ` ${versionName}` : ''}`;
      }
      const name = openerNames[0] || openerName;
      return `${name} opened ${chartName}${versionName ? ` ${versionName}` : ''}`;
    }
    default:
      return 'Notification';
  }
}

function getNotificationSub(n: Notification): string {
  const p = n.payload as Record<string, unknown>;
  switch (n.eventType) {
    case 'version_published':
      return n.ensembleName || (p.ensembleName as string) || '';
    case 'migration_complete':
      return (p.chartName as string) || '';
    case 'migration_failed':
      return (p.error as string) || '';
    case 'version_opened': {
      const names = (p.openerNames as string[]) || [];
      if (names.length > 2) return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
      if (names.length === 2) return names.join(' and ');
      return '';
    }
    default:
      return '';
  }
}

interface Props {
  notification: Notification;
  onClick: (n: Notification) => void;
}

export function NotificationRow({ notification: n, onClick }: Props) {
  const isUnread = !n.readAt;
  const title = getNotificationTitle(n);
  const sub = getNotificationSub(n);
  const icon = EVENT_ICONS[n.eventType] || '\u2022';

  return (
    <button
      onClick={() => onClick(n)}
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
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 999,
        background: isUnread ? 'rgba(200,83,28,0.12)' : 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14,
        color: isUnread ? 'var(--accent)' : 'var(--text-faint)',
        flexShrink: 0,
      }}>
        {icon}
      </div>

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

      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10.5,
        color: 'var(--text-faint)', whiteSpace: 'nowrap',
      }}>
        {timeAgo(n.createdAt)}
      </div>
    </button>
  );
}
