CREATE TABLE IF NOT EXISTS ensemble_instruments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ensemble_id    UUID NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  display_order  INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ensemble_id, name)
);
