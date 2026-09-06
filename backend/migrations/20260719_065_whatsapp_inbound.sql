-- Inbound WhatsApp messages. The webhook (POST /guardian/whatsapp/webhook) only
-- ever logged inbound messages and dropped them; persist them so dispatch can
-- see replies and so auto-reply flows have something to build on.
--
-- The webhook is unauthenticated (Meta calls it, HMAC-verified) and has no org
-- context, so it writes through the raw pooled connection and resolves org from
-- whatsapp_config.phone_number_id. org_id is nullable: a message whose receiving
-- number matches no configured org is still stored (never lost) rather than
-- rejected. RLS + FORCE mirror whatsapp_config so authenticated reads via req.db
-- are org-scoped; the webhook's superuser connection bypasses RLS to insert.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID,
  wa_message_id   TEXT UNIQUE,
  phone_number_id VARCHAR(100),
  from_number     VARCHAR(40),
  msg_type        VARCHAR(40),
  body            TEXT,
  raw             JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_inbound_org_received
  ON whatsapp_inbound_messages (org_id, received_at DESC);

ALTER TABLE whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_inbound_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON whatsapp_inbound_messages;
CREATE POLICY org_isolation ON whatsapp_inbound_messages
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON whatsapp_inbound_messages TO sonalit_app;
