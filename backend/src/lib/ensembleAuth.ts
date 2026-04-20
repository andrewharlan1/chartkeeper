import { eq, and } from 'drizzle-orm';
import { dz } from '../db';
import { workspaceMembers, ensembles } from '../schema';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Get user's role in a workspace (or null if not a member). */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const [row] = await dz.select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return (row?.role as WorkspaceRole) ?? null;
}

/** Require user is a workspace member; returns the role. */
export async function requireWorkspaceMember(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (!role) throw { status: 403, message: 'Not a member of this workspace' };
  return role;
}

/** Require owner or admin on a workspace. */
export async function requireWorkspaceAdmin(
  workspaceId: string,
  userId: string
): Promise<void> {
  const role = await requireWorkspaceMember(workspaceId, userId);
  if (role !== 'owner' && role !== 'admin') {
    throw { status: 403, message: 'Insufficient permissions' };
  }
}

/** Look up the workspace that owns an ensemble and check membership. */
export async function requireEnsembleMember(
  ensembleId: string,
  userId: string
): Promise<WorkspaceRole> {
  const [ens] = await dz.select({ workspaceId: ensembles.workspaceId })
    .from(ensembles)
    .where(eq(ensembles.id, ensembleId));
  if (!ens) throw { status: 404, message: 'Ensemble not found' };
  return requireWorkspaceMember(ens.workspaceId, userId);
}

/** Look up the workspace that owns an ensemble and require admin. */
export async function requireEnsembleAdmin(
  ensembleId: string,
  userId: string
): Promise<void> {
  const [ens] = await dz.select({ workspaceId: ensembles.workspaceId })
    .from(ensembles)
    .where(eq(ensembles.id, ensembleId));
  if (!ens) throw { status: 404, message: 'Ensemble not found' };
  await requireWorkspaceAdmin(ens.workspaceId, userId);
}

// ── Backward-compat aliases for not-yet-migrated routes ──────────────────────
// Remove these as each route is migrated to the new auth functions.
export type EnsembleRole = WorkspaceRole;
export const getMemberRole = getWorkspaceRole;
export const requireMember = requireEnsembleMember;
export const requireOwnerOrEditor = requireEnsembleAdmin;
