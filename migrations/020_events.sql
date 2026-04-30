CREATE TYPE event_type AS ENUM ('gig', 'rehearsal', 'recording', 'workshop', 'other');

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ensemble_id UUID NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type event_type NOT NULL DEFAULT 'gig',
  starts_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  notes TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_events_ensemble_id ON events(ensemble_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_starts_at ON events(starts_at) WHERE deleted_at IS NULL;

CREATE TABLE event_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  chart_id UUID NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, chart_id)
);

CREATE INDEX idx_event_charts_event_id ON event_charts(event_id);
CREATE INDEX idx_event_charts_chart_id ON event_charts(chart_id);
