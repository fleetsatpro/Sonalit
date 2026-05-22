-- Base schema: creates all core tables that migrations 001+ depend on.
-- All DDL uses IF NOT EXISTS / CREATE OR REPLACE — safe to re-run.

-- Extensions: wrapped in DO blocks so permission errors don't abort the migration.
-- gen_random_uuid() is built-in since PG 13; pgcrypto provides it on PG < 13.
DO $ext$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto extension not available: %', SQLERRM;
END $ext$;

DO $ext2$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'uuid-ossp extension not available: %', SQLERRM;
END $ext2$;

-- ── Core tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'operator'
                CHECK (role IN ('admin','dispatcher','operator','analyst','driver','cfo')),
  status        VARCHAR(50)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role)  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS convoys (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  region             VARCHAR(100) NOT NULL,
  status             VARCHAR(50)  NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned','active','completed','aborted')),
  priority           VARCHAR(50)  NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low','medium','high','critical')),
  description        TEXT,
  departure_time     TIMESTAMPTZ,
  arrival_time       TIMESTAMPTZ,
  estimated_arrival  TIMESTAMPTZ,
  route_origin       VARCHAR(100),
  route_destination  VARCHAR(100),
  timezone           VARCHAR(100),
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_convoys_status ON convoys(status)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_convoys_region ON convoys(region)  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vehicles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 VARCHAR(100) NOT NULL,
  registration         VARCHAR(50)  UNIQUE NOT NULL,
  region               VARCHAR(100) NOT NULL,
  status               VARCHAR(50)  NOT NULL DEFAULT 'idle'
                       CHECK (status IN ('idle','active','maintenance','offline')),
  capacity             INTEGER      NOT NULL DEFAULT 4,
  latitude             DECIMAL(10,7),
  longitude            DECIMAL(10,7),
  heading              DECIMAL(6,2) DEFAULT 0,
  altitude             DECIMAL(8,2),
  last_ping            TIMESTAMPTZ,
  make                 VARCHAR(100),
  model                VARCHAR(100),
  year                 INTEGER,
  vin                  VARCHAR(50),
  color                VARCHAR(50),
  cargo_capacity_kg    DECIMAL(8,2),
  insurance_expiry     TIMESTAMPTZ,
  inspection_expiry    TIMESTAMPTZ,
  purchase_date        TIMESTAMPTZ,
  purchase_cost        DECIMAL(12,2),
  current_value        DECIMAL(12,2),
  assigned_driver      VARCHAR(255),
  driver_id            UUID REFERENCES users(id),
  assigned_convoy_id   UUID REFERENCES convoys(id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_region ON vehicles(region)  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS convoy_assignments (
  convoy_id  UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  role       VARCHAR(50) NOT NULL DEFAULT 'escort',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (convoy_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID REFERENCES vehicles(id),
  convoy_id       UUID REFERENCES convoys(id),
  type            VARCHAR(100) NOT NULL
                  CHECK (type IN ('speed','geofence','mechanical','security','communication')),
  severity        VARCHAR(50)  NOT NULL
                  CHECK (severity IN ('low','medium','high','critical')),
  message         TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_severity   ON alerts(severity)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_vehicle    ON alerts(vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(created_at) WHERE resolved_at IS NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS incidents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id   UUID REFERENCES convoys(id),
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  severity    VARCHAR(50)  NOT NULL DEFAULT 'medium'
              CHECK (severity IN ('low','medium','high','critical')),
  status      VARCHAR(50)  NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','investigating','resolved')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidents_convoy ON incidents(convoy_id);

CREATE TABLE IF NOT EXISTS channels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id  UUID REFERENCES users(id),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id  UUID,
  action     VARCHAR(20)  NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data   JSONB,
  new_data   JSONB,
  user_id    UUID REFERENCES users(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_logs(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user  ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS gps_logs (
  id         BIGSERIAL   PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  lat        DECIMAL(10,7) NOT NULL,
  lng        DECIMAL(10,7) NOT NULL,
  speed      DECIMAL(6,2)  NOT NULL DEFAULT 0,
  timestamp  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_vehicle ON gps_logs(vehicle_id, timestamp DESC);

-- ── Enterprise tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drivers (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id),
  name                 VARCHAR(255) NOT NULL,
  employee_id          VARCHAR(100) UNIQUE,
  phone                VARCHAR(30),
  email                VARCHAR(255),
  license_number       VARCHAR(100),
  license_class        VARCHAR(50),
  license_expiry       TIMESTAMPTZ,
  certifications       JSONB DEFAULT '[]',
  status               VARCHAR(50)  DEFAULT 'active'
                       CHECK (status IN ('active','inactive','suspended','on_leave')),
  current_vehicle_id   UUID REFERENCES vehicles(id),
  driver_score         INTEGER DEFAULT 100,
  total_trips          INTEGER DEFAULT 0,
  total_km             DECIMAL(12,2) DEFAULT 0,
  harsh_braking_count  INTEGER DEFAULT 0,
  speeding_count       INTEGER DEFAULT 0,
  idling_minutes       INTEGER DEFAULT 0,
  photo_url            VARCHAR(500),
  notes                TEXT,
  hired_date           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_score  ON drivers(driver_score DESC);

CREATE TABLE IF NOT EXISTS shipments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number      VARCHAR(100) UNIQUE NOT NULL,
  convoy_id            UUID REFERENCES convoys(id),
  vehicle_id           UUID REFERENCES vehicles(id),
  driver_id            UUID REFERENCES drivers(id),
  customer_name        VARCHAR(255),
  customer_ref         VARCHAR(100),
  status               VARCHAR(50) DEFAULT 'pending'
                       CHECK (status IN ('pending','picked_up','in_transit','at_checkpoint','delivered','failed','returned')),
  priority             VARCHAR(50) DEFAULT 'standard'
                       CHECK (priority IN ('standard','express','critical','hazmat','cold_chain')),
  origin_address       TEXT,
  origin_lat           DECIMAL(10,7),
  origin_lng           DECIMAL(10,7),
  destination_address  TEXT,
  destination_lat      DECIMAL(10,7),
  destination_lng      DECIMAL(10,7),
  cargo_description    TEXT,
  cargo_weight_kg      DECIMAL(10,2),
  cargo_volume_m3      DECIMAL(10,3),
  cargo_value          DECIMAL(14,2),
  currency             VARCHAR(10) DEFAULT 'USD',
  requires_temp_control BOOLEAN DEFAULT false,
  temp_min             DECIMAL(5,2),
  temp_max             DECIMAL(5,2),
  is_hazmat            BOOLEAN DEFAULT false,
  hazmat_class         VARCHAR(50),
  seal_number          VARCHAR(100),
  scheduled_pickup     TIMESTAMPTZ,
  actual_pickup        TIMESTAMPTZ,
  scheduled_delivery   TIMESTAMPTZ,
  actual_delivery      TIMESTAMPTZ,
  estimated_arrival    TIMESTAMPTZ,
  pod_signature        VARCHAR(500),
  pod_notes            TEXT,
  pod_at               TIMESTAMPTZ,
  cost_usd             DECIMAL(10,2),
  distance_km          DECIMAL(8,2),
  notes                TEXT,
  metadata             JSONB DEFAULT '{}',
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_convoy   ON shipments(convoy_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS checkpoints (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id    UUID REFERENCES shipments(id),
  convoy_id      UUID REFERENCES convoys(id),
  name           VARCHAR(255) NOT NULL,
  location_name  VARCHAR(255),
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  sequence_order INTEGER DEFAULT 0,
  status         VARCHAR(50) DEFAULT 'pending'
                 CHECK (status IN ('pending','reached','skipped','delayed')),
  expected_at    TIMESTAMPTZ,
  reached_at     TIMESTAMPTZ,
  delay_minutes  INTEGER DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_shipment ON checkpoints(shipment_id);

CREATE TABLE IF NOT EXISTS trips (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           UUID NOT NULL REFERENCES vehicles(id),
  driver_id            UUID REFERENCES drivers(id),
  convoy_id            UUID REFERENCES convoys(id),
  shipment_id          UUID REFERENCES shipments(id),
  status               VARCHAR(50) DEFAULT 'active'
                       CHECK (status IN ('active','completed','aborted')),
  start_lat            DECIMAL(10,7),
  start_lng            DECIMAL(10,7),
  end_lat              DECIMAL(10,7),
  end_lng              DECIMAL(10,7),
  start_address        TEXT,
  end_address          TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  distance_km          DECIMAL(8,2) DEFAULT 0,
  duration_minutes     INTEGER DEFAULT 0,
  avg_speed            DECIMAL(6,2) DEFAULT 0,
  max_speed            DECIMAL(6,2) DEFAULT 0,
  fuel_used            DECIMAL(8,2),
  fuel_cost            DECIMAL(8,2),
  harsh_braking_count  INTEGER DEFAULT 0,
  speeding_violations  INTEGER DEFAULT 0,
  idle_minutes         INTEGER DEFAULT 0,
  route_deviation_km   DECIMAL(6,2) DEFAULT 0,
  driver_score         INTEGER DEFAULT 100,
  cost_usd             DECIMAL(10,2),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_driver  ON trips(driver_id,  started_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  VARCHAR(100) UNIQUE NOT NULL,
  shipment_id     UUID REFERENCES shipments(id),
  trip_id         UUID REFERENCES trips(id),
  customer_name   VARCHAR(255) NOT NULL,
  customer_email  VARCHAR(255),
  status          VARCHAR(50) DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate        DECIMAL(5,4)  DEFAULT 0.0,
  tax_amount      DECIMAL(12,2) DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency        VARCHAR(10) DEFAULT 'USD',
  line_items      JSONB DEFAULT '[]',
  due_date        TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID REFERENCES trips(id),
  vehicle_id   UUID REFERENCES vehicles(id),
  driver_id    UUID REFERENCES drivers(id),
  category     VARCHAR(100) NOT NULL
               CHECK (category IN ('fuel','maintenance','toll','permit','driver_allowance','other')),
  amount       DECIMAL(10,2) NOT NULL,
  currency     VARCHAR(10) DEFAULT 'USD',
  description  TEXT,
  receipt_url  VARCHAR(500),
  recorded_by  UUID REFERENCES users(id),
  expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_trip    ON expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON expenses(vehicle_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id              UUID NOT NULL REFERENCES vehicles(id),
  type                    VARCHAR(100) NOT NULL
                          CHECK (type IN ('scheduled','breakdown','inspection','recall','upgrade')),
  title                   VARCHAR(255) NOT NULL,
  description             TEXT,
  status                  VARCHAR(50) DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  priority                VARCHAR(50) DEFAULT 'medium'
                          CHECK (priority IN ('low','medium','high','critical')),
  odometer_at_service     DECIMAL(10,2),
  engine_hours_at_service DECIMAL(10,2),
  cost                    DECIMAL(10,2),
  parts                   JSONB DEFAULT '[]',
  workshop                VARCHAR(255),
  technician              VARCHAR(255),
  notes                   TEXT,
  scheduled_at            TIMESTAMPTZ,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  next_service_km         DECIMAL(10,2),
  next_service_date       TIMESTAMPTZ,
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance_records(vehicle_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_maint_status  ON maintenance_records(status) WHERE status != 'completed';

CREATE TABLE IF NOT EXISTS risk_zones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  risk_level  VARCHAR(50) DEFAULT 'medium'
              CHECK (risk_level IN ('low','medium','high','critical','no_go')),
  zone_type   VARCHAR(100) DEFAULT 'general'
              CHECK (zone_type IN ('conflict','theft_hotspot','flood','road_closed','customs','checkpoint','restricted','no_go')),
  lat         DECIMAL(10,7) NOT NULL,
  lng         DECIMAL(10,7) NOT NULL,
  radius_km   DECIMAL(6,2) DEFAULT 5,
  polygon     JSONB,
  active      BOOLEAN DEFAULT true,
  valid_from  TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  source      VARCHAR(100),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_zones_active ON risk_zones(risk_level) WHERE active = true;

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  type       VARCHAR(100) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB DEFAULT '{}',
  channel    VARCHAR(50) DEFAULT 'in_app'
             CHECK (channel IN ('in_app','email','sms','push')),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS driver_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES drivers(id),
  vehicle_id  UUID REFERENCES vehicles(id),
  trip_id     UUID REFERENCES trips(id),
  event_type  VARCHAR(100) NOT NULL
              CHECK (event_type IN ('harsh_braking','harsh_acceleration','speeding','idling','geofence_breach','fatigue_alert','phone_use','seatbelt','sos')),
  severity    VARCHAR(50) DEFAULT 'medium',
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  speed       DECIMAL(6,2),
  score_impact INTEGER DEFAULT 0,
  details     JSONB DEFAULT '{}',
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_events_driver ON driver_events(driver_id, timestamp DESC);

-- ── Guardian / CFO tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guardian_devices (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token                    UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name                     TEXT NOT NULL,
  imei                     TEXT,
  model                    TEXT,
  os_version               TEXT,
  app_version              TEXT,
  status                   TEXT DEFAULT 'pending',
  assignment_type          TEXT,
  assignment_id            UUID,
  panic_active             BOOLEAN DEFAULT false,
  last_seen                TIMESTAMPTZ,
  last_lat                 DECIMAL(10,7),
  last_lng                 DECIMAL(10,7),
  last_speed               DECIMAL(6,2),
  convoy_code              TEXT,
  last_checkin_at          TIMESTAMPTZ,
  last_integrity_verdict   TEXT,
  last_integrity_verdict_at TIMESTAMPTZ,
  enrolled_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_locations (
  id        BIGSERIAL   PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
  lat       DECIMAL(10,7) NOT NULL,
  lng       DECIMAL(10,7) NOT NULL,
  altitude  DECIMAL(8,2),
  heading   DECIMAL(6,2),
  speed     DECIMAL(6,2),
  accuracy  DECIMAL(8,2),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_health (
  id               BIGSERIAL   PRIMARY KEY,
  device_id        UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
  battery_level    INT,
  battery_charging BOOLEAN,
  signal_strength  INT,
  network_type     TEXT,
  storage_free_mb  INT,
  ram_free_mb      INT,
  app_version      TEXT,
  recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS panic_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES guardian_devices(id),
  mode        TEXT NOT NULL,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  message     TEXT,
  event_uuid  UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_commands (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    UUID NOT NULL REFERENCES guardian_devices(id),
  command_type TEXT NOT NULL,
  payload      JSONB,
  status       TEXT DEFAULT 'pending',
  result       TEXT,
  issued_by    UUID,
  issued_at    TIMESTAMPTZ DEFAULT NOW(),
  executed_at  TIMESTAMPTZ,
  nonce        TEXT,
  sent_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  signature    TEXT
);

CREATE TABLE IF NOT EXISTS field_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   UUID NOT NULL REFERENCES guardian_devices(id),
  category    TEXT NOT NULL,
  severity    TEXT DEFAULT 'medium',
  description TEXT,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  photo_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guardian_config (
  key         TEXT PRIMARY KEY,
  value_int   INT,
  value_text  TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO guardian_config (key, value_int, description) VALUES
  ('min_apk_version_code',        5,   'Heartbeat rejects APKs below this versionCode'),
  ('audit_log_archive_enabled',   0,   'Archive audit log rows to R2 before GDPR deletion'),
  ('dms_default_interval_minutes',60,  'Default dead-man switch interval in minutes'),
  ('dms_max_interval_minutes',    120, 'Maximum allowed DMS interval'),
  ('cfo_module_enabled',          0,   'CFO module feature flag')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS guardian_audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin','device','system')),
  actor_id    UUID,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  payload     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollment_codes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  used_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS convoy_codes (
  code        TEXT PRIMARY KEY,
  created_by  UUID REFERENCES users(id),
  max_members INT DEFAULT 50,
  expires_at  TIMESTAMPTZ,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cfo_login_attempts (
  device_id    UUID        PRIMARY KEY,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guardian_command_nonces (
  device_id UUID        NOT NULL,
  nonce     TEXT        NOT NULL,
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_command_nonces_seen_at ON guardian_command_nonces(seen_at);

CREATE TABLE IF NOT EXISTS convoy_trucks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id         UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  vehicle_id        UUID NOT NULL,
  driver_name       TEXT NOT NULL,
  driver_phone      TEXT,
  driver_license_no TEXT,
  position          INT  NOT NULL CHECK (position BETWEEN 1 AND 6),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, vehicle_id),
  UNIQUE (convoy_id, position)
);
CREATE INDEX IF NOT EXISTS idx_convoy_trucks_convoy_id ON convoy_trucks(convoy_id);

CREATE TABLE IF NOT EXISTS convoy_cfos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id          UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  cfo_user_id        UUID NOT NULL REFERENCES users(id),
  guardian_device_id UUID REFERENCES guardian_devices(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, cfo_user_id)
);
CREATE INDEX IF NOT EXISTS idx_convoy_cfos_cfo_user_id ON convoy_cfos(cfo_user_id);

CREATE TABLE IF NOT EXISTS convoy_cfo_truck_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id   UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  cfo_user_id UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS convoy_truck_photos (
  id                 UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id          UUID             NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  convoy_truck_id    UUID             NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
  cfo_user_id        UUID             NOT NULL REFERENCES users(id),
  guardian_device_id UUID             REFERENCES guardian_devices(id),
  session            TEXT             NOT NULL CHECK (session IN ('sod','eod')),
  photo_type         TEXT             NOT NULL CHECK (photo_type IN ('front','rear','seal')),
  seal_position      TEXT,
  report_date        DATE             NOT NULL,
  photo_url          TEXT             NOT NULL,
  taken_at           TIMESTAMPTZ      NOT NULL,
  uploaded_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  event_uuid         UUID             NOT NULL,
  location_mismatch  BOOLEAN          NOT NULL DEFAULT false,
  notes              TEXT,
  created_at         TIMESTAMPTZ      DEFAULT NOW(),
  UNIQUE (event_uuid)
);
CREATE INDEX IF NOT EXISTS idx_ctp_convoy_date       ON convoy_truck_photos(convoy_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ctp_truck_date_session ON convoy_truck_photos(convoy_truck_id, report_date, session, photo_type);
CREATE INDEX IF NOT EXISTS idx_ctp_cfo_date          ON convoy_truck_photos(cfo_user_id, report_date);

CREATE TABLE IF NOT EXISTS convoy_daily_reports (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id            UUID  NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  report_date          DATE  NOT NULL,
  status               TEXT  NOT NULL
                       CHECK (status IN ('pending','partial','complete','generated','failed')),
  required_photo_count INT   NOT NULL,
  received_photo_count INT   NOT NULL DEFAULT 0,
  pdf_url              TEXT,
  content_hash         TEXT,
  generated_at         TIMESTAMPTZ,
  generation_error     TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, report_date)
);
CREATE INDEX IF NOT EXISTS idx_cdr_status      ON convoy_daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_cdr_convoy_date ON convoy_daily_reports(convoy_id, report_date DESC);

-- ── App infrastructure tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS geofences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(50),
  coordinates JSONB,
  radius      DECIMAL(10,2),
  region      VARCHAR(100),
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geofence_actions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  geofence_id       UUID REFERENCES geofences(id) ON DELETE CASCADE,
  action_type       VARCHAR(100),
  recipient         TEXT,
  message_template  TEXT,
  enabled           BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_logs (
  id          BIGSERIAL   PRIMARY KEY,
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id),
  temperature DECIMAL(6,2),
  humidity    DECIMAL(6,2),
  shock_g     DECIMAL(6,2),
  raw_payload JSONB,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sensor_vehicle ON sensor_logs(vehicle_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  key_hash    TEXT         NOT NULL UNIQUE,
  key_prefix  VARCHAR(20)  NOT NULL,
  permissions JSONB DEFAULT '[]',
  rate_limit  INTEGER DEFAULT 1000,
  last_used   TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id   UUID REFERENCES convoys(id),
  type        VARCHAR(100),
  title       VARCHAR(255),
  metadata    JSONB DEFAULT '{}',
  valid_until TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(100) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  data       JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id         BIGSERIAL   PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  fuel_level DECIMAL(6,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_logs(vehicle_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id          BIGSERIAL   PRIMARY KEY,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ── Seed default channels ─────────────────────────────────────────────────────
INSERT INTO channels (name, description) VALUES
  ('ops-general',  'General operations channel'),
  ('kenya-convoy', 'Kenya region convoys'),
  ('drc-convoy',   'DRC region convoys'),
  ('alerts',       'System alerts and broadcasts')
ON CONFLICT (name) DO NOTHING;
