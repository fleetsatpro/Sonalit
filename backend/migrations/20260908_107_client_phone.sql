-- Client onboarding stores the canonical contact phone alongside identity data.
ALTER TABLE cargo_clients ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE INDEX IF NOT EXISTS idx_cargo_clients_phone ON cargo_clients(org_id, phone) WHERE deleted_at IS NULL;
