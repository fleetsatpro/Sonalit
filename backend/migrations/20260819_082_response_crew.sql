-- Response Crew: tables for response teams, crew members, and intercept dispatches.
-- Formalises the response_teams table already queried by dashboard.js §2.12.

BEGIN;

-- ── response_teams (already referenced but never formally migrated) ──────────
CREATE TABLE IF NOT EXISTS response_teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'reaction',
  callsign      TEXT,
  location      TEXT,
  base_lat      DOUBLE PRECISION,
  base_lng      DOUBLE PRECISION,
  eta_minutes   INT DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'standby',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_response_teams_org ON response_teams(org_id) WHERE active = true;

-- ── response_crew_members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS response_crew_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id),
  team_id       UUID NOT NULL REFERENCES response_teams(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id),
  name          TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'responder',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_members_team ON response_crew_members(team_id) WHERE active = true;

-- ── intercept_dispatches ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intercept_dispatches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id),
  team_id       UUID NOT NULL REFERENCES response_teams(id),
  alert_id      UUID,
  panic_id      UUID,
  convoy_id     UUID,
  vehicle_id    UUID,
  priority      TEXT NOT NULL DEFAULT 'high',
  status        TEXT NOT NULL DEFAULT 'dispatched',
  reason        TEXT NOT NULL,
  target_lat    DOUBLE PRECISION NOT NULL,
  target_lng    DOUBLE PRECISION NOT NULL,
  target_label  TEXT,
  dispatched_by UUID REFERENCES users(id),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  arrived_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  resolution_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatches_org_status ON intercept_dispatches(org_id, status)
  WHERE status IN ('dispatched', 'en_route', 'on_scene');

-- Add response_crew to the users role constraint (alongside yard_agent, port_agent)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','dispatcher','operator','analyst','cfo','yard_agent','port_agent','response_crew'));

COMMIT;
