-- Ensure source tracking columns exist (previously only in Drizzle schema via push)
ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS source_annotation_id UUID REFERENCES annotations(id),
  ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES versions(id);
