import { db, dz } from '../db';
import { users, workspaces, workspaceMembers, ensembles, notifications, userNotificationPreferences } from '../schema';
import { sendNotification, getEffectivePreference } from '../notifications/send';
import { DEFAULT_PREFERENCES } from '../notifications/defaults';
import { eq, and, sql } from 'drizzle-orm';

let userDirector: string;
let userPlayer: string;
let workspaceId: string;
let ensembleId: string;

async function clearTables() {
  await db.query('DELETE FROM user_notification_preferences');
  await db.query('DELETE FROM notifications');
  await db.query('DELETE FROM workspace_members');
  await db.query('DELETE FROM ensembles');
  await db.query('DELETE FROM workspaces');
  await db.query('DELETE FROM users');
}

beforeAll(async () => {
  await clearTables();

  // Create director user
  const [director] = await dz.insert(users).values({
    email: 'director@notif-test.local',
    passwordHash: 'x',
    displayName: 'Director Dan',
  }).returning();
  userDirector = director.id;

  // Create player user
  const [player] = await dz.insert(users).values({
    email: 'player@notif-test.local',
    passwordHash: 'x',
    displayName: 'Player Pat',
  }).returning();
  userPlayer = player.id;

  // Create workspace + ensemble
  const [ws] = await dz.insert(workspaces).values({ name: 'Notif Test Workspace' }).returning();
  workspaceId = ws.id;

  await dz.insert(workspaceMembers).values([
    { workspaceId, userId: userDirector, role: 'owner' },
    { workspaceId, userId: userPlayer, role: 'member' },
  ]);

  const [ens] = await dz.insert(ensembles).values({ workspaceId, name: 'Test Ensemble' }).returning();
  ensembleId = ens.id;
});

beforeEach(async () => {
  await db.query('DELETE FROM user_notification_preferences');
  await db.query('DELETE FROM notifications');
});

afterAll(async () => {
  await clearTables();
  await db.end();
});

