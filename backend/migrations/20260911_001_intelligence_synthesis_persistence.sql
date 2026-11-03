-- Persistent intelligence synthesis + newsroom enrichment.
-- Additive only: preserves the raw observation/event ledger and provenance.

ALTER TABLE intel_observations
  ADD COLUMN IF NOT EXISTS title_en TEXT,
  ADD COLUMN IF NOT EXISTS body_en TEXT,
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'pending' CHECK (translation_status IN ('pending','not_required','translated','failed')),
  ADD COLUMN IF NOT EXISTS translated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS intel_observations_translation_queue
  ON intel_observations(org_id, translation_status, observed_at DESC)
  WHERE translation_status IN ('pending','failed');

ALTER TABLE intel_events
  ADD COLUMN IF NOT EXISTS canonical_headline TEXT,
  ADD COLUMN IF NOT EXISTS executive_brief TEXT,
  ADD COLUMN IF NOT EXISTS intelligence_type TEXT,
  ADD COLUMN IF NOT EXISTS key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS why_it_matters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS caveats JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS synthesis_confidence NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS synthesized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synthesis_provider TEXT;

CREATE INDEX IF NOT EXISTS intel_events_synthesis_queue
  ON intel_events(org_id, synthesized_at, last_seen_at DESC);

-- Publication cadence / provenance metadata lives in the existing JSON body.
-- This index makes newsroom coverage checks inexpensive.
CREATE INDEX IF NOT EXISTS intel_publications_period_lookup
  ON intel_publications(org_id, country_code, publication_type, period_start, period_end DESC);
