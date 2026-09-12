-- A login system for the Field app that shares nothing with the operator app.
--
-- The operator app authenticates a *person* at a desk: email + password, a JWT
-- in memory, an httpOnly refresh cookie, CSRF double-submit. None of that fits a
-- shared yard tablet — one device passed between crews, worn gloves, no
-- keyboard, and a dead zone between the gate and the stack. Worse, sharing the
-- session machinery means signing into Field on a phone silently signs you out
-- of the operator app in the next tab, and a stolen yard tablet carries a
-- credential that unlocks the whole dashboard.
--
-- So Field gets its own two-factor-ish scheme, built from two independent
-- credentials:
--
--   1. The DEVICE. An admin enrols a tablet once with a short pairing code; the
--      device exchanges it for a long-lived opaque token it keeps forever (or
--      until revoked). This is the "is this one of our tablets" factor, and it
--      is what makes a lost device revocable centrally without touching any
--      worker's account.
--   2. The WORKER. Each yard/port agent has a numeric PIN — fast to enter with
--      gloves on — that is only accepted *on a paired device*. This is the
--      "who is holding it right now" factor, and it is what keeps every clamp
--      attributable to a named person, which the custody chain in migration 078
--      depends on.
--
-- Neither credential is a cookie and neither is a JWT, so a Field session and
-- an operator session can coexist in the same browser without either one
-- being able to end, read, or escalate into the other.

-- ─── Paired devices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_devices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL,
  label               TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  -- Free text on purpose: sites are named by whoever runs them ("Gate 3",
  -- "ICD Embakasi apron"), and a lookup table here would be one more thing to
  -- administer for a string that is only ever shown back to the crew.
  site                TEXT        CHECK (char_length(site) <= 80),

  -- Which side of the flow this tablet is for. NULL = whatever the signed-in
  -- worker's role allows, which is the sensible default for a supervisor's
  -- device; setting it pins a gate tablet to one job even if a port agent
  -- wanders over and signs in.
  scope               TEXT        CHECK (scope IN ('yard','port')),

  -- Only ever stored hashed. The plaintext exists for exactly as long as it
  -- takes the admin to read it off the screen and type it into the tablet.
  pairing_code_hash   CHAR(64),
  pairing_expires_at  TIMESTAMPTZ,
  token_hash          CHAR(64)    UNIQUE,

  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','revoked')),
  paired_at           TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_field_devices_org ON field_devices(org_id, created_at DESC);
-- Pairing looks a code up across orgs (the tablet has no org yet), so this
-- index is deliberately not org-scoped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_devices_pairing
  ON field_devices(pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;

-- ─── Per-worker PINs ─────────────────────────────────────────────────────────
-- Kept out of users.password_hash on purpose. That column is the operator
-- credential; a 4-digit PIN must never be accepted by POST /auth/login, and an
-- operator password must never be typed into a shared tablet. Separate columns
-- keep the two credentials from ever being interchangeable by accident.
CREATE TABLE IF NOT EXISTS field_agent_pins (
  user_id         UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID        NOT NULL,
  pin_hash        TEXT        NOT NULL,
  -- Set when an admin issues or resets a PIN, cleared once the worker picks
  -- their own — so the PIN the admin knows is never the one left in service.
  must_change     BOOLEAN     NOT NULL DEFAULT TRUE,
  -- A 4-digit PIN is only 10k guesses; bcrypt does not make that expensive
  -- enough to matter. The lockout below is the actual defence, so it is not
  -- optional hardening — it is the control.
  failed_attempts INTEGER     NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  set_by          UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_pins_org ON field_agent_pins(org_id);

-- ─── Shift sessions ──────────────────────────────────────────────────────────
-- Opaque and server-side, not a JWT: handing a shared tablet to the next crew
-- has to end the previous worker's access *immediately*, and a self-contained
-- token can't be taken back before it expires.
CREATE TABLE IF NOT EXISTS field_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL,
  device_id    UUID        NOT NULL REFERENCES field_devices(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)    NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_field_sessions_device ON field_sessions(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_sessions_user ON field_sessions(user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Credential lookups run before an org is known (a token is presented, the org
-- is what comes back), so those queries use the unscoped pool the way
-- middleware/auth.js already does for its users lookup. These policies cover
-- the admin-facing reads, which do run org-scoped through req.db.
ALTER TABLE field_devices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_agent_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_sessions   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_devices','field_agent_pins','field_sessions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'org_isolation_' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org_id'', true)::UUID)',
        'org_isolation_' || t, t
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON field_devices    TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_agent_pins TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_sessions   TO sonalit_app;
