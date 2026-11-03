-- Spatial World Model: durable, explainable spatial events + query indexes.
-- Idempotent. Uses existing Sonalit operational tables; does not create a
-- competing telemetry or alert source of truth.

CREATE TABLE IF NOT EXISTS spatial_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL,
  event_key              TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  subject_type           TEXT NOT NULL,
  subject_id             TEXT NOT NULL,
  convoy_id              UUID REFERENCES convoys(id) ON DELETE SET NULL,
  related_entities       JSONB NOT NULL DEFAULT '[]'::jsonb,
  previous_state         TEXT,
  new_state              TEXT,
  observed_at            TIMESTAMPTZ,
  detected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity               TEXT NOT NULL DEFAULT 'medium'
                         CHECK (severity IN ('low','medium','high','critical')),
  confidence             NUMERIC(5,4) NOT NULL DEFAULT 0,
  operational_confidence NUMERIC(5,4),
  evidence               JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_references      JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertainty             JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_version           TEXT NOT NULL DEFAULT 'spatial-v1',
  status                 TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','resolved','suppressed')),
  resolved_at            TIMESTAMPTZ,
  resolved_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS spatial_events_open_key
  ON spatial_events(org_id, event_key)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS spatial_events_org_detected
  ON spatial_events(org_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS spatial_events_org_convoy
  ON spatial_events(org_id, convoy_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS spatial_events_subject
  ON spatial_events(org_id, subject_type, subject_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicles_org_last_ping
  ON vehicles(org_id, last_ping DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_checkpoints_convoy_sequence
  ON checkpoints(convoy_id, sequence_order);

CREATE INDEX IF NOT EXISTS idx_incidents_convoy_status
  ON incidents(convoy_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_geofences_org_active
  ON geofences(org_id, active);

CREATE INDEX IF NOT EXISTS idx_device_locations_device_time
  ON device_locations(device_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_risk_zones_org_active_coords
  ON risk_zones(org_id, active, lat, lng);

ALTER TABLE spatial_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spatial_events_org_isolation ON spatial_events;

CREATE POLICY spatial_events_org_isolation ON spatial_events
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON spatial_events TO sonalit_app;

CREATE OR REPLACE FUNCTION spatial_events_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spatial_events_updated_at ON spatial_events;

CREATE TRIGGER trg_spatial_events_updated_at
BEFORE UPDATE ON spatial_events
FOR EACH ROW
EXECUTE FUNCTION spatial_events_touch_updated_at();
