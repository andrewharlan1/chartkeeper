import { eq, and, isNull, desc, gt, sql } from 'drizzle-orm';
import { dz } from '../db';
import { notifications, userNotificationPreferences, workspaceMembers, ensembles } from '../schema';
import type { NotificationEventType } from '../schema';
import { DEFAULT_PREFERENCES } from './defaults';

/** Resolve effective preference for a user + event type (sparse table + defaults) */
export async function getEffectivePreference(
  userId: string,
  eventType: NotificationEventType,
): Promise<{ inAppEnabled: boolean; emailEnabled: boolean }> {
  const def = DEFAULT_PREFERENCES[eventType];
  const [row] = await dz.select()
    .from(userNotificationPreferences)
    .where(and(
      eq(userNotificationPreferences.userId, userId),
      eq(userNotificationPreferences.eventType, eventType),
    ));
  return {
    inAppEnabled: row?.inAppEnabled ?? def.inAppEnabled,
    emailEnabled: row?.emailEnabled ?? def.emailEnabled,
  };
}

/** Check if user is a director (owner/admin) of the workspace that owns the ensemble. */
async function isDirectorOfEnsemble(userId: string, ensembleId: string): Promise<boolean> {
  const [ens] = await dz.select({ workspaceId: ensembles.workspaceId })
    .from(ensembles)
    .where(eq(ensembles.id, ensembleId));
  if (!ens) return false;
  const [membership] = await dz.select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, ens.workspaceId),
      eq(workspaceMembers.userId, userId),
    ));
  return membership?.role === 'owner' || membership?.role === 'admin';
}

/** Merge payloads when clustering events of the same type. */
function mergePayload(
  eventType: NotificationEventType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  switch (eventType) {
    case 'version_opened': {
      // Cluster opener names into an array
      const names = Array.isArray(existing.openerNames)
        ? [...existing.openerNames]
        : existing.openerName ? [existing.openerName] : [];
      const newName = incoming.openerName as string | undefined;
      if (newName && !names.includes(newName)) names.push(newName);
      return { ...existing, openerNames: names };
    }
    case 'migration_complete': {
      // Sum numeric fields
      return {
        ...existing,
        sourcesSucceeded: ((existing.sourcesSucceeded as number) || 0) + ((incoming.sourcesSucceeded as number) || 0),
        sourcesFailed: ((existing.sourcesFailed as number) || 0) + ((incoming.sourcesFailed as number) || 0),
        annotationsAdded: ((existing.annotationsAdded as number) || 0) + ((incoming.annotationsAdded as number) || 0),
      };
    }
    case 'version_published': {
      // Track part names
      const partNames = Array.isArray(existing.partNames)
        ? [...existing.partNames]
        : existing.partName ? [existing.partName] : [];
      const newPart = incoming.partName as string | undefined;
      if (newPart && !partNames.includes(newPart)) partNames.push(newPart);
      return { ...existing, partNames };
    }
    default:
      // For other event types, keep the latest payload
      return { ...existing, ...incoming };
  }
}

/** Deep link for a notification, computed from event type and payload */
export function computeDeepLink(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): string | undefined {
  const partId = payload.partId as string | undefined;
  const versionId = payload.versionId as string | undefined;
  const chartId = payload.chartId as string | undefined;
  const ensembleId = payload.ensembleId as string | undefined;

  switch (eventType) {
    case 'version_published':
    case 'migration_complete':
    case 'migration_failed':
    case 'annotation_flagged':
      if (chartId && versionId) return `/charts/${chartId}/versions/${versionId}`;
      if (chartId) return `/charts/${chartId}`;
      return undefined;
    case 'version_opened':
      if (chartId && versionId) return `/charts/${chartId}/versions/${versionId}`;
      return undefined;
    case 'member_added':
    case 'role_changed':
      if (ensembleId) return `/ensembles/${ensembleId}/members`;
      return undefined;
    case 'ensemble_renamed':
      if (ensembleId) return `/ensembles/${ensembleId}`;
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Send a notification to a user with smart clustering.
 *
 * Events within a 5-minute window of the same (recipient, eventType, ensembleId)
 * cluster into a single notification row.
 */
export async function sendNotification(
  recipientUserId: string,
  event: {
    eventType: NotificationEventType;
    ensembleId?: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const def = DEFAULT_PREFERENCES[event.eventType];

  // 1. Check directorOnly default
  if (def.directorOnly && event.ensembleId) {
    const isDirector = await isDirectorOfEnsemble(recipientUserId, event.ensembleId);
    if (!isDirector) return;
  }

  // 2. Resolve user prefs
  const pref = await getEffectivePreference(recipientUserId, event.eventType);
  if (!pref.inAppEnabled && !pref.emailEnabled) return;

  // 3. Look for an existing cluster within the 5-minute window
  const ensembleCondition = event.ensembleId
    ? eq(notifications.ensembleId, event.ensembleId)
    : isNull(notifications.ensembleId);

  const [cluster] = await dz.select()
    .from(notifications)
    .where(and(
      eq(notifications.recipientUserId, recipientUserId),
      eq(notifications.eventType, event.eventType),
      ensembleCondition,
      isNull(notifications.deliveredEmailAt),
      gt(notifications.clusterWindowStartedAt, sql`NOW() - INTERVAL '5 minutes'`),
    ))
    .orderBy(desc(notifications.clusterWindowStartedAt))
    .limit(1);

  if (cluster) {
    // 4. Cluster: increment count, merge payload
    const merged = mergePayload(
      event.eventType,
      cluster.payload as Record<string, unknown>,
      event.payload,
    );
    await dz.update(notifications)
      .set({
        clusterCount: cluster.clusterCount + 1,
        payload: merged,
      })
      .where(eq(notifications.id, cluster.id));
    // Real-time: would publish here if pub/sub existed
    return;
  }

  // 5. New notification
  await dz.insert(notifications).values({
    recipientUserId,
    eventType: event.eventType,
    ensembleId: event.ensembleId ?? null,
    payload: event.payload,
  });
  // Real-time: would publish here if pub/sub existed
}
