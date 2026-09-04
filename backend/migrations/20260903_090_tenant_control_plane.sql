-- 090 — Tenant control plane.
--
-- Sonalit already isolates customer data: every tenant-owned table carries
-- org_id, RLS policies key on app.current_org_id, and withOrg() sets that
-- context transaction-locally. That mechanism is sound and is preserved
-- verbatim here — org_id remains the tenant column throughout.
--
-- What was missing is the control plane above it:
--   * org_id was a free-floating UUID with no registry, so there was no tenant
--     lifecycle, no per-tenant module entitlement, and nothing to validate an
--     org_id against.
--   * tenant authorization lived solely on users.org_id, which cannot express
--     "this identity is authorized in tenant Y with role Z" and leaves no room
--     for a second membership later.
--   * there was no representation of Sonalit's own platform scope, so a
--     platform administrator was indistinguishable from a customer admin.
--
-- This migration is purely additive. It introduces the registry, the membership
-- model, the platform scope, support sessions and the security event log, then
-- closes the RLS gaps found by auditing the live schema. No existing column,
-- policy or table is dropped or rewritten.

BEGIN;

-- ── Tenants ───────────────────────────────────────────────────────────────────
-- The registry org_id points at. data_classification is deliberately separate
-- from status: status drives authorization, classification records what the
-- rows actually are. Ownership, not an is_test flag, is the security mechanism.

CREATE TABLE IF NOT EXISTS tenants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(255) NOT NULL,
  legal_name          VARCHAR(255),
  slug                VARCHAR(120) NOT NULL,
  status              VARCHAR(32)  NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','LOCKED','ARCHIVED')),
  data_classification VARCHAR(32)  NOT NULL DEFAULT 'TENANT'
                      CHECK (data_classification IN
                        ('TENANT','PLATFORM_INTERNAL','PLATFORM_TEST','PLATFORM_DEMO','SYSTEM','QUARANTINED')),
  subscription_plan   VARCHAR(64),
  subscription_status VARCHAR(32),
  enabled_modules     TEXT[]       NOT NULL DEFAULT ARRAY[
                        'FLEET','CONVOY','GPS','ALERTS','REPORTING','CDS','E_LOCK','GEOFENCING','ANALYTICS'
                      ]::TEXT[],
  configuration       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE archived_at IS NULL;

-- Backfill: every org_id already present in the data becomes a tenant row.
-- The legacy default org (seeded by migration 001) is the live customer and is
-- activated. Anything else discovered in the data is QUARANTINED — its
-- ownership was never established, so it must not become customer-visible by
-- default. Classification is a deliberate act, not an inference.
DO $$
DECLARE
  legacy_org UUID := '00000000-0000-0000-0000-000000000001';
  found_org  UUID;
BEGIN
  INSERT INTO tenants (id, name, legal_name, slug, status, data_classification, subscription_plan, subscription_status)
  VALUES (legacy_org, 'Sonalit', 'Sonalit Ltd', 'sonalit', 'ACTIVE', 'TENANT', 'internal', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Sweep every table carrying org_id for values with no tenant row.
  FOR found_org IN
    SELECT DISTINCT u.org_id FROM users u WHERE u.org_id IS NOT NULL
    UNION
    SELECT DISTINCT v.org_id FROM vehicles v WHERE v.org_id IS NOT NULL
    UNION
    SELECT DISTINCT c.org_id FROM convoys c WHERE c.org_id IS NOT NULL
  LOOP
    INSERT INTO tenants (id, name, legal_name, slug, status, data_classification)
    VALUES (
      found_org,
      'Unclassified org ' || left(found_org::text, 8),
      NULL,
      'quarantined-' || left(found_org::text, 8),
      'LOCKED',
      'QUARANTINED'
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- ── Memberships ───────────────────────────────────────────────────────────────
-- "User X is authorized to operate inside tenant Y with role Z."
-- users.org_id is retained so existing queries and RLS keep working unchanged;
-- membership becomes the authorization record the security context is built
-- from. The unique index is on (user_id, tenant_id), not user_id alone, so the
-- model can carry multiple memberships later without another migration.

CREATE TABLE IF NOT EXISTS memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  role       VARCHAR(50)  NOT NULL,
  status     VARCHAR(32)  NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  is_primary BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_user_tenant ON memberships(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON memberships(user_id) WHERE revoked_at IS NULL;

-- Backfill one membership per existing user from users.org_id, carrying the
-- role already on the user record so nobody's access changes on deploy.
INSERT INTO memberships (user_id, tenant_id, role, status, is_primary)
SELECT u.id, u.org_id, u.role,
       CASE WHEN u.status = 'active' THEN 'ACTIVE' ELSE 'SUSPENDED' END,
       TRUE
FROM users u
WHERE u.org_id IS NOT NULL
  AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = u.org_id)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- ── Platform scope ────────────────────────────────────────────────────────────
-- Platform authority lives in its own table, never on the user row and never in
-- a token claim. A tenant administrator manages memberships; there is no write
-- path from tenant user management into this table, so tenant-side compromise
-- cannot mint platform scope. Granting it is a deliberate operator action.

CREATE TABLE IF NOT EXISTS platform_admins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(32) NOT NULL DEFAULT 'PLATFORM_ADMIN'
              CHECK (role IN ('PLATFORM_ADMIN','PLATFORM_SUPPORT','PLATFORM_READONLY')),
  status      VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  granted_by  UUID REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  note        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admins_user ON platform_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_admins_active ON platform_admins(status) WHERE revoked_at IS NULL;

-- ── Support mode ──────────────────────────────────────────────────────────────
-- Explicit, reason-bound, time-limited, read-only by default, and auditable —
-- rather than invisible impersonation or a permanent privilege escalation.
-- A support session grants a platform admin a *tenant-scoped* context, so RLS
-- keeps protecting that tenant's data while the session is active.

CREATE TABLE IF NOT EXISTS support_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  access_level    VARCHAR(16) NOT NULL DEFAULT 'READ_ONLY'
                  CHECK (access_level IN ('READ_ONLY','READ_WRITE')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  ended_reason    VARCHAR(32),
  CONSTRAINT support_session_window CHECK (expires_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_live
  ON support_sessions(platform_user_id, expires_at DESC) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_support_sessions_tenant
  ON support_sessions(tenant_id, started_at DESC);

-- ── Security events ───────────────────────────────────────────────────────────
-- Deliberately separate from audit_logs. audit_logs is the hash-chained record
-- of data mutations; this is the security event stream (authn, authz failures,
-- tenant lifecycle, support mode, exports). Keeping them apart lets the
-- security-critical stream be retained on its own schedule rather than being
-- buried under high-volume operational telemetry.

CREATE TABLE IF NOT EXISTS security_events (
  id            BIGSERIAL PRIMARY KEY,
  event_id      UUID NOT NULL DEFAULT gen_random_uuid(),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action        VARCHAR(64) NOT NULL,
  result        VARCHAR(16) NOT NULL CHECK (result IN ('SUCCESS','FAILURE','DENIED')),
  scope         VARCHAR(16) CHECK (scope IN ('PLATFORM','TENANT','ANONYMOUS')),
  actor_id      UUID,
  tenant_id     UUID,
  membership_id UUID,
  resource_type VARCHAR(64),
  resource_id   TEXT,
  request_id    TEXT,
  source_ip     INET,
  user_agent    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_security_events_time   ON security_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_tenant ON security_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_actor  ON security_events(actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_denied
  ON security_events(occurred_at DESC) WHERE result IN ('DENIED','FAILURE');

-- ── Customer account requests ─────────────────────────────────────────────────
-- Customers request access; Sonalit reviews and provisions. Internal review
-- notes stay platform-private and are never exposed on the customer-facing
-- read path.

CREATE TABLE IF NOT EXISTS tenant_access_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   VARCHAR(255) NOT NULL,
  contact_name   VARCHAR(255) NOT NULL,
  contact_email  VARCHAR(255) NOT NULL,
  contact_phone  VARCHAR(64),
  country        VARCHAR(100),
  fleet_size     INTEGER,
  message        TEXT,
  status         VARCHAR(32) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  internal_notes TEXT,
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  tenant_id      UUID REFERENCES tenants(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_access_requests_status
  ON tenant_access_requests(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_access_requests_open_email
  ON tenant_access_requests(lower(contact_email)) WHERE status = 'PENDING';

-- ── Activation tokens ─────────────────────────────────────────────────────────
-- Single-use, short-lived, revocable, stored as a SHA-256 hash so a database
-- read cannot yield a usable token. Never a permanent password.

CREATE TABLE IF NOT EXISTS activation_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  CHAR(64) NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose     VARCHAR(32) NOT NULL DEFAULT 'ACTIVATION'
              CHECK (purpose IN ('ACTIVATION','PASSWORD_RESET','MFA_ENROLL')),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_tokens_hash ON activation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_activation_tokens_user
  ON activation_tokens(user_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ── Referential integrity: org_id now means something ─────────────────────────
-- users.org_id gains a real foreign key to the registry. NOT VALID first so the
-- migration takes no lengthy lock on a live table, then validated separately —
-- VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock and does not
-- block reads or writes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_org_tenant') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_org_tenant
      FOREIGN KEY (org_id) REFERENCES tenants(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE users VALIDATE CONSTRAINT fk_users_org_tenant;

-- Cross-tenant referential integrity for memberships: a membership's tenant and
-- the user's own org must agree while the model is single-membership. Enforced
-- as a trigger rather than a composite FK because users.org_id has no unique
-- constraint to point a composite key at.
CREATE OR REPLACE FUNCTION memberships_tenant_consistency() RETURNS TRIGGER AS $$
DECLARE user_org UUID;
BEGIN
  SELECT org_id INTO user_org FROM users WHERE id = NEW.user_id;
  IF user_org IS NOT NULL AND NEW.is_primary AND NEW.tenant_id <> user_org THEN
    RAISE EXCEPTION 'membership tenant % does not match user org % (cross-tenant membership rejected)',
      NEW.tenant_id, user_org;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memberships_tenant_consistency ON memberships;
CREATE TRIGGER trg_memberships_tenant_consistency
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_tenant_consistency();

-- guardian_crash_reports is created by runtime DDL in routes/guardian.js rather
-- than by a migration, so it never went through the RLS discipline the migration
-- path applies and it does not exist in a freshly migrated database at all — it
-- appears the first time that route runs. Declaring it here brings it under the
-- same policy as everything else; the CREATE TABLE IF NOT EXISTS in the route
-- remains harmless once the table exists.
CREATE TABLE IF NOT EXISTS guardian_crash_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       UUID REFERENCES guardian_devices(id) ON DELETE CASCADE,
  org_id          UUID,
  app_version     TEXT,
  app_build       BIGINT,
  android_version TEXT,
  sdk_int         INT,
  device_model    TEXT,
  thread          TEXT,
  stack_trace     TEXT,
  occurred_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardian_crash_reports_org
  ON guardian_crash_reports(org_id, created_at DESC);

-- ── Close the RLS gaps found by auditing the live schema ──────────────────────
-- These eleven tables carry org_id but were never brought under RLS, so the
-- database was not backing up the application's tenant filtering on them.
-- Same policy shape as migration 001: USING alone, which PostgreSQL also
-- applies as the WITH CHECK expression for INSERT and UPDATE on a FOR ALL
-- policy — that is what blocks writing a row into another tenant.

DO $$
DECLARE
  tbl      TEXT;
  col_type TEXT;
  predicate TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'alert_rules', 'audit_logs', 'device_commands', 'field_reports',
    'guardian_capture_events', 'guardian_captures', 'guardian_voice_messages',
    'guardian_crash_reports',
    'idempotency_keys', 'intercept_dispatches', 'response_crew_members',
    'response_teams'
  ] LOOP
    BEGIN
      SELECT data_type INTO col_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'org_id';

      IF col_type IS NULL THEN
        RAISE NOTICE 'Table % has no org_id — skipping RLS', tbl;
        CONTINUE;
      END IF;

      -- idempotency_keys stores org_id as text rather than uuid. Comparing on
      -- the setting's own type keeps each side native, so the uuid tables keep
      -- using their org_id index instead of falling back to a cast.
      IF col_type = 'uuid' THEN
        predicate := 'org_id = current_setting(''app.current_org_id'', true)::uuid';
      ELSE
        predicate := 'org_id = current_setting(''app.current_org_id'', true)';
      END IF;

      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', tbl);
      EXECUTE format('CREATE POLICY org_isolation ON %I USING (%s)', tbl, predicate);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table % not found — skipping RLS', tbl;
    END;
  END LOOP;
END $$;


-- Partitions of cds_gps_history: the parent has RLS, which covers queries routed
-- through the parent, but a query naming a partition directly is checked against
-- that partition's own policies. Without this, the partition name is a bypass.
DO $$
DECLARE part TEXT;
BEGIN
  FOR part IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'cds_gps_history' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', part);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', part);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING (org_id = current_setting(''app.current_org_id'', true)::uuid)',
      part
    );
  END LOOP;
END $$;

-- ── RLS on the control-plane tables ───────────────────────────────────────────
-- Two policies each. The tenant policy lets a customer read only its own row on
-- the tables it has any business seeing. The platform policy keys on
-- app.platform_scope, which only withPlatform() sets — customer request paths
-- never reach it. platform_admins and security_events get no tenant policy at
-- all: a customer must not be able to enumerate Sonalit's operators or read the
-- security stream.

ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_tokens      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_self_read ON tenants;
CREATE POLICY tenants_self_read ON tenants FOR SELECT
  USING (id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS tenants_platform_all ON tenants;
CREATE POLICY tenants_platform_all ON tenants
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

DROP POLICY IF EXISTS memberships_tenant_read ON memberships;
CREATE POLICY memberships_tenant_read ON memberships FOR SELECT
  USING (tenant_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS memberships_platform_all ON memberships;
CREATE POLICY memberships_platform_all ON memberships
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

DROP POLICY IF EXISTS platform_admins_platform_all ON platform_admins;
CREATE POLICY platform_admins_platform_all ON platform_admins
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

DROP POLICY IF EXISTS support_sessions_tenant_read ON support_sessions;
CREATE POLICY support_sessions_tenant_read ON support_sessions FOR SELECT
  USING (tenant_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS support_sessions_platform_all ON support_sessions;
CREATE POLICY support_sessions_platform_all ON support_sessions
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

DROP POLICY IF EXISTS security_events_platform_all ON security_events;
CREATE POLICY security_events_platform_all ON security_events
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

-- The security log must record denials from tenant-scoped requests too, so the
-- app role needs append-only access. Insert only: no SELECT policy for tenants,
-- so a customer can write an event it can never read back.
DROP POLICY IF EXISTS security_events_append ON security_events;
CREATE POLICY security_events_append ON security_events FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS tenant_access_requests_platform_all ON tenant_access_requests;
CREATE POLICY tenant_access_requests_platform_all ON tenant_access_requests
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

-- Prospective customers are unauthenticated when they apply, so the request
-- path inserts without a tenant context. Insert only — the submitter cannot
-- read the queue back, which also keeps the queue from becoming an email
-- enumeration oracle.
DROP POLICY IF EXISTS tenant_access_requests_submit ON tenant_access_requests;
CREATE POLICY tenant_access_requests_submit ON tenant_access_requests FOR INSERT
  WITH CHECK (status = 'PENDING' AND internal_notes IS NULL);

DROP POLICY IF EXISTS activation_tokens_platform_all ON activation_tokens;
CREATE POLICY activation_tokens_platform_all ON activation_tokens
  USING (current_setting('app.platform_scope', true) = 'on')
  WITH CHECK (current_setting('app.platform_scope', true) = 'on');

-- Activation and password reset are consumed before any tenant context exists.
-- There is deliberately NO permissive policy for the tenant path here: an
-- unrestricted USING(true) would let any tenant-scoped connection enumerate
-- every outstanding token row and update or delete tokens belonging to other
-- accounts — hashes rather than usable secrets, but still an account-takeover
-- denial-of-service. Redemption instead runs through withPlatform() on the
-- server, which is a pre-authentication path and never reachable from a
-- customer session.
DROP POLICY IF EXISTS activation_tokens_redeem ON activation_tokens;

-- ── Make every org_isolation policy null-safe ─────────────────────────────────
-- A custom GUC that has never been set returns NULL from current_setting(_, true),
-- but once it HAS been set on a connection, later transactions that do not set it
-- read back an empty string rather than NULL. Connections are pooled, so this is
-- the normal steady state: any query running without a tenant context on a
-- previously-used connection evaluated ''::uuid and raised
-- "invalid input syntax for type uuid" instead of simply matching no rows.
--
-- That failed closed — it errored rather than leaking — but it turned a
-- deny-by-default read into a 500, and it made the platform code path (which
-- deliberately sets no org context) unusable. nullif() restores the intended
-- semantics: no context means NULL, NULL matches nothing, zero rows.
DO $$
DECLARE
  pol       RECORD;
  col_type  TEXT;
  predicate TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'org_isolation'
  LOOP
    SELECT data_type INTO col_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = pol.tablename AND column_name = 'org_id';

    CONTINUE WHEN col_type IS NULL;

    IF col_type = 'uuid' THEN
      predicate := 'org_id = nullif(current_setting(''app.current_org_id'', true), '''')::uuid';
    ELSE
      predicate := 'org_id = nullif(current_setting(''app.current_org_id'', true), '''')';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', pol.tablename);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (%s)', pol.tablename, predicate);
  END LOOP;
END $$;

-- The control-plane policies compare against the same setting, so they need the
-- same treatment.
DROP POLICY IF EXISTS tenants_self_read ON tenants;
CREATE POLICY tenants_self_read ON tenants FOR SELECT
  USING (id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS memberships_tenant_read ON memberships;
CREATE POLICY memberships_tenant_read ON memberships FOR SELECT
  USING (tenant_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS support_sessions_tenant_read ON support_sessions;
CREATE POLICY support_sessions_tenant_read ON support_sessions FOR SELECT
  USING (tenant_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- sonalit_app is the RLS-enforced application role. It is not a table owner, so
-- the policies above genuinely bind it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sonalit_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      tenants, memberships, platform_admins, support_sessions,
      security_events, tenant_access_requests, activation_tokens
      TO sonalit_app;
    GRANT USAGE, SELECT ON SEQUENCE security_events_id_seq TO sonalit_app;
  END IF;
END $$;

COMMIT;
