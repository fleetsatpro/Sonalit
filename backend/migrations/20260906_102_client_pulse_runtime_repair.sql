-- Final forward-only repair for CDS Client Pulse recipient routing.
-- Never infer client ownership from names; use exact org-scoped email equality.
-- Also repairs the configured global Super Admin recipient independently of CDS customer enrollment.

CREATE OR REPLACE FUNCTION sonalit_bind_cds_client_pulse_recipient(
  p_org_id UUID,
  p_recipient_id UUID,
  p_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id UUID;
  v_enrollment_id UUID;
BEGIN
  IF p_org_id IS NULL OR p_recipient_id IS NULL OR NULLIF(trim(p_email), '') IS NULL THEN RETURN; END IF;

  SELECT c.id INTO v_customer_id
    FROM cds_customers c
   WHERE c.org_id = p_org_id
     AND c.deleted_at IS NULL
     AND lower(trim(c.email)) = lower(trim(p_email))
   ORDER BY c.created_at DESC NULLS LAST, c.id DESC
   LIMIT 1;

  IF v_customer_id IS NULL THEN RETURN; END IF;

  SELECT e.id INTO v_enrollment_id
    FROM communication_enrollments e
   WHERE e.org_id = p_org_id
     AND e.recipient_id = p_recipient_id
     AND e.domain = 'cds'
     AND e.cds_customer_id = v_customer_id
   ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_enrollment_id IS NULL THEN
    INSERT INTO communication_enrollments
      (org_id, recipient_id, domain, cds_customer_id, contact_role, status, verified_at)
    VALUES
      (p_org_id, p_recipient_id, 'cds', v_customer_id, 'client_pulse', 'active', NOW())
    RETURNING id INTO v_enrollment_id;
  ELSE
    UPDATE communication_enrollments
       SET status='active', verified_at=COALESCE(verified_at,NOW()), revoked_at=NULL,
           suspended_at=NULL, updated_at=NOW()
     WHERE id=v_enrollment_id;
  END IF;

  UPDATE communication_subscriptions
     SET enabled=TRUE, critical_override=TRUE, updated_at=NOW()
   WHERE enrollment_id=v_enrollment_id
     AND event_type='cds.client_pulse'
     AND channel='email';

  IF NOT FOUND THEN
    INSERT INTO communication_subscriptions
      (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override)
    VALUES
      (p_org_id, v_enrollment_id, 'cds.client_pulse', 'email', 'immediate', TRUE, TRUE);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sonalit_repair_all_cds_client_pulse_bindings()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, org_id, email
      FROM client_email_recipients
     WHERE deleted_at IS NULL
       AND enabled IS TRUE
       AND cds_client_pulse IS TRUE
       AND email IS NOT NULL
  LOOP
    PERFORM sonalit_bind_cds_client_pulse_recipient(r.org_id,r.id,r.email);
  END LOOP;
END;
$$;

-- Repair existing eligible customer recipients now.
SELECT sonalit_repair_all_cds_client_pulse_bindings();

-- Global Super Admin is not customer-scoped and therefore must not depend on
-- a cds_customer_id enrollment. Keep the configured authority enabled.
UPDATE client_email_recipients
   SET authority_role='super_admin', enabled=TRUE, sonalit_operational=TRUE,
       sonalit_security=TRUE, cds_client_pulse=TRUE, updated_at=NOW()
 WHERE lower(trim(email))='griffinonyari@gmail.com'
   AND deleted_at IS NULL;

-- Ensure recipient changes re-run the exact-match binding logic.
CREATE OR REPLACE FUNCTION ensure_cds_client_pulse_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE communication_subscriptions s
     SET enabled=FALSE, updated_at=NOW()
    FROM communication_enrollments e
   WHERE e.id=s.enrollment_id AND e.org_id=NEW.org_id AND e.recipient_id=NEW.id
     AND e.domain='cds' AND s.event_type='cds.client_pulse' AND s.channel='email';

  IF NEW.deleted_at IS NULL AND NEW.enabled IS TRUE AND NEW.cds_client_pulse IS TRUE THEN
    PERFORM sonalit_bind_cds_client_pulse_recipient(NEW.org_id,NEW.id,NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_email_recipient_cds_pulse_binding ON client_email_recipients;
CREATE TRIGGER trg_client_email_recipient_cds_pulse_binding
AFTER INSERT OR UPDATE OF email, enabled, cds_client_pulse, deleted_at
ON client_email_recipients
FOR EACH ROW EXECUTE FUNCTION ensure_cds_client_pulse_enrollment();

COMMENT ON FUNCTION sonalit_repair_all_cds_client_pulse_bindings()
IS 'Repairs exact organization-scoped CDS Client Pulse recipient bindings.';
