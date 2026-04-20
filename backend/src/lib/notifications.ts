import { eq, and } from 'drizzle-orm';
import { dz } from '../db';
import { versions, charts, workspaceMembers, ensembles } from '../schema';
import type { VersionDiffJson } from './diff';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getWorkspaceMemberIds(ensembleId: string): Promise<string[]> {
  const [ens] = await dz.select({ workspaceId: ensembles.workspaceId })
    .from(ensembles).where(eq(ensembles.id, ensembleId));
  if (!ens) return [];

  const rows = await dz.select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, ens.workspaceId));
  return rows.map(r => r.userId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by the diff worker after a VersionDiff is stored.
 * Sends per-player notifications with their specific changed measure count.
 *
 * TODO: Push notifications disabled until device_tokens table is added to Drizzle schema.
 * Currently just logs.
 */
export async function notifyNewVersion(
  ensembleId: string,
  toVersionId: string,
  diffJson: VersionDiffJson
): Promise<void> {
  const [ver] = await dz.select({ name: versions.name })
    .from(versions).where(eq(versions.id, toVersionId));
  if (!ver) return;

  const totalChanged = Object.values(diffJson.parts)
    .reduce((a, pd) => a + pd.changedMeasures.length, 0);
  const summary = totalChanged > 0
    ? `${totalChanged} measure${totalChanged !== 1 ? 's' : ''} changed`
    : 'new version available';

  const memberIds = await getWorkspaceMemberIds(ensembleId);
  console.log(
    `[notifications] Version "${ver.name}" — ${summary} ` +
    `(${memberIds.length} members to notify, push disabled)`
  );
}

/**
 * Called when OMR settles but no diff could be computed (first version, or all OMR failed).
 */
export async function notifyNewVersionNoDiff(
  ensembleId: string,
  toVersionId: string
): Promise<void> {
  const [ver] = await dz.select({ name: versions.name })
    .from(versions).where(eq(versions.id, toVersionId));
  if (!ver) return;

  const memberIds = await getWorkspaceMemberIds(ensembleId);
  console.log(
    `[notifications] Version "${ver.name}" — new version available ` +
    `(${memberIds.length} members, push disabled)`
  );
}

/**
 * Called by the restore endpoint.
 */
export async function notifyRestore(
  ensembleId: string,
  versionId: string
): Promise<void> {
  const [ver] = await dz.select({ name: versions.name })
    .from(versions).where(eq(versions.id, versionId));
  if (!ver) return;

  const memberIds = await getWorkspaceMemberIds(ensembleId);
  console.log(
    `[notifications] Version "${ver.name}" restored ` +
    `(${memberIds.length} members, push disabled)`
  );
}
