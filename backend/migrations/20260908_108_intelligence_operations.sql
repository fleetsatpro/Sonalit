-- Intelligence operations layer: gaps, storylines, forecasts and publication governance.
-- Idempotent. Admin-only route enforcement + org RLS keep the surface private.

CREATE TABLE IF NOT EXISTS intel_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  gap_type TEXT NOT NULL CHECK (gap_type IN ('missing_observation','stale_observation','unresolved_contradiction','poor_geolocation','missing_independent_source','provider_unavailable','other')),
  title TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','country','region','corridor','route','event','entity')),
  scope_key TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','tasked','monitoring','resolved','accepted')),
  recommended_action TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_gaps_queue ON intel_gaps(org_id,status,priority,created_at DESC);
CREATE INDEX IF NOT EXISTS intel_gaps_scope ON intel_gaps(org_id,scope_type,scope_key);
ALTER TABLE intel_gaps ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_storylines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','watch','closed','archived')),
  severity TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('critical','high','moderate','low','informational')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','country','region','corridor','route','event','entity')),
  scope_key TEXT,
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessment TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id,reference)
);
CREATE INDEX IF NOT EXISTS intel_storylines_active ON intel_storylines(org_id,status,updated_at DESC);
ALTER TABLE intel_storylines ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_storyline_events (
  storyline_id UUID NOT NULL REFERENCES intel_storylines(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES intel_events(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  relationship TEXT NOT NULL DEFAULT 'develops' CHECK (relationship IN ('develops','supports','contradicts','context')),
  PRIMARY KEY(storyline_id,event_id)
);

CREATE TABLE IF NOT EXISTS intel_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','country','region','corridor','route','event')),
  scope_key TEXT,
  horizon TEXT NOT NULL,
  scenario TEXT NOT NULL,
  probability NUMERIC(5,2) CHECK (probability BETWEEN 0 AND 100),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  judgement TEXT NOT NULL,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation_triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','verified','expired','superseded')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_forecasts_scope ON intel_forecasts(org_id,scope_type,scope_key,valid_until DESC);
ALTER TABLE intel_forecasts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_publication_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  publication_id UUID NOT NULL REFERENCES intel_publications(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('submit','approve','reject','withdraw','request_changes')),
  reviewer_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_publication_reviews_pub ON intel_publication_reviews(org_id,publication_id,created_at DESC);
ALTER TABLE intel_publication_reviews ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['intel_gaps','intel_storylines','intel_forecasts','intel_publication_reviews'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t || '_org_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org_id'', true)::uuid)', t || '_org_isolation', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON intel_gaps,intel_storylines,intel_storyline_events,intel_forecasts,intel_publication_reviews TO sonalit_app;
