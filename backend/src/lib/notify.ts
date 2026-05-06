import { eq, and, sql } from 'drizzle-orm';
import { dz } from '../db';
import { instrumentSlotAssignments, partSlotAssignments, users, ensembles, charts, versions } from '../schema';
import { sendNotification } from '../notifications/send';

/**
 * Notify users assigned to the uploaded part's instrument slots.
 * Uses sendNotification for smart clustering and preference checks.
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
    // Resolve ensemble ID from chart
    const [chart] = await dz.select({ ensembleId: charts.ensembleId })
      .from(charts)
      .where(eq(charts.id, opts.chartId));
    const ensembleId = chart?.ensembleId;

    // Find instrument slots this part is assigned to
    const slotRows = await dz.select({ slotId: partSlotAssignments.instrumentSlotId })
      .from(partSlotAssignments)
      .where(eq(partSlotAssignments.partId, opts.partId));

    if (slotRows.length === 0) return;

    // Find users assigned to those slots (excluding the uploader and dummy users)
    const userRows = await dz.select({ userId: instrumentSlotAssignments.userId })
      .from(instrumentSlotAssignments)
      .innerJoin(users, eq(users.id, instrumentSlotAssignments.userId))
      .where(and(
        sql`${instrumentSlotAssignments.slotId} in (${sql.join(slotRows.map(r => sql`${r.slotId}`), sql`, `)})`,
        eq(users.isDummy, false),
        sql`${instrumentSlotAssignments.userId} != ${opts.uploadedByUserId}`,
      ));

    if (userRows.length === 0) return;

    const uniqueUserIds = [...new Set(userRows.map(r => r.userId))];

    for (const userId of uniqueUserIds) {
      await sendNotification(userId, {
        eventType: 'version_published',
        ensembleId,
        payload: {
          chartId: opts.chartId,
          chartName: opts.chartName,
          versionId: opts.versionId,
          versionName: opts.versionName,
          partId: opts.partId,
          partName: opts.partName,
        },
      });
    }
  } catch (err) {
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
    await sendNotification(opts.userId, {
      eventType: 'member_added',
      ensembleId: opts.ensembleId,
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
