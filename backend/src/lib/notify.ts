import { eq, and, isNull, sql } from 'drizzle-orm';
import { dz } from '../db';
import { notifications, instrumentSlotAssignments, partSlotAssignments, parts, users } from '../schema';

/**
 * Create notifications for users assigned to instruments that received new content.
 * Called asynchronously after a part upload — should never block the upload response.
 */
export async function notifyPartUploaded(opts: {
  partId: string;
  partName: string;
  chartId: string;
  chartName: string;
  versionId: string;
  versionName: string;
  uploadedByUserId: string;
}): Promise<void> {
  try {
    // Find instrument slots this part is assigned to
    const slotRows = await dz.select({ slotId: partSlotAssignments.instrumentSlotId })
      .from(partSlotAssignments)
      .where(eq(partSlotAssignments.partId, opts.partId));

    if (slotRows.length === 0) return;

    // Find users assigned to those slots (excluding the uploader and dummy users)
    const userRows = await dz.select({
      userId: instrumentSlotAssignments.userId,
    })
      .from(instrumentSlotAssignments)
      .innerJoin(users, eq(users.id, instrumentSlotAssignments.userId))
      .where(and(
        sql`${instrumentSlotAssignments.slotId} in (${sql.join(slotRows.map(r => sql`${r.slotId}`), sql`, `)})`,
        eq(users.isDummy, false),
        sql`${instrumentSlotAssignments.userId} != ${opts.uploadedByUserId}`,
      ));

    if (userRows.length === 0) return;

    // Deduplicate user IDs
    const uniqueUserIds = [...new Set(userRows.map(r => r.userId))];

    // Create notifications
    await dz.insert(notifications).values(
      uniqueUserIds.map(userId => ({
        userId,
        kind: 'new_part_version' as const,
        payload: {
          chartId: opts.chartId,
          chartName: opts.chartName,
          versionId: opts.versionId,
          versionName: opts.versionName,
          partId: opts.partId,
          partName: opts.partName,
        },
      })),
    );
  } catch (err) {
    // Log but don't throw — notifications are non-critical
    console.error('Failed to create notifications for part upload:', err);
  }
}

/**
 * Notify a user when they are assigned to an instrument slot.
 */
export async function notifyAssignmentAdded(opts: {
  userId: string;
  instrumentName: string;
  ensembleId: string;
  ensembleName: string;
}): Promise<void> {
  try {
    await dz.insert(notifications).values({
      userId: opts.userId,
      kind: 'assignment_added' as const,
      payload: {
        instrumentName: opts.instrumentName,
        ensembleId: opts.ensembleId,
        ensembleName: opts.ensembleName,
      },
    });
  } catch (err) {
    console.error('Failed to create assignment notification:', err);
  }
}
