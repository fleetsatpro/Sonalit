-- Collection Fabric refreshes observations in-place. Keep an explicit last_seen timestamp
-- separate from the original observed_at timestamp so repeated sightings remain traceable.
ALTER TABLE intel_observations ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS intel_observations_last_seen ON intel_observations(org_id, last_seen_at DESC);
