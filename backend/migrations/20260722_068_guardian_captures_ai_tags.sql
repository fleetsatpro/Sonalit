-- AI auto-tagging for covert captures. Each photo is run through Claude vision
-- (see backend/src/utils/captureVision.js) to detect people, weapons, vehicles,
-- and licence plates, and to summarise the scene — turning the Surveillance
-- gallery into something searchable by who/what, and surfacing threats (weapon
-- visible, plate → watchlist) the instant a capture lands. All nullable: a row
-- stays untagged until analysed, and analysis is skipped when no vision provider
-- is configured.
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_summary      TEXT;
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_labels       TEXT[];
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_person_count INTEGER;
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_has_weapon   BOOLEAN;
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_plates       TEXT[];
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_vehicles     TEXT[];
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_threat_level TEXT;
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS ai_analyzed_at  TIMESTAMPTZ;

-- Partial index so "find untagged captures" (the backfill query) stays cheap.
CREATE INDEX IF NOT EXISTS idx_gcap_unanalyzed ON guardian_captures(org_id, created_at DESC) WHERE ai_analyzed_at IS NULL;
