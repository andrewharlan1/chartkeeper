-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE ensemble_role AS ENUM ('owner', 'editor', 'player');
CREATE TYPE omr_status AS ENUM ('pending', 'processing', 'complete', 'failed');
CREATE TYPE annotation_type AS ENUM ('dynamic', 'fingering', 'text', 'highlight', 'bowing', 'form_mark');
CREATE TYPE annotation_confidence AS ENUM ('high', 'low');
CREATE TYPE annotation_migration_status AS ENUM ('migrated', 'needs_review');

-- ============================================================
-- updated_at TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ensembles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ensemble_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ensemble_id UUID NOT NULL REFERENCES ensembles(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  role        ensemble_role NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ensemble_id, user_id)
);

CREATE TABLE charts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ensemble_id   UUID NOT NULL REFERENCES ensembles(id),
  title         TEXT,
  composer      TEXT,
  metadata_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chart_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id       UUID NOT NULL REFERENCES charts(id),
  version_number INT NOT NULL,
  version_name   TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chart_id, version_number)
);

CREATE TABLE parts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_version_id UUID NOT NULL REFERENCES chart_versions(id),
  instrument_name  TEXT NOT NULL,
  pdf_s3_key       TEXT NOT NULL,
  musicxml_s3_key  TEXT,
  omr_status       omr_status NOT NULL DEFAULT 'pending',
  omr_json         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE version_diffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id        UUID NOT NULL REFERENCES charts(id),
  from_version_id UUID NOT NULL REFERENCES chart_versions(id),
  to_version_id   UUID NOT NULL REFERENCES chart_versions(id),
  diff_json       JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_version_id, to_version_id)
);

CREATE TABLE annotations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id           UUID NOT NULL REFERENCES parts(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  type              annotation_type NOT NULL,
  content           TEXT,
  anchor_json       JSONB NOT NULL,
  page_position_json JSONB NOT NULL,
  confidence        annotation_confidence,
  migration_status  annotation_migration_status,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audio_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_version_id UUID NOT NULL REFERENCES chart_versions(id),
  label            TEXT,
  s3_key           TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  ensemble_id      UUID NOT NULL REFERENCES ensembles(id),
  chart_version_id UUID REFERENCES chart_versions(id),
  type             TEXT NOT NULL,
  message          TEXT NOT NULL,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- updated_at TRIGGERS
-- ============================================================

CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_ensembles
  BEFORE UPDATE ON ensembles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_ensemble_members
  BEFORE UPDATE ON ensemble_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_charts
  BEFORE UPDATE ON charts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_chart_versions
  BEFORE UPDATE ON chart_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_parts
  BEFORE UPDATE ON parts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_version_diffs
  BEFORE UPDATE ON version_diffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_annotations
  BEFORE UPDATE ON annotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_audio_attachments
  BEFORE UPDATE ON audio_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_notifications
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
