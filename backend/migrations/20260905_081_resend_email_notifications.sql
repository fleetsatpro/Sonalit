-- Production Resend email delivery ledger.
-- One row represents one intended recipient/message, allowing retries and
-- provider lifecycle reconciliation without treating API acceptance as delivery.
CREATE TABLE IF NOT EXISTS email_notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL,
  recipient             TEXT NOT NULL CHECK (char_length(recipient) <= 320),
  recipient_name        TEXT,
  notification_type     TEXT NOT NULL,
  severity              TEXT NOT NULL DEFAULT 'normal'
                        CHECK (severity IN ('critical','high','normal','low')),
  subject               TEXT NOT NULL CHECK (char_length(subject) <= 998),
  text_body             TEXT NOT NULL,
  html_body             TEXT NOT NULL,
  entity_type           TEXT,
  entity_id             UUID,
  correlation_id        TEXT,
  idempotency_key       TEXT NOT NULL,
  provider              TEXT NOT NULL DEFAULT 'resend',
  provider_email_id     TEXT,
  provider_event_id     TEXT,
  status                TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sending','sent','delivered','delivery_delayed','opened','clicked','bounced','complained','failed','suppressed')),
  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error            TEXT,
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  last_attempt_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_email_notifications_org_status
  ON email_notifications(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_notifications_provider_id
  ON email_notifications(provider_email_id) WHERE provider_email_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_notifications_provider_event
  ON email_notifications(provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_notifications_entity
  ON email_notifications(org_id, entity_type, entity_id) WHERE entity_id IS NOT NULL;

ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_notifications'
      AND policyname = 'org_isolation_email_notifications'
  ) THEN
    CREATE POLICY org_isolation_email_notifications ON email_notifications
      USING (org_id = current_setting('app.current_org_id', true)::UUID)
      WITH CHECK (org_id = current_setting('app.current_org_id', true)::UUID);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON email_notifications TO sonalit_app;
