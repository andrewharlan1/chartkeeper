CREATE TYPE device_platform AS ENUM ('ios', 'web');

CREATE TABLE device_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  token        TEXT NOT NULL,
  platform     device_platform NOT NULL,
  web_endpoint TEXT,
  web_p256dh   TEXT,
  web_auth     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE TRIGGER set_updated_at_device_tokens
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
