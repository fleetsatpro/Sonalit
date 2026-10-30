-- Executive mobility, assigned field teams and mission-scoped Ops Comms.
-- Flight state remains operator-entered until a trusted provider integration is configured.
BEGIN;
ALTER TABLE public.sjm_journeys
 ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'executive_transfer',
 ADD COLUMN IF NOT EXISTS principal_reference TEXT,
 ADD COLUMN IF NOT EXISTS airport_code TEXT,
 ADD COLUMN IF NOT EXISTS terminal TEXT,
 ADD COLUMN IF NOT EXISTS airline TEXT,
 ADD COLUMN IF NOT EXISTS flight_number TEXT,
 ADD COLUMN IF NOT EXISTS flight_scheduled_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS flight_status TEXT NOT NULL DEFAULT 'unknown',
 ADD COLUMN IF NOT EXISTS flight_status_source TEXT NOT NULL DEFAULT 'not_recorded',
 ADD COLUMN IF NOT EXISTS flight_status_observed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS flight_status_note TEXT,
 ADD COLUMN IF NOT EXISTS meet_greet_instructions TEXT;
ALTER TABLE public.sjm_journeys
 ADD CONSTRAINT sjm_journeys_service_type_check CHECK (service_type IN ('airport_arrival','airport_departure','meet_and_greet','close_protection','security_escort','executive_transfer','other')),
 ADD CONSTRAINT sjm_journeys_airport_code_check CHECK (airport_code IS NULL OR airport_code ~ '^[A-Z0-9]{3,4}$'),
 ADD CONSTRAINT sjm_journeys_flight_status_check CHECK (flight_status IN ('unknown','scheduled','delayed','landed','departed','cancelled','diverted')),
 ADD CONSTRAINT sjm_journeys_flight_status_source_check CHECK (flight_status_source IN ('not_recorded','operator_entered')),
 ADD CONSTRAINT sjm_journeys_mobility_text_limits_check CHECK ((principal_reference IS NULL OR length(principal_reference)<=120) AND (terminal IS NULL OR length(terminal)<=80) AND (airline IS NULL OR length(airline)<=100) AND (flight_number IS NULL OR length(flight_number)<=24) AND (flight_status_note IS NULL OR length(flight_status_note)<=1200) AND (meet_greet_instructions IS NULL OR length(meet_greet_instructions)<=2000));
CREATE TABLE IF NOT EXISTS public.sjm_journey_participants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID NOT NULL,
 journey_id UUID NOT NULL REFERENCES public.sjm_journeys(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 duty_role TEXT NOT NULL CHECK (duty_role IN ('driver','backup_driver','cpo','meet_greet','security_escort','dispatcher')),
 is_primary BOOLEAN NOT NULL DEFAULT FALSE,
 assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), removed_at TIMESTAMPTZ,
 CHECK (removed_at IS NULL OR removed_at>=assigned_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sjm_active_participant_role ON public.sjm_journey_participants(org_id,journey_id,user_id,duty_role) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sjm_primary_participant_role ON public.sjm_journey_participants(org_id,journey_id,duty_role) WHERE removed_at IS NULL AND is_primary=true;
CREATE INDEX IF NOT EXISTS idx_sjm_participants_user_active ON public.sjm_journey_participants(org_id,user_id,journey_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_participants_journey_active ON public.sjm_journey_participants(org_id,journey_id,duty_role) WHERE removed_at IS NULL;
ALTER TABLE public.sjm_journey_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_journey_participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_org_isolation ON public.sjm_journey_participants;
CREATE POLICY sjm_org_isolation ON public.sjm_journey_participants USING (org_id=current_setting('app.current_org_id',true)::uuid) WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
DROP POLICY IF EXISTS tenant_isolation_hardening ON public.sjm_journey_participants;
CREATE POLICY tenant_isolation_hardening ON public.sjm_journey_participants AS RESTRICTIVE FOR ALL USING (org_id::text=NULLIF(current_setting('app.current_org_id',true),'')) WITH CHECK (org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
GRANT SELECT,INSERT,UPDATE ON public.sjm_journey_participants TO sonalit_app;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS sjm_journey_id UUID REFERENCES public.sjm_journeys(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_sjm_journey ON public.channels(org_id,sjm_journey_id) WHERE sjm_journey_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channels_sjm_journey ON public.channels(org_id,sjm_journey_id) WHERE sjm_journey_id IS NOT NULL;
COMMIT;