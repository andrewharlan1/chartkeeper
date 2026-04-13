import { db } from '../db';
import { sendPush, DeviceToken } from './push';
import { VersionDiffJson } from './diff';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface EnsembleMemberRow {
  user_id: string;
}

interface DeviceTokenRow extends DeviceToken {
  user_id: string;
}

async function getEnsembleMembers(ensembleId: string): Promise<EnsembleMemberRow[]> {
  const result = await db.query<EnsembleMemberRow>(
    `SELECT user_id FROM ensemble_members WHERE ensemble_id = $1`,
    [ensembleId]
  );
  return result.rows;
}

async function getDeviceTokens(userIds: string[]): Promise<DeviceTokenRow[]> {
  if (userIds.length === 0) return [];
  const result = await db.query<DeviceTokenRow>(
    `SELECT user_id, token, platform, web_endpoint AS "webEndpoint",
            web_p256dh AS "webP256dh", web_auth AS "webAuth"
     FROM device_tokens
     WHERE user_id = ANY($1)`,
    [userIds]
  );
  return result.rows;
}

async function writeNotification(
  userId: string,
  ensembleId: string,
  chartVersionId: string | null,
  type: string,
  message: string
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, ensemble_id, chart_version_id, type, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, ensembleId, chartVersionId, type, message]
  );
}

async function dispatchToUsers(
  userIds: string[],
  ensembleId: string,
  chartVersionId: string | null,
  type: string,
  buildMessage: (userId: string) => string,
  buildPushBody: (userId: string) => string,
  title: string
): Promise<void> {
  const tokens = await getDeviceTokens(userIds);
  const tokensByUser = new Map<string, DeviceTokenRow[]>();
  for (const t of tokens) {
    const list = tokensByUser.get(t.user_id) ?? [];
    list.push(t);
    tokensByUser.set(t.user_id, list);
  }

  await Promise.all(
    userIds.map(async (userId) => {
      const message = buildMessage(userId);
      await writeNotification(userId, ensembleId, chartVersionId, type, message);

      const userTokens = tokensByUser.get(userId) ?? [];
      await Promise.all(
        userTokens.map(async (device) => {
          try {
            await sendPush(device, { title, body: buildPushBody(userId) });
          } catch (err: any) {
            if (err.expired) {
              // Clean up expired web push subscriptions
              await db.query(`DELETE FROM device_tokens WHERE token = $1`, [device.token]);
            } else {
              console.error(`[notifications] Push failed for user ${userId}:`, err);
            }
          }
        })
      );
    })
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by the diff worker after a VersionDiff is stored.
 * Sends per-player notifications with their specific changed measure count.
 */
export async function notifyNewVersion(
  chartId: string,
  toVersionId: string,
  diffJson: VersionDiffJson
): Promise<void> {
  const meta = await db.query<{
    chart_title: string;
    version_name: string;
    ensemble_id: string;
  }>(
    `SELECT c.title AS chart_title, cv.version_name, c.ensemble_id
     FROM chart_versions cv
     JOIN charts c ON c.id = cv.chart_id
     WHERE cv.id = $1`,
    [toVersionId]
  );
  if (!meta.rows[0]) return;
  const { chart_title, version_name, ensemble_id } = meta.rows[0];
  const chartTitle = chart_title ?? 'Untitled';

  // Map instrument → changed measure count from diffJson
  const changedByInstrument: Record<string, number> = {};
  for (const [instrument, partDiff] of Object.entries(diffJson.parts)) {
    changedByInstrument[instrument] = partDiff.changedMeasures.length;
  }

  // Map user → their instrument for this version
  const partRows = await db.query<{ user_instrument?: string }>(
    // Players don't have an assigned instrument yet in Phase 1 — send to all members
    // In Phase 2 this will filter by player's assigned instrument
    `SELECT user_id FROM ensemble_members WHERE ensemble_id = $1`,
    [ensemble_id]
  );
  const memberIds = partRows.rows.map((r: any) => r.user_id);

  // Build a summary of all changed parts for the generic message
  const totalChanged = Object.values(changedByInstrument).reduce((a, b) => a + b, 0);
  const summary =
    totalChanged > 0
      ? `${totalChanged} measure${totalChanged !== 1 ? 's' : ''} changed`
      : 'new version available';

  const title = chartTitle;
  const body = `${chartTitle} updated — ${summary}`;

  await dispatchToUsers(
    memberIds,
    ensemble_id,
    toVersionId,
    'new_version',
    () => body,
    () => body,
    title
  );
}

/**
 * Called when OMR settles but no diff could be computed (first version, or all OMR failed).
 */
export async function notifyNewVersionNoDiff(
  chartId: string,
  toVersionId: string
): Promise<void> {
  const meta = await db.query<{
    chart_title: string;
    version_name: string;
    ensemble_id: string;
  }>(
    `SELECT c.title AS chart_title, cv.version_name, c.ensemble_id
     FROM chart_versions cv
     JOIN charts c ON c.id = cv.chart_id
     WHERE cv.id = $1`,
    [toVersionId]
  );
  if (!meta.rows[0]) return;
  const { chart_title, ensemble_id } = meta.rows[0];
  const chartTitle = chart_title ?? 'Untitled';
  const body = `${chartTitle} updated — new version available`;

  const members = await getEnsembleMembers(ensemble_id);
  const memberIds = members.map((m) => m.user_id);

  await dispatchToUsers(
    memberIds,
    ensemble_id,
    toVersionId,
    'new_version',
    () => body,
    () => body,
    chartTitle
  );
}

/**
 * Called by the restore endpoint.
 */
export async function notifyRestore(
  chartId: string,
  restoredVersionId: string
): Promise<void> {
  const meta = await db.query<{
    chart_title: string;
    version_name: string;
    ensemble_id: string;
  }>(
    `SELECT c.title AS chart_title, cv.version_name, c.ensemble_id
     FROM chart_versions cv
     JOIN charts c ON c.id = cv.chart_id
     WHERE cv.id = $1`,
    [restoredVersionId]
  );
  if (!meta.rows[0]) return;
  const { chart_title, version_name, ensemble_id } = meta.rows[0];
  const chartTitle = chart_title ?? 'Untitled';
  const body = `${chartTitle} restored to "${version_name}"`;

  const members = await getEnsembleMembers(ensemble_id);
  const memberIds = members.map((m) => m.user_id);

  await dispatchToUsers(
    memberIds,
    ensemble_id,
    restoredVersionId,
    'restore',
    () => body,
    () => body,
    chartTitle
  );
}
