-- Notification recipient binding repair.
-- Fleet security fan-out is intentionally client-scoped. Recipients created by
-- the legacy/CDS email UI historically had no explicit cargo-client binding,
-- which caused notificationWorker to see client_id=NULL and omit them from
-- client-owned PANIC/SOS/TAMPER notifications.
--
-- Bind only when the relationship is unambiguous: exact org-scoped email first,
-- otherwise a unique org-scoped company name. Never overwrite an explicit
-- client_id and never guess across multiple clients.

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

-- Repair recipients already present in production. The trigger is used so the
-- exact same safety rules apply to historical rows and future onboarding.
UPDATE client_email_recipients
   SET email = email
 WHERE client_id IS NULL
   AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_security_scope
  ON client_email_recipients (org_id, client_id, enabled, sonalit_security)
  WHERE deleted_at IS NULL;
