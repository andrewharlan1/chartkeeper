import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql, desc, lt } from 'drizzle-orm';
import { dz } from '../db';
import { notifications, users, ensembles, userNotificationPreferences, notificationEventTypes } from '../schema';
import type { NotificationEventType } from '../schema';
import { requireAuth } from '../middleware/auth';
import { DEFAULT_PREFERENCES } from '../notifications/defaults';
import { computeDeepLink } from '../notifications/send';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// GET /notifications?cursor=&limit=50&eventType=&unreadOnly=true
notificationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const cursor = req.query.cursor as string | undefined;
  const eventTypeFilter = req.query.eventType as string | undefined;
  const unreadOnly = req.query.unreadOnly === 'true';

  const conditions = [eq(notifications.recipientUserId, req.user!.id)];
  if (unreadOnly) conditions.push(isNull(notifications.readAt));
  if (eventTypeFilter) conditions.push(eq(notifications.eventType, eventTypeFilter));
  if (cursor) conditions.push(lt(notifications.createdAt, new Date(cursor)));

  const rows = await dz.select({
    id: notifications.id,
    recipientUserId: notifications.recipientUserId,
    eventType: notifications.eventType,
    ensembleId: notifications.ensembleId,
    payload: notifications.payload,
    clusterCount: notifications.clusterCount,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
    ensembleName: ensembles.name,
  })
    .from(notifications)
    .leftJoin(ensembles, eq(ensembles.id, notifications.ensembleId))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1); // fetch one extra to check for next page

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Compute deep links
  const enriched = page.map(r => ({
    id: r.id,
    eventType: r.eventType,
    ensembleId: r.ensembleId,
    ensembleName: r.ensembleName ?? undefined,
    payload: r.payload,
    clusterCount: r.clusterCount,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    deepLink: computeDeepLink(r.eventType as NotificationEventType, r.payload as Record<string, unknown>),
  }));

  // Unread count
  const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, req.user!.id), isNull(notifications.readAt)));

  res.json({
    notifications: enriched,
    unreadCount: Number(count),
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : undefined,
  });
});

// GET /notifications/unread-count
notificationsRouter.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  const [{ count }] = await dz.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, req.user!.id), isNull(notifications.readAt)));

  res.json({ count: Number(count) });
});

// POST /notifications/:id/read
notificationsRouter.post('/:id/read', async (req: Request, res: Response): Promise<void> => {
  const [existing] = await dz.select()
    .from(notifications)
    .where(and(
      eq(notifications.id, req.params.id),
      eq(notifications.recipientUserId, req.user!.id),
    ));

  if (!existing) { res.status(404).json({ error: 'Notification not found' }); return; }

  if (!existing.readAt) {
    const [updated] = await dz.update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, req.params.id))
      .returning();
    res.json({ notification: updated });
  } else {
    res.json({ notification: existing });
  }
});

// POST /notifications/read-all
notificationsRouter.post('/read-all', async (req: Request, res: Response): Promise<void> => {
  const result = await dz.update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientUserId, req.user!.id), isNull(notifications.readAt)))
    .returning();

  res.json({ updated: result.length });
});

// POST /notifications/mark-read (backward compat)
notificationsRouter.post('/mark-read', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    ids: z.array(z.string().uuid()).optional(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const now = new Date();

  if (parsed.data?.ids && parsed.data.ids.length > 0) {
    await dz.update(notifications)
      .set({ readAt: now })
      .where(and(
        eq(notifications.recipientUserId, req.user!.id),
        isNull(notifications.readAt),
        sql`${notifications.id} in (${sql.join(parsed.data.ids.map(id => sql`${id}`), sql`, `)})`,
      ));
  } else {
    await dz.update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.recipientUserId, req.user!.id), isNull(notifications.readAt)));
  }

  res.json({ ok: true });
});

