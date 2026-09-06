-- Dispatch -> device voice messages (the Live Fleet "Voice" action).
-- Clips are short opus/webm recordings (capped at 2 MB in the route), so
-- Postgres bytea is the right store: durable across redeploys, org-scoped,
-- no external object-store dependency. The device downloads the audio back
-- through its device-token-authenticated HTTP client.
CREATE TABLE IF NOT EXISTS guardian_voice_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID,
  device_id   UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
  issued_by   UUID,
  mime        TEXT NOT NULL DEFAULT 'audio/webm',
  duration_ms INT,
  audio       BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gvm_device_created
  ON guardian_voice_messages(device_id, created_at DESC);
