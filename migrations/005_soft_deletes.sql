-- Add soft-delete support to charts and chart_versions
ALTER TABLE charts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chart_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
