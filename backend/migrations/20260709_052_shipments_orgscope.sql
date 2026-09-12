-- Shipments: add org scoping
-- Every other domain table (convoys, vehicles, drivers, shifts, geofences,
-- reports, ...) is org-scoped with RLS. shipments never got org_id at all,
-- so shipments.js queried through the raw unscoped connection and every
-- organization's shipments were mixed into one global list.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS org_id UUID;

UPDATE shipments s
SET    org_id = u.org_id
FROM   users u
WHERE  s.created_by = u.id
  AND  u.org_id IS NOT NULL
  AND  s.org_id IS NULL;

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON shipments;
CREATE POLICY org_isolation ON shipments
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON shipments TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_shipments_org ON shipments (org_id, created_at DESC) WHERE deleted_at IS NULL;
