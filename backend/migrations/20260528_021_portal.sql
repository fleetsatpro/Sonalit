-- Cargo Owner Portal — access token table
-- Idempotent.

CREATE TABLE IF NOT EXISTS portal_tokens (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL,
  convoy_id        UUID        NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  token_hash       TEXT        NOT NULL UNIQUE,
  cargo_owner_ref  VARCHAR(128),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_used_at     TIMESTAMPTZ,
  issued_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_org
  ON portal_tokens(org_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_convoy
  ON portal_tokens(convoy_id)
  WHERE revoked_at IS NULL;

-- RLS
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON portal_tokens;
CREATE POLICY org_isolation ON portal_tokens
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON portal_tokens TO sonalit_app;
