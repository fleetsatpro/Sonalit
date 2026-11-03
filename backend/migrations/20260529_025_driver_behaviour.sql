-- S2-F3: Driver Behaviour Scoring
-- RULE A: ENABLE + FORCE RLS + org_isolation on every new table

-- ─── driver_behaviour_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_behaviour_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  driver_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id    UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  event_type    VARCHAR(50) NOT NULL,
  -- hard_braking | harsh_acceleration | harsh_cornering | speeding | prolonged_idle | fatigue_pattern
  severity      NUMERIC(3,1) DEFAULT 1.0,  -- 1–5 scale, higher = worse
  speed_kmh     NUMERIC(6,1),
  lat           NUMERIC(10,7),
  lng           NUMERIC(10,7),
  extra         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

ALTER TABLE driver_behaviour_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_behaviour_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON driver_behaviour_events;
CREATE POLICY org_isolation ON driver_behaviour_events
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON driver_behaviour_events TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_driver_beh_events_driver ON driver_behaviour_events (org_id, driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_beh_events_vehicle ON driver_behaviour_events (vehicle_id, created_at DESC) WHERE deleted_at IS NULL;

-- ─── driver_scores_30d (materialized view) ────────────────────────────────────
-- RULE B: matviews don't honour RLS — include org_id column, every read uses WHERE org_id = $1
CREATE MATERIALIZED VIEW IF NOT EXISTS driver_scores_30d AS
  SELECT
    org_id,
    driver_id,
    COUNT(*) FILTER (WHERE event_type = 'hard_braking')          AS hard_braking_count,
    COUNT(*) FILTER (WHERE event_type = 'harsh_acceleration')     AS harsh_acceleration_count,
    COUNT(*) FILTER (WHERE event_type = 'harsh_cornering')        AS harsh_cornering_count,
    COUNT(*) FILTER (WHERE event_type = 'speeding')               AS speeding_count,
    COUNT(*) FILTER (WHERE event_type = 'prolonged_idle')         AS idle_count,
    COUNT(*) FILTER (WHERE event_type = 'fatigue_pattern')        AS fatigue_count,
    COUNT(*)                                                       AS total_events,
    ROUND(
      GREATEST(0,
        100
        - COUNT(*) FILTER (WHERE event_type = 'hard_braking')         * 3
        - COUNT(*) FILTER (WHERE event_type = 'harsh_acceleration')    * 2
        - COUNT(*) FILTER (WHERE event_type = 'harsh_cornering')       * 2
        - COUNT(*) FILTER (WHERE event_type = 'speeding')              * 2
        - COUNT(*) FILTER (WHERE event_type = 'prolonged_idle')        * 1
        - COUNT(*) FILTER (WHERE event_type = 'fatigue_pattern')       * 5
      )
    , 1) AS score,
    NOW() AS refreshed_at
  FROM driver_behaviour_events
  WHERE deleted_at IS NULL
    AND created_at > NOW() - INTERVAL '30 days'
  GROUP BY org_id, driver_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS driver_scores_30d_pkey ON driver_scores_30d (org_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_scores_30d_org ON driver_scores_30d (org_id, score DESC);