// GET /notifications/preferences
notificationsRouter.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  // Master email kill switch
  const [user] = await dz.select({ notificationEmailEnabled: users.notificationEmailEnabled })
    .from(users)
    .where(eq(users.id, req.user!.id));

  // Sparse preference rows
  const rows = await dz.select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, req.user!.id));

  const sparseMap = new Map(rows.map(r => [r.eventType, r]));

  // Merge sparse with defaults
  const preferences: Record<string, { inAppEnabled: boolean; emailEnabled: boolean }> = {};
  for (const eventType of notificationEventTypes) {
    const def = DEFAULT_PREFERENCES[eventType];
    const sparse = sparseMap.get(eventType);
    preferences[eventType] = {
      inAppEnabled: sparse?.inAppEnabled ?? def.inAppEnabled,
      emailEnabled: sparse?.emailEnabled ?? def.emailEnabled,
    };
  }

  res.json({
    masterEmailEnabled: user?.notificationEmailEnabled ?? true,
    preferences,
  });
});

// PATCH /notifications/preferences
notificationsRouter.patch('/preferences', async (req: Request, res: Response): Promise<void> => {
  const eventTypeSchema = z.enum(notificationEventTypes as unknown as [string, ...string[]]);
  const parsed = z.object({
    masterEmailEnabled: z.boolean().optional(),
    preferences: z.record(eventTypeSchema, z.object({
      inAppEnabled: z.boolean().optional(),
      emailEnabled: z.boolean().optional(),
    })).optional(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const userId = req.user!.id;

  // Update master kill switch
  if (parsed.data.masterEmailEnabled !== undefined) {
    await dz.update(users)
      .set({ notificationEmailEnabled: parsed.data.masterEmailEnabled })
      .where(eq(users.id, userId));
  }

  // Update per-event preferences (sparse storage)
  if (parsed.data.preferences) {
    for (const [eventType, update] of Object.entries(parsed.data.preferences)) {
      if (!update) continue;
      const def = DEFAULT_PREFERENCES[eventType as NotificationEventType];
      if (!def) continue;

      // Get current sparse row
      const [existing] = await dz.select()
        .from(userNotificationPreferences)
        .where(and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.eventType, eventType),
        ));

      // Compute new effective values
      const newInApp = update.inAppEnabled ?? existing?.inAppEnabled ?? def.inAppEnabled;
      const newEmail = update.emailEnabled ?? existing?.emailEnabled ?? def.emailEnabled;

      // If matches default, delete the sparse row
      if (newInApp === def.inAppEnabled && newEmail === def.emailEnabled) {
        if (existing) {
          await dz.delete(userNotificationPreferences)
            .where(and(
              eq(userNotificationPreferences.userId, userId),
              eq(userNotificationPreferences.eventType, eventType),
            ));
        }
      } else {
        // Upsert
        if (existing) {
          await dz.update(userNotificationPreferences)
            .set({ inAppEnabled: newInApp, emailEnabled: newEmail })
            .where(and(
              eq(userNotificationPreferences.userId, userId),
              eq(userNotificationPreferences.eventType, eventType),
            ));
        } else {
          await dz.insert(userNotificationPreferences).values({
            userId,
            eventType,
            inAppEnabled: newInApp,
            emailEnabled: newEmail,
          });
        }
      }
    }
  }

  // Return updated full preference map (same as GET)
  const [user] = await dz.select({ notificationEmailEnabled: users.notificationEmailEnabled })
    .from(users)
    .where(eq(users.id, userId));

  const rows = await dz.select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));

  const sparseMap = new Map(rows.map(r => [r.eventType, r]));
  const preferences: Record<string, { inAppEnabled: boolean; emailEnabled: boolean }> = {};
  for (const eventType of notificationEventTypes) {
    const def = DEFAULT_PREFERENCES[eventType];
    const sparse = sparseMap.get(eventType);
    preferences[eventType] = {
      inAppEnabled: sparse?.inAppEnabled ?? def.inAppEnabled,
      emailEnabled: sparse?.emailEnabled ?? def.emailEnabled,
    };
  }

  res.json({
    masterEmailEnabled: user?.notificationEmailEnabled ?? true,
    preferences,
  });
});
