-- Every zone still shows green/low regardless of real severity because the
-- auto-sweep already overwrote `level` (down to 'low') for zones with no
-- matching OSINT events, in every cycle it ran BEFORE the level_source
-- floor (migration 055) existed to stop it. That floor only protects
-- zones going forward — it does nothing for damage already done.
--
-- `risk_level` is a separate legacy column the sweep never touches (it
-- only ever writes `level`/`confidence`/`velocity`/`level_source`), and
-- both the seed data (20260604_037) and the admin/AI zone-creation paths
-- (POST /risk/zones, create_risk_zone tool) always set risk_level to the
-- same curated severity as the original `level`. So the correct value is
-- still fully recoverable from it. Re-derive `level` from `risk_level`
-- (same mapping as migration 036) for every active zone and mark it
-- 'manual' so the sweep can only escalate past it from here on, never
-- silently erase it again.
UPDATE risk_zones
SET level = CASE risk_level
  WHEN 'critical' THEN 'high'
  WHEN 'no_go'    THEN 'high'
  WHEN 'high'     THEN 'high'
  WHEN 'medium'   THEN 'medium'
  ELSE 'low'
END,
level_source = 'manual'
WHERE is_active = true;
