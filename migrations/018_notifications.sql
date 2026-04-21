-- In-app notifications for users.
-- Generated when content changes for instruments a user is assigned to.

CREATE TYPE IF NOT EXISTS notification_kind AS ENUM (
  'new_part_version',
  'assignment_added',
  'migration_complete'
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind notification_kind NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(user_id, read_at) WHERE read_at IS NULL;
