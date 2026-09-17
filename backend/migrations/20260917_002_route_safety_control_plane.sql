-- Route Safety Control Plane v2
ALTER TABLE route_analyses
  ADD COLUMN IF NOT EXISTS analysis_version TEXT NOT NULL DEFAULT 'route-safety-v2',
  ADD COLUMN IF NOT EXISTS routing_provider TEXT,
  ADD COLUMN IF NOT EXISTS route_status TEXT NOT NULL DEFAULT 'routed'
    CHECK (route_status IN ('routed','unrouted','blocked','degraded')),
  ADD COLUMN IF NOT EXISTS risk_zone_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS route_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_route_analyses_org_route_status
  ON route_analyses(org_id, route_status, analysed_at DESC);

CREATE INDEX IF NOT EXISTS idx_route_analyses_cache
  ON route_analyses(org_id, convoy_id, origin_lat, origin_lng, destination_lat, destination_lng, analysed_at DESC);


ALTER TABLE route_analyses ADD COLUMN IF NOT EXISTS safety_gate TEXT NOT NULL DEFAULT 'CONDITIONAL' CHECK (safety_gate IN ('GO','CONDITIONAL','NO_GO','HUMAN_REVIEW'));
ALTER TABLE route_analyses ADD COLUMN IF NOT EXISTS swarm JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_route_analyses_safety_gate ON route_analyses(org_id, safety_gate, analysed_at DESC);
