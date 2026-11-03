-- 4D world-state reconciliation
-- Raw tracking_locations remains immutable evidence. tracking_sessions.current_* stays
-- the operational best-estimate state so existing consumers do not need a second
-- competing position field. Observed-vs-estimated metadata is additive and auditable.

ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS current_observed_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS current_observed_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS current_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS position_state TEXT NOT NULL DEFAULT 'observed'
    CHECK (position_state IN (
      'observed','reconciled_estimate','outlier_suspected','tracking_uncertain',
      'source_conflict','stale','no_confident_estimate'
    )),
  ADD COLUMN IF NOT EXISTS position_confidence NUMERIC
    CHECK (position_confidence IS NULL OR (position_confidence >= 0 AND position_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS position_uncertainty_m NUMERIC
    CHECK (position_uncertainty_m IS NULL OR position_uncertainty_m >= 0),
  ADD COLUMN IF NOT EXISTS position_reason TEXT,
  ADD COLUMN IF NOT EXISTS position_algorithm_version TEXT;

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_position_state
  ON tracking_sessions(org_id, position_state, last_seen_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS world_state_agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'position_reconcile','route_consistency','source_conflict','trajectory_review'
  )),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  trigger_reason TEXT,
  observed_lat NUMERIC,
  observed_lng NUMERIC,
  observed_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_state_agent_tasks_queue
  ON world_state_agent_tasks(status, priority, created_at)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_world_state_agent_tasks_session
  ON world_state_agent_tasks(session_id, created_at DESC);

ALTER TABLE world_state_agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_state_agent_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS world_state_agent_tasks_org_isolation ON world_state_agent_tasks;
CREATE POLICY world_state_agent_tasks_org_isolation ON world_state_agent_tasks
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- Deterministic safety guard for every producer already updating current_*.
-- It never overwrites raw evidence. A jump that is physically implausible is
-- retained as the observed coordinate while the operational position remains
-- at the previous best estimate and a reconciliation task is queued.
CREATE OR REPLACE FUNCTION sonalit_guard_world_state_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  dt_hours NUMERIC;
  jump_km NUMERIC;
  max_km NUMERIC;
BEGIN
  IF NEW.current_lat IS NULL OR NEW.current_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Preserve exactly what the producer supplied.
  NEW.current_observed_lat := NEW.current_lat;
  NEW.current_observed_lng := NEW.current_lng;
  NEW.current_observed_at := COALESCE(NEW.last_location_at, NOW());

  IF TG_OP = 'UPDATE'
     AND OLD.current_lat IS NOT NULL
     AND OLD.current_lng IS NOT NULL
     AND OLD.last_location_at IS NOT NULL
     AND NEW.last_location_at IS NOT NULL THEN

    dt_hours := EXTRACT(EPOCH FROM (NEW.last_location_at - OLD.last_location_at)) / 3600.0;
    jump_km := 111.32 * sqrt(
      power(NEW.current_lat - OLD.current_lat, 2) +
      power((NEW.current_lng - OLD.current_lng) * cos(radians((NEW.current_lat + OLD.current_lat) / 2.0)), 2)
    );

    IF dt_hours > 0 THEN
      max_km := GREATEST(0.10, 250.0 * dt_hours);
      IF jump_km > max_km THEN
        NEW.position_state := 'outlier_suspected';
        NEW.position_confidence := 0.20;
        NEW.position_uncertainty_m := GREATEST(COALESCE(NEW.current_accuracy_m, 0), jump_km * 1000 / 2);
        NEW.position_reason := format('implausible_jump_%skm_over_%ss', round(jump_km, 3), round(dt_hours * 3600, 1));
        NEW.position_algorithm_version := 'db-guard-v1';

        -- Keep the operational point physically continuous. The observed point
        -- remains available in the observation columns and the source evidence
        -- table; this update only decides what existing live consumers see.
        NEW.current_lat := OLD.current_lat;
        NEW.current_lng := OLD.current_lng;
        NEW.current_accuracy_m := OLD.current_accuracy_m;
        NEW.current_speed_kph := OLD.current_speed_kph;
        NEW.current_heading := OLD.current_heading;
        NEW.current_source := OLD.current_source;

        INSERT INTO world_state_agent_tasks (
          org_id, session_id, task_type, priority, trigger_reason,
          observed_lat, observed_lng, observed_at, payload
        ) VALUES (
          NEW.org_id, NEW.id, 'position_reconcile',
          CASE WHEN jump_km > 25 THEN 'critical' WHEN jump_km > 5 THEN 'high' ELSE 'normal' END,
          'deterministic_jump_guard',
          NEW.current_observed_lat, NEW.current_observed_lng, NEW.current_observed_at,
          jsonb_build_object(
            'jump_km', round(jump_km, 3),
            'elapsed_seconds', round(dt_hours * 3600, 1),
            'max_plausible_km', round(max_km, 3),
            'previous_lat', OLD.current_lat,
            'previous_lng', OLD.current_lng
          )
        );
      ELSE
        NEW.position_state := 'observed';
        NEW.position_confidence := CASE
          WHEN NEW.current_accuracy_m IS NULL THEN NULL
          WHEN NEW.current_accuracy_m <= 25 THEN 0.98
          WHEN NEW.current_accuracy_m <= 75 THEN 0.90
          WHEN NEW.current_accuracy_m <= 250 THEN 0.70
          ELSE 0.40
        END;
        NEW.position_uncertainty_m := NEW.current_accuracy_m;
        NEW.position_reason := 'deterministic_motion_consistent';
        NEW.position_algorithm_version := 'db-guard-v1';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sonalit_guard_world_state ON tracking_sessions;
CREATE TRIGGER trg_sonalit_guard_world_state
BEFORE UPDATE OF current_lat, current_lng ON tracking_sessions
FOR EACH ROW
EXECUTE FUNCTION sonalit_guard_world_state_update();

-- Backfill metadata only from fields already known; never invents coordinates.
UPDATE tracking_sessions
SET current_observed_lat = current_lat,
    current_observed_lng = current_lng,
    current_observed_at = COALESCE(last_location_at, updated_at),
    position_state = CASE
      WHEN current_lat IS NULL OR current_lng IS NULL THEN 'no_confident_estimate'
      ELSE 'observed'
    END,
    position_algorithm_version = 'backfill-v1'
WHERE current_observed_lat IS NULL
   OR current_observed_lng IS NULL
   OR current_observed_at IS NULL;
