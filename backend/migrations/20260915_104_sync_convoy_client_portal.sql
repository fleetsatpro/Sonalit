-- Keep the operational cargo-owner relationship and the client portal visibility contract in sync.
-- A convoy selected for a cargo client during creation must immediately be visible
-- in that client's portal. This also repairs older convoys that already have
-- convoys.client_id but no cargo_client_links row.

INSERT INTO cargo_client_links (org_id, client_id, convoy_id, show_value)
SELECT c.org_id, c.client_id, c.id, false
FROM convoys c
JOIN cargo_clients cc ON cc.id = c.client_id AND cc.org_id = c.org_id AND cc.deleted_at IS NULL
LEFT JOIN cargo_client_links l ON l.client_id = c.client_id AND l.convoy_id = c.id
WHERE c.client_id IS NOT NULL
  AND c.deleted_at IS NULL
  AND l.id IS NULL
ON CONFLICT (client_id, convoy_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_convoy_client_portal_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.org_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    INSERT INTO cargo_client_links (org_id, client_id, convoy_id, show_value)
    SELECT NEW.org_id, NEW.client_id, NEW.id, false
    WHERE EXISTS (
      SELECT 1 FROM cargo_clients cc
      WHERE cc.id = NEW.client_id
        AND cc.org_id = NEW.org_id
        AND cc.deleted_at IS NULL
    )
    ON CONFLICT (client_id, convoy_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_convoy_client_portal_link ON convoys;
CREATE TRIGGER trg_sync_convoy_client_portal_link
AFTER INSERT OR UPDATE OF client_id, org_id ON convoys
FOR EACH ROW
EXECUTE FUNCTION sync_convoy_client_portal_link();

CREATE INDEX IF NOT EXISTS idx_convoys_client_portal
  ON convoys(client_id, org_id)
  WHERE client_id IS NOT NULL AND deleted_at IS NULL;
