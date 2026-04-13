-- Allow parts without a PDF (link type, audio without S3 yet, etc.)
ALTER TABLE parts ALTER COLUMN pdf_s3_key DROP NOT NULL;

-- URL for link-type parts
ALTER TABLE parts ADD COLUMN IF NOT EXISTS url TEXT;

-- Band-leader can assign an instrument slot (by name) to a specific player
CREATE TABLE IF NOT EXISTS chart_part_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id     UUID NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
  instrument_name TEXT NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by  UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chart_id, instrument_name, user_id)
);
