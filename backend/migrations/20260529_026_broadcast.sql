-- S2-F4: Convoy Broadcast + WhatsApp Config
-- RULE A: ENABLE + FORCE RLS + org_isolation on every new table

-- ─── canned_messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canned_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  category    VARCHAR(50) DEFAULT 'general',
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE canned_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON canned_messages;
CREATE POLICY org_isolation ON canned_messages
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON canned_messages TO sonalit_app;

-- ─── convoy_broadcasts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS convoy_broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  convoy_id       UUID REFERENCES convoys(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  channel         VARCHAR(30) NOT NULL DEFAULT 'app',  -- app | whatsapp | sms | email
  message         TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0,
  sent_at         TIMESTAMPTZ,
  status          VARCHAR(30) DEFAULT 'pending',  -- pending | sent | failed | partial
  idempotency_key VARCHAR(100) UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE convoy_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_broadcasts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON convoy_broadcasts;
CREATE POLICY org_isolation ON convoy_broadcasts
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON convoy_broadcasts TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_convoy_broadcasts_convoy ON convoy_broadcasts (convoy_id, created_at DESC);

-- ─── whatsapp_config ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL UNIQUE,
  phone_number_id VARCHAR(100),
  access_token    TEXT,  -- encrypted at application layer before storage
  verify_token    VARCHAR(200),
  business_id     VARCHAR(100),
  active          BOOLEAN DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON whatsapp_config;
CREATE POLICY org_isolation ON whatsapp_config
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON whatsapp_config TO sonalit_app;
