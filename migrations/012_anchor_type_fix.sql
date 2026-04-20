-- Drop the CHECK constraint on anchor_type so new anchor types (e.g. 'page') can
-- be added without a schema migration. Validation is enforced at the API layer only.

ALTER TABLE annotations
  DROP CONSTRAINT IF EXISTS annotations_anchor_type_check;
