-- Sonalit Intelligence Platform foundation
-- Information -> verification -> fusion -> assessment -> forecast -> dissemination.
-- Idempotent. Admin-only product surface is enforced at the route layer; org isolation is enforced here.

CREATE TABLE IF NOT EXISTS intel_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('news','social','government','humanitarian','sensor','database','rss','other')),
  provider TEXT,
  endpoint TEXT,
  reliability NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (reliability BETWEEN 0 AND 100),
  bias_score NUMERIC(5,2) DEFAULT 50 CHECK (bias_score BETWEEN 0 AND 100),
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_sources_org_active ON intel_sources(org_id, active);
ALTER TABLE intel_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  source_id UUID REFERENCES intel_sources(id) ON DELETE SET NULL,
  external_id TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  title TEXT,
  body TEXT,
  url TEXT,
  language TEXT,
  country_code TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  content_hash TEXT,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  credibility NUMERIC(5,2) DEFAULT 50 CHECK (credibility BETWEEN 0 AND 100),
  manipulation_score NUMERIC(5,2) DEFAULT 0 CHECK (manipulation_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, source_id, external_id)
);
CREATE INDEX IF NOT EXISTS intel_observations_org_time ON intel_observations(org_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS intel_observations_country_time ON intel_observations(org_id, country_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS intel_observations_hash ON intel_observations(org_id, content_hash);
ALTER TABLE intel_observations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','validating','fused','assessed','warned','closed')),
  severity TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('critical','high','moderate','low','informational')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  country_code TEXT,
  region TEXT,
  occurred_from TIMESTAMPTZ,
  occurred_to TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  risk_velocity NUMERIC(8,2) DEFAULT 0,
  indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_events_org_time ON intel_events(org_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_events_country_time ON intel_events(org_id, country_code, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_events_severity ON intel_events(org_id, severity, status);
ALTER TABLE intel_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_event_observations (
  event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  observation_id UUID NOT NULL REFERENCES intel_observations(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'supports' CHECK (relationship IN ('supports','contradicts','duplicates','context')),
  weight NUMERIC(5,2) DEFAULT 50 CHECK (weight BETWEEN 0 AND 100),
  PRIMARY KEY(event_id, observation_id)
);

CREATE TABLE IF NOT EXISTS intel_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('country','region','corridor','route','event','global')),
  scope_key TEXT NOT NULL,
  assessment_type TEXT NOT NULL CHECK (assessment_type IN ('situation','threat','risk','forecast','early_warning','exposure')),
  headline TEXT NOT NULL,
  judgement TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('critical','high','moderate','low','informational')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  validity_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  validity_end TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  downgrade_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  upgrade_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyst_status TEXT NOT NULL DEFAULT 'ai_draft' CHECK (analyst_status IN ('ai_draft','analyst_review','verified','rejected','superseded')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_assessments_scope ON intel_assessments(org_id, scope_type, scope_key, validity_start DESC);
ALTER TABLE intel_assessments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  country_code TEXT NOT NULL,
  publication_type TEXT NOT NULL CHECK (publication_type IN ('daily','weekly','monthly','flash','crisis','country_profile','route_assessment','executive_brief','custom')),
  title TEXT NOT NULL,
  subtitle TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','superseded','withdrawn')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  executive_assessment TEXT,
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  map_layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(5,2),
  version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_publications_country ON intel_publications(org_id, country_code, publication_type, period_end DESC);
ALTER TABLE intel_publications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  country_code TEXT NOT NULL,
  destination TEXT,
  traveller_profile TEXT NOT NULL DEFAULT 'general',
  advisory_level TEXT NOT NULL DEFAULT 'caution' CHECK (advisory_level IN ('avoid','reconsider','caution','normal')),
  confidence NUMERIC(5,2) DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','expired')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_advisories_country ON intel_advisories(org_id, country_code, valid_until DESC);
ALTER TABLE intel_advisories ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','collecting','answered','closed')),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  answer TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  due_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, reference)
);
CREATE INDEX IF NOT EXISTS intel_requirements_status ON intel_requirements(org_id, status, priority);
ALTER TABLE intel_requirements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  watch_type TEXT NOT NULL CHECK (watch_type IN ('country','region','entity','corridor','keyword','topic')),
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity_floor TEXT DEFAULT 'moderate',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_watchlists_active ON intel_watchlists(org_id, active);
ALTER TABLE intel_watchlists ENABLE ROW LEVEL SECURITY;

-- Reusable org isolation policy helper.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['intel_sources','intel_observations','intel_events','intel_assessments','intel_publications','intel_advisories','intel_requirements','intel_watchlists'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t || '_org_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org_id'', true)::uuid)', t || '_org_isolation', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON intel_sources, intel_observations, intel_events, intel_event_observations,
  intel_assessments, intel_publications, intel_advisories, intel_requirements, intel_watchlists TO sonalit_app;
