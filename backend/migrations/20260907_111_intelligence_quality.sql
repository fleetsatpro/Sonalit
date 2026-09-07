-- Intelligence quality, corroboration and trajectory metrics.
-- Deterministic scores are advisory inputs; analyst review remains authoritative.
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (quality_score BETWEEN 0 AND 100);
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS contradiction_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (contradiction_score BETWEEN 0 AND 100);
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0);
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0);
ALTER TABLE intel_events ADD COLUMN IF NOT EXISTS manipulation_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (manipulation_score BETWEEN 0 AND 100);
CREATE INDEX IF NOT EXISTS intel_events_quality ON intel_events(org_id, quality_score DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_events_velocity ON intel_events(org_id, risk_velocity DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS intel_event_quality_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  quality_score NUMERIC(5,2) NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  contradiction_score NUMERIC(5,2) NOT NULL CHECK (contradiction_score BETWEEN 0 AND 100),
  risk_velocity NUMERIC(8,2) NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  observation_count INTEGER NOT NULL DEFAULT 0,
  drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(event_id, measured_at)
);
CREATE INDEX IF NOT EXISTS intel_event_quality_history_event ON intel_event_quality_history(event_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS intel_event_quality_history_org ON intel_event_quality_history(org_id, measured_at DESC);
ALTER TABLE intel_event_quality_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intel_event_quality_history' AND policyname='intel_event_quality_history_org_isolation') THEN
    CREATE POLICY intel_event_quality_history_org_isolation ON intel_event_quality_history USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON intel_event_quality_history TO sonalit_app;
