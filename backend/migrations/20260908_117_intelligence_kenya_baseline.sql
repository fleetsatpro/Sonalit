-- Establish non-fabricated baseline configuration for Sonalit's primary
-- Kenya intelligence scope. These are configuration objects, not incidents
-- or assessments, and therefore do not create false intelligence.

INSERT INTO intel_watchlists (org_id,name,description,watch_type,target,severity_floor,active)
SELECT DISTINCT u.org_id,
  'Kenya National Watch',
  'Baseline country watch for Kenya. Feeds country-aware collection, alert filtering and analytical scope.',
  'country',
  '{"country_code":"KE","country":"Kenya","scope":"national"}'::jsonb,
  'moderate',
  true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM intel_watchlists w
  WHERE w.org_id=u.org_id
    AND w.watch_type='country'
    AND COALESCE(w.target->>'country_code','')='KE'
    AND w.name='Kenya National Watch'
);

INSERT INTO intel_entities (org_id,entity_type,canonical_name,aliases,country_code,confidence,metadata)
SELECT DISTINCT u.org_id,
  'country',
  'Kenya',
  '["KE","Republic of Kenya"]'::jsonb,
  'KE',
  100,
  '{"baseline":true,"role":"country_intelligence_scope"}'::jsonb
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM intel_entities e
  WHERE e.org_id=u.org_id AND e.entity_type='country' AND e.canonical_name='Kenya'
);

CREATE INDEX IF NOT EXISTS intel_alerts_kenya_recent
  ON intel_alerts(org_id,last_seen_at DESC)
  WHERE country_code='KE';
