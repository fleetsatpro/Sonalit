-- Register NewsNow as a first-class intelligence discovery source.
-- NewsNow is an aggregator/link-out service; this registration does not scrape it
-- or copy its headlines into intel_observations. Observation ingestion requires
-- an approved feed/API contract.
INSERT INTO intel_sources (
  org_id,
  name,
  source_type,
  provider,
  endpoint,
  reliability,
  active,
  metadata,
  last_seen_at
)
SELECT
  u.org_id,
  'NewsNow',
  'news',
  'newsnow',
  'https://www.newsnow.co.uk/h/',
  60,
  true,
  jsonb_build_object(
    'role', 'discovery',
    'collection_mode', 'link_out',
    'observation_ingestion', false,
    'note', 'NewsNow is a discovery/link-out source. Do not scrape or treat the aggregator page as direct evidence without an approved feed or API contract.'
  ),
  NOW()
FROM (
  SELECT DISTINCT org_id
  FROM users
  WHERE org_id IS NOT NULL
    AND deleted_at IS NULL
) u
WHERE NOT EXISTS (
  SELECT 1
  FROM intel_sources s
  WHERE s.org_id = u.org_id
    AND s.provider = 'newsnow'
    AND s.endpoint = 'https://www.newsnow.co.uk/h/'
);
