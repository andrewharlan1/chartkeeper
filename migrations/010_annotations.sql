CREATE TABLE IF NOT EXISTS annotations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id                     UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anchor_type                 TEXT NOT NULL CHECK (anchor_type IN ('measure', 'beat', 'note', 'section')),
  anchor_json                 JSONB NOT NULL,
  content_type                TEXT NOT NULL CHECK (content_type IN ('text', 'ink', 'highlight')),
  content_json                JSONB NOT NULL,
  migrated_from_annotation_id UUID REFERENCES annotations(id),
  is_unresolved               BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS annotations_part_id_idx ON annotations(part_id) WHERE deleted_at IS NULL;
