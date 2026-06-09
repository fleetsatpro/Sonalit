-- Guardian Convoy App tables
-- photo_uploads, convoy_reports, seal_verifications, sos_events

-- photo_uploads: stores committed photo metadata after R2 upload
CREATE TABLE IF NOT EXISTS photo_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id),
  convoy_id     TEXT NOT NULL,
  cfo_id        TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('sod','eod')),
  photo_type    TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  r2_url        TEXT NOT NULL,
  lat           DECIMAL(9,6),
  lng           DECIMAL(9,6),
  accuracy_m    INTEGER,
  plate_number  TEXT,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE photo_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY photo_uploads_org ON photo_uploads USING (org_id = current_setting('app.org_id')::UUID);

-- convoy_reports: per-CFO per-convoy per-day report record
CREATE TABLE IF NOT EXISTS convoy_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id),
  convoy_id         TEXT NOT NULL,
  cfo_id            TEXT NOT NULL,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  status            TEXT NOT NULL DEFAULT 'in_progress',
  sod_submitted_at  TIMESTAMPTZ,
  eod_submitted_at  TIMESTAMPTZ,
  arrival_at        TIMESTAMPTZ,
  arrival_lat       DECIMAL(9,6),
  arrival_lng       DECIMAL(9,6),
  pdf_url           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT convoy_reports_status_check CHECK (status IN ('in_progress','sod_complete','eod_complete')),
  UNIQUE (convoy_id, cfo_id, date)
);
ALTER TABLE convoy_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY convoy_reports_org ON convoy_reports USING (org_id = current_setting('app.org_id')::UUID);

-- seal_verifications: seal scan records per report phase
CREATE TABLE IF NOT EXISTS seal_verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id),
  report_id      UUID REFERENCES convoy_reports(id),
  seal_serial    TEXT NOT NULL,
  vehicle_plate  TEXT NOT NULL,
  position       TEXT NOT NULL,
  phase          TEXT NOT NULL CHECK (phase IN ('sod','eod')),
  photo_id       UUID REFERENCES photo_uploads(id),
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','tampered','missing')),
  verified_at    TIMESTAMPTZ DEFAULT NOW(),
  lat            DECIMAL(9,6),
  lng            DECIMAL(9,6),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE seal_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE seal_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY seal_verifications_org ON seal_verifications USING (org_id = current_setting('app.org_id')::UUID);

-- sos_events: SOS / panic events from CFO in the field
CREATE TABLE IF NOT EXISTS sos_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id),
  convoy_id      TEXT NOT NULL,
  cfo_id         TEXT NOT NULL,
  incident_type  TEXT NOT NULL DEFAULT 'unspecified',
  lat            DECIMAL(9,6),
  lng            DECIMAL(9,6),
  accuracy_m     INTEGER,
  acknowledged   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sos_events_org ON sos_events USING (org_id = current_setting('app.org_id')::UUID);
