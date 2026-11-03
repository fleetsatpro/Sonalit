-- Classify convoys by owning client (cargo_clients), so ops can filter/report
-- by client without conflating it with cargo_client_links (portal-visibility
-- grants, which are many-to-many and unrelated to "whose cargo is this").
ALTER TABLE convoys ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES cargo_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_convoys_client ON convoys(client_id) WHERE deleted_at IS NULL;
