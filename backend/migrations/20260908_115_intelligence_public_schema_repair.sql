-- @sonalit-reconcile-always
-- Final physical-schema repair. Every object is explicitly qualified as
-- public because production certification is explicitly against public.

CREATE TABLE IF NOT EXISTS public.intel_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, country_code TEXT, severity TEXT NOT NULL DEFAULT 'moderate', confidence NUMERIC(5,2) NOT NULL DEFAULT 50, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.intel_observations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, source_id UUID, observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), credibility NUMERIC(5,2) DEFAULT 50, manipulation_score NUMERIC(5,2) DEFAULT 0);
CREATE TABLE IF NOT EXISTS public.intel_gaps (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, gap_type TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'medium');
CREATE TABLE IF NOT EXISTS public.intel_storylines (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, reference TEXT NOT NULL DEFAULT 'UNREFERENCED', status TEXT NOT NULL DEFAULT 'active', severity TEXT NOT NULL DEFAULT 'moderate', confidence NUMERIC(5,2) NOT NULL DEFAULT 50);
CREATE TABLE IF NOT EXISTS public.intel_storyline_events (storyline_id UUID, event_id UUID, sequence_no INTEGER NOT NULL DEFAULT 0, relationship TEXT NOT NULL DEFAULT 'develops');
CREATE TABLE IF NOT EXISTS public.intel_forecasts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, scope_type TEXT NOT NULL DEFAULT 'global', horizon TEXT NOT NULL DEFAULT 'unspecified', probability NUMERIC(5,2), confidence NUMERIC(5,2) NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'draft');
CREATE TABLE IF NOT EXISTS public.intel_publication_reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, publication_id UUID, action TEXT NOT NULL DEFAULT 'request_changes', created_at TIMESTAMPTZ NOT NULL DEFAULT now());

ALTER TABLE public.intel_events ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS org_id UUID, ADD COLUMN IF NOT EXISTS country_code TEXT, ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'moderate', ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50, ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.intel_observations ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS source_id UUID, ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS credibility NUMERIC(5,2) DEFAULT 50, ADD COLUMN IF NOT EXISTS manipulation_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE public.intel_gaps ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS org_id UUID, ADD COLUMN IF NOT EXISTS gap_type TEXT NOT NULL DEFAULT 'other', ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open', ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE public.intel_storylines ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS org_id UUID, ADD COLUMN IF NOT EXISTS reference TEXT NOT NULL DEFAULT 'UNREFERENCED', ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active', ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'moderate', ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50;
ALTER TABLE public.intel_storyline_events ADD COLUMN IF NOT EXISTS storyline_id UUID, ADD COLUMN IF NOT EXISTS event_id UUID, ADD COLUMN IF NOT EXISTS sequence_no INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT 'develops';
ALTER TABLE public.intel_forecasts ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS org_id UUID, ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'global', ADD COLUMN IF NOT EXISTS horizon TEXT NOT NULL DEFAULT 'unspecified', ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2), ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,2) NOT NULL DEFAULT 50, ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.intel_publication_reviews ADD COLUMN IF NOT EXISTS id UUID, ADD COLUMN IF NOT EXISTS org_id UUID, ADD COLUMN IF NOT EXISTS publication_id UUID, ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'request_changes', ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
DECLARE missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM (
    VALUES
      ('intel_events','id'),('intel_events','org_id'),('intel_events','country_code'),('intel_events','severity'),('intel_events','confidence'),('intel_events','last_seen_at'),
      ('intel_observations','id'),('intel_observations','source_id'),('intel_observations','observed_at'),('intel_observations','credibility'),('intel_observations','manipulation_score'),
      ('intel_gaps','id'),('intel_gaps','org_id'),('intel_gaps','gap_type'),('intel_gaps','status'),('intel_gaps','priority'),
      ('intel_storylines','id'),('intel_storylines','org_id'),('intel_storylines','reference'),('intel_storylines','status'),('intel_storylines','severity'),('intel_storylines','confidence'),
      ('intel_storyline_events','storyline_id'),('intel_storyline_events','event_id'),('intel_storyline_events','sequence_no'),('intel_storyline_events','relationship'),
      ('intel_forecasts','id'),('intel_forecasts','org_id'),('intel_forecasts','scope_type'),('intel_forecasts','horizon'),('intel_forecasts','probability'),('intel_forecasts','confidence'),('intel_forecasts','status'),
      ('intel_publication_reviews','id'),('intel_publication_reviews','org_id'),('intel_publication_reviews','publication_id'),('intel_publication_reviews','action'),('intel_publication_reviews','created_at')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=required.table_name AND c.column_name=required.column_name);
  IF missing_count > 0 THEN RAISE EXCEPTION 'Intelligence public schema repair failed: % columns missing', missing_count; END IF;
END $$;
