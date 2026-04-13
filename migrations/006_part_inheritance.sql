-- Part inheritance: allows a new version to carry forward unchanged parts
ALTER TABLE parts ADD COLUMN IF NOT EXISTS inherited_from_part_id UUID REFERENCES parts(id);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
