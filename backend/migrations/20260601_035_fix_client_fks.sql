-- Remove REFERENCES organizations(id) FK from client tables.
-- Production has no organizations table; org isolation is enforced by RLS only.
-- Migration 030 created these tables with the FK; this migration removes it safely.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop any FK constraints on cargo_clients that reference organizations
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'cargo_clients'::regclass AND contype = 'f'
       AND confrelid = (SELECT oid FROM pg_class WHERE relname = 'organizations' LIMIT 1)
  LOOP
    EXECUTE format('ALTER TABLE cargo_clients DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- Drop any FK constraints on cargo_client_links that reference organizations
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'cargo_client_links'::regclass AND contype = 'f'
       AND confrelid = (SELECT oid FROM pg_class WHERE relname = 'organizations' LIMIT 1)
  LOOP
    EXECUTE format('ALTER TABLE cargo_client_links DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- Drop any FK constraints on client_magic_links that reference organizations
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'client_magic_links'::regclass AND contype = 'f'
       AND confrelid = (SELECT oid FROM pg_class WHERE relname = 'organizations' LIMIT 1)
  LOOP
    EXECUTE format('ALTER TABLE client_magic_links DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Also ensure tables exist if migration 030 never ran (production may have missed it)
CREATE TABLE IF NOT EXISTS cargo_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, email)
);

CREATE TABLE IF NOT EXISTS cargo_client_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES cargo_clients(id) ON DELETE CASCADE,
  convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
  show_value BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, convoy_id)
);

CREATE TABLE IF NOT EXISTS client_magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES cargo_clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (idempotent)
ALTER TABLE cargo_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_magic_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cargo_clients' AND policyname='org_isolation') THEN
    CREATE POLICY org_isolation ON cargo_clients
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cargo_client_links' AND policyname='org_isolation') THEN
    CREATE POLICY org_isolation ON cargo_client_links
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='client_magic_links' AND policyname='org_isolation') THEN
    CREATE POLICY org_isolation ON client_magic_links
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cargo_clients_org ON cargo_clients(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_client_links_client ON cargo_client_links(client_id);
CREATE INDEX IF NOT EXISTS idx_cargo_client_links_convoy ON cargo_client_links(convoy_id);
CREATE INDEX IF NOT EXISTS idx_client_magic_links_hash ON client_magic_links(token_hash);
