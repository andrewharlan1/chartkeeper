-- Junction table: which users are assigned to which instrument slots.
-- Many-to-many: a user can play multiple instruments, an instrument can have multiple players.

CREATE TABLE IF NOT EXISTS instrument_slot_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES instrument_slots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS instrument_slot_assignments_slot_idx ON instrument_slot_assignments(slot_id);
CREATE INDEX IF NOT EXISTS instrument_slot_assignments_user_idx ON instrument_slot_assignments(user_id);
