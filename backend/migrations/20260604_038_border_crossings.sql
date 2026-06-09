-- S2-F9: Seed East Africa border crossing geofences
-- Idempotent: uses ON CONFLICT DO NOTHING via unique name+org_id check.

DO $$
DECLARE
  _org UUID;
BEGIN
  SELECT org_id INTO _org FROM convoys LIMIT 1;
  IF _org IS NULL THEN
    SELECT id INTO _org FROM organizations LIMIT 1;
  END IF;
  IF _org IS NULL THEN
    _org := '00000000-0000-0000-0000-000000000001';
  END IF;

  INSERT INTO geofences (name, type, region, coordinates, radius, active, org_id, created_at, updated_at)
  SELECT * FROM (VALUES
    ('Malaba', 'border', 'Uganda/Kenya',
     '{"type":"Point","coordinates":[34.2833,0.6333]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Gatuna/Katuna', 'border', 'Uganda/Rwanda',
     '{"type":"Point","coordinates":[29.8167,-1.2167]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Gisenyi/Goma', 'border', 'Rwanda/DRC',
     '{"type":"Point","coordinates":[29.2597,-1.7003]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Kobero', 'border', 'Burundi/Tanzania',
     '{"type":"Point","coordinates":[30.7833,-2.9667]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Namanga', 'border', 'Kenya/Tanzania',
     '{"type":"Point","coordinates":[36.7978,-2.5536]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Moyale', 'border', 'Ethiopia/Kenya',
     '{"type":"Point","coordinates":[38.9833,3.5333]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Mutukula', 'border', 'Uganda/Tanzania',
     '{"type":"Point","coordinates":[31.4167,-1.0167]}'::jsonb, 5.0, true, _org, NOW(), NOW()),
    ('Nimule', 'border', 'South Sudan/Uganda',
     '{"type":"Point","coordinates":[32.0583,3.5917]}'::jsonb, 5.0, true, _org, NOW(), NOW())
  ) AS v(name, type, region, coordinates, radius, active, org_id, created_at, updated_at)
  WHERE NOT EXISTS (
    SELECT 1 FROM geofences g WHERE g.name = v.name AND g.org_id = _org AND g.type = 'border'
  );
END $$;
