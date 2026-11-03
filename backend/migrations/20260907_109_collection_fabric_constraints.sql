-- Collection Fabric correctness: durable idempotency key for observation ingestion.
CREATE UNIQUE INDEX IF NOT EXISTS intel_observations_org_source_external_uidx
  ON intel_observations(org_id, source_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS intel_observations_org_observed_time
  ON intel_observations(org_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS intel_observations_org_country_time
  ON intel_observations(org_id, country_code, observed_at DESC)
  WHERE country_code IS NOT NULL;
