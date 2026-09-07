-- Communications delivery hardening.
-- Keep queue state separate from provider lifecycle and make the audit ledger
-- capable of representing every provider state without losing history.
ALTER TABLE communication_delivery_events DROP CONSTRAINT IF EXISTS communication_delivery_events_status_check;
ALTER TABLE communication_delivery_events ADD CONSTRAINT communication_delivery_events_status_check
  CHECK (status IN ('queued','sending','sent','delivery_delayed','delivered','opened','clicked','bounced','complained','suppressed','failed','skipped'));

ALTER TABLE communication_delivery_events ADD COLUMN IF NOT EXISTS provider_event_id TEXT;
ALTER TABLE communication_delivery_events ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE communication_delivery_events ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE communication_delivery_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_comm_delivery_provider_message ON communication_delivery_events(org_id, provider_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_delivery_correlation ON communication_delivery_events(org_id, correlation_id, created_at DESC);

-- Webhook idempotency is already keyed by provider event id. Add a lookup path
-- for reconciliation when provider events arrive before/after local state.
-- The webhook ledger uses received_at (not created_at) as its event timestamp.
CREATE INDEX IF NOT EXISTS idx_resend_webhook_provider_email ON resend_webhook_events(provider_email_id, received_at DESC);

COMMENT ON COLUMN communication_delivery_events.status IS 'Full lifecycle: application queue -> provider -> recipient outcome. queued is not delivery.';
