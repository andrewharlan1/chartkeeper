# Notifications Buildout — Spec

**Status:** Spec complete, build queued for overnight session
**Date:** 2026-05-05
**Suggested repo path:** `docs/notifications-spec-2026-05-05.md`

## Summary

Full notifications system covering email + in-app delivery, smart batching with a 5-minute cluster window, all version events plus ensemble events plus read receipts, with per-event-type user toggles. Web push is deferred to a follow-up; the schema is designed so it can land without migration pain.

## Decisions

- **Channels:** Email + in-app. Web push deferred. Schema includes a `channel` enum that already accepts `'web_push'` so it can be added later without migration.
- **Batching:** Smart batching with a 5-minute cluster window. Events that arrive within 5 minutes of an existing pending notification of the same type for the same recipient cluster into a single delivered notification.
- **Event types covered in v1:**
  - `version_published` — director publishes a new version of a chart
  - `migration_complete` — annotation migration finished (any/partial success)
  - `migration_failed` — annotation migration failed entirely
  - `annotation_flagged` — annotation flagged for review (post-migration)
  - `member_added` — user added to ensemble
  - `role_changed` — user's role in ensemble changed
  - `ensemble_renamed` — ensemble renamed (ensemble_created is implicit on add)
  - `version_opened` — read receipt: a player opened a new version (director-side only)
- **Controls:** Per-event-type toggle in user settings. No per-ensemble muting in v1.

## Why these choices

- **Email + in-app** matches working musicians who often have the app closed but check email constantly. Web push requires PWA setup and explicit permission grants — heavier infra, defer.
- **5-minute smart batching** prevents the cascade problem during a busy revision cycle. A director who publishes 8 part versions in a 3-minute window produces 1 batched notification per recipient, not 8.
- **Read receipts as notifications** (Q3) means directors get pinged when players open new versions. This is noisy by default — see Decision A under "Notable nuances" for how it's tamed.
- **Per-event toggle** lets users turn off the channels they find noisy. Per-ensemble muting is a v1.5 enhancement.

## Notable nuances

**A. Read receipts are director-only by default and digest-batched.** When a player opens a new version, the director who published it gets a notification. Multiple players opening the same version in a short window cluster into one notification: "5 players have opened Flute v3." Players themselves do not receive read-receipt notifications. The `version_opened` toggle defaults OFF for non-directors so they never see it; it defaults ON for directors but they can disable it. Without this nuance, a 17-piece big band would generate 17 notifications per version.

**B. Cluster key.** The 5-minute window cluster key is `(recipient_user_id, event_type, ensemble_id)`. Different event types do not cluster together. A migration_complete and a version_published in the same window become two notifications, not one.

**C. Cluster behavior on email vs in-app.**
- In-app: cluster updates the existing notification's content and increments a count. The user sees one row that says "5 players opened Flute v3" instead of 5 separate rows.
- Email: cluster delays sending until the 5-minute window closes, then sends one email summarizing the cluster.

**D. Migration completion notifications use the cluster window for failure aggregation.** If migration_failed fires for source A and migration_complete fires for sources B and C within the same job, all three cluster into "Migration finished — 2 succeeded, 1 failed."

**E. Source users are not notified when their annotations are migrated by another player.** This is Decision 6.5 from the cross-instrument migration spec. Notifications fire for migration_complete to the *destination* user only.

**F. Toggle storage is sparse.** Defaults are stored in code, not DB. Only deviations from default are stored in `user_notification_preferences`. New users start with an empty row set; the system uses the code-side default for any preference not explicitly set. This avoids running a backfill migration when new event types are added later.

## Data model

### `notifications` table (new)

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'version_published', 'migration_complete', 'migration_failed',
    'annotation_flagged', 'member_added', 'role_changed',
    'ensemble_renamed', 'version_opened'
  )),
  ensemble_id UUID REFERENCES ensembles(id),
  payload JSONB NOT NULL,
  cluster_count INT NOT NULL DEFAULT 1,
  cluster_window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  delivered_email_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_cluster_window
  ON notifications (recipient_user_id, event_type, ensemble_id, cluster_window_started_at)
  WHERE delivered_email_at IS NULL;
```

`payload` is event-specific JSON. For `version_opened`: `{ partId, versionId, openerUserId, openerName }` (with cluster_count being how many distinct openers). For `migration_complete`: `{ partId, versionId, sourcesSucceeded, sourcesFailed, annotationsAdded }`. Etc.

`cluster_count` increments when an event clusters into an existing notification.

`cluster_window_started_at` is when the cluster opened; the worker computes "should this cluster?" by `NOW() - cluster_window_started_at < INTERVAL '5 minutes'`.

`delivered_email_at` is null until the email has been sent. The worker uses this to find clusters whose window has closed and email is pending.

### `user_notification_preferences` table (new)

```sql
CREATE TABLE user_notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, event_type)
);
```

Sparse. Only event types where the user has changed defaults appear here.

### Existing schema additions

Add `notification_email_enabled BOOLEAN NOT NULL DEFAULT TRUE` to `users`. Master kill switch — overrides per-event email toggles. If false, no emails to that user ever, regardless of per-event preferences.

## Server-side helper: `sendNotification(userId, event)`

This is the helper the cross-instrument migration worker already calls (currently stubbed). After this build, it becomes real.

```ts
async function sendNotification(
  recipientUserId: string,
  event: {
    eventType: NotificationEventType;
    ensembleId?: string;
    payload: object;
  }
): Promise<void>
```

Logic inside:

1. Resolve the user's preference for this event type (sparse table lookup, fall back to default).
2. If in-app disabled and email disabled, do nothing. Done.
3. Find an existing unsent-email notification with matching `(recipientUserId, eventType, ensembleId)` whose `cluster_window_started_at` is within the last 5 minutes.
4. If a cluster exists: increment `cluster_count`, merge payload (event-type-specific merge logic), do NOT create a new row. Push real-time event to in-app subscribers showing updated cluster.
5. If no cluster: insert new notification row. Push real-time event for in-app delivery (immediately for in-app — no batching delay there).
6. Email delivery is handled by a separate worker that polls for notifications where `cluster_window_started_at + 5 min < NOW()` and `delivered_email_at IS NULL`. That worker is the only thing that writes `delivered_email_at`.

**Why this split:** in-app is real-time (you see the row update as the cluster grows); email is delayed (you get one summary email after the window closes).

## Email worker (`notificationEmailWorker.ts`)

Polls every 30 seconds:

```sql
SELECT * FROM notifications
WHERE delivered_email_at IS NULL
  AND cluster_window_started_at + INTERVAL '5 minutes' < NOW()
