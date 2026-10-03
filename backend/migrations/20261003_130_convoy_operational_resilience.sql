BEGIN;
CREATE TABLE IF NOT EXISTS convoy_operational_states(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),org_id UUID NOT NULL,convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,posture TEXT NOT NULL CHECK(posture IN('secure','watch','elevated','critical')),summary JSONB NOT NULL DEFAULT '{}'::jsonb,version INT NOT NULL DEFAULT 1 CHECK(version>0),evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(convoy_id));
CREATE INDEX IF NOT EXISTS idx_convoy_operational_states_org ON convoy_operational_states(org_id);
CREATE TABLE IF NOT EXISTS convoy_operational_exceptions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),org_id UUID NOT NULL,convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,convoy_truck_id UUID REFERENCES convoy_trucks(id) ON DELETE SET NULL,vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,cfo_user_id UUID REFERENCES users(id) ON DELETE SET NULL,exception_type TEXT NOT NULL CHECK(exception_type IN('departure_readiness','truck_lagging','convoy_separation','truck_ahead','vehicle_breakdown','extended_stop','telemetry_gap','cfo_coverage_gap','route_deviation','checkpoint_delay','road_blockage','security_event','resource_conflict')),severity TEXT NOT NULL CHECK(severity IN('low','medium','high','critical')),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','acknowledged','mitigating','resolved','waived')),source TEXT NOT NULL DEFAULT 'derived' CHECK(source IN('derived','explicit','operator')),fingerprint TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,context JSONB NOT NULL DEFAULT '{}'::jsonb,recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ,resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,resolution_note TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS ux_convoy_operational_open_fingerprint ON convoy_operational_exceptions(convoy_id,fingerprint) WHERE status IN('open','acknowledged','mitigating');
CREATE INDEX IF NOT EXISTS idx_convoy_operational_exceptions_convoy ON convoy_operational_exceptions(org_id,convoy_id,status,severity);
CREATE INDEX IF NOT EXISTS idx_convoy_operational_exceptions_truck ON convoy_operational_exceptions(org_id,convoy_truck_id,status);
CREATE TABLE IF NOT EXISTS convoy_operational_actions(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),org_id UUID NOT NULL,convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,exception_id UUID REFERENCES convoy_operational_exceptions(id) ON DELETE SET NULL,action_type TEXT NOT NULL CHECK(action_type IN('hold_departure','contact_driver','verify_comms','do_not_assume_breakdown','reassign_backup_cfo','dispatch_mobile_response','dispatch_recovery','deploy_static_guard','regroup_convoy','hold_or_regroup','hold_affected_vehicle','verify_escort_coverage','escalate_operator')),status TEXT NOT NULL DEFAULT 'executed' CHECK(status IN('proposed','authorized','executing','executed','failed','cancelled')),convoy_truck_id UUID REFERENCES convoy_trucks(id) ON DELETE SET NULL,cfo_user_id UUID REFERENCES users(id) ON DELETE SET NULL,response_team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL,dispatch_id UUID REFERENCES intercept_dispatches(id) ON DELETE SET NULL,actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_convoy_operational_actions_convoy ON convoy_operational_actions(org_id,convoy_id,created_at DESC);
CREATE OR REPLACE FUNCTION convoy_resilience_state_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $resilience$
BEGIN
  PERFORM tenant_assert_parent_org('convoys',NEW.convoy_id,NEW.org_id);
  RETURN NEW;
END $resilience$;

DROP TRIGGER IF EXISTS convoy_resilience_state_parent_guard ON convoy_operational_states;
CREATE TRIGGER convoy_resilience_state_parent_guard
  BEFORE INSERT OR UPDATE ON convoy_operational_states
  FOR EACH ROW EXECUTE FUNCTION convoy_resilience_state_parent_guard();

CREATE OR REPLACE FUNCTION convoy_resilience_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $resilience$
BEGIN
  PERFORM tenant_assert_parent_org('convoys',NEW.convoy_id,NEW.org_id);
  IF TG_TABLE_NAME='convoy_operational_exceptions' THEN
    PERFORM tenant_assert_parent_org('convoy_trucks',NEW.convoy_truck_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('vehicles',NEW.vehicle_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('users',NEW.cfo_user_id,NEW.org_id);
  ELSE
    PERFORM tenant_assert_parent_org('convoy_operational_exceptions',NEW.exception_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('convoy_trucks',NEW.convoy_truck_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('users',NEW.cfo_user_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('response_teams',NEW.response_team_id,NEW.org_id);
    PERFORM tenant_assert_parent_org('intercept_dispatches',NEW.dispatch_id,NEW.org_id);
  END IF; RETURN NEW;
END $resilience$;
DROP TRIGGER IF EXISTS convoy_resilience_exception_parent_guard ON convoy_operational_exceptions;
CREATE TRIGGER convoy_resilience_exception_parent_guard BEFORE INSERT OR UPDATE ON convoy_operational_exceptions FOR EACH ROW EXECUTE FUNCTION convoy_resilience_parent_guard();
DROP TRIGGER IF EXISTS convoy_resilience_action_parent_guard ON convoy_operational_actions;
CREATE TRIGGER convoy_resilience_action_parent_guard BEFORE INSERT OR UPDATE ON convoy_operational_actions FOR EACH ROW EXECUTE FUNCTION convoy_resilience_parent_guard();
ALTER TABLE convoy_operational_states ENABLE ROW LEVEL SECURITY; ALTER TABLE convoy_operational_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convoy_operational_states_tenant ON convoy_operational_states;
CREATE POLICY convoy_operational_states_tenant ON convoy_operational_states AS RESTRICTIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
DROP POLICY IF EXISTS convoy_operational_states_base ON convoy_operational_states;
CREATE POLICY convoy_operational_states_base ON convoy_operational_states AS PERMISSIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
ALTER TABLE convoy_operational_exceptions ENABLE ROW LEVEL SECURITY; ALTER TABLE convoy_operational_exceptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convoy_operational_exceptions_tenant ON convoy_operational_exceptions;
CREATE POLICY convoy_operational_exceptions_tenant ON convoy_operational_exceptions AS RESTRICTIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
DROP POLICY IF EXISTS convoy_operational_exceptions_base ON convoy_operational_exceptions;
CREATE POLICY convoy_operational_exceptions_base ON convoy_operational_exceptions AS PERMISSIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
ALTER TABLE convoy_operational_actions ENABLE ROW LEVEL SECURITY; ALTER TABLE convoy_operational_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS convoy_operational_actions_tenant ON convoy_operational_actions;
CREATE POLICY convoy_operational_actions_tenant ON convoy_operational_actions AS RESTRICTIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
DROP POLICY IF EXISTS convoy_operational_actions_base ON convoy_operational_actions;
CREATE POLICY convoy_operational_actions_base ON convoy_operational_actions AS PERMISSIVE FOR ALL USING(org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK(org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
COMMIT;