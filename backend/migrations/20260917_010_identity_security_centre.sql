-- Sonalit Identity & Security Centre
-- Additive/idempotent. No existing operational data is deleted or rewritten.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS identity_access_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  organization    TEXT,
  role_requested  TEXT NOT NULL DEFAULT 'operator',
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_identity_access_requests_org_status
  ON identity_access_requests(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_access_requests_email
  ON identity_access_requests(lower(email));

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON refresh_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL AND revoked_at IS NULL;
