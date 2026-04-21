-- Expand part_kind enum from (part, score) to include chart, link, audio, other.
-- Add kind-specific nullable columns to parts table.

-- Safely add new enum values (idempotent with IF NOT EXISTS)
ALTER TYPE part_kind ADD VALUE IF NOT EXISTS 'chart';
ALTER TYPE part_kind ADD VALUE IF NOT EXISTS 'link';
ALTER TYPE part_kind ADD VALUE IF NOT EXISTS 'audio';
ALTER TYPE part_kind ADD VALUE IF NOT EXISTS 'other';

-- Make pdf_s3_key nullable (link-kind parts don't have files)
ALTER TABLE parts ALTER COLUMN pdf_s3_key DROP NOT NULL;

-- Kind-specific columns (all nullable — only relevant for certain kinds)
ALTER TABLE parts ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS audio_duration_seconds INTEGER;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS audio_mime_type TEXT;
