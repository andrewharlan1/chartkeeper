import type { NotificationEventType } from '../schema';

/** Stub email sender — logs to console until real email infra is configured. */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  // TODO: Replace with SendGrid/Postmark/SES when email infra is set up
  console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
  console.log(`[EMAIL] Body: ${html.slice(0, 200)}...`);
}

/** Compose email subject + HTML body for a notification. */
export function composeEmailForNotification(notification: {
  eventType: string;
  payload: Record<string, unknown>;
  clusterCount: number;
  ensembleId?: string | null;
}): { subject: string; html: string } {
  const { eventType, payload, clusterCount } = notification;
  const chartName = (payload.chartName as string) || 'a chart';
  const versionName = (payload.versionName as string) || '';
  const ensembleName = (payload.ensembleName as string) || '';

  let subject: string;
  let body: string;

  switch (eventType as NotificationEventType) {
    case 'version_published': {
      const partNames = payload.partNames as string[] | undefined;
      if (clusterCount > 1 && partNames && partNames.length > 1) {
        subject = `${clusterCount} parts published for ${chartName}`;
        body = `<p>${partNames.join(', ')} were published${versionName ? ` as ${versionName}` : ''}${ensembleName ? ` in ${ensembleName}` : ''}.</p>`;
      } else {
        const partName = (payload.partName as string) || 'a part';
        subject = `New version of ${partName} published`;
        body = `<p>${partName} was published${versionName ? ` as ${versionName}` : ''}${ensembleName ? ` in ${ensembleName}` : ''}.</p>`;
      }
      break;
    }
    case 'migration_complete': {
      const added = (payload.annotationsAdded as number) || 0;
      const succeeded = (payload.sourcesSucceeded as number) || 0;
      const failed = (payload.sourcesFailed as number) || 0;
      subject = `Migration finished: ${added} annotation${added !== 1 ? 's' : ''} added`;
      body = `<p>Annotation migration for ${chartName}${versionName ? ` ${versionName}` : ''} completed.</p>` +
        `<p>${succeeded} source${succeeded !== 1 ? 's' : ''} succeeded` +
        (failed > 0 ? `, ${failed} failed` : '') + `.</p>` +
        `<p>${added} annotation${added !== 1 ? 's' : ''} added to your part.</p>`;
      break;
    }
    case 'migration_failed': {
      const error = (payload.error as string) || 'Unknown error';
      subject = `Migration failed for ${chartName}`;
      body = `<p>Annotation migration for ${chartName}${versionName ? ` ${versionName}` : ''} failed.</p><p>Error: ${error}</p>`;
      break;
    }
    case 'annotation_flagged': {
      subject = `Annotation flagged for review in ${chartName}`;
      body = `<p>An annotation in ${chartName} has been flagged for review after migration.</p>`;
      break;
    }
    case 'member_added': {
      const instrumentName = (payload.instrumentName as string) || 'an instrument';
      subject = `You were added to ${ensembleName || 'an ensemble'}`;
      body = `<p>You've been assigned to ${instrumentName}${ensembleName ? ` in ${ensembleName}` : ''}.</p>`;
      break;
    }
    case 'role_changed': {
      const newRole = (payload.newRole as string) || 'a new role';
      subject = `Your role changed in ${ensembleName || 'an ensemble'}`;
      body = `<p>Your role has been changed to ${newRole}${ensembleName ? ` in ${ensembleName}` : ''}.</p>`;
      break;
    }
    case 'ensemble_renamed': {
      const oldName = (payload.oldName as string) || 'the ensemble';
      const newName = (payload.newName as string) || ensembleName;
      subject = `Ensemble renamed: ${oldName} → ${newName}`;
      body = `<p>The ensemble "${oldName}" has been renamed to "${newName}".</p>`;
      break;
    }
    case 'version_opened': {
      const openerNames = (payload.openerNames as string[]) || [];
      if (clusterCount > 1 && openerNames.length > 1) {
        subject = `${clusterCount} players opened ${chartName}${versionName ? ` ${versionName}` : ''}`;
        body = `<p>${openerNames.join(', ')} opened ${chartName}${versionName ? ` ${versionName}` : ''}.</p>`;
      } else {
        const name = openerNames[0] || (payload.openerName as string) || 'A player';
        subject = `${name} opened ${chartName}${versionName ? ` ${versionName}` : ''}`;
        body = `<p>${name} opened ${chartName}${versionName ? ` ${versionName}` : ''}.</p>`;
      }
      break;
    }
    default:
      subject = 'ChartKeeper notification';
      body = '<p>You have a new notification.</p>';
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a2e; margin: 0 0 16px;">${subject}</h2>
      ${body}
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="font-size: 12px; color: #888;">
        You're receiving this from ChartKeeper. Manage your notification preferences in Settings.
      </p>
    </div>
  `;

  return { subject, html };
}
