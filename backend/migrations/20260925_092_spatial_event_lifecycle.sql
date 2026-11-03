-- Spatial event lifecycle hardening.
-- Adds last-seen and explicit resolution reason so condition state can be
-- reconciled without pretending provider failure means condition resolution.
ALTER TABLE spatial_events
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE spatial_events
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

UPDATE spatial_events
   SET last_seen_at = COALESCE(last_seen_at, updated_at, detected_at, created_at)
 WHERE last_seen_at IS NULL;

ALTER TABLE spatial_events
  ALTER COLUMN last_seen_at SET DEFAULT NOW();

ALTER TABLE spatial_events
  ALTER COLUMN last_seen_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS spatial_events_open_lifecycle
  ON spatial_events(org_id, event_type, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS spatial_events_open_subject
  ON spatial_events(org_id, convoy_id, subject_type, subject_id, status);
