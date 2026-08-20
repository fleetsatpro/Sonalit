-- Convoy handover: local-consignment flag on convoys, the handover_officer
-- role, and a convoy_handovers table recording who signed a convoy (or one
-- of its trucks) over and with what form. Completing a convoy is gated on a
-- qualifying row existing here — see updateConvoyStatus in convoyController.js.

BEGIN;

ALTER TABLE convoys ADD COLUMN IF NOT EXISTS local_consignment BOOLEAN NOT NULL DEFAULT false;

-- Add handover_officer to the users role constraint (alongside yard_agent, port_agent, response_crew)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','dispatcher','operator','analyst','cfo','yard_agent','port_agent','response_crew','handover_officer'));

CREATE TABLE IF NOT EXISTS convoy_handovers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organisations(id),
  convoy_id              UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  -- NULL = whole-convoy handover. Set = this truck only (convoys handed over
  -- truck-by-truck as each peels off at a different destination).
  convoy_truck_id        UUID REFERENCES convoy_trucks(id) ON DELETE CASCADE,
  handed_over_by_role    TEXT NOT NULL CHECK (handed_over_by_role IN ('cfo','handover_officer')),
  handed_over_by_user_id UUID REFERENCES users(id),
  form_key               TEXT NOT NULL,
  form_url               TEXT NOT NULL,
  notes                  TEXT,
  signed_off_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_convoy_handovers_convoy ON convoy_handovers(convoy_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_convoy_handovers_org_active ON convoy_handovers(org_id, created_at DESC) WHERE deleted_at IS NULL;

-- One live whole-convoy handover row per convoy, one live per-truck row per truck.
CREATE UNIQUE INDEX IF NOT EXISTS uq_convoy_handovers_convoy_wide
  ON convoy_handovers(convoy_id) WHERE convoy_truck_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_convoy_handovers_truck
  ON convoy_handovers(convoy_id, convoy_truck_id) WHERE convoy_truck_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE convoy_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_handovers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convoy_handovers_org_isolation ON convoy_handovers;
CREATE POLICY convoy_handovers_org_isolation ON convoy_handovers
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

COMMIT;
