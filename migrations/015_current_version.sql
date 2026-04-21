-- Add is_current flag to versions table.
-- At most one version per chart should have is_current = true at any time.
-- This is enforced at the application layer, not as a database constraint.

ALTER TABLE versions ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

-- Set the most recent version per chart as current (initial backfill)
UPDATE versions v
SET is_current = true
WHERE v.id = (
  SELECT id FROM versions v2
  WHERE v2.chart_id = v.chart_id AND v2.deleted_at IS NULL
  ORDER BY v2.sort_order DESC
  LIMIT 1
);
