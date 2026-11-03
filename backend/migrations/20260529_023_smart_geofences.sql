-- S2-F1: Smart Geofencing + Route Deviation
-- Idempotent throughout.

-- ── 1. Add org_id to geofences (if missing) ──────────────────────────────────
DO $$
DECLARE default_org UUID;
BEGIN
  -- Derive a fallback org_id from existing convoy rows (no organizations table in this schema)
  SELECT org_id INTO default_org FROM convoys LIMIT 1;
  IF default_org IS NULL THEN default_org := '00000000-0000-0000-0000-000000000001'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'geofences' AND column_name = 'org_id') THEN
    EXECUTE format('ALTER TABLE geofences ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
END $$;

-- ── 2. Smart geofencing columns on geofences ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='corridor_width_km') THEN
    ALTER TABLE geofences ADD COLUMN corridor_width_km NUMERIC(4,1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='active_from_time') THEN
    ALTER TABLE geofences ADD COLUMN active_from_time TIME;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='active_to_time') THEN
    ALTER TABLE geofences ADD COLUMN active_to_time TIME;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='days_of_week') THEN
    ALTER TABLE geofences ADD COLUMN days_of_week SMALLINT[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='checkpoint_order') THEN
    ALTER TABLE geofences ADD COLUMN checkpoint_order SMALLINT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='geofences' AND column_name='dwell_alert_min') THEN
    ALTER TABLE geofences ADD COLUMN dwell_alert_min SMALLINT;
  END IF;
END $$;

-- ── 3. RLS on geofences ────────────────────────────────────────────────────────
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON geofences;
CREATE POLICY org_isolation ON geofences
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

-- ── 4. geofence_events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofence_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL,
  geofence_id   UUID        REFERENCES geofences(id),
  vehicle_id    UUID        REFERENCES vehicles(id),
  device_id     UUID        REFERENCES guardian_devices(id),
  convoy_id     UUID        REFERENCES convoys(id),
  event_type    TEXT        NOT NULL
                CHECK (event_type IN
                  ('enter','exit','dwell_exceeded','route_deviation','checkpoint_signin')),
  location      JSONB       NOT NULL,
  dwell_minutes NUMERIC(6,1),
  deviation_km  NUMERIC(6,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofence_events_org_time
  ON geofence_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geofence_events_convoy
  ON geofence_events (convoy_id, created_at DESC)
  WHERE convoy_id IS NOT NULL;

-- RULE A: RLS on geofence_events
ALTER TABLE geofence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE geofence_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON geofence_events;
CREATE POLICY org_isolation ON geofence_events
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON geofence_events TO sonalit_app;

-- ── 5. convoy_route_corridors ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convoy_route_corridors (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL,
  convoy_id  UUID        NOT NULL REFERENCES convoys(id) UNIQUE,
  route_line JSONB       NOT NULL,
  width_km   NUMERIC(4,1) NOT NULL DEFAULT 2.0,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RULE A: RLS on convoy_route_corridors
ALTER TABLE convoy_route_corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_route_corridors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON convoy_route_corridors;
CREATE POLICY org_isolation ON convoy_route_corridors
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON convoy_route_corridors TO sonalit_app;
