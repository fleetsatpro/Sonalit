-- Catch-up migration: the entire Guardian CFO photo-verification schema
-- (convoy_trucks, convoy_cfos, convoy_cfo_truck_assignments, convoy_truck_photos,
-- convoy_daily_reports, plus the convoys/users column and CHECK-constraint
-- extensions they depend on) was originally applied straight to production via
-- one-off scripts in backend/scripts/archive/migrate-guardian-cfo-p1/p2/p3.js,
-- run directly with `node`, never through this tracked migration pipeline and
-- never recorded in schema_migrations. Later tracked migrations (036 onward)
-- already assume these tables exist, so a fresh database run through
-- backend/migrations/*.sql from scratch fails partway through. This file
-- reproduces that DDL verbatim (idempotently) so a fresh environment ends up
-- schema-identical to production instead of erroring on a missing table.
-- Placed at "015b" (after 015, before 016) so it runs before 036, which is the
-- first later migration to reference convoy_trucks.

-- ── users.role: allow 'cfo' ───────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_cfo_check;
ALTER TABLE users ADD CONSTRAINT users_role_cfo_check
  CHECK (role IN ('admin','dispatcher','operator','analyst','cfo'));

-- ── convoys: CFO-related columns + status extension ──────────────────────────
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS seal_count_per_truck INT NOT NULL DEFAULT 3;
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS archive_pdf_url TEXT;

ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_status_check;
ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_status_cfo_check;
ALTER TABLE convoys ADD CONSTRAINT convoys_status_cfo_check
  -- Must match migration 041's convoys_status_check list exactly ('completing'
  -- included) — this migration was failing on every single deploy since it
  -- shipped because a live convoy already has status='completing' (the
  -- "completing/handover" feature from migration 041, itself never able to
  -- run because it comes after this one in sort order and this one never
  -- succeeded), and this constraint's list didn't have it. That blocked every
  -- migration from 016 onward — including 049's convoy_daily_reports.pdf_data
  -- column — from ever applying, on every deploy since.
  CHECK (status IN ('planned','active','completing','completed','aborted','cancelled'));

ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_seal_count_check;
ALTER TABLE convoys ADD CONSTRAINT convoys_seal_count_check
  CHECK (seal_count_per_truck BETWEEN 1 AND 6);

-- ── convoy_trucks ──────────────────────────────────────────────────────────────
-- vehicle_id is nullable here (not NOT NULL like the original p1 script) to
-- match migration 047, which later dropped that constraint on production —
-- a fresh DB should land directly on the final, current shape.
CREATE TABLE IF NOT EXISTS convoy_trucks (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id         UUID    NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  vehicle_id        UUID,
  driver_name       TEXT    NOT NULL,
  driver_phone      TEXT,
  driver_license_no TEXT,
  registration      TEXT,
  position          INT     NOT NULL CHECK (position BETWEEN 1 AND 6),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, vehicle_id),
  UNIQUE (convoy_id, position)
);
CREATE INDEX IF NOT EXISTS idx_convoy_trucks_convoy_id ON convoy_trucks(convoy_id);

CREATE OR REPLACE FUNCTION enforce_convoy_truck_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM convoy_trucks WHERE convoy_id = NEW.convoy_id) >= 6 THEN
    RAISE EXCEPTION 'convoy_truck_limit_exceeded: a convoy may have at most 6 trucks';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_convoy_truck_limit ON convoy_trucks;
CREATE TRIGGER trg_enforce_convoy_truck_limit
  BEFORE INSERT ON convoy_trucks
  FOR EACH ROW EXECUTE FUNCTION enforce_convoy_truck_limit();

-- ── convoy_cfos ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convoy_cfos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id          UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  cfo_user_id        UUID NOT NULL REFERENCES users(id),
  guardian_device_id UUID REFERENCES guardian_devices(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, cfo_user_id)
);
CREATE INDEX IF NOT EXISTS idx_convoy_cfos_cfo_user_id ON convoy_cfos(cfo_user_id);

-- ── convoy_cfo_truck_assignments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convoy_cfo_truck_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id       UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  cfo_user_id     UUID NOT NULL REFERENCES users(id),
  convoy_truck_id UUID NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, cfo_user_id, convoy_truck_id),
  UNIQUE (convoy_truck_id)
);
CREATE INDEX IF NOT EXISTS idx_convoy_cfo_truck_asgn ON convoy_cfo_truck_assignments(convoy_id, cfo_user_id);

CREATE OR REPLACE FUNCTION enforce_cfo_truck_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM convoy_cfo_truck_assignments
       WHERE convoy_id = NEW.convoy_id AND cfo_user_id = NEW.cfo_user_id) >= 2 THEN
    RAISE EXCEPTION 'cfo_truck_limit_exceeded: a CFO may cover at most 2 trucks in a convoy';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_cfo_truck_limit ON convoy_cfo_truck_assignments;
CREATE TRIGGER trg_enforce_cfo_truck_limit
  BEFORE INSERT ON convoy_cfo_truck_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_cfo_truck_limit();

-- ── convoy_truck_photos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convoy_truck_photos (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  convoy_id          UUID         NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  convoy_truck_id    UUID         NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
  cfo_user_id        UUID         NOT NULL REFERENCES users(id),
  guardian_device_id UUID         REFERENCES guardian_devices(id),
  session            TEXT         NOT NULL CHECK (session IN ('sod','eod')),
  photo_type         TEXT         NOT NULL CHECK (photo_type IN ('front','rear','seal')),
  seal_position      TEXT,
  report_date        DATE         NOT NULL,
  photo_url          TEXT         NOT NULL,
  taken_at           TIMESTAMPTZ  NOT NULL,
  uploaded_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  event_uuid         UUID         NOT NULL,
  location_mismatch  BOOLEAN      NOT NULL DEFAULT false,
  photo_url_hash     TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (event_uuid)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seal_position_consistency'
  ) THEN
    ALTER TABLE convoy_truck_photos
      ADD CONSTRAINT seal_position_consistency
      CHECK (
        (photo_type = 'seal' AND seal_position IS NOT NULL)
        OR
        (photo_type IN ('front','rear') AND seal_position IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ctp_convoy_date ON convoy_truck_photos(convoy_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ctp_truck_date_session ON convoy_truck_photos(convoy_truck_id, report_date, session, photo_type);
CREATE INDEX IF NOT EXISTS idx_ctp_cfo_date ON convoy_truck_photos(cfo_user_id, report_date);
CREATE INDEX IF NOT EXISTS idx_convoy_truck_photos_hash
  ON convoy_truck_photos(convoy_id, session, photo_url_hash) WHERE photo_url_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_truck_photo_front_rear
  ON convoy_truck_photos(convoy_truck_id, report_date, session, photo_type)
  WHERE photo_type IN ('front','rear');

CREATE UNIQUE INDEX IF NOT EXISTS ux_truck_photo_seal
  ON convoy_truck_photos(convoy_truck_id, report_date, session, seal_position)
  WHERE photo_type = 'seal';

-- ── convoy_daily_reports ───────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_cdr_status ON convoy_daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_cdr_convoy_date ON convoy_daily_reports(convoy_id, report_date DESC);

-- ── guardian_config: cfo_module_enabled flag ──────────────────────────────────
-- Default OFF; ON CONFLICT DO NOTHING preserves production's already-enabled
-- state (see backend/scripts/archive/migrate-enable-cfo.js) rather than
-- resetting it.
INSERT INTO guardian_config (key, value_int, value_text, updated_at)
VALUES ('cfo_module_enabled', 0, NULL, NOW())
ON CONFLICT (key) DO NOTHING;
