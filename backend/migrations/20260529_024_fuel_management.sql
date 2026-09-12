-- S2-F2: Fuel Management + Anomaly Detection
-- RULE A: every new org-scoped table gets ENABLE + FORCE RLS + org_isolation policy

-- ─── fuel_entries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  vehicle_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  convoy_id           UUID REFERENCES convoys(id) ON DELETE SET NULL,
  source              VARCHAR(30) NOT NULL DEFAULT 'manual',  -- manual | fuel_card_webhook | iot_sensor
  litres              NUMERIC(8,2) NOT NULL,
  cost_per_litre      NUMERIC(8,4),
  total_cost          NUMERIC(10,2),
  currency            VARCHAR(3) DEFAULT 'KES',
  odometer_km         NUMERIC(10,2),
  station_name        VARCHAR(200),
  station_lat         NUMERIC(10,7),
  station_lng         NUMERIC(10,7),
  fuel_card_ref       VARCHAR(100),
  idempotency_key     VARCHAR(100) UNIQUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

ALTER TABLE fuel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON fuel_entries;
CREATE POLICY org_isolation ON fuel_entries
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON fuel_entries TO sonalit_app;

-- ─── fuel_anomalies ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_anomalies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  fuel_entry_id   UUID REFERENCES fuel_entries(id) ON DELETE CASCADE,
  vehicle_id      UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  anomaly_type    VARCHAR(50) NOT NULL,  -- unknown_location | volume_mismatch | consumption_spike | duplicate_entry | off_route_refuel
  severity        VARCHAR(20) NOT NULL DEFAULT 'medium',  -- low | medium | high | critical
  description     TEXT,
  resolved        BOOLEAN DEFAULT false,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_anomalies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON fuel_anomalies;
CREATE POLICY org_isolation ON fuel_anomalies
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON fuel_anomalies TO sonalit_app;

-- ─── approved_fuel_stations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approved_fuel_stations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  name        VARCHAR(200) NOT NULL,
  lat         NUMERIC(10,7) NOT NULL,
  lng         NUMERIC(10,7) NOT NULL,
  radius_km   NUMERIC(5,2) DEFAULT 0.5,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE approved_fuel_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_fuel_stations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON approved_fuel_stations;
CREATE POLICY org_isolation ON approved_fuel_stations
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON approved_fuel_stations TO sonalit_app;

-- Index for fast vehicle/org lookups
CREATE INDEX IF NOT EXISTS idx_fuel_entries_vehicle_org ON fuel_entries (org_id, vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_entries_convoy ON fuel_entries (convoy_id) WHERE convoy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fuel_anomalies_org ON fuel_anomalies (org_id, resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approved_stations_org ON approved_fuel_stations (org_id) WHERE active = true;
