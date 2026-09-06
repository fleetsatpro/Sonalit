-- Forward-only repair for CDS Client Pulse routing.
-- 100 created the binding layer, but production must be able to recover even if
-- that migration was skipped/failed. Never infer customer ownership from names;
-- bind only on an exact, organization-scoped email match.

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
  IF p_org_id IS NULL OR p_recipient_id IS NULL OR NULLIF(trim(p_email), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.id
    INTO v_customer_id
    FROM cds_customers c
   WHERE c.org_id = p_org_id
     AND c.deleted_at IS NULL
     AND lower(trim(c.email)) = lower(trim(p_email))
   ORDER BY c.created_at DESC NULLS LAST, c.id DESC
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- Insert without relying on expression-index inference. Then resolve the
  -- canonical row and update it. This remains safe if the index definition
  -- changes in a later migration.
  INSERT INTO communication_enrollments
    (org_id, recipient_id, domain, cds_customer_id, contact_role, status, verified_at)
  SELECT p_org_id, p_recipient_id, 'cds', v_customer_id, 'client_pulse', 'active', NOW()
   WHERE NOT EXISTS (
     SELECT 1
       FROM communication_enrollments e
      WHERE e.org_id = p_org_id
        AND e.recipient_id = p_recipient_id
        AND e.domain = 'cds'
        AND e.cds_customer_id = v_customer_id
   );

  SELECT e.id
    INTO v_enrollment_id
    FROM communication_enrollments e
   WHERE e.org_id = p_org_id
     AND e.recipient_id = p_recipient_id
     AND e.domain = 'cds'
     AND e.cds_customer_id = v_customer_id
   ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_enrollment_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE communication_enrollments
     SET status = 'active', verified_at = COALESCE(verified_at, NOW()),
         revoked_at = NULL, suspended_at = NULL, updated_at = NOW()
   WHERE id = v_enrollment_id;

  INSERT INTO communication_subscriptions
    (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override)
  SELECT p_org_id, v_enrollment_id, 'cds.client_pulse', 'email', 'immediate', TRUE, TRUE
   WHERE NOT EXISTS (
     SELECT 1 FROM communication_subscriptions s
      WHERE s.enrollment_id = v_enrollment_id
        AND s.event_type = 'cds.client_pulse'
        AND s.channel = 'email'
   );

  UPDATE communication_subscriptions
     SET enabled = TRUE, critical_override = TRUE, updated_at = NOW()
   WHERE enrollment_id = v_enrollment_id
     AND event_type = 'cds.client_pulse'
     AND channel = 'email';
END;
$$;

CREATE OR REPLACE FUNCTION ensure_cds_client_pulse_enrollment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Disable stale CDS Pulse subscriptions first. This prevents a recipient
  -- whose email/client assignment changes from retaining the old customer's feed.
  UPDATE communication_subscriptions s
     SET enabled = FALSE, updated_at = NOW()
    FROM communication_enrollments e
   WHERE e.id = s.enrollment_id
     AND e.org_id = NEW.org_id
     AND e.recipient_id = NEW.id
     AND e.domain = 'cds'
     AND s.event_type = 'cds.client_pulse'
     AND s.channel = 'email';

  IF NEW.deleted_at IS NOT NULL OR NEW.enabled IS NOT TRUE OR NEW.cds_client_pulse IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  PERFORM sonalit_bind_cds_client_pulse_recipient(NEW.org_id, NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_cds_customer_client_pulse_bindings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  -- If a customer's email changed, retire the previous exact-match binding.
  IF TG_OP = 'UPDATE' AND lower(COALESCE(OLD.email, '')) <> lower(COALESCE(NEW.email, '')) THEN
    UPDATE communication_subscriptions s
       SET enabled = FALSE, updated_at = NOW()
      FROM communication_enrollments e
     WHERE e.id = s.enrollment_id
       AND e.org_id = OLD.org_id
       AND e.domain = 'cds'
       AND e.cds_customer_id = OLD.id
       AND s.event_type = 'cds.client_pulse'
       AND s.channel = 'email';
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT id, org_id, email
      FROM client_email_recipients
     WHERE org_id = NEW.org_id
       AND deleted_at IS NULL
       AND enabled IS TRUE
       AND cds_client_pulse IS TRUE
       AND lower(trim(email)) = lower(trim(NEW.email))
  LOOP
    PERFORM sonalit_bind_cds_client_pulse_recipient(r.org_id, r.id, r.email);
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

-- Repair every currently eligible customer recipient.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, org_id, email
      FROM client_email_recipients
     WHERE deleted_at IS NULL
       AND enabled IS TRUE
       AND cds_client_pulse IS TRUE
       AND email IS NOT NULL
  LOOP
    PERFORM sonalit_bind_cds_client_pulse_recipient(r.org_id, r.id, r.email);
  END LOOP;
END;
$$;

-- Reconcile the configured global Super Admin identity. Global visibility is
-- intentionally represented by authority_role and does not require a CDS
-- customer enrollment, so it cannot accidentally inherit one customer's scope.
UPDATE client_email_recipients
   SET authority_role = 'super_admin', enabled = TRUE,
       sonalit_operational = TRUE, sonalit_security = TRUE,
       cds_client_pulse = TRUE, updated_at = NOW()
 WHERE lower(trim(email)) = 'griffinonyari@gmail.com'
   AND deleted_at IS NULL;

COMMENT ON FUNCTION sonalit_bind_cds_client_pulse_recipient(UUID, UUID, TEXT)
IS 'Idempotently binds a Client Pulse recipient to a CDS customer only on exact organization-scoped email equality.';
