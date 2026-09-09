-- CDS Client Pulse recipient binding repair
-- Every external Pulse recipient must be explicitly bound to a CDS customer.
-- Super Admin recipients remain global and are intentionally not enrolled.

ALTER TABLE client_email_recipients
  ADD COLUMN IF NOT EXISTS cds_customer_id UUID REFERENCES cds_customers(id);

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_cds_customer
  ON client_email_recipients (org_id, cds_customer_id, enabled)
  WHERE deleted_at IS NULL;

-- Safe legacy reconciliation:
-- 1) exact recipient email -> CDS customer email
-- 2) otherwise exact company -> exactly one CDS customer in the org
-- Never guess when company names are ambiguous.
WITH email_match AS (
  SELECT r.id, c.id AS cds_customer_id
  FROM client_email_recipients r
  JOIN cds_customers c
    ON c.org_id=r.org_id
   AND c.deleted_at IS NULL
   AND r.email IS NOT NULL
   AND c.email IS NOT NULL
   AND lower(trim(r.email))=lower(trim(c.email))
  WHERE r.deleted_at IS NULL
    AND r.authority_role IS DISTINCT FROM 'super_admin'
    AND r.cds_customer_id IS NULL
), company_match AS (
  SELECT r.id, MIN(c.id::text)::uuid AS cds_customer_id
  FROM client_email_recipients r
  JOIN cds_customers c
    ON c.org_id=r.org_id
   AND c.deleted_at IS NULL
   AND r.company IS NOT NULL
   AND lower(trim(r.company))=lower(trim(c.company_name))
  WHERE r.deleted_at IS NULL
    AND r.authority_role IS DISTINCT FROM 'super_admin'
    AND r.cds_customer_id IS NULL
  GROUP BY r.id
  HAVING COUNT(*)=1
), candidates AS (
  SELECT id, cds_customer_id FROM email_match
  UNION ALL
  SELECT id, cds_customer_id FROM company_match
  WHERE id NOT IN (SELECT id FROM email_match)
)
UPDATE client_email_recipients r
SET cds_customer_id=c.cds_customer_id, updated_at=NOW()
FROM candidates c
WHERE r.id=c.id
  AND r.cds_customer_id IS NULL;

-- Create/repair the canonical CDS Client Pulse enrollment for every bound
-- recipient. This is deliberately idempotent and leaves other domains alone.
INSERT INTO communication_enrollments
  (org_id,recipient_id,domain,cds_customer_id,contact_role,status)
SELECT r.org_id,r.id,'cds',r.cds_customer_id,'client_pulse','active'
FROM client_email_recipients r
WHERE r.deleted_at IS NULL
  AND r.enabled=true
  AND r.authority_role IS DISTINCT FROM 'super_admin'
  AND r.cds_customer_id IS NOT NULL
ON CONFLICT (org_id,recipient_id,domain,cds_customer_id,client_id)
DO UPDATE SET status='active', updated_at=NOW();

INSERT INTO communication_subscriptions
  (org_id,enrollment_id,event_type,channel,delivery_mode,enabled,critical_override)
SELECT e.org_id,e.id,'cds.client_pulse','email','immediate',TRUE,TRUE
FROM communication_enrollments e
JOIN client_email_recipients r ON r.id=e.recipient_id AND r.org_id=e.org_id
WHERE e.domain='cds'
  AND e.cds_customer_id IS NOT NULL
  AND r.cds_customer_id=e.cds_customer_id
  AND r.enabled=true
  AND r.deleted_at IS NULL
ON CONFLICT (enrollment_id,event_type,channel)
DO UPDATE SET enabled=TRUE,delivery_mode='immediate',critical_override=TRUE,updated_at=NOW();

COMMENT ON COLUMN client_email_recipients.cds_customer_id IS 'Authoritative CDS customer scope for Client Pulse recipients. NULL means unbound/non-CDS recipient; super admins remain global.';
