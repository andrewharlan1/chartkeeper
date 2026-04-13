CREATE TYPE job_status AS ENUM ('pending', 'processing', 'complete', 'failed');

CREATE TABLE jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  status     job_status NOT NULL DEFAULT 'pending',
  attempts   INT NOT NULL DEFAULT 0,
  last_error TEXT,
  run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX jobs_pending_idx ON jobs (type, status, run_at)
  WHERE status = 'pending';

CREATE TRIGGER set_updated_at_jobs
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