ORDER BY cluster_window_started_at ASC
LIMIT 100
```

For each row:
1. Look up user's email preference and master kill switch. If email disabled, mark `delivered_email_at = NOW()` and skip sending (so it doesn't keep polling forever).
2. Compose email from event-type-specific template using `payload` and `cluster_count`.
3. Send via existing email infra (or stub if not yet shipped — see Section 6 of the build prompt).
4. Mark `delivered_email_at = NOW()`.

## Real-time channel for in-app

Topic: `user:${userId}:notifications`. Events:
- `notification.created` — new row inserted
- `notification.clustered` — existing row's count incremented

Frontend `NotificationContext` subscribes on mount and updates badge count + inbox in real time.

## API surface

### `GET /api/notifications`

Returns recent notifications for the current user. Defaults to last 50, paginated.

Response:
```ts
{
  notifications: Array<{
    id: string;
    eventType: NotificationEventType;
    ensembleId?: string;
    ensembleName?: string;       // server-resolved
    payload: object;             // event-specific
    clusterCount: number;
    readAt?: string;
    createdAt: string;
    deepLink?: string;           // server-computed where to navigate on click
  }>;
  unreadCount: number;
  nextCursor?: string;
}
```

### `POST /api/notifications/:id/read`

Marks one notification as read. Body empty. Returns updated notification.

### `POST /api/notifications/read-all`

Marks all unread notifications as read.

### `GET /api/notifications/preferences`

Returns the user's full preference map. Server merges sparse DB rows with defaults so the client receives a complete map.

```ts
{
  masterEmailEnabled: boolean;
  preferences: Record<NotificationEventType, {
    inAppEnabled: boolean;
    emailEnabled: boolean;
  }>;
}
```

### `PATCH /api/notifications/preferences`

Body:
```ts
{
  masterEmailEnabled?: boolean;
  preferences?: Partial<Record<NotificationEventType, {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
  }>>;
}
```

Updates the sparse table. If a preference matches the default, delete the row instead of inserting (keeps storage sparse).

## Frontend surface

### Existing
- Notifications inbox page (Phase 9 basic version) — extend, don't rebuild

### New components
- `NotificationContext` — top-level provider managing badge count, inbox cache, real-time subscription
- `NotificationBadge` — bell icon with unread count, in app chrome
- `NotificationInbox` — full inbox page, filter chips by event type, "Mark all read" action
- `NotificationRow` — single row rendering, including cluster summary ("5 players opened Flute v3"), event-type icon, time-ago, deep-link click handler
- `NotificationPreferences` — settings page with grouped toggles per event type and master email kill switch

### Modified components
- App chrome — add bell icon next to user menu (sibling to migration progress badge from earlier today)
- User settings page — add "Notifications" tab linking to NotificationPreferences

## Out of scope (explicit)

- Web push (deferred — schema accommodates, infra not yet built)
- Per-ensemble muting (v1.5)
- Per-channel cluster window tuning (5 min is hardcoded for v1)
- Notification archive / history search beyond paginated inbox
- Push to mobile via APNs (paired with Capacitor work, not now)
- Notification sound preferences
- Slack / Discord / SMS integrations

## Open questions for build time

1. **Email infrastructure.** Does an email-sending helper exist in the codebase? (e.g., SendGrid, Postmark, AWS SES). If not, stub the `sendEmail()` function with a console.log + TODO and proceed. Don't block on email infra setup.
2. **Real-time channel layer.** If the websocket / pub-sub layer doesn't exist, fall back to client-side polling of `GET /api/notifications` every 15s while the app is in focus. Document in build summary.
3. **Email template language.** Markdown? HTML? Plain text? Pick simplest that works (likely HTML with inline styles for one-off templates) and build for one event type, then template-ize.
4. **Master kill switch UI placement.** Top of the preferences page vs. user settings root. Build decision.
5. **What does "ensemble_created" map to?** Decision says ensemble_created is implicit on `member_added` (you're added to a brand-new ensemble that nobody else is in yet). Confirm that's the right mental model during build.

## Calibration estimate

One overnight session, 4–6 hours of Claude Code time. Schema is straightforward. The clustering worker logic is the most novel piece. Frontend is mostly extending an existing inbox page.

## Sign-off

Four user-facing decisions plus six derived nuances. Schema designed to absorb web push (channel enum), per-ensemble muting (preferences table can extend to scope by ensemble_id), and additional event types (sparse preferences) without future migrations.
