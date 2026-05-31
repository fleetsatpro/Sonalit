-- cargo_clients: one per cargo-owner contact, scoped to an org
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
ALTER TABLE cargo_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_clients FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON cargo_clients
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- cargo_client_links: which convoys a client may see
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
ALTER TABLE cargo_client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_client_links FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON cargo_client_links
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- client_magic_links: single-use login tokens (15 min TTL)
CREATE TABLE IF NOT EXISTS client_magic_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES cargo_clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE client_magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_magic_links FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON client_magic_links
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- notification_prefs
CREATE TABLE IF NOT EXISTS client_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES cargo_clients(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  convoy_id UUID REFERENCES convoys(id) ON DELETE CASCADE, -- null = all client's convoys
  events TEXT[] NOT NULL DEFAULT '{}',
  channels TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (client_id, convoy_id)
);
ALTER TABLE client_notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_notification_prefs FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON client_notification_prefs
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_cargo_clients_org ON cargo_clients(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_client_links_client ON cargo_client_links(client_id);
CREATE INDEX IF NOT EXISTS idx_cargo_client_links_convoy ON cargo_client_links(convoy_id);