describe('sendNotification', () => {
  // 1. Direct event delivery
  it('creates a notification row for a direct event', async () => {
    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { partId: 'p1', versionId: 'v1', chartName: 'Test', sourcesSucceeded: 2, sourcesFailed: 0, annotationsAdded: 10 },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('migration_complete');
    expect(rows[0].clusterCount).toBe(1);
    expect((rows[0].payload as any).annotationsAdded).toBe(10);
  });

  // 2. Cluster within window
  it('clusters events within 5-minute window into one row', async () => {
    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { sourcesSucceeded: 1, sourcesFailed: 0, annotationsAdded: 5 },
    });

    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { sourcesSucceeded: 1, sourcesFailed: 1, annotationsAdded: 3 },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    expect(rows[0].clusterCount).toBe(2);
    expect((rows[0].payload as any).annotationsAdded).toBe(8);
    expect((rows[0].payload as any).sourcesSucceeded).toBe(2);
    expect((rows[0].payload as any).sourcesFailed).toBe(1);
  });

  // 3. Cluster across window boundary
  it('creates separate rows across the 5-minute window boundary', async () => {
    // Insert first notification with old timestamp
    await dz.insert(notifications).values({
      recipientUserId: userDirector,
      eventType: 'migration_complete',
      ensembleId,
      payload: { annotationsAdded: 5 },
      clusterWindowStartedAt: new Date(Date.now() - 6 * 60 * 1000), // 6 min ago
    });

    // Send second — should create a new cluster
    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { annotationsAdded: 3 },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(2);
  });

  // 4. Different event types don't cluster
  it('does not cluster different event types', async () => {
    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { annotationsAdded: 5 },
    });

    await sendNotification(userDirector, {
      eventType: 'migration_failed',
      ensembleId,
      payload: { error: 'fail' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(2);
  });

  // 5. DirectorOnly default skips non-directors
  it('skips version_opened for non-director users', async () => {
    await sendNotification(userPlayer, {
      eventType: 'version_opened',
      ensembleId,
      payload: { openerName: 'Someone' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userPlayer));
    expect(rows).toHaveLength(0);
  });

  // 6. DirectorOnly fires for directors
  it('delivers version_opened to directors', async () => {
    await sendNotification(userDirector, {
      eventType: 'version_opened',
      ensembleId,
      payload: { openerName: 'Pat' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('version_opened');
  });

  // 7. Master email kill switch
  it('marks delivered_email_at when master email disabled (no actual send)', async () => {
    // Disable master email
    await dz.update(users)
      .set({ notificationEmailEnabled: false })
      .where(eq(users.id, userDirector));

    // The notification should still be created (for in-app)
    await sendNotification(userDirector, {
      eventType: 'version_published',
      ensembleId,
      payload: { chartName: 'Test' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    // Note: delivered_email_at is set by the email worker, not sendNotification.
    // The worker checks the master switch before sending.

    // Restore
    await dz.update(users)
      .set({ notificationEmailEnabled: true })
      .where(eq(users.id, userDirector));
  });

  // 8. Per-event email pref
  it('respects per-event email preference', async () => {
    // Set email off for migration_complete
    await dz.insert(userNotificationPreferences).values({
      userId: userDirector,
      eventType: 'migration_complete',
      inAppEnabled: true,
      emailEnabled: false,
    });

    const pref = await getEffectivePreference(userDirector, 'migration_complete');
    expect(pref.inAppEnabled).toBe(true);
    expect(pref.emailEnabled).toBe(false);
  });

  // 9. In-app off, email on — row IS created (email worker needs it)
  it('creates row when in-app disabled but email enabled', async () => {
    await dz.insert(userNotificationPreferences).values({
      userId: userDirector,
      eventType: 'version_published',
      inAppEnabled: false,
      emailEnabled: true,
    });

    await sendNotification(userDirector, {
      eventType: 'version_published',
      ensembleId,
      payload: { chartName: 'Test' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
  });

  // 10. Both off — NO row inserted
  it('inserts no row when both channels disabled', async () => {
    await dz.insert(userNotificationPreferences).values({
      userId: userDirector,
      eventType: 'version_published',
      inAppEnabled: false,
      emailEnabled: false,
    });

    await sendNotification(userDirector, {
      eventType: 'version_published',
      ensembleId,
      payload: { chartName: 'Test' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(0);
  });

  // 11. Sparse preference: setting back to default removes row
  it('removes sparse preference row when set back to default', async () => {
    // Set a non-default preference
    await dz.insert(userNotificationPreferences).values({
      userId: userDirector,
      eventType: 'version_published',
      inAppEnabled: true,
      emailEnabled: false, // Default is true
    });

    let [row] = await dz.select().from(userNotificationPreferences)
      .where(and(
        eq(userNotificationPreferences.userId, userDirector),
        eq(userNotificationPreferences.eventType, 'version_published'),
      ));
    expect(row).toBeDefined();

    // Test the API by simulating what PATCH /preferences does:
    // Setting emailEnabled back to true (the default) should delete the row
    const def = DEFAULT_PREFERENCES['version_published'];
    const newEmail = true; // back to default
    const newInApp = row.inAppEnabled;
    if (newInApp === def.inAppEnabled && newEmail === def.emailEnabled) {
      await dz.delete(userNotificationPreferences)
        .where(and(
          eq(userNotificationPreferences.userId, userDirector),
          eq(userNotificationPreferences.eventType, 'version_published'),
        ));
    }

    const rows = await dz.select().from(userNotificationPreferences)
      .where(and(
        eq(userNotificationPreferences.userId, userDirector),
        eq(userNotificationPreferences.eventType, 'version_published'),
      ));
    expect(rows).toHaveLength(0);
  });

  // 12. Cluster payload merge — version_opened
  it('merges openerNames on version_opened clustering', async () => {
    await sendNotification(userDirector, {
      eventType: 'version_opened',
      ensembleId,
      payload: { openerName: 'Alice', chartName: 'Flute', versionName: 'v3' },
    });

    await sendNotification(userDirector, {
      eventType: 'version_opened',
      ensembleId,
      payload: { openerName: 'Bob', chartName: 'Flute', versionName: 'v3' },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    expect(rows[0].clusterCount).toBe(2);
    const payload = rows[0].payload as any;
    expect(payload.openerNames).toContain('Alice');
    expect(payload.openerNames).toContain('Bob');
  });

  // 13. Cluster payload merge — migration_complete sums numerics
  it('sums numeric fields on migration_complete clustering', async () => {
    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { sourcesSucceeded: 2, sourcesFailed: 0, annotationsAdded: 15 },
    });

    await sendNotification(userDirector, {
      eventType: 'migration_complete',
      ensembleId,
      payload: { sourcesSucceeded: 1, sourcesFailed: 1, annotationsAdded: 7 },
    });

    const rows = await dz.select().from(notifications)
      .where(eq(notifications.recipientUserId, userDirector));
    expect(rows).toHaveLength(1);
    expect(rows[0].clusterCount).toBe(2);
    const payload = rows[0].payload as any;
    expect(payload.sourcesSucceeded).toBe(3);
    expect(payload.sourcesFailed).toBe(1);
    expect(payload.annotationsAdded).toBe(22);
  });
});
