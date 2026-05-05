-- Cross-instrument annotation migration support
-- Adds migration_source_kind enum, needs_review boolean, and migratable boolean

DO $$ BEGIN
  CREATE TYPE migration_source_kind AS ENUM ('same_instrument', 'cross_instrument');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS migration_source_kind migration_source_kind,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS migratable BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS annotations_needs_review_idx
  ON annotations (part_id)
  WHERE needs_review = TRUE;

CREATE INDEX IF NOT EXISTS annotations_migratable_idx
  ON annotations (part_id, migratable)
  WHERE deleted_at IS NULL;
