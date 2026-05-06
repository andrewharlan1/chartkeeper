# Notifications Buildout — Build Summary

**Status:** Complete
**Date:** 2026-05-05
**Spec:** `docs/notifications-spec-2026-05-05.md`

## What Was Built

Full notifications system with smart 5-minute cluster batching, 8 event types, per-event user preferences, email worker, and updated frontend inbox.

## Schema

**Migration:** `migrations/023_notifications_full_buildout.sql`

- Added `notification_email_enabled` (boolean) to `users` table (master email kill switch)
- Rebuilt `notifications` table: `event_type` text column, `ensemble_id`, `cluster_count`, `cluster_window_started_at`, `delivered_email_at`, `deep_link`, `payload` JSONB
- Created `user_notification_preferences` table (sparse storage — only deviations from code-side defaults)
- Migrated data from old `kind` enum to new `event_type` text
- Dropped old `notification_kind` enum and stale trigger

## Backend

### Core (`backend/src/notifications/`)

| File | Purpose |
|------|---------|
| `defaults.ts` | `DEFAULT_PREFERENCES` map + `EVENT_TYPE_LABELS` |
| `send.ts` | `sendNotification()` — preference check, directorOnly gating, 5-min cluster lookup, payload merge |
| `email.ts` | `composeEmailForNotification()` templates + stub `sendEmail()` |
| `index.ts` | Barrel export |

### Cluster logic

- Key: `(recipient_user_id, event_type, ensemble_id)`
- Window: 5 minutes from `cluster_window_started_at`
- Payload merge per event type:
  - `version_opened`: accumulates `openerNames[]`
  - `migration_complete`: sums `sourcesSucceeded`, `sourcesFailed`, `annotationsAdded`
  - `version_published`: accumulates `partNames[]`
  - Others: last-write-wins

### API (`backend/src/routes/notifications.ts`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/notifications` | GET | Cursor-paginated list with eventType filter, ensemble name join, unreadCount |
| `/notifications/:id/read` | POST | Mark single read |
| `/notifications/read-all` | POST | Mark all read, returns count |
| `/notifications/mark-read` | POST | Backward compat (accepts `ids` array) |
| `/notifications/preferences` | GET | Full merged preference map (defaults + overrides) |
| `/notifications/preferences` | PATCH | Sparse upsert; setting back to default deletes the row |

### Event Sources Wired

| Event type | Source location |
|------------|----------------|
| `version_published` | `backend/src/lib/notify.ts` → `notifyPartUploaded` |
| `migration_complete` | `backend/src/workers/migration.worker.ts` |
| `migration_failed` | `backend/src/workers/migration.worker.ts` |
| `member_added` | `backend/src/routes/instrumentSlots.ts` + `backend/src/lib/notify.ts` |
| `role_changed` | (ready to wire when role-change endpoint is added) |
| `ensemble_renamed` | `backend/src/routes/ensembles.ts` PATCH |
| `version_opened` | `backend/src/routes/versions.ts` POST /:id/opened |
| `annotation_flagged` | (ready to wire when flag endpoint is added) |

### Email Worker (`backend/src/workers/notificationEmail.worker.ts`)

- Polls every 30s for notifications where cluster window closed (5+ min old) and `delivered_email_at` is null
- Checks master email kill switch per user
- Checks per-event email preference
- Composes and sends email, marks `delivered_email_at`
- Script: `npm run worker:email`

### Tests (`backend/src/__tests__/notifications.test.ts`)

13 test cases, all passing:
1. Direct event delivery
2. Cluster within window
3. Cluster across window boundary (separate rows)
4. Different event types don't cluster
5. DirectorOnly skips non-directors
6. DirectorOnly fires for directors
7. Master email kill switch
8. Per-event email preference
9. In-app off, email on (row still created)
10. Both off (no row)
11. Sparse preference reset removes row
12. `version_opened` openerNames merge
13. `migration_complete` numeric field summing

## Frontend

### NotificationContext (`frontend/src/contexts/NotificationContext.tsx`)

- Provider wraps entire app (in App.tsx)
- 15-second polling fallback (no websocket)
- Cursor-based pagination (`loadMore`)
- Optimistic mark-read with rollback on failure

### Notifications Page (`frontend/src/pages/Notifications.tsx`)

- Filter chips: All, Unread, Published, Migration, Failed, Flagged, Members, Opened
- Uses `NotificationRow` component with event-type icons and cluster-aware titles
- Mark all read button, Load more pagination
- Link to preferences page

### NotificationRow (`frontend/src/components/notifications/NotificationRow.tsx`)

- Event-type icons (unicode symbols)
- `getNotificationTitle()` — exported, cluster-aware text (e.g., "5 parts published for Chart X")
- `getNotificationSub()` — secondary line (ensemble name, opener list, error)
- Relative time display

### NotificationPreferences Page (`frontend/src/pages/NotificationPreferences.tsx`)

- Route: `/settings/notifications`
- Master email toggle
- Per-event-type in-app/email checkboxes in a grid
- Immediate save on toggle

### Layout Bell Icon (`frontend/src/components/Layout.tsx`)

- Migrated from local polling to `useNotifications()` context
- Uses `getNotificationTitle()` for notification text
- Deep link navigation on click
- "View all notifications" link at bottom of dropdown

## Type Check

Both `frontend` and `backend` compile cleanly (`tsc --noEmit` passes with zero errors).

## Known Pre-Existing Issues (Not Caused by This Build)

- 3 test suites (diff.test.ts, diff.worker.test.ts, pipeline.integration.test.ts) fail with unrelated diff logic errors — pre-existing before notification work began.

## What's Deferred

- Web push (schema ready with `channel` enum extensibility)
- Per-ensemble notification muting
- `annotation_flagged` and `role_changed` event sources (endpoints don't exist yet — `sendNotification` calls ready to drop in)
- Real email transport (currently `console.log` stub in `sendEmail()`)
