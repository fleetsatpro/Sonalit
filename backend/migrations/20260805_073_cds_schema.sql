-- CDS (Container Delivery System) schema
-- All DDL uses IF NOT EXISTS — safe to re-run.

CREATE EXTENSION IF NOT EXISTS "postgis";

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_customers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  code            VARCHAR(20)  UNIQUE NOT NULL,
  company_name    VARCHAR(255) NOT NULL,
  contact_person  VARCHAR(255) NOT NULL,
  phone           VARCHAR(50)  NOT NULL,
  email           VARCHAR(255),
  address         TEXT,
  city            VARCHAR(100),
  country         VARCHAR(100) NOT NULL DEFAULT 'Kenya',
  billing_info    JSONB        DEFAULT '{}',
  total_shipments INTEGER      NOT NULL DEFAULT 0,
  active_shipments INTEGER     NOT NULL DEFAULT 0,
  sla_compliance  DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  rating          DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive','suspended')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_customers_org  ON cds_customers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_customers_code ON cds_customers(code)   WHERE deleted_at IS NULL;

-- ── Transporters ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_transporters (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  code            VARCHAR(20)  UNIQUE NOT NULL,
  company_name    VARCHAR(255) NOT NULL,
  contact_person  VARCHAR(255) NOT NULL,
  phone           VARCHAR(50)  NOT NULL,
  email           VARCHAR(255),
  total_trucks    INTEGER      NOT NULL DEFAULT 0,
  active_trips    INTEGER      NOT NULL DEFAULT 0,
  total_trips     INTEGER      NOT NULL DEFAULT 0,
  on_time_rate    DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  avg_clamp_time  VARCHAR(20)  DEFAULT '0m',
  rating          DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  insurance       JSONB        DEFAULT '{}',
  contracts       JSONB        DEFAULT '[]',
  performance_score DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive','suspended')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_transporters_org ON cds_transporters(org_id) WHERE deleted_at IS NULL;

-- ── CDS Vehicles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_vehicles (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  registration    VARCHAR(20)  UNIQUE NOT NULL,
  fleet_number    VARCHAR(20),
  vin             VARCHAR(50),
  type            VARCHAR(20)  NOT NULL DEFAULT 'truck'
                  CHECK (type IN ('truck','trailer','tanker','flatbed')),
  make            VARCHAR(100),
  model           VARCHAR(100),
  year            INTEGER,
  fuel_type       VARCHAR(20)  DEFAULT 'diesel',
  capacity_kg     DECIMAL(10,2),
  transporter_id  UUID         REFERENCES cds_transporters(id),
  current_driver_id UUID,
  gps_device_id   VARCHAR(50),
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  speed           DECIMAL(6,2) DEFAULT 0,
  heading         DECIMAL(6,2) DEFAULT 0,
  fuel_level      DECIMAL(5,2),
  odometer        DECIMAL(12,2) DEFAULT 0,
  last_position_at TIMESTAMPTZ,
  insurance_expiry TIMESTAMPTZ,
  road_license_expiry TIMESTAMPTZ,
  next_service    TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','in_use','maintenance','decommissioned')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_vehicles_org    ON cds_vehicles(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_vehicles_status ON cds_vehicles(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_vehicles_transporter ON cds_vehicles(transporter_id) WHERE deleted_at IS NULL;

-- ── CDS Drivers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_drivers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  name            VARCHAR(255) NOT NULL,
  phone           VARCHAR(50)  NOT NULL,
  email           VARCHAR(255),
  national_id     VARCHAR(50),
  license_number  VARCHAR(50)  NOT NULL,
  license_expiry  TIMESTAMPTZ  NOT NULL,
  transporter_id  UUID         REFERENCES cds_transporters(id),
  current_vehicle_id UUID     REFERENCES cds_vehicles(id),
  total_trips     INTEGER      NOT NULL DEFAULT 0,
  rating          DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  photo           TEXT,
  training_records JSONB       DEFAULT '[]',
  status          VARCHAR(20)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','active','on_break','off_duty','suspended')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_drivers_org    ON cds_drivers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_drivers_status ON cds_drivers(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_drivers_transporter ON cds_drivers(transporter_id) WHERE deleted_at IS NULL;

ALTER TABLE cds_vehicles ADD CONSTRAINT fk_cds_vehicles_driver
  FOREIGN KEY (current_driver_id) REFERENCES cds_drivers(id);

-- ── Containers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_containers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  number          VARCHAR(20)  UNIQUE NOT NULL,
  iso_type        VARCHAR(10)  NOT NULL DEFAULT '20GP',
  container_type  VARCHAR(50)  NOT NULL DEFAULT 'General Purpose',
  container_size  INTEGER      NOT NULL DEFAULT 20,
  ownership       VARCHAR(20)  NOT NULL DEFAULT 'leased'
                  CHECK (ownership IN ('owned','leased','customer')),
  length_m        DECIMAL(5,2),
  width_m         DECIMAL(5,2),
  height_m        DECIMAL(5,2),
  max_weight_kg   DECIMAL(10,2),
  tare_weight_kg  DECIMAL(10,2),
  manufacturer    VARCHAR(100),
  year_built      INTEGER,
  condition       VARCHAR(20)  DEFAULT 'good'
                  CHECK (condition IN ('new','good','fair','damaged','retired')),
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  current_location VARCHAR(255),
  last_inspection TIMESTAMPTZ,
  next_inspection TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','booked','awaiting_pickup','in_transit','at_port','delivered','maintenance')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_containers_org    ON cds_containers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_containers_number ON cds_containers(number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_containers_status ON cds_containers(status) WHERE deleted_at IS NULL;

-- ── Electronic Locks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_electronic_locks (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  serial          VARCHAR(30)  UNIQUE NOT NULL,
  provider        VARCHAR(50)  NOT NULL DEFAULT 'securisat',
  battery_level   INTEGER      NOT NULL DEFAULT 100,
  solar_charging  BOOLEAN      NOT NULL DEFAULT false,
  signal_strength VARCHAR(20)  NOT NULL DEFAULT 'strong'
                  CHECK (signal_strength IN ('strong','medium','weak','offline')),
  firmware_version VARCHAR(20),
  container_id    UUID         REFERENCES cds_containers(id),
  vehicle_id      UUID         REFERENCES cds_vehicles(id),
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  location        VARCHAR(255),
  last_heartbeat  TIMESTAMPTZ  DEFAULT NOW(),
  temperature     DECIMAL(5,2),
  tamper_detected BOOLEAN      NOT NULL DEFAULT false,
  tamper_status   VARCHAR(20)  DEFAULT 'normal'
                  CHECK (tamper_status IN ('normal','cable_cut','door_opened','power_lost','forced_removal')),
  last_event_at   TIMESTAMPTZ  DEFAULT NOW(),
  assigned_at     TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available','assigned','installed','removed','maintenance','offline')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_locks_org    ON cds_electronic_locks(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_locks_serial ON cds_electronic_locks(serial) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_locks_status ON cds_electronic_locks(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_locks_container ON cds_electronic_locks(container_id) WHERE deleted_at IS NULL;

-- ── Lock Events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_lock_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  lock_id         UUID         NOT NULL REFERENCES cds_electronic_locks(id),
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('lock','unlock','tamper','heartbeat','gps_update','battery_low','offline','online','firmware_update')),
  data            JSONB        DEFAULT '{}',
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_lock_events_lock ON cds_lock_events(lock_id, created_at DESC);

-- ── Bookings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_bookings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  booking_number  VARCHAR(30)  UNIQUE NOT NULL,
  customer_id     UUID         NOT NULL REFERENCES cds_customers(id),
  commodity       VARCHAR(100) NOT NULL,
  weight_kg       DECIMAL(10,2),
  seal_number     VARCHAR(50),
  container_type  VARCHAR(10)  DEFAULT '20GP',
  container_size  INTEGER      DEFAULT 20,
  pickup_location VARCHAR(255) NOT NULL,
  delivery_location VARCHAR(255) NOT NULL,
  shipping_line   VARCHAR(100),
  vessel          VARCHAR(100),
  voyage          VARCHAR(50),
  eta             TIMESTAMPTZ,
  reference       VARCHAR(100),
  notes           TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','pending','approved','assigned','in_progress','delivered','cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_bookings_org      ON cds_bookings(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_bookings_customer ON cds_bookings(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_bookings_status   ON cds_bookings(status) WHERE deleted_at IS NULL;

-- ── Trips (the core lifecycle object) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_trips (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  trip_number     VARCHAR(30)  UNIQUE NOT NULL,
  booking_id      UUID         REFERENCES cds_bookings(id),
  customer_id     UUID         REFERENCES cds_customers(id),
  container_id    UUID         REFERENCES cds_containers(id),
  vehicle_id      UUID         REFERENCES cds_vehicles(id),
  driver_id       UUID         REFERENCES cds_drivers(id),
  lock_id         UUID         REFERENCES cds_electronic_locks(id),
  transporter_id  UUID         REFERENCES cds_transporters(id),
  commodity       VARCHAR(100),
  weight_kg       DECIMAL(10,2),
  seal_number     VARCHAR(50),
  origin          VARCHAR(255) NOT NULL,
  destination     VARCHAR(255) NOT NULL,
  eta             TIMESTAMPTZ,
  departed_at     TIMESTAMPTZ,
  arrived_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  risk            VARCHAR(20)  NOT NULL DEFAULT 'low'
                  CHECK (risk IN ('low','medium','high','critical')),
  progress        INTEGER      NOT NULL DEFAULT 0,
  route_geometry  JSONB,
  notes           TEXT,
  status          VARCHAR(30)  NOT NULL DEFAULT 'created'
                  CHECK (status IN (
                    'created','vehicle_assigned','driver_assigned','awaiting_lock',
                    'locked','dispatched','checkpoint','delayed','at_port',
                    'delivered','lock_removed','completed','archived'
                  )),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_trips_org       ON cds_trips(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_status    ON cds_trips(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_customer  ON cds_trips(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_container ON cds_trips(container_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_vehicle   ON cds_trips(vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_driver    ON cds_trips(driver_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_trips_lock      ON cds_trips(lock_id) WHERE deleted_at IS NULL;

-- ── Trip Events (state machine log) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_trip_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  trip_id         UUID         NOT NULL REFERENCES cds_trips(id),
  from_status     VARCHAR(30),
  to_status       VARCHAR(30)  NOT NULL,
  actor_id        UUID,
  actor_name      VARCHAR(255),
  notes           TEXT,
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  metadata        JSONB        DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_trip_events_trip ON cds_trip_events(trip_id, created_at DESC);

-- ── GPS History (high-volume, partitioned by month) ──────────────────────────
CREATE TABLE IF NOT EXISTS cds_gps_history (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  vehicle_id      UUID         NOT NULL,
  trip_id         UUID,
  lat             DECIMAL(10,7) NOT NULL,
  lng             DECIMAL(10,7) NOT NULL,
  speed           DECIMAL(6,2),
  heading         DECIMAL(6,2),
  altitude        DECIMAL(8,2),
  ignition        BOOLEAN,
  fuel_level      DECIMAL(5,2),
  battery         DECIMAL(5,2),
  odometer        DECIMAL(12,2),
  signal_strength INTEGER,
  device_time     TIMESTAMPTZ  NOT NULL,
  server_time     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_cds_gps_vehicle ON cds_gps_history(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cds_gps_trip    ON cds_gps_history(trip_id, created_at DESC) WHERE trip_id IS NOT NULL;

-- Auto-create monthly partitions for GPS history
DO $$
DECLARE
  start_date DATE := '2026-01-01';
  end_date   DATE := '2027-12-01';
  cur        DATE := start_date;
  part_name  TEXT;
BEGIN
  WHILE cur < end_date LOOP
    part_name := 'cds_gps_history_' || to_char(cur, 'YYYY_MM');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF cds_gps_history FOR VALUES FROM (%L) TO (%L)',
        part_name, cur, cur + INTERVAL '1 month'
      );
    END IF;
    cur := cur + INTERVAL '1 month';
  END LOOP;
END $$;

-- ── Geofences ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_geofences (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20)  NOT NULL DEFAULT 'circle'
                  CHECK (type IN ('circle','polygon','corridor','route')),
  category        VARCHAR(20)  NOT NULL DEFAULT 'warehouse'
                  CHECK (category IN ('warehouse','port','border','customer','restricted','corridor')),
  geometry        JSONB        NOT NULL,
  center_lat      DECIMAL(10,7),
  center_lng      DECIMAL(10,7),
  radius_m        DECIMAL(10,2),
  alert_config    JSONB        NOT NULL DEFAULT '[]',
  active          BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_geofences_org ON cds_geofences(org_id) WHERE deleted_at IS NULL;

-- ── Alerts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_alerts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('overspeed','route_deviation','lock_tamper','device_offline',
                    'unauthorized_stop','late_delivery','fuel_theft','geofence_exit',
                    'battery_low','sos','harsh_braking','harsh_acceleration')),
  severity        VARCHAR(20)  NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('critical','high','medium','low','info')),
  title           VARCHAR(255) NOT NULL,
  message         TEXT NOT NULL,
  entity_type     VARCHAR(20)  NOT NULL
                  CHECK (entity_type IN ('trip','container','lock','vehicle','driver','geofence')),
  entity_id       UUID         NOT NULL,
  acknowledged    BOOLEAN      NOT NULL DEFAULT false,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  escalation_level VARCHAR(20) DEFAULT 'operator'
                  CHECK (escalation_level IN ('operator','supervisor','manager','customer')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_alerts_org      ON cds_alerts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cds_alerts_entity   ON cds_alerts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cds_alerts_severity ON cds_alerts(severity) WHERE acknowledged = false;

-- ── Incidents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_incidents (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  incident_number VARCHAR(30)  UNIQUE NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('tamper','theft','accident','breakdown','route_deviation','unauthorized_stop','lock_failure')),
  severity        VARCHAR(20)  NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('critical','high','medium','low','info')),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  trip_id         UUID         REFERENCES cds_trips(id),
  container_id    UUID         REFERENCES cds_containers(id),
  lock_id         UUID         REFERENCES cds_electronic_locks(id),
  vehicle_id      UUID         REFERENCES cds_vehicles(id),
  driver_id       UUID         REFERENCES cds_drivers(id),
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  assigned_to     UUID,
  resolution      TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','investigating','resolved','closed')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_incidents_org    ON cds_incidents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_incidents_status ON cds_incidents(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_incidents_trip   ON cds_incidents(trip_id) WHERE deleted_at IS NULL;

-- ── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_documents (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('booking_form','delivery_order','bill_of_lading','packing_list',
                    'invoice','customs_declaration','inspection_report','photo','other')),
  mime_type       VARCHAR(100),
  file_size       INTEGER,
  storage_key     VARCHAR(500),
  trip_id         UUID         REFERENCES cds_trips(id),
  container_id    UUID         REFERENCES cds_containers(id),
  booking_id      UUID         REFERENCES cds_bookings(id),
  ai_extracted    BOOLEAN      NOT NULL DEFAULT false,
  extraction_data JSONB,
  extraction_confidence DECIMAL(5,2),
  uploaded_by     UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cds_documents_org  ON cds_documents(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_documents_trip ON cds_documents(trip_id) WHERE deleted_at IS NULL;

-- ── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_notifications (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  user_id         UUID,
  channel         VARCHAR(20)  NOT NULL DEFAULT 'web'
                  CHECK (channel IN ('email','sms','whatsapp','push','web')),
  type            VARCHAR(20)  NOT NULL DEFAULT 'info'
                  CHECK (type IN ('info','warning','error','success')),
  title           VARCHAR(255) NOT NULL,
  message         TEXT NOT NULL,
  entity_type     VARCHAR(30),
  entity_id       UUID,
  read            BOOLEAN      NOT NULL DEFAULT false,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  action_url      VARCHAR(500),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_notifications_user ON cds_notifications(user_id, created_at DESC) WHERE read = false;

-- ── Audit Log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_audit_logs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  action          VARCHAR(50)  NOT NULL,
  entity_type     VARCHAR(30)  NOT NULL,
  entity_id       UUID         NOT NULL,
  user_id         UUID,
  user_name       VARCHAR(255),
  before_data     JSONB,
  after_data      JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_audit_org    ON cds_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cds_audit_entity ON cds_audit_logs(entity_type, entity_id);

-- ── Activity Feed (denormalized for dashboard) ───────────────────────────────
CREATE TABLE IF NOT EXISTS cds_activity_feed (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  icon            VARCHAR(20)  NOT NULL DEFAULT 'checkpoint',
  text            TEXT         NOT NULL,
  meta            TEXT,
  entity_type     VARCHAR(30),
  entity_id       UUID,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_activity_org ON cds_activity_feed(org_id, created_at DESC);

-- ── Reports ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cds_reports (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(20)  NOT NULL DEFAULT 'daily'
                  CHECK (type IN ('daily','weekly','monthly','custom','trip','delivery','driver','vehicle','transporter','customer','incident','lock')),
  format          VARCHAR(10)  NOT NULL DEFAULT 'pdf'
                  CHECK (format IN ('pdf','excel','csv')),
  parameters      JSONB        DEFAULT '{}',
  storage_key     VARCHAR(500),
  generated_by    UUID,
  generated_at    TIMESTAMPTZ,
  status          VARCHAR(20)  NOT NULL DEFAULT 'generating'
                  CHECK (status IN ('generating','ready','failed')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cds_reports_org ON cds_reports(org_id, created_at DESC);

-- ── Updated-at trigger function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cds_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'cds_customers','cds_transporters','cds_vehicles','cds_drivers',
    'cds_containers','cds_electronic_locks','cds_bookings','cds_trips',
    'cds_geofences','cds_incidents'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated ON %I; CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cds_update_timestamp()',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;
