-- Risk Intel OSINT ingestion: risk_events gets external_url/external_id so
-- automated sources (GDELT, ReliefWeb, Claude web search) can dedupe against
-- re-inserting the same article every sweep. The partial unique index only
-- applies to rows that carry an external_id — manual admin-entered events
-- (source='manual') never set one and are unaffected.
ALTER TABLE risk_events ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE risk_events ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS risk_events_zone_external_uniq
  ON risk_events(zone_id, external_id) WHERE external_id IS NOT NULL;
