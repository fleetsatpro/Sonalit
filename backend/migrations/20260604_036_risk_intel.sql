-- Migration: Risk Intelligence module
-- Idempotent — safe to run multiple times.
-- Adds intel columns to risk_zones, creates risk_events,
-- convoy_risk_zones, and risk_zone_stats materialized view.

-- ─── 1. Add org_id to risk_zones ─────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_zones' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE risk_zones
      ADD COLUMN org_id UUID DEFAULT (
        SELECT org_id FROM convoys
        WHERE org_id IS NOT NULL
        ORDER BY created_at
        LIMIT 1
      );
    -- Fall back to a sentinel UUID if no convoy rows exist yet
    UPDATE risk_zones
    SET org_id = '00000000-0000-0000-0000-000000000001'::uuid
    WHERE org_id IS NULL;
  END IF;
END $$;

-- ─── 2. Add new intel columns to risk_zones ───────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'zone_code') THEN
    ALTER TABLE risk_zones ADD COLUMN zone_code TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'continent') THEN
    ALTER TABLE risk_zones ADD COLUMN continent TEXT
      CHECK (continent IN ('africa','asia','europe','americas','mideast','oceania'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'level') THEN
    ALTER TABLE risk_zones ADD COLUMN level TEXT
      CHECK (level IN ('high','medium','low'));
    -- Seed from risk_level, mapping critical/no_go -> high
    UPDATE risk_zones
    SET level = CASE risk_level
      WHEN 'critical' THEN 'high'
      WHEN 'no_go'    THEN 'high'
      WHEN 'high'     THEN 'high'
      WHEN 'medium'   THEN 'medium'
      ELSE 'low'
    END
    WHERE level IS NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'region') THEN
    ALTER TABLE risk_zones ADD COLUMN region TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'why') THEN
    ALTER TABLE risk_zones ADD COLUMN why TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'when_active') THEN
    ALTER TABLE risk_zones ADD COLUMN when_active TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'precaution') THEN
    ALTER TABLE risk_zones ADD COLUMN precaution TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'tags') THEN
    ALTER TABLE risk_zones ADD COLUMN tags TEXT[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'map_lon') THEN
    ALTER TABLE risk_zones ADD COLUMN map_lon NUMERIC(8,4);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'map_lat') THEN
    ALTER TABLE risk_zones ADD COLUMN map_lat NUMERIC(8,4);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'confidence') THEN
    ALTER TABLE risk_zones ADD COLUMN confidence INTEGER DEFAULT 70;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'velocity') THEN
    ALTER TABLE risk_zones ADD COLUMN velocity TEXT DEFAULT 'stable'
      CHECK (velocity IN ('rising','stable','falling'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_zones' AND column_name = 'is_active') THEN
    ALTER TABLE risk_zones ADD COLUMN is_active BOOLEAN DEFAULT true;
    -- Mirror existing active column
    UPDATE risk_zones SET is_active = active WHERE is_active IS NULL;
  END IF;
END $$;

-- ─── 3. RLS on risk_zones ─────────────────────────────────────────────────────

ALTER TABLE risk_zones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'risk_zones' AND policyname = 'risk_zones_org_isolation'
  ) THEN
    CREATE POLICY risk_zones_org_isolation ON risk_zones
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

-- ─── 4. risk_events table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS risk_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  zone_id     UUID NOT NULL REFERENCES risk_zones(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('high','medium','low')),
  source      TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS risk_events_org_zone
  ON risk_events(org_id, zone_id, occurred_at DESC);

ALTER TABLE risk_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'risk_events' AND policyname = 'risk_events_org_isolation'
  ) THEN
    CREATE POLICY risk_events_org_isolation ON risk_events
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

-- ─── 5. convoy_risk_zones junction table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS convoy_risk_zones (
  convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  zone_id   UUID NOT NULL REFERENCES risk_zones(id) ON DELETE CASCADE,
  PRIMARY KEY (convoy_id, zone_id)
);

-- ─── 6. risk_zone_stats materialized view ─────────────────────────────────────
-- DROP + CREATE is the only idempotent way to redefine a materialized view.

DROP MATERIALIZED VIEW IF EXISTS risk_zone_stats;

CREATE MATERIALIZED VIEW risk_zone_stats AS
SELECT
  rz.org_id,
  rz.id AS zone_id,
  rz.zone_code,
  COUNT(re.id) AS total_events,
  COUNT(re.id) FILTER (WHERE re.occurred_at >= now() - interval '24h') AS events_24h,
  COALESCE(
    (SELECT json_agg(cnt ORDER BY day)
     FROM (
       SELECT d.day,
         COALESCE(COUNT(re2.id), 0) AS cnt
       FROM generate_series(
         date_trunc('day', now()) - interval '6 days',
         date_trunc('day', now()),
         interval '1 day'
       ) AS d(day)
       LEFT JOIN risk_events re2 ON re2.zone_id = rz.id
         AND date_trunc('day', re2.occurred_at) = d.day
       GROUP BY d.day
     ) t),
    '[]'::json
  ) AS week_data
FROM risk_zones rz
LEFT JOIN risk_events re ON re.zone_id = rz.id
WHERE rz.is_active = true
GROUP BY rz.org_id, rz.id, rz.zone_code;

CREATE UNIQUE INDEX IF NOT EXISTS risk_zone_stats_pk
  ON risk_zone_stats(org_id, zone_id);

-- ─── 7. Grant permissions ─────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_events TO sonalit_app;
GRANT SELECT, INSERT, DELETE ON convoy_risk_zones TO sonalit_app;
GRANT SELECT ON risk_zone_stats TO sonalit_app;
