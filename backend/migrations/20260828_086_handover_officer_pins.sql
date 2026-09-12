-- Handover-officer PIN auth (modeled on field_agent_pins but for the
-- Handover app's own login flow). Handover officers first sign in with
-- email/password to set up a PIN, then use the PIN for quick re-auth.
--
-- Unlike field_agent_pins which lives on shared tablets, handover
-- officer PINs are per-user — there is no "device pairing" concept.
-- The session token is stored in-memory like the operator JWT.

CREATE TABLE IF NOT EXISTS handover_officer_pins (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash      TEXT NOT NULL,
  must_change   BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handover_pins_locked
  ON handover_officer_pins (locked_until)
  WHERE locked_until IS NOT NULL;
