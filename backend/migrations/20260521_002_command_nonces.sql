-- T1.3 — Command nonce table for replay protection
BEGIN;

CREATE TABLE IF NOT EXISTS guardian_command_nonces (
  device_id  UUID        NOT NULL,
  nonce      TEXT        NOT NULL,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_command_nonces_seen_at ON guardian_command_nonces(seen_at);

-- Add nonce column to device_commands if not present
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS nonce TEXT;
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

-- TTL cleanup function — call daily to drop nonces older than 24h
CREATE OR REPLACE FUNCTION cleanup_command_nonces() RETURNS void LANGUAGE sql AS $$
  DELETE FROM guardian_command_nonces WHERE seen_at < NOW() - INTERVAL '24 hours';
$$;

COMMIT;
