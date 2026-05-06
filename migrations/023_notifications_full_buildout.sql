-- Full notifications buildout: extend notifications table, add preferences, add email kill switch.
-- See docs/notifications-spec-2026-05-05.md for design rationale.

-- 1. Add master email kill switch to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_email_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Add new columns to notifications table
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS ensemble_id UUID REFERENCES ensembles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cluster_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cluster_window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS delivered_email_at TIMESTAMPTZ;

-- 3. Migrate old kind → event_type
UPDATE notifications SET event_type = CASE
  WHEN kind = 'new_part_version' THEN 'version_published'
  WHEN kind = 'assignment_added' THEN 'member_added'
  WHEN kind = 'migration_complete' THEN 'migration_complete'
  ELSE 'version_published'
END
WHERE event_type IS NULL;

-- 4. Make event_type NOT NULL + add CHECK constraint
ALTER TABLE notifications ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE notifications ADD CONSTRAINT notifications_event_type_check
  CHECK (event_type IN (
    'version_published', 'migration_complete', 'migration_failed',
    'annotation_flagged', 'member_added', 'role_changed',
    'ensemble_renamed', 'version_opened'
  ));

-- 5. Rename user_id → recipient_user_id
ALTER TABLE notifications RENAME COLUMN user_id TO recipient_user_id;

-- 6. Drop old kind column (after data migration)
ALTER TABLE notifications DROP COLUMN IF EXISTS kind;

-- 7. Indexes for efficient queries
DROP INDEX IF EXISTS notifications_user_idx;
DROP INDEX IF EXISTS notifications_user_unread_idx;

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_cluster_window
  ON notifications (recipient_user_id, event_type, ensemble_id, cluster_window_started_at)
  WHERE delivered_email_at IS NULL;

CREATE INDEX idx_notifications_email_pending
  ON notifications (cluster_window_started_at)
  WHERE delivered_email_at IS NULL;

CREATE INDEX idx_notifications_recipient_created
  ON notifications (recipient_user_id, created_at DESC);

-- 8. User notification preferences (sparse — only deviations from default)
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, event_type)
);

-- 9. Drop old notification_kind enum if no longer used
-- (Safe: we removed the 'kind' column above)
DROP TYPE IF EXISTS notification_kind;

-- 10. Drop stale updated_at trigger (notifications table has no updated_at column)
DROP TRIGGER IF EXISTS set_updated_at_notifications ON notifications;
