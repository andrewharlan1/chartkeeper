-- Score Editor Slice 1: personal version columns + edit_operations table
-- See docs/score-editor-spec-2026-05-05.md

-- Add personal version and editor columns to versions table
ALTER TABLE versions
  ADD COLUMN private_owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN branch_label TEXT,
  ADD COLUMN parent_version_id UUID REFERENCES versions(id) ON DELETE SET NULL,
  ADD COLUMN edit_origin TEXT
    CHECK (edit_origin IN ('upload', 'editor_director', 'editor_player')),
  ADD COLUMN musicxml_blob TEXT,
  ADD COLUMN pdf_render_status TEXT
    CHECK (pdf_render_status IN ('pending', 'rendering', 'complete', 'failed'))
    DEFAULT 'complete';

-- Backfill: existing versions are uploads with status complete
UPDATE versions SET edit_origin = 'upload' WHERE edit_origin IS NULL;
ALTER TABLE versions ALTER COLUMN edit_origin SET NOT NULL;

-- Partial index for personal version queries (only rows with a private owner)
CREATE INDEX idx_versions_private_owner
  ON versions (chart_id, private_owner_user_id)
  WHERE private_owner_user_id IS NOT NULL;

-- Edit operations audit log
CREATE TABLE edit_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  parent_version_id UUID NOT NULL REFERENCES versions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  natural_language_input TEXT,
  operation_json JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_edit_operations_version
  ON edit_operations (version_id);
