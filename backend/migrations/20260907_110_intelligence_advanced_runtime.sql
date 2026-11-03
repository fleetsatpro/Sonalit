-- Advanced Intelligence Runtime: entity resolution, event relationships and early warning state.
CREATE TABLE IF NOT EXISTS intel_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','organization','location','country','corridor','vehicle','group','topic','unknown')),
  canonical_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  country_code TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(org_id, entity_type, canonical_name)
);
CREATE INDEX IF NOT EXISTS intel_entities_org_type ON intel_entities(org_id, entity_type, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_entities_org_country ON intel_entities(org_id, country_code, last_seen_at DESC);
ALTER TABLE intel_entities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_observation_entities (
  observation_id UUID NOT NULL REFERENCES intel_observations(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES intel_entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'mentioned',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (confidence BETWEEN 0 AND 100),
  PRIMARY KEY(observation_id, entity_id)
);

CREATE TABLE IF NOT EXISTS intel_event_entities (
  event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES intel_entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'associated',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (confidence BETWEEN 0 AND 100),
  PRIMARY KEY(event_id, entity_id)
);

CREATE TABLE IF NOT EXISTS intel_event_links (
  from_event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  to_event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('related','spatial_cluster','temporal_cluster','escalation','same_story','possible_duplicate')),
  distance_km NUMERIC(10,3),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (confidence BETWEEN 0 AND 100),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(from_event_id, to_event_id, relationship),
  CHECK (from_event_id <> to_event_id)
);
CREATE INDEX IF NOT EXISTS intel_event_links_from ON intel_event_links(from_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intel_event_links_to ON intel_event_links(to_event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS intel_early_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  warning_type TEXT NOT NULL CHECK (warning_type IN ('spike','acceleration','geographic_spread','severity_shift','novel_actor','cross_domain','information_acceleration')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('country','region','corridor','entity','global')),
  scope_key TEXT NOT NULL,
  headline TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','moderate','low','informational')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  signal_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','review','acknowledged','dismissed','expired')),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, warning_type, scope_type, scope_key, first_detected_at)
);
CREATE INDEX IF NOT EXISTS intel_early_warnings_active ON intel_early_warnings(org_id, status, severity, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS intel_early_warnings_scope ON intel_early_warnings(org_id, scope_type, scope_key, last_detected_at DESC);
ALTER TABLE intel_early_warnings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['intel_entities','intel_early_warnings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t || '_org_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org_id'', true)::uuid)', t || '_org_isolation', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON intel_entities, intel_observation_entities, intel_event_entities, intel_event_links, intel_early_warnings TO sonalit_app;
