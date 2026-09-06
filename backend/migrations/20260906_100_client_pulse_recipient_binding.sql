-- CDS Client Pulse recipient binding compatibility layer.
-- The Communications UI historically created client_email_recipients and toggled
-- cds_client_pulse, but did not create the domain-specific enrollment required
-- by the new communication control plane. Bind only on an exact, org-scoped
-- email match to a CDS customer; never infer ownership from arbitrary text.

CREATE OR REPLACE FUNCTION ensure_cds_client_pulse_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_id UUID;
  enrollment_id UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.enabled IS NOT TRUE OR NEW.cds_client_pulse IS NOT TRUE THEN
    IF TG_OP = 'UPDATE' THEN
      UPDATE communication_subscriptions s
         SET enabled = FALSE, updated_at = NOW()
        FROM communication_enrollments e
       WHERE e.id = s.enrollment_id
         AND e.org_id = NEW.org_id
         AND e.recipient_id = NEW.id
         AND e.domain = 'cds'
         AND s.event_type = 'cds.client_pulse'
         AND s.channel = 'email';
    END IF;
    RETURN NEW;
  END IF;

  SELECT c.id
    INTO customer_id
    FROM cds_customers c
   WHERE c.org_id = NEW.org_id
     AND c.deleted_at IS NULL
     AND NEW.email IS NOT NULL
     AND lower(trim(c.email)) = lower(trim(NEW.email))
   ORDER BY c.created_at DESC
   LIMIT 1;

  IF customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO communication_enrollments
    (org_id, recipient_id, domain, cds_customer_id, contact_role, status, verified_at)
  VALUES
    (NEW.org_id, NEW.id, 'cds', customer_id, 'client_pulse', 'active', NOW())
  ON CONFLICT (org_id, recipient_id, domain, COALESCE(cds_customer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET status = 'active', updated_at = NOW(), revoked_at = NULL, suspended_at = NULL
  RETURNING id INTO enrollment_id;

  INSERT INTO communication_subscriptions
    (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override)
  VALUES
    (NEW.org_id, enrollment_id, 'cds.client_pulse', 'email', 'immediate', TRUE, TRUE)
  ON CONFLICT (enrollment_id, event_type, channel)
  DO UPDATE SET enabled = TRUE, updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_cds_customer_client_pulse_bindings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recipient RECORD;
  enrollment_id UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR recipient IN
    SELECT r.*
      FROM client_email_recipients r
     WHERE r.org_id = NEW.org_id
       AND r.deleted_at IS NULL
       AND r.enabled IS TRUE
       AND r.cds_client_pulse IS TRUE
       AND lower(trim(r.email)) = lower(trim(NEW.email))
  LOOP
    INSERT INTO communication_enrollments
      (org_id, recipient_id, domain, cds_customer_id, contact_role, status, verified_at)
    VALUES
      (NEW.org_id, recipient.id, 'cds', NEW.id, 'client_pulse', 'active', NOW())
    ON CONFLICT (org_id, recipient_id, domain, COALESCE(cds_customer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = 'active', updated_at = NOW(), revoked_at = NULL, suspended_at = NULL
    RETURNING id INTO enrollment_id;

    INSERT INTO communication_subscriptions
      (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override)
    VALUES
      (NEW.org_id, enrollment_id, 'cds.client_pulse', 'email', 'immediate', TRUE, TRUE)
    ON CONFLICT (enrollment_id, event_type, channel)
    DO UPDATE SET enabled = TRUE, updated_at = NOW();
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_email_recipient_cds_pulse_binding ON client_email_recipients;
CREATE TRIGGER trg_client_email_recipient_cds_pulse_binding
AFTER INSERT OR UPDATE OF email, enabled, cds_client_pulse, deleted_at
ON client_email_recipients
FOR EACH ROW EXECUTE FUNCTION ensure_cds_client_pulse_enrollment();

DROP TRIGGER IF EXISTS trg_cds_customer_cds_pulse_binding ON cds_customers;
CREATE TRIGGER trg_cds_customer_cds_pulse_binding
AFTER INSERT OR UPDATE OF email, deleted_at
ON cds_customers
FOR EACH ROW EXECUTE FUNCTION ensure_cds_customer_client_pulse_bindings();

-- Repair existing recipients immediately. Exact email matching is deliberate:
-- it provides a deterministic customer boundary without guessing from company
-- names or other mutable attributes.
DO $$
DECLARE
  r RECORD;
  enrollment_id UUID;
BEGIN
  FOR r IN
    SELECT r.id AS recipient_id, r.org_id, c.id AS customer_id
      FROM client_email_recipients r
      JOIN cds_customers c
        ON c.org_id = r.org_id
       AND c.deleted_at IS NULL
       AND r.email IS NOT NULL
       AND lower(trim(c.email)) = lower(trim(r.email))
     WHERE r.deleted_at IS NULL
       AND r.enabled IS TRUE
       AND r.cds_client_pulse IS TRUE
  LOOP
    INSERT INTO communication_enrollments
      (org_id, recipient_id, domain, cds_customer_id, contact_role, status, verified_at)
    VALUES
      (r.org_id, r.recipient_id, 'cds', r.customer_id, 'client_pulse', 'active', NOW())
    ON CONFLICT (org_id, recipient_id, domain, COALESCE(cds_customer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET status = 'active', updated_at = NOW(), revoked_at = NULL, suspended_at = NULL
    RETURNING id INTO enrollment_id;

    INSERT INTO communication_subscriptions
      (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override)
    VALUES
      (r.org_id, enrollment_id, 'cds.client_pulse', 'email', 'immediate', TRUE, TRUE)
    ON CONFLICT (enrollment_id, event_type, channel)
    DO UPDATE SET enabled = TRUE, updated_at = NOW();
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS ensure_cds_client_pulse_enrollment();
DROP FUNCTION IF EXISTS ensure_cds_customer_client_pulse_bindings();
