-- Guardian voice messages so far were dispatch -> device only (the Live
-- Fleet "Voice" action, see 060_guardian_voice_messages.sql). Adding the
-- reverse direction — a field officer recording a note and sending it up
-- to dispatch — reuses the same table and bytea-in-Postgres storage
-- decision (short clips capped at 2MB, no need for an external object
-- store) rather than standing up a parallel schema for identical data.
--
-- Deliberately NOT enabling RLS here: the existing device-audio-download
-- route (GET /guardian/voice-messages/:id/audio) reads via the raw query()
-- helper, which never sets app.current_org_id — enabling RLS would make
-- that already-shipped route silently return zero rows. New endpoints
-- added alongside this migration filter by org_id explicitly instead,
-- same as the existing POST /devices/:id/voice-message route already does.
ALTER TABLE guardian_voice_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'to_device'
  CHECK (direction IN ('to_device', 'from_device'));

CREATE INDEX IF NOT EXISTS idx_gvm_org_direction_created
  ON guardian_voice_messages(org_id, direction, created_at DESC);
