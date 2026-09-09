-- Tighten the Client Pulse subscription guard so it can never keep an
-- obsolete customer's route enabled after recipient reassignment.

CREATE OR REPLACE FUNCTION sonalit_guard_cds_client_pulse_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_domain TEXT;
  v_status TEXT;
  v_enabled BOOLEAN;
  v_pulse BOOLEAN;
  v_customer_id UUID;
BEGIN
  SELECT e.domain,e.status,r.enabled,r.cds_client_pulse,r.cds_customer_id
    INTO v_domain,v_status,v_enabled,v_pulse,v_customer_id
    FROM communication_enrollments e
    JOIN client_email_recipients r
      ON r.id=e.recipient_id AND r.org_id=e.org_id
   WHERE e.id=NEW.enrollment_id
     AND e.org_id=NEW.org_id;

  IF NEW.event_type='cds.client_pulse'
     AND NEW.channel='email'
     AND v_domain='cds'
     AND v_status IN ('active','verified')
     AND v_enabled IS TRUE
     AND v_pulse IS TRUE
     AND v_customer_id IS NOT NULL
     AND v_customer_id = (
       SELECT r2.cds_customer_id
       FROM client_email_recipients r2
       WHERE r2.id=NEW.enrollment_id
          OR r2.id=(SELECT recipient_id FROM communication_enrollments WHERE id=NEW.enrollment_id)
       LIMIT 1
     )
  THEN
    NEW.enabled := TRUE;
    NEW.critical_override := TRUE;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sonalit_guard_cds_client_pulse_subscription()
IS 'Allows only the subscription belonging to the recipient current authoritative CDS customer to be forced active.';
