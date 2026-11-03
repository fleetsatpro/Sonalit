-- PANIC recipient repair.
-- Migration 122 was not reliably applied in production, so this migration is
-- intentionally self-contained. Client-owned security recipients must have a
-- deterministic client_id and an enabled Sonalit security subscription.

CREATE OR REPLACE FUNCTION sonalit_bind_notification_recipient_client()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matched_client UUID;
  company_matches INTEGER;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id
    INTO matched_client
    FROM cargo_clients c
   WHERE c.org_id = NEW.org_id
     AND c.deleted_at IS NULL
     AND NEW.email IS NOT NULL
     AND lower(trim(c.email)) = lower(trim(NEW.email))
   ORDER BY c.created_at ASC
   LIMIT 1;

  IF matched_client IS NULL AND NULLIF(trim(NEW.company), '') IS NOT NULL THEN
    SELECT COUNT(*), MIN(c.id)
      INTO company_matches, matched_client
      FROM cargo_clients c
     WHERE c.org_id = NEW.org_id
       AND c.deleted_at IS NULL
       AND lower(trim(c.company)) = lower(trim(NEW.company));

    IF company_matches <> 1 THEN
      matched_client := NULL;
    END IF;
  END IF;

  IF matched_client IS NOT NULL THEN
    NEW.client_id := matched_client;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bind_notification_recipient_client
  ON client_email_recipients;

CREATE TRIGGER trg_bind_notification_recipient_client
BEFORE INSERT OR UPDATE OF email, company, client_id
ON client_email_recipients
FOR EACH ROW
EXECUTE FUNCTION sonalit_bind_notification_recipient_client();

-- Backfill the same deterministic relationship for historical recipients.
UPDATE client_email_recipients r
   SET email = r.email,
       updated_at = NOW()
 WHERE r.client_id IS NULL
   AND r.deleted_at IS NULL;

-- A client recipient created/configured for CDS Client Pulse is also a client
-- security recipient unless an administrator explicitly disables Security in
-- the UI. This repairs historical rows created with the old false default.
UPDATE client_email_recipients
   SET sonalit_security = TRUE,
       updated_at = NOW()
 WHERE client_id IS NOT NULL
   AND enabled IS TRUE
   AND cds_client_pulse IS TRUE
   AND deleted_at IS NULL
   AND sonalit_security IS FALSE;

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_security_scope
  ON client_email_recipients (org_id, client_id, enabled, sonalit_security)
  WHERE deleted_at IS NULL;
