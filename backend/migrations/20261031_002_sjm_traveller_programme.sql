-- SJM traveller identity, multi-leg travel and dated programme execution.
-- Traveller identity and travel documents are manager-only. Duty teams receive a
-- deliberately minimised operational view; they never receive passport files.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sjm_travellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  traveller_reference TEXT NOT NULL CHECK (length(trim(traveller_reference)) BETWEEN 2 AND 48),
  traveller_type TEXT NOT NULL DEFAULT 'principal'
    CHECK (traveller_type IN ('principal','accompanying','assistant','dependent','other')),
  title TEXT CHECK (title IS NULL OR length(title)<=24),
  given_name TEXT NOT NULL CHECK (length(trim(given_name)) BETWEEN 1 AND 100),
  middle_name TEXT CHECK (middle_name IS NULL OR length(middle_name)<=100),
  family_name TEXT NOT NULL CHECK (length(trim(family_name)) BETWEEN 1 AND 100),
  preferred_name TEXT CHECK (preferred_name IS NULL OR length(preferred_name)<=100),
  nationality TEXT CHECK (nationality IS NULL OR length(nationality)<=80),
  date_of_birth DATE,
  email TEXT CHECK (email IS NULL OR length(email)<=254),
  phone TEXT CHECK (phone IS NULL OR length(phone)<=48),
  emergency_contact_name TEXT CHECK (emergency_contact_name IS NULL OR length(emergency_contact_name)<=160),
  emergency_contact_phone TEXT CHECK (emergency_contact_phone IS NULL OR length(emergency_contact_phone)<=48),
  internal_notes TEXT CHECK (internal_notes IS NULL OR length(internal_notes)<=1200),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id,journey_id,id),
  UNIQUE (org_id,journey_id,traveller_reference),
  FOREIGN KEY (org_id,journey_id) REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sjm_travellers_journey
  ON public.sjm_travellers(org_id,journey_id,created_at,id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_flight_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  traveller_id UUID,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 30),
  carrier TEXT NOT NULL CHECK (length(trim(carrier)) BETWEEN 1 AND 120),
  flight_number TEXT NOT NULL CHECK (length(trim(flight_number)) BETWEEN 2 AND 24),
  departure_airport TEXT NOT NULL CHECK (departure_airport ~ '^[A-Z0-9]{3,4}$'),
  departure_airport_name TEXT CHECK (departure_airport_name IS NULL OR length(departure_airport_name)<=180),
  departure_terminal TEXT CHECK (departure_terminal IS NULL OR length(departure_terminal)<=80),
  departure_gate TEXT CHECK (departure_gate IS NULL OR length(departure_gate)<=32),
  departure_at TIMESTAMPTZ NOT NULL,
  departure_timezone TEXT NOT NULL,
  arrival_airport TEXT NOT NULL CHECK (arrival_airport ~ '^[A-Z0-9]{3,4}$'),
  arrival_airport_name TEXT CHECK (arrival_airport_name IS NULL OR length(arrival_airport_name)<=180),
  arrival_terminal TEXT CHECK (arrival_terminal IS NULL OR length(arrival_terminal)<=80),
  arrival_gate TEXT CHECK (arrival_gate IS NULL OR length(arrival_gate)<=32),
  arrival_at TIMESTAMPTZ NOT NULL,
  arrival_timezone TEXT NOT NULL,
  booking_reference TEXT CHECK (booking_reference IS NULL OR length(booking_reference)<=80),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','boarding','departed','delayed','landed','cancelled','diverted','unknown')),
  status_source TEXT NOT NULL DEFAULT 'operator_entered'
    CHECK (status_source IN ('operator_entered','provider')),
  status_observed_at TIMESTAMPTZ,
  status_note TEXT CHECK (status_note IS NULL OR length(status_note)<=1000),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id,journey_id,id),
  UNIQUE (org_id,journey_id,sequence),
  FOREIGN KEY (org_id,journey_id) REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,journey_id,traveller_id) REFERENCES public.sjm_travellers(org_id,journey_id,id) ON DELETE RESTRICT,
  CHECK (arrival_at>departure_at)
);
CREATE INDEX IF NOT EXISTS idx_sjm_flight_segments_journey
  ON public.sjm_flight_segments(org_id,journey_id,sequence) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  journey_date DATE NOT NULL,
  timezone TEXT NOT NULL,
  day_title TEXT NOT NULL CHECK (length(trim(day_title)) BETWEEN 1 AND 180),
  briefing TEXT CHECK (briefing IS NULL OR length(briefing)<=3000),
  operational_notes TEXT CHECK (operational_notes IS NULL OR length(operational_notes)<=3000),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id,journey_id,id),
  UNIQUE (org_id,journey_id,journey_date),
  FOREIGN KEY (org_id,journey_id) REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sjm_itinerary_days_journey
  ON public.sjm_itinerary_days(org_id,journey_id,journey_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  day_id UUID NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 100),
  item_type TEXT NOT NULL DEFAULT 'other'
    CHECK (item_type IN ('flight','transfer','meeting','security_briefing','hotel','checkpoint','rest','event','other')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  description TEXT CHECK (description IS NULL OR length(description)<=2000),
  location_label TEXT CHECK (location_label IS NULL OR length(location_label)<=240),
  location_lat NUMERIC(10,7),
  location_lng NUMERIC(10,7),
  planned_start_at TIMESTAMPTZ NOT NULL,
  planned_end_at TIMESTAMPTZ NOT NULL,
  responsible_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  responsible_role TEXT CHECK (responsible_role IS NULL OR length(responsible_role)<=48),
  flight_segment_id UUID,
  execution_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (execution_status IN ('planned','in_progress','completed','delayed','skipped','exception')),
  actual_start_at TIMESTAMPTZ,
  actual_end_at TIMESTAMPTZ,
  execution_note TEXT CHECK (execution_note IS NULL OR length(execution_note)<=2000),
  sequence_revision INTEGER NOT NULL DEFAULT 1 CHECK (sequence_revision>0),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id,journey_id,day_id,id),
  UNIQUE (org_id,journey_id,day_id,sequence),
  FOREIGN KEY (org_id,journey_id,day_id) REFERENCES public.sjm_itinerary_days(org_id,journey_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,journey_id,flight_segment_id) REFERENCES public.sjm_flight_segments(org_id,journey_id,id) ON DELETE RESTRICT,
  CHECK (planned_end_at>planned_start_at),
  CHECK ((location_lat IS NULL AND location_lng IS NULL) OR (location_lat BETWEEN -90 AND 90 AND location_lng BETWEEN -180 AND 180)),
  CHECK (actual_end_at IS NULL OR actual_start_at IS NULL OR actual_end_at>=actual_start_at)
);
CREATE INDEX IF NOT EXISTS idx_sjm_itinerary_items_day
  ON public.sjm_itinerary_items(org_id,journey_id,day_id,sequence) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_itinerary_items_execution
  ON public.sjm_itinerary_items(org_id,journey_id,execution_status,planned_start_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_itinerary_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  day_id UUID NOT NULL,
  item_id UUID NOT NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('PLAN_CREATED','PLAN_UPDATED','EXECUTION_STARTED','EXECUTION_COMPLETED','EXECUTION_DELAYED','EXECUTION_SKIPPED','EXCEPTION_RAISED','EXECUTION_NOTE_ADDED')),
  previous_status TEXT,
  new_status TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (org_id,journey_id,day_id,item_id)
    REFERENCES public.sjm_itinerary_items(org_id,journey_id,day_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sjm_itinerary_item_events_item
  ON public.sjm_itinerary_item_events(org_id,journey_id,item_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS public.sjm_travel_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  traveller_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('passport','visa','e_ticket','booking_confirmation','travel_insurance','invitation_letter','residence_permit','other')),
  holder_name TEXT NOT NULL CHECK (length(trim(holder_name)) BETWEEN 1 AND 180),
  issuing_country TEXT CHECK (issuing_country IS NULL OR length(issuing_country)<=80),
  issue_date DATE,
  expiry_date DATE,
  review_status TEXT NOT NULL DEFAULT 'UPLOAD_PENDING'
    CHECK (review_status IN ('UPLOAD_PENDING','PENDING_REVIEW','VERIFIED','REJECTED','EXPIRED')),
  review_note TEXT CHECK (review_note IS NULL OR length(review_note)<=1000),
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id,journey_id,id),
  FOREIGN KEY (org_id,journey_id,traveller_id)
    REFERENCES public.sjm_travellers(org_id,journey_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id,journey_id,evidence_id)
    REFERENCES public.sjm_evidence(org_id,journey_id,id) ON DELETE RESTRICT,
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date>=issue_date)
);
CREATE INDEX IF NOT EXISTS idx_sjm_travel_documents_traveller
  ON public.sjm_travel_documents(org_id,journey_id,traveller_id,created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_travel_workspace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'TRAVELLER_CREATED','TRAVELLER_UPDATED','TRAVELLER_REGISTER_VIEWED',
    'TRAVEL_DOCUMENT_REGISTER_VIEWED','TRAVEL_DOCUMENT_UPLOADED',
    'TRAVEL_DOCUMENT_REVIEWED','FLIGHT_CREATED','FLIGHT_UPDATED',
    'DAY_CREATED','DAY_UPDATED','PLAN_ITEM_CREATED','PLAN_ITEM_UPDATED'
  )),
  subject_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (org_id,journey_id) REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sjm_travel_workspace_events_journey
  ON public.sjm_travel_workspace_events(org_id,journey_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.sjm_sync_travel_document_evidence_status()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='VERIFIED' THEN
      UPDATE public.sjm_travel_documents SET review_status='PENDING_REVIEW',updated_at=NOW()
       WHERE org_id=NEW.org_id AND journey_id=NEW.journey_id AND evidence_id=NEW.id
         AND review_status='UPLOAD_PENDING';
    ELSIF NEW.status='REJECTED' THEN
      UPDATE public.sjm_travel_documents SET review_status='REJECTED',updated_at=NOW()
       WHERE org_id=NEW.org_id AND journey_id=NEW.journey_id AND evidence_id=NEW.id
         AND review_status='UPLOAD_PENDING';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_sjm_sync_travel_document_evidence_status ON public.sjm_evidence;
CREATE TRIGGER trg_sjm_sync_travel_document_evidence_status
AFTER UPDATE OF status ON public.sjm_evidence
FOR EACH ROW EXECUTE FUNCTION public.sjm_sync_travel_document_evidence_status();

CREATE OR REPLACE FUNCTION public.sjm_travel_workspace_event_guard()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'SJM travel workspace events are append-only';
END $function$;
DROP TRIGGER IF EXISTS trg_sjm_travel_workspace_events_immutable ON public.sjm_travel_workspace_events;
CREATE TRIGGER trg_sjm_travel_workspace_events_immutable
BEFORE UPDATE OR DELETE ON public.sjm_travel_workspace_events
FOR EACH ROW EXECUTE FUNCTION public.sjm_travel_workspace_event_guard();
DROP TRIGGER IF EXISTS trg_sjm_itinerary_item_events_immutable ON public.sjm_itinerary_item_events;
CREATE TRIGGER trg_sjm_itinerary_item_events_immutable
BEFORE UPDATE OR DELETE ON public.sjm_itinerary_item_events
FOR EACH ROW EXECUTE FUNCTION public.sjm_travel_workspace_event_guard();

DO $sjm$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sjm_travellers','sjm_flight_segments','sjm_itinerary_days',
    'sjm_itinerary_items','sjm_itinerary_item_events',
    'sjm_travel_documents','sjm_travel_workspace_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS sjm_org_isolation ON public.%I',t);
    EXECUTE format('CREATE POLICY sjm_org_isolation ON public.%I USING (org_id=current_setting(''app.current_org_id'',true)::uuid) WITH CHECK (org_id=current_setting(''app.current_org_id'',true)::uuid)',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardening ON public.%I',t);
    EXECUTE format('CREATE POLICY tenant_isolation_hardening ON public.%I AS RESTRICTIVE FOR ALL USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''')) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',t);
  END LOOP;
END $sjm$;

GRANT SELECT,INSERT,UPDATE ON public.sjm_travellers TO sonalit_app;
GRANT SELECT,INSERT,UPDATE ON public.sjm_flight_segments TO sonalit_app;
GRANT SELECT,INSERT,UPDATE ON public.sjm_itinerary_days TO sonalit_app;
GRANT SELECT,INSERT,UPDATE ON public.sjm_itinerary_items TO sonalit_app;
GRANT SELECT,INSERT ON public.sjm_itinerary_item_events TO sonalit_app;
GRANT SELECT,INSERT,UPDATE ON public.sjm_travel_documents TO sonalit_app;
GRANT SELECT,INSERT ON public.sjm_travel_workspace_events TO sonalit_app;

COMMIT;
