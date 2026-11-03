-- Convoy Day Plans (Guardian Convoy app)
-- CFO sets a plan each morning: start point, night park, and waypoints
-- Waypoints are auto-detected by GPS proximity but CFO confirms reaching them

CREATE TABLE IF NOT EXISTS convoy_day_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  convoy_id         TEXT NOT NULL,
  cfo_id            TEXT NOT NULL,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  start_label       TEXT,
  start_lat         DECIMAL(9,6),
  start_lng         DECIMAL(9,6),
  night_park_label  TEXT NOT NULL,
  night_park_lat    DECIMAL(9,6),
  night_park_lng    DECIMAL(9,6),
  modified_at       TIMESTAMPTZ,
  modified_reason   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (convoy_id, cfo_id, date)
);
ALTER TABLE convoy_day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_day_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY convoy_day_plans_org ON convoy_day_plans
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE TABLE IF NOT EXISTS convoy_day_plan_waypoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  plan_id      UUID NOT NULL REFERENCES convoy_day_plans(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  label        TEXT NOT NULL,
  lat          DECIMAL(9,6) NOT NULL,
  lng          DECIMAL(9,6) NOT NULL,
  radius_m     INTEGER NOT NULL DEFAULT 500,
  reached_at   TIMESTAMPTZ,
  reached_lat  DECIMAL(9,6),
  reached_lng  DECIMAL(9,6),
  UNIQUE (plan_id, seq)
);
ALTER TABLE convoy_day_plan_waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_day_plan_waypoints FORCE ROW LEVEL SECURITY;
CREATE POLICY convoy_day_plan_waypoints_org ON convoy_day_plan_waypoints
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_day_plans_convoy_date ON convoy_day_plans (convoy_id, date);
CREATE INDEX IF NOT EXISTS idx_day_plan_waypoints_plan ON convoy_day_plan_waypoints (plan_id, seq);
