-- Route Safety Scoring — analysis persistence table
-- Idempotent.

CREATE TABLE IF NOT EXISTS route_analyses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL,
  convoy_id           UUID        REFERENCES convoys(id) ON DELETE SET NULL,
  origin_lat          DECIMAL(10,7) NOT NULL,
  origin_lng          DECIMAL(10,7) NOT NULL,
  destination_lat     DECIMAL(10,7) NOT NULL,
  destination_lng     DECIMAL(10,7) NOT NULL,
  overall_risk_score  NUMERIC(5,2) NOT NULL CHECK (overall_risk_score >= 0 AND overall_risk_score <= 100),
  primary_risk_factors JSONB NOT NULL DEFAULT '[]',
  recommended_route   JSONB NOT NULL DEFAULT '{}',
  alternate_routes    JSONB NOT NULL DEFAULT '[]',
  ai_summary          TEXT,
  requested_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  analysed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_analyses_org
  ON route_analyses(org_id, analysed_at DESC);

CREATE INDEX IF NOT EXISTS idx_route_analyses_convoy
  ON route_analyses(convoy_id)
  WHERE convoy_id IS NOT NULL;

-- RLS
ALTER TABLE route_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_analyses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON route_analyses;
CREATE POLICY org_isolation ON route_analyses
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON route_analyses TO sonalit_app;
