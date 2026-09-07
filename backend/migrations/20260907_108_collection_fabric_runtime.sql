-- Collection Fabric runtime support.
-- The collector updates observation recency and records each bounded run.
ALTER TABLE intel_observations ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS intel_observations_source_time ON intel_observations(org_id, source_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS intel_collection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  source_id UUID REFERENCES intel_sources(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed','cancelled')),
  observations_seen INTEGER NOT NULL DEFAULT 0,
  observations_inserted INTEGER NOT NULL DEFAULT 0,
  observations_duplicate INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS intel_collection_runs_org_time ON intel_collection_runs(org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS intel_collection_runs_source_time ON intel_collection_runs(source_id, started_at DESC);
ALTER TABLE intel_collection_runs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intel_collection_runs' AND policyname='intel_collection_runs_org_isolation') THEN
    CREATE POLICY intel_collection_runs_org_isolation ON intel_collection_runs
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON intel_collection_runs TO sonalit_app;
