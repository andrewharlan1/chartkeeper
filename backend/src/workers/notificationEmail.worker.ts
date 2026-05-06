import dotenv from 'dotenv';
dotenv.config();

import { eq, and, isNull, lt, asc, sql } from 'drizzle-orm';
import { dz } from '../db';
import { notifications, users, userNotificationPreferences } from '../schema';
import type { NotificationEventType } from '../schema';
import { DEFAULT_PREFERENCES } from '../notifications/defaults';
import { sendEmail, composeEmailForNotification } from '../notifications/email';

const POLL_INTERVAL_MS = parseInt(process.env.EMAIL_POLL_INTERVAL_MS ?? '30000');

async function processEmailQueue(): Promise<void> {
  // Find notifications whose cluster window has closed (5+ min old) and email not yet sent
  const dueNotifications = await dz.select()
    .from(notifications)
    .where(and(
      isNull(notifications.deliveredEmailAt),
      lt(notifications.clusterWindowStartedAt, sql`NOW() - INTERVAL '5 minutes'`),
    ))
    .orderBy(asc(notifications.clusterWindowStartedAt))
    .limit(100);

  if (dueNotifications.length === 0) return;

  for (const n of dueNotifications) {
    try {
      // Check master email kill switch
      const [user] = await dz.select({
        email: users.email,
        notificationEmailEnabled: users.notificationEmailEnabled,
      })
        .from(users)
        .where(eq(users.id, n.recipientUserId));

      if (!user || !user.notificationEmailEnabled) {
        await dz.update(notifications)
          .set({ deliveredEmailAt: sql`NOW()` })
          .where(eq(notifications.id, n.id));
        continue;
      }

      // Check per-event email preference
      const eventType = n.eventType as NotificationEventType;
      const def = DEFAULT_PREFERENCES[eventType];
      const [pref] = await dz.select()
        .from(userNotificationPreferences)
        .where(and(
          eq(userNotificationPreferences.userId, n.recipientUserId),
          eq(userNotificationPreferences.eventType, n.eventType),
        ));
      const emailEnabled = pref?.emailEnabled ?? def?.emailEnabled ?? true;

      if (!emailEnabled) {
        await dz.update(notifications)
          .set({ deliveredEmailAt: sql`NOW()` })
          .where(eq(notifications.id, n.id));
        continue;
      }

      // Compose and send
      const { subject, html } = composeEmailForNotification({
        eventType: n.eventType,
        payload: n.payload as Record<string, unknown>,
        clusterCount: n.clusterCount,
        ensembleId: n.ensembleId,
      });
      await sendEmail(user.email, subject, html);

      await dz.update(notifications)
        .set({ deliveredEmailAt: sql`NOW()` })
        .where(eq(notifications.id, n.id));
    } catch (err) {
      console.error('[notificationEmail.worker] Email send failed', { notificationId: n.id, err });
      // Don't mark as delivered; it'll retry next poll cycle
    }
  }
}

async function tick(): Promise<void> {
  try {
    await processEmailQueue();
  } catch (err) {
    console.error('[notificationEmail.worker] Tick error:', err);
  }
}

async function run(): Promise<void> {
  console.log(`[notificationEmail.worker] Started — polling every ${POLL_INTERVAL_MS}ms`);
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

run().catch(err => {
  console.error('[notificationEmail.worker] Fatal error:', err);
  process.exit(1);
});
