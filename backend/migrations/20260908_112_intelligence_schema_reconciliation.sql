-- Sonalit intelligence schema reconciliation.
-- Forward-only, idempotent repair for installations where 20260907_107 / 20260908_108
-- were recorded as applied while older intelligence tables already existed.
-- Never drops or rewrites existing data.

-- Core columns required by the intelligence schema contract.
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

-- Restore the most important performance paths without disturbing existing indexes.
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

-- Make the reconciliation visible and auditable to operators.
CREATE TABLE IF NOT EXISTS intelligence_schema_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO intelligence_schema_reconciliations (migration_name, details)
VALUES ('20260908_112_intelligence_schema_reconciliation', jsonb_build_object('mode','forward_only','data_destructive',false))
ON CONFLICT (migration_name) DO NOTHING;
