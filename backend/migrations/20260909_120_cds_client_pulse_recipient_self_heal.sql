-- Self-heal legacy recipient onboarding paths.
-- The historical /settings/email-recipients endpoint writes only client_email_recipients.
-- This trigger keeps CDS Client Pulse routing complete without trusting the legacy UI.
-- It never guesses across ambiguous CDS customers and never enrolls Super Admin recipients.

CREATE OR REPLACE FUNCTION sonalit_sync_cds_client_pulse_recipient()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id UUID;
  v_old_customer_id UUID;
BEGIN
  IF NEW.authority_role = 'super_admin' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_old_customer_id := CASE WHEN TG_OP='UPDATE' THEN OLD.cds_customer_id ELSE NULL END;

  -- Explicit binding wins. Otherwise safely resolve only when email or company
  -- identifies exactly one CDS customer in this organization.
  v_customer_id := NEW.cds_customer_id;
  IF v_customer_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(c.id::text)::uuid END INTO v_customer_id
    FROM cds_customers c
    WHERE c.org_id=NEW.org_id AND c.deleted_at IS NULL
      AND c.email IS NOT NULL
      AND lower(trim(c.email))=lower(trim(NEW.email));
  END IF;
  IF v_customer_id IS NULL AND NEW.company IS NOT NULL THEN
    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(c.id::text)::uuid END INTO v_customer_id
    FROM cds_customers c
    WHERE c.org_id=NEW.org_id AND c.deleted_at IS NULL
      AND lower(trim(c.company_name))=lower(trim(NEW.company));
  END IF;

  IF NEW.cds_customer_id IS NULL AND v_customer_id IS NOT NULL THEN
    NEW.cds_customer_id := v_customer_id;
  END IF;

  -- Any previous customer route that is no longer authoritative must be shut
  -- off before enabling the new route. This prevents cross-client delivery.
  IF v_old_customer_id IS NOT NULL AND v_old_customer_id IS DISTINCT FROM NEW.cds_customer_id THEN
    UPDATE communication_subscriptions s
       SET enabled=FALSE, updated_at=NOW()
      FROM communication_enrollments e
     WHERE e.id=s.enrollment_id
       AND e.org_id=NEW.org_id
       AND e.recipient_id=NEW.id
       AND e.domain='cds'
       AND e.cds_customer_id=v_old_customer_id
       AND s.event_type='cds.client_pulse'
       AND s.channel='email';
    UPDATE communication_enrollments
       SET status='revoked', revoked_at=NOW(), updated_at=NOW()
     WHERE org_id=NEW.org_id
       AND recipient_id=NEW.id
       AND domain='cds'
       AND cds_customer_id=v_old_customer_id
       AND status IN ('draft','pending_verification','active','verified');
  END IF;

  IF NEW.enabled IS TRUE AND NEW.cds_client_pulse IS TRUE AND NEW.cds_customer_id IS NOT NULL THEN
    UPDATE communication_enrollments
       SET status='active', revoked_at=NULL, suspended_at=NULL, updated_at=NOW()
     WHERE org_id=NEW.org_id
       AND recipient_id=NEW.id
       AND domain='cds'
       AND cds_customer_id=NEW.cds_customer_id;

    INSERT INTO communication_enrollments
      (org_id,recipient_id,domain,cds_customer_id,contact_role,status)
    SELECT NEW.org_id,NEW.id,'cds',NEW.cds_customer_id,'client_pulse','active'
    WHERE NOT EXISTS (
      SELECT 1 FROM communication_enrollments e
      WHERE e.org_id=NEW.org_id
        AND e.recipient_id=NEW.id
        AND e.domain='cds'
        AND e.cds_customer_id=NEW.cds_customer_id
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO communication_subscriptions
      (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override)
    SELECT e.org_id,e.id,'cds.client_pulse','email','immediate',TRUE,TRUE
    FROM communication_enrollments e
    WHERE e.org_id=NEW.org_id AND e.recipient_id=NEW.id
      AND e.domain='cds' AND e.cds_customer_id=NEW.cds_customer_id
    ON CONFLICT (enrollment_id,event_type,channel)
    DO UPDATE SET enabled=TRUE,delivery_mode='immediate',critical_override=TRUE,updated_at=NOW();
  ELSE
    UPDATE communication_subscriptions s
       SET enabled=FALSE,updated_at=NOW()
      FROM communication_enrollments e
     WHERE e.id=s.enrollment_id
       AND e.org_id=NEW.org_id AND e.recipient_id=NEW.id
       AND e.domain='cds'
       AND s.event_type='cds.client_pulse' AND s.channel='email';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cds_client_pulse_recipient ON client_email_recipients;
CREATE TRIGGER trg_sync_cds_client_pulse_recipient
BEFORE INSERT OR UPDATE OF email,company,enabled,cds_customer_id,cds_client_pulse,deleted_at,authority_role
ON client_email_recipients
FOR EACH ROW
EXECUTE FUNCTION sonalit_sync_cds_client_pulse_recipient();

-- Repair any stale routes left by previous migrations: each recipient may have
-- only its current authoritative CDS customer route enabled.
UPDATE communication_subscriptions s
   SET enabled=FALSE,updated_at=NOW()
  FROM communication_enrollments e
  JOIN client_email_recipients r ON r.id=e.recipient_id AND r.org_id=e.org_id
 WHERE s.enrollment_id=e.id
   AND e.domain='cds'
   AND s.event_type='cds.client_pulse'
   AND s.channel='email'
   AND r.authority_role IS DISTINCT FROM 'super_admin'
   AND (r.deleted_at IS NOT NULL OR r.enabled IS NOT TRUE OR r.cds_client_pulse IS NOT TRUE OR r.cds_customer_id IS NULL OR e.cds_customer_id<>r.cds_customer_id);

COMMENT ON FUNCTION sonalit_sync_cds_client_pulse_recipient()
IS 'Self-heals legacy CDS Client Pulse recipient onboarding using explicit or uniquely resolvable customer scope.';
