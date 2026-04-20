-- Structured log of every Vision API call for observability and cost tracking.
-- Query this table to spot accuracy regressions, cost spikes, and latency outliers.

CREATE TABLE IF NOT EXISTS vision_call_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id             UUID REFERENCES parts(id) ON DELETE SET NULL,
  from_version_id     UUID REFERENCES chart_versions(id) ON DELETE SET NULL,
  to_version_id       UUID REFERENCES chart_versions(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  input_tokens        INT,
  output_tokens       INT,
  latency_ms          INT NOT NULL,
  overall_confidence  NUMERIC,
  success             BOOLEAN NOT NULL,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vision_call_logs_created_at_idx ON vision_call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS vision_call_logs_to_version_idx ON vision_call_logs(to_version_id);
