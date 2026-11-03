-- CDS Client Pulse recipient reconciliation.
--
-- The communications control plane made recipient enrollment explicit, but the
-- Client Pulse dispatcher only sends to CDS enrollments whose route is active
-- AND whose cds.client_pulse subscription is enabled. Existing onboarding paths
-- could leave a CDS enrollment in pending_verification with the pulse
-- subscription disabled, while the Super Admin identity was separately forced
-- active by earlier repair migrations. That made the Super Admin the only
-- address actually reaching the dispatcher.
--
-- In Sonalit, a CDS enrollment is created by an authenticated Admin/authority
-- operator. For the Client Pulse entitlement, that administrative enrollment is
-- the explicit authorization. Keep the legacy pending_verification value
-- accepted by the API, but reconcile the actual CDS Client Pulse route to the
-- recipient's cds_client_pulse preference.

-- 1. Repair every existing CDS enrollment whose recipient is enabled and has
--    the Client Pulse entitlement. Do not infer customer ownership from email;
--    the enrollment's cds_customer_id remains authoritative.
UPDATE communication_enrollments e
SET status='active',
    verified_at=COALESCE(e.verified_at,NOW()),
    revoked_at=NULL,
    suspended_at=NULL,
    updated_at=NOW()
FROM client_email_recipients r
WHERE r.id=e.recipient_id
  AND r.org_id=e.org_id
  AND e.domain='cds'
  AND e.cds_customer_id IS NOT NULL
  AND r.deleted_at IS NULL
  AND r.enabled IS TRUE
  AND r.cds_client_pulse IS TRUE
  AND e.status IN ('draft','pending_verification','active','verified');

-- 2. Every authorized CDS enrollment gets exactly one active email Pulse route.
INSERT INTO communication_subscriptions
  (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override)
SELECT e.org_id,e.id,'cds.client_pulse','email','immediate',TRUE,TRUE
FROM communication_enrollments e
JOIN client_email_recipients r
  ON r.id=e.recipient_id AND r.org_id=e.org_id
WHERE e.domain='cds'
  AND e.cds_customer_id IS NOT NULL
  AND e.status IN ('active','verified')
  AND r.deleted_at IS NULL
  AND r.enabled IS TRUE
  AND r.cds_client_pulse IS TRUE
ON CONFLICT (enrollment_id,event_type,channel)
DO UPDATE SET enabled=TRUE, critical_override=TRUE, delivery_mode='immediate', updated_at=NOW();

-- 3. Make future CDS enrollment creation self-healing. The admin enrollment
--    itself authorizes Client Pulse; no dead-end pending state should silently
--    prevent delivery.
CREATE OR REPLACE FUNCTION sonalit_ensure_cds_client_pulse_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_pulse BOOLEAN;
BEGIN
  IF NEW.domain <> 'cds' OR NEW.cds_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.enabled, r.cds_client_pulse
    INTO v_enabled, v_pulse
    FROM client_email_recipients r
   WHERE r.id=NEW.recipient_id
     AND r.org_id=NEW.org_id
     AND r.deleted_at IS NULL;

  IF COALESCE(v_enabled,FALSE) IS NOT TRUE OR COALESCE(v_pulse,FALSE) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- An Admin-created CDS enrollment is the explicit Client Pulse authority.
  -- Normalize legacy pending/draft rows so the dispatcher can actually use it.
  IF NEW.status IN ('draft','pending_verification') THEN
    UPDATE communication_enrollments
       SET status='active',
           verified_at=COALESCE(verified_at,NOW()),
           revoked_at=NULL,
           suspended_at=NULL,
           updated_at=NOW()
     WHERE id=NEW.id;
  END IF;

  INSERT INTO communication_subscriptions
    (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override)
  VALUES
    (NEW.org_id,NEW.id,'cds.client_pulse','email','immediate',TRUE,TRUE)
  ON CONFLICT (enrollment_id,event_type,channel)
  DO UPDATE SET enabled=TRUE, critical_override=TRUE, delivery_mode='immediate', updated_at=NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_cds_client_pulse_route ON communication_enrollments;
CREATE TRIGGER trg_ensure_cds_client_pulse_route
AFTER INSERT OR UPDATE OF recipient_id,domain,cds_customer_id,status
ON communication_enrollments
FOR EACH ROW
EXECUTE FUNCTION sonalit_ensure_cds_client_pulse_route();

-- 4. If an operator later explicitly enables/updates the Pulse subscription,
--    keep the route enabled for an authorized CDS enrollment. Other event
--    subscriptions remain fully operator-controlled.
CREATE OR REPLACE FUNCTION sonalit_guard_cds_client_pulse_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_domain TEXT;
  v_status TEXT;
  v_enabled BOOLEAN;
  v_pulse BOOLEAN;
BEGIN
  SELECT e.domain,e.status,r.enabled,r.cds_client_pulse
    INTO v_domain,v_status,v_enabled,v_pulse
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
  THEN
    NEW.enabled := TRUE;
    NEW.critical_override := TRUE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_cds_client_pulse_subscription ON communication_subscriptions;
CREATE TRIGGER trg_guard_cds_client_pulse_subscription
BEFORE INSERT OR UPDATE OF event_type,channel,enabled,critical_override,enrollment_id
ON communication_subscriptions
FOR EACH ROW
EXECUTE FUNCTION sonalit_guard_cds_client_pulse_subscription();

COMMENT ON FUNCTION sonalit_ensure_cds_client_pulse_route()
IS 'Keeps admin-authorized CDS Client Pulse enrollments active and subscribed.';
COMMENT ON FUNCTION sonalit_guard_cds_client_pulse_subscription()
IS 'Prevents an authorized CDS Client Pulse route from being silently disabled.';
