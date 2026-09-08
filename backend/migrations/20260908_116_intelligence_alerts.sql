-- Near-real-time incident alert layer. Alerts are derived from public/authorized observations;
-- they are not treated as verified facts until corroborated.
CREATE TABLE IF NOT EXISTS intel_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  observation_id UUID REFERENCES intel_observations(id) ON DELETE SET NULL,
  source_id UUID REFERENCES intel_sources(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  summary TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 35,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  status TEXT NOT NULL DEFAULT 'open',
  country_code TEXT,
  region TEXT,
  location_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_count INTEGER NOT NULL DEFAULT 1,
  corroboration_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_alerts_org_recent ON intel_alerts(org_id,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_alerts_org_category ON intel_alerts(org_id,category,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_alerts_geo ON intel_alerts(org_id,country_code,region,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_alerts_open ON intel_alerts(org_id,status,last_seen_at DESC);
