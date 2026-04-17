CREATE TABLE IF NOT EXISTS ensemble_instrument_assignments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ensemble_instrument_id UUID NOT NULL REFERENCES ensemble_instruments(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by            UUID NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ensemble_instrument_id, user_id)
);
