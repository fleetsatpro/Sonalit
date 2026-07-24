-- Persist covert-capture breadcrumbs so a shot that silently fails on a field
-- device is diagnosable from the console, not just from server logs. Small,
-- append-only, org-scoped by device.
CREATE TABLE IF NOT EXISTS guardian_capture_events (
  id         BIGSERIAL PRIMARY KEY,
  device_id  UUID NOT NULL,
  org_id     UUID,
  stage      TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capture_events_device_time
  ON guardian_capture_events (device_id, created_at DESC);
