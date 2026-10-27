-- Secure Journey Management (SJM): tenant-scoped itinerary, approvals and reporting.
-- Reuses Sonalit clients, convoys, Route Safety and actual location evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS sjm_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  reference TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
  client_id UUID REFERENCES cargo_clients(id) ON DELETE SET NULL,
  convoy_id UUID REFERENCES convoys(id) ON DELETE SET NULL,
  transport_mode TEXT NOT NULL DEFAULT 'road' CHECK (transport_mode IN ('road','air','rail','sea','multimodal','other')),
  origin_label TEXT NOT NULL,
  origin_lat NUMERIC(10,7) NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng NUMERIC(10,7) NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  destination_label TEXT NOT NULL,
  destination_lat NUMERIC(10,7) NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
  destination_lng NUMERIC(10,7) NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
  planned_departure_at TIMESTAMPTZ,
  planned_arrival_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','in_progress','paused','exception','arrival_pending_verification','closed','cancelled','aborted','on_hold')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  planning_started_at TIMESTAMPTZ,
  assessment_pending_at TIMESTAMPTZ,
  ready_for_review_at TIMESTAMPTZ,
  ready_to_depart_at TIMESTAMPTZ,
  departure_readiness_acknowledgement TEXT,
  paused_at TIMESTAMPTZ,
  exception_at TIMESTAMPTZ,
  arrival_pending_verification_at TIMESTAMPTZ,
  arrival_confirmed_at TIMESTAMPTZ,
  arrival_verification_source TEXT,
  arrival_verification_note TEXT,
  closed_at TIMESTAMPTZ,
  aborted_at TIMESTAMPTZ,
  on_hold_at TIMESTAMPTZ,
  planned_route JSONB NOT NULL DEFAULT '[]'::jsonb,
  planned_distance_km NUMERIC(10,2),
  planned_duration_minutes INTEGER,
  route_assessment JSONB,
  human_review_decision TEXT CHECK (human_review_decision IN ('approve_with_controls','reject')),
  human_review_rationale TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  risk_acknowledgement TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, reference),
  CHECK (planned_arrival_at IS NULL OR planned_departure_at IS NULL OR planned_arrival_at > planned_departure_at)
);
CREATE TABLE IF NOT EXISTS sjm_journey_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES sjm_journeys(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 23),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  stop_type TEXT NOT NULL DEFAULT 'checkpoint' CHECK (stop_type IN ('checkpoint','rest','refuelling','border','meeting','overnight','destination','other')),
  lat NUMERIC(10,7),
  lng NUMERIC(10,7),
  planned_arrival_at TIMESTAMPTZ,
  planned_departure_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 10080),
  instructions TEXT,
  stop_status TEXT NOT NULL DEFAULT 'planned' CHECK (stop_status IN ('planned','reached','skipped')),
  confirmed_at TIMESTAMPTZ,
  actual_lat NUMERIC(10,7),
  actual_lng NUMERIC(10,7),
  confirmation_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, sequence),
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)),
  CHECK ((actual_lat IS NULL AND actual_lng IS NULL) OR (actual_lat BETWEEN -90 AND 90 AND actual_lng BETWEEN -180 AND 180))
);
CREATE TABLE IF NOT EXISTS sjm_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES sjm_journeys(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'operator' CHECK (source IN ('operator','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sjm_client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES cargo_clients(id) ON DELETE CASCADE,
  report_timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  report_template JSONB NOT NULL DEFAULT '{"title":"Secure Journey Management Report","sections":["summary","itinerary","stops","route_assessment","operational_events","telemetry_snapshot"]}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, client_id)
);
CREATE TABLE IF NOT EXISTS sjm_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES sjm_journeys(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('itinerary','daily','final')),
  report_date DATE NOT NULL,
  schema_version TEXT NOT NULL,
  data JSONB NOT NULL,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sjm_journeys_org_departure ON sjm_journeys(org_id, planned_departure_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_journeys_org_status ON sjm_journeys(org_id, status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_journeys_client ON sjm_journeys(org_id, client_id, planned_departure_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_stops_journey_sequence ON sjm_journey_stops(org_id, journey_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sjm_events_journey_time ON sjm_journey_events(org_id, journey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sjm_reports_org_date ON sjm_reports(org_id, report_date DESC, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sjm_reports_journey ON sjm_reports(org_id, journey_id, generated_at DESC);
DO $sjm$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sjm_journeys','sjm_journey_stops','sjm_journey_events','sjm_client_profiles','sjm_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS sjm_org_isolation ON public.%I', t);
    EXECUTE format('CREATE POLICY sjm_org_isolation ON public.%I USING (org_id = current_setting(''app.current_org_id'', true)::uuid) WITH CHECK (org_id = current_setting(''app.current_org_id'', true)::uuid)', t);
  END LOOP;
END
$sjm$;
GRANT SELECT, INSERT, UPDATE, DELETE ON sjm_journeys TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sjm_journey_stops TO sonalit_app;
GRANT SELECT, INSERT ON sjm_journey_events TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sjm_client_profiles TO sonalit_app;
GRANT SELECT, INSERT ON sjm_reports TO sonalit_app;
COMMIT;
