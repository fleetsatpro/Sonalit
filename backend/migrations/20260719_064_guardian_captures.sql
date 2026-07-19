-- Dispatch-requested device photo captures ("remote eyes") — the lightweight
-- substitute for the old Knox remote screen/control. A dispatcher issues a
-- capture_photo command; the device silently captures a still, uploads it to R2
-- via a presigned PUT (POST /guardian/capture-photo-url), then reports the
-- public URL (POST /guardian/capture-photo), which Live Fleet surfaces.
--
-- Photos live in R2, not Postgres bytea like guardian_voice_messages — images
-- are larger and an object store is their right home — so only the URL/key is
-- kept here.
--
-- Deliberately NOT enabling RLS, exactly as guardian_voice_messages (migration
-- 062): the device-token routes read/write this table through the raw query()
-- helper, which never sets app.current_org_id, so RLS would silently zero them
-- out. Every query filters by org_id explicitly instead.
CREATE TABLE IF NOT EXISTS guardian_captures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID,
  device_id   UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
  command_id  TEXT,
  url         TEXT NOT NULL,
  storage_key TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gcap_device_created ON guardian_captures(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcap_org_created ON guardian_captures(org_id, created_at DESC);
