-- Resend/Svix webhooks are at-least-once. Persist event ids separately so
-- duplicate deliveries are acknowledged without replaying state transitions.
CREATE TABLE IF NOT EXISTS resend_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_email_id TEXT,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_provider_email
  ON resend_webhook_events(provider_email_id);
