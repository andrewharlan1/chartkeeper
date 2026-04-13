import { db } from '../db';

export type EnsembleRole = 'owner' | 'editor' | 'player';

export async function getMemberRole(
  ensembleId: string,
  userId: string
): Promise<EnsembleRole | null> {
  const result = await db.query<{ role: EnsembleRole }>(
    `SELECT role FROM ensemble_members WHERE ensemble_id = $1 AND user_id = $2`,
    [ensembleId, userId]
  );
  return result.rows[0]?.role ?? null;
}

export async function requireMember(
  ensembleId: string,
  userId: string
): Promise<EnsembleRole> {
  const role = await getMemberRole(ensembleId, userId);
  if (!role) throw { status: 403, message: 'Not a member of this ensemble' };
  return role;
}

export async function requireOwnerOrEditor(
  ensembleId: string,
  userId: string
): Promise<void> {
  const role = await requireMember(ensembleId, userId);
  if (role === 'player') throw { status: 403, message: 'Insufficient permissions' };
}
