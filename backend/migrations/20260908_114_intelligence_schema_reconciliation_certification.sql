-- Sonalit intelligence schema certification replay.
--
-- Migration 113 can legitimately be present in schema_migrations while the
-- physical database is still missing part of its contract. This is a new,
-- deterministic migration identity so the reconciliation DDL is guaranteed
-- to execute on affected installations.
--
-- Every DDL operation is additive/idempotent. No rows are deleted or rewritten.

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

CREATE INDEX IF NOT EXISTS intel_events_org_time
  ON intel_events(org_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS intel_observations_org_time
  ON intel_observations(org_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS intel_gaps_queue
  ON intel_gaps(org_id, status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS intel_storylines_active
  ON intel_storylines(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS intel_forecasts_scope
  ON intel_forecasts(org_id, scope_type, scope_key, valid_until DESC);
CREATE INDEX IF NOT EXISTS intel_publication_reviews_pub
  ON intel_publication_reviews(org_id, publication_id, created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_schema_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO intelligence_schema_reconciliations (migration_name, details)
VALUES (
  '20260908_114_intelligence_schema_reconciliation_certification',
  jsonb_build_object('mode','certification_replay','data_destructive',false)
)
ON CONFLICT (migration_name) DO NOTHING;

DO $$
DECLARE
  missing_count INTEGER;
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
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Intelligence schema certification failed: % required columns remain missing', missing_count;
  END IF;
END $$;
