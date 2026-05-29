-- S2-F6: Shift & Roster Management
-- RULE A: ENABLE + FORCE RLS + org_isolation

-- ─── shifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  driver_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id      UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  convoy_id       UUID REFERENCES convoys(id) ON DELETE SET NULL,
  role            VARCHAR(50) NOT NULL DEFAULT 'driver',
  -- driver | co_driver | loader | escort | supervisor
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  actual_start    TIMESTAMPTZ,
  actual_end      TIMESTAMPTZ,
  status          VARCHAR(30) DEFAULT 'scheduled',
  -- scheduled | active | completed | cancelled | no_show
  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shifts_times_check CHECK (end_time > start_time)
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON shifts;
CREATE POLICY org_isolation ON shifts
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON shifts TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_shifts_org_time ON shifts (org_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_shifts_driver ON shifts (driver_id, start_time) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (org_id, status) WHERE status IN ('scheduled','active');

-- ─── shift_handovers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_handovers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  from_shift_id   UUID REFERENCES shifts(id) ON DELETE CASCADE,
  to_shift_id     UUID REFERENCES shifts(id) ON DELETE CASCADE,
  odometer_km     NUMERIC(10,2),
  fuel_level_pct  INTEGER CHECK (fuel_level_pct BETWEEN 0 AND 100),
  condition_notes TEXT,
  seal_intact     BOOLEAN,
  voice_note_id   UUID,  -- bare UUID, FK wired in migration 029
  ack_at          TIMESTAMPTZ,
  ack_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handovers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON shift_handovers;
CREATE POLICY org_isolation ON shift_handovers
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON shift_handovers TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_shift_handovers_shift ON shift_handovers (from_shift_id, to_shift_id);
