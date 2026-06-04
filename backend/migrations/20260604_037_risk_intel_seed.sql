-- Seed realistic risk zones for Risk Intelligence module.
-- Idempotent: ON CONFLICT (zone_code, org_id) DO NOTHING.
-- Runs after 036 which adds the intel columns.

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Derive org from existing convoy rows; fall back to sentinel
  SELECT org_id INTO v_org_id FROM convoys WHERE org_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_org_id IS NULL THEN v_org_id := '00000000-0000-0000-0000-000000000001'; END IF;

  -- Add unique constraint if missing (needed for ON CONFLICT)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'risk_zones_zone_code_org_id_key' AND conrelid = 'risk_zones'::regclass
  ) THEN
    ALTER TABLE risk_zones ADD CONSTRAINT risk_zones_zone_code_org_id_key UNIQUE (zone_code, org_id);
  END IF;

  INSERT INTO risk_zones (
    org_id, zone_code, name, continent, level, region,
    why, when_active, precaution,
    tags, map_lon, map_lat, confidence, velocity, is_active,
    lat, lng, radius_km, risk_level, active
  ) VALUES

  -- AFRICA
  (v_org_id, 'AF-MOG', 'Mogadishu Corridor', 'africa', 'high',
   'Southern Somalia', 'Active Al-Shabaab interdiction activity along the Afgooye corridor and K50 road; IED placements reported weekly.',
   'All hours; elevated 04:00–08:00 local', 'Avoid travel; if essential use armoured vehicle with armed escort and pre-notify AMISOM.',
   ARRAY['armed-conflict','ied','kidnap'], 45.3413, 2.0469, 89, 'rising', true, 2.0, 45.3, 80, 'high', true),

  (v_org_id, 'AF-NIG', 'Niger Delta Transit Zone', 'africa', 'high',
   'Rivers State, Nigeria', 'Armed piracy and cargo hijacking on waterways and coastal roads; MEND-linked groups active.',
   'Night hours particularly dangerous (18:00–06:00)', 'Travel in convoy only; share route plan 24h in advance; no night movement.',
   ARRAY['piracy','armed-robbery','kidnap'], 6.5244, 4.5020, 82, 'stable', true, 4.5, 6.5, 60, 'high', true),

  (v_org_id, 'AF-SAH', 'Sahel Corridor (Mali–Niger)', 'africa', 'high',
   'Northern Mali / Western Niger', 'JNIM and ISGS operations targeting supply convoys; multiple ambush incidents in 2026.',
   'Continuous risk; worst at dusk and dawn', 'UN/AMISOM escort required; file flight plan if air corridor; no solo ground movement.',
   ARRAY['armed-conflict','ambush','jnim'], -2.0, 18.5, 91, 'rising', true, 18.5, -2.0, 400, 'high', true),

  (v_org_id, 'AF-ETH', 'Afar Region Access Road', 'africa', 'medium',
   'Afar, Ethiopia', 'Inter-communal clashes and opportunistic banditry on the Djibouti–Addis highway segment.',
   'Risk elevated during dry season (Oct–Mar)', 'Travel in groups; notify local administration; avoid roadside stops.',
   ARRAY['banditry','communal-violence'], 40.4897, 11.7558, 68, 'stable', true, 11.8, 40.5, 120, 'medium', true),

  -- ASIA
  (v_org_id, 'AS-KHY', 'Khyber Pass Corridor', 'asia', 'high',
   'KPK Province, Pakistan', 'TTP checkpoints and IED activity on N-55 and N-5 highways; 3 convoy incidents in 2026 Q1.',
   'All hours; worst at night', 'Requires FC/Levies escort; share manifest with authorities 24h ahead; no unmarked vehicles.',
   ARRAY['ied','checkpoint','armed-conflict'], 71.0833, 34.1, 85, 'rising', true, 34.1, 71.1, 90, 'high', true),

  (v_org_id, 'AS-MYA', 'Myanmar Central Corridor', 'asia', 'high',
   'Sagaing–Mandalay, Myanmar', 'Junta and PDF clashes disrupting road logistics on the Mandalay–Monywa axis.',
   'Unpredictable; flare-ups during military offensives', 'No civilian convoy movement without local PDF clearance; monitor OCHA alerts.',
   ARRAY['armed-conflict','checkpoint'], 95.9956, 21.9588, 76, 'rising', true, 22.0, 96.0, 200, 'high', true),

  (v_org_id, 'AS-AFG', 'Kabul–Kandahar Highway', 'asia', 'medium',
   'Ghazni–Zabul provinces, Afghanistan', 'IED threat reduced post-transition but banditry and extortion at Taliban checkpoints persists.',
   'All hours; additional risk at dusk', 'Advance coordination with local Taliban governance; carry documentation; no night movement.',
   ARRAY['ied','extortion','checkpoint'], 67.5, 33.0, 72, 'falling', true, 33.0, 67.5, 350, 'medium', true),

  -- MIDEAST
  (v_org_id, 'ME-YEM', 'Marib–Sana''a Supply Route', 'mideast', 'high',
   'Marib Governorate, Yemen', 'Houthi artillery and drone strikes targeting supply convoys; active frontline shifts weekly.',
   'Continuous; aerial threat all hours', 'De-conflict with UNDSS; humanitarian marking mandatory; no fuel tankers without special clearance.',
   ARRAY['armed-conflict','drone','shelling'], 45.3333, 15.4667, 94, 'rising', true, 15.5, 45.3, 150, 'high', true),

  (v_org_id, 'ME-IRQ', 'Baghdad Southern Belt', 'mideast', 'medium',
   'Babil–Wasit Governorates, Iraq', 'PMF-linked checkpoint extortion and occasional IED remnants on Highway 1 south corridor.',
   'Risk peaks around political events and Iranian anniversaries', 'Avoid lone travel; travel in groups of 3+ vehicles; pre-notify embassy security.',
   ARRAY['checkpoint','ied','extortion'], 44.3661, 32.9167, 65, 'stable', true, 33.0, 44.4, 100, 'medium', true),

  -- EUROPE
  (v_org_id, 'EU-UKR', 'Eastern Ukraine Supply Line', 'europe', 'high',
   'Zaporizhzhia–Dnipro, Ukraine', 'Artillery threat within 40km of the frontline; road infrastructure damage slows convoys.',
   'All hours; worst during Russian offensive windows', 'UNDSS/OCHA de-confliction mandatory; no travel east of Dnipro without military clearance.',
   ARRAY['armed-conflict','shelling','unexploded-ordnance'], 35.5, 47.5, 96, 'stable', true, 47.5, 35.5, 200, 'high', true),

  -- AMERICAS
  (v_org_id, 'AM-MEX', 'Tamaulipas Corridor', 'americas', 'high',
   'Tamaulipas, Mexico', 'Gulf Cartel and CDN clashes; extortion of freight at informal checkpoints on Highway 97.',
   'Night hours extremely dangerous; risk all day on isolated routes', 'Use licensed freight forwarder with cartel-negotiated safe passage; no solo trucks.',
   ARRAY['cartel','extortion','kidnap'], -98.5, 24.5, 83, 'rising', true, 24.5, -98.5, 180, 'high', true),

  (v_org_id, 'AM-COL', 'Urabá–Córdoba Axis', 'americas', 'medium',
   'Antioquia–Córdoba, Colombia', 'FARC-EMC and Clan del Golfo presence causing selective road access and extortion.',
   'Riskier at dawn and dusk; weekends lower', 'Register route with UNGRD; use local logistics partner; avoid isolated roads.',
   ARRAY['farc','extortion','armed-conflict'], -76.5, 7.5, 66, 'stable', true, 7.5, -76.5, 120, 'medium', true),

  -- OCEANIA (low — included for completeness)
  (v_org_id, 'OC-PNG', 'Highlands Highway, PNG', 'oceania', 'low',
   'Eastern Highlands, Papua New Guinea', 'Tribal clashes and opportunistic vehicle crime; low-level but persistent.',
   'Night movement strongly discouraged', 'Travel before 15:00; travel in groups; engage community liaison before entry.',
   ARRAY['tribal-violence','theft'], 145.7, -6.1, 45, 'stable', true, -6.1, 145.7, 200, 'low', true)

  ON CONFLICT (zone_code, org_id) DO NOTHING;

END $$;
