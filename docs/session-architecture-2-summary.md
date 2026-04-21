# Architecture Session 2 Summary

**Date:** 2026-04-21
**Scope:** Users, Assignments, Instrument-Centric Chart Page, Notifications

## Commits

1. **Add user model with dummy users and team management** (`d3c2539`)
   - Migration 016: `is_dummy` boolean on users table
   - `POST /workspaces/:id/members` — creates user + workspace membership
   - `DELETE /workspaces/:id/members/:userId` — removes member
   - `POST /workspaces/:id/seed-dummies` — creates 5 test dummy users
   - Login rejects dummy users
   - Ensemble page: Team section with member list, add modal, seed button

2. **Add user assignments to instrument slots** (`a89075b`)
   - Migration 017: `instrument_slot_assignments` junction table (slot_id, user_id)
   - `GET /instrument-slots/assignments/by-ensemble` — bulk fetch all slot assignments
   - `POST /instrument-slots/:id/assignments` — assign user to slot
   - `DELETE /instrument-slots/:id/assignments/:userId` — unassign user
   - Ensemble page: assigned players shown under each instrument, inline assign/unassign dropdown

3. **Add dummy user impersonation with View As dropdown** (`1111ad5`)
   - `X-Impersonate-User-Id` header in auth middleware
   - Only workspace owners/admins can impersonate
   - API client sends header automatically from localStorage
   - Layout sidebar: "View As" dropdown lists all workspace members
   - Yellow impersonation banner with exit button

4. **Add instrument-grouped chart version endpoint** (`6589121`)
   - `GET /charts/:id/versions/:vId/instruments` — returns data grouped by instrument slot
   - Per-instrument: assigned users, current parts (annotation count, diff status), fallback parts from previous versions, score parts
   - Access control: non-admin users only see instruments they are assigned to
   - Frontend types and API function for the new endpoint

5. **Redesign chart page with instrument-centric layout** (`0635574`)
   - Version dropdown selector replaces version list
   - Instrument rows: State A (has content), State B (content in previous version only), State C (no content), State D (multiple parts)
   - Per-row actions: Open, Upload part
   - Score parts in dedicated "Shared with everyone" section
   - Empty state links to ensemble page for instrument setup

6. **Add in-app notifications with bell icon and panel** (`3166f58`)
   - Migration 018: `notifications` table with `notification_kind` enum
   - `notifyPartUploaded()` creates notifications for assigned users after upload (excludes uploader, excludes dummy users)
   - `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/mark-read`
   - Bell icon in top bar with unread count badge (polls every 60s)
   - Dropdown panel: notification list, time-ago formatting, click-to-navigate, clear all

## Schema Changes

- **Migration 016** (`016_user_model_dummy.sql`): `is_dummy` boolean on users
- **Migration 017** (`017_instrument_slot_assignments.sql`): junction table for users-to-instrument-slots
- **Migration 018** (`018_notifications.sql`): notifications table with kind enum and payload JSONB

## New Files

- `backend/src/lib/notify.ts` — notification generation logic
- `frontend/src/api/notifications.ts` — notification API client

## Test Status

- **12 suites pass** (auth, charts, ensembles, workspaces, instrumentSlots, versions, parts, annotations, annotation-migration, smoke integration, omr worker, annotation-content schema)
- **6 suites fail (pre-existing)**: pipeline integration (missing device_tokens table), deviceTokens (missing table), notifications lib test (references device_tokens), diff.test (type errors), vision-diff.test (vitest), diff.worker.test

## Confidence Level for Session 3

**High.** The foundational user/assignment model is in place and tested. The instrument-centric data layer is solid — per-instrument diff computation (Session 3) can build on the `GET /charts/:id/versions/:vId/instruments` endpoint by enhancing the diff queries. The access control pattern (filter by user assignments) is established and can be reused.

Key risks for Session 3:
- Diff engine currently compares files directly; needs to understand instrument continuity across versions
- May need to refactor `version_diffs` to be instrument-aware rather than part-pair-aware
- Performance testing with larger ensembles not yet done

## Deferred Items

- Real user email invitations (currently creates user without sending email)
- Drag-reorder instruments on Ensemble page
- Notification batching (multiple uploads in quick succession create individual notifications)
- `device_tokens` table and migration (for push notifications)
- Per-instrument inline upload from chart page (currently links to upload page)
