-- @sonalit-reconcile-always
-- Sonalit intelligence schema certification replay.
-- This reconciliation intentionally runs even when schema_migrations says the
-- historical migrations were applied. It repairs physical-schema drift after
-- restores/imports without rewriting migration history.

-- Recreate the Intelligence tables when the physical schema is missing them.
-- These definitions mirror the original 107/108 contracts and are additive.
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
  credibility NUMERIC(5,2) DEFAULT 50,
  manipulation_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  severity TEXT NOT NULL DEFAULT 'moderate',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
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

CREATE TABLE IF NOT EXISTS intel_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  gap_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL,
  scope_key TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  recommended_action TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_storylines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  severity TEXT NOT NULL DEFAULT 'moderate',
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_key TEXT,
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_storyline_events (
  storyline_id UUID NOT NULL REFERENCES intel_storylines(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  relationship TEXT NOT NULL DEFAULT 'develops',
  PRIMARY KEY(storyline_id,event_id)
);

CREATE TABLE IF NOT EXISTS intel_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  scope_type TEXT NOT NULL,
  scope_key TEXT,
  horizon TEXT NOT NULL,
  scenario TEXT NOT NULL,
  probability NUMERIC(5,2),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  judgement TEXT NOT NULL,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_publication_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  publication_id UUID NOT NULL REFERENCES intel_publications(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reviewer_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Complete/repair columns for installations where the tables existed partially.
ALTER TABLE IF EXISTS intel_events
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'moderate',
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS intel_observations
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES intel_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS credibility NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS manipulation_score NUMERIC(5,2) DEFAULT 0;

ALTER TABLE IF EXISTS intel_gaps
  ADD COLUMN IF NOT EXISTS gap_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE IF EXISTS intel_storylines
  ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT 'UNREFERENCED',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'moderate',
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50;

ALTER TABLE IF EXISTS intel_storyline_events
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT 'develops';

ALTER TABLE IF EXISTS intel_forecasts
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS horizon TEXT NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE IF EXISTS intel_publication_reviews
  ADD COLUMN IF NOT EXISTS org_id UUID,
  ADD COLUMN IF NOT EXISTS publication_id UUID,
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'request_changes',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS intel_events_org_time ON intel_events(org_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_observations_org_time ON intel_observations(org_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS intel_gaps_queue ON intel_gaps(org_id, status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS intel_storylines_active ON intel_storylines(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS intel_forecasts_scope ON intel_forecasts(org_id, scope_type, scope_key, valid_until DESC);
CREATE INDEX IF NOT EXISTS intel_publication_reviews_pub ON intel_publication_reviews(org_id, publication_id, created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_schema_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO intelligence_schema_reconciliations (migration_name, details)
VALUES ('20260908_114_intelligence_schema_reconciliation_certification', jsonb_build_object('mode','certification_replay','data_destructive',false))
ON CONFLICT (migration_name) DO NOTHING;

DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM (
    VALUES
      ('intel_events','id'),('intel_events','org_id'),('intel_events','country_code'),('intel_events','severity'),('intel_events','confidence'),('intel_events','last_seen_at'),
      ('intel_observations','id'),('intel_observations','org_id'),('intel_observations','source_id'),('intel_observations','observed_at'),('intel_observations','credibility'),('intel_observations','manipulation_score'),
      ('intel_gaps','id'),('intel_gaps','org_id'),('intel_gaps','gap_type'),('intel_gaps','status'),('intel_gaps','priority'),
      ('intel_storylines','id'),('intel_storylines','org_id'),('intel_storylines','reference'),('intel_storylines','status'),('intel_storylines','severity'),('intel_storylines','confidence'),
      ('intel_storyline_events','storyline_id'),('intel_storyline_events','event_id'),('intel_storyline_events','sequence_no'),('intel_storyline_events','relationship'),
      ('intel_forecasts','id'),('intel_forecasts','org_id'),('intel_forecasts','scope_type'),('intel_forecasts','horizon'),('intel_forecasts','probability'),('intel_forecasts','confidence'),('intel_forecasts','status'),
      ('intel_publication_reviews','id'),('intel_publication_reviews','org_id'),('intel_publication_reviews','publication_id'),('intel_publication_reviews','action'),('intel_publication_reviews','created_at')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=required.table_name AND c.column_name=required.column_name
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Intelligence schema certification failed: % required columns remain missing', missing_count;
  END IF;
END $$;
