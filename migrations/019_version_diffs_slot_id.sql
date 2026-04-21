-- Migration 019: Add slot_id to version_diffs for per-instrument diff tracking
--
-- Previously diffs matched parts by filename. Now each diff is tied to
-- a specific instrument slot, enabling per-instrument diff computation.
-- slot_id is nullable: NULL means a score-level diff (no specific slot).

-- Step 1: Add the column as nullable
ALTER TABLE version_diffs
  ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES instrument_slots(id) ON DELETE CASCADE;

-- Step 2: Backfill from the first part-slot assignment of each target part
UPDATE version_diffs vd
SET slot_id = psa.instrument_slot_id
FROM (
  SELECT DISTINCT ON (part_id) part_id, instrument_slot_id
  FROM part_slot_assignments
  ORDER BY part_id, created_at ASC
) psa
WHERE vd.to_part_id = psa.part_id
  AND vd.slot_id IS NULL;

-- Step 3: Delete orphaned diffs where no slot assignment exists and the part is not a score
DELETE FROM version_diffs
WHERE slot_id IS NULL
  AND to_part_id NOT IN (
    SELECT id FROM parts WHERE kind = 'score'
  );

-- Step 4: Drop the old unique constraint and add the new one (target + slot)
ALTER TABLE version_diffs DROP CONSTRAINT IF EXISTS version_diffs_uniq;
ALTER TABLE version_diffs ADD CONSTRAINT version_diffs_target_slot_uniq UNIQUE (to_part_id, slot_id);

-- Step 5: Add index for slot-based lookups
CREATE INDEX IF NOT EXISTS version_diffs_slot_idx ON version_diffs(slot_id);
