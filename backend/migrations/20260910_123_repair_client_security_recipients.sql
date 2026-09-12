-- Repair client notification recipients created by the legacy onboarding UI.
-- That UI defaulted sonalit_security=false while client recipients were also
-- subscribed to CDS Client Pulse, causing them to be silently excluded from
-- PANIC/SOS security fan-out. Only unambiguously client-owned recipients are
-- repaired; global/admin recipients and ambiguous records are untouched.

UPDATE client_email_recipients r
SET sonalit_security = TRUE
WHERE r.deleted_at IS NULL
  AND r.authority_role = 'client'
  AND r.sonalit_security = FALSE
  AND r.cds_client_pulse = TRUE
  AND r.client_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM cargo_clients c
    WHERE c.id = r.client_id
      AND c.org_id = r.org_id
      AND c.deleted_at IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_security_client
  ON client_email_recipients (org_id, client_id, enabled, sonalit_security)
  WHERE deleted_at IS NULL AND authority_role = 'client';
