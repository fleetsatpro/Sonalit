-- SJM-owned private evidence register and append-only custody history.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sjm_journeys_org_id_id
  ON public.sjm_journeys(org_id,id);

CREATE TABLE IF NOT EXISTS public.sjm_evidence (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('photo','video','document','incident_attachment','check_in','handover')),
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','video/mp4','application/pdf')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOAD_PENDING' CHECK (status IN ('UPLOAD_PENDING','VERIFIED','REJECTED')),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  captured_at TIMESTAMPTZ,
  capture_time_quality TEXT NOT NULL DEFAULT 'NOT_SUPPLIED'
    CHECK (capture_time_quality IN ('NOT_SUPPLIED','DEVICE_CLOCK_UNVERIFIED')),
  location_lat NUMERIC(10,7),
  location_lng NUMERIC(10,7),
  location_accuracy_m NUMERIC(9,2),
  location_source TEXT NOT NULL DEFAULT 'NOT_CAPTURED'
    CHECK (location_source IN ('NOT_CAPTURED','BROWSER_GEOLOCATION_UNVERIFIED')),
  access_classification TEXT NOT NULL DEFAULT 'INTERNAL_OPERATIONS'
    CHECK (access_classification IN ('INTERNAL_OPERATIONS','HIGHLY_SENSITIVE')),
  retention_policy TEXT NOT NULL DEFAULT 'ORGANISATION_POLICY',
  retention_until TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  device_id TEXT CHECK (device_id IS NULL OR length(device_id) BETWEEN 1 AND 128),
  uploaded_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, storage_key),
  UNIQUE (org_id, journey_id, id),
  FOREIGN KEY (org_id, journey_id)
    REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT,
  CHECK (
    (location_lat IS NULL AND location_lng IS NULL AND location_accuracy_m IS NULL AND location_source='NOT_CAPTURED')
    OR
    (location_lat BETWEEN -90 AND 90 AND location_lng BETWEEN -180 AND 180
      AND location_accuracy_m BETWEEN 0 AND 5000
      AND location_source='BROWSER_GEOLOCATION_UNVERIFIED')
  ),
  CHECK (
    (status='VERIFIED' AND sha256 IS NOT NULL AND uploaded_at IS NOT NULL AND verified_at IS NOT NULL)
    OR status<>'VERIFIED'
  )
);

CREATE INDEX IF NOT EXISTS idx_sjm_evidence_journey_time
  ON public.sjm_evidence(org_id, journey_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_evidence_pending
  ON public.sjm_evidence(org_id, status, created_at)
  WHERE status='UPLOAD_PENDING' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sjm_evidence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (org_id, journey_id)
    REFERENCES public.sjm_journeys(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, journey_id, evidence_id)
    REFERENCES public.sjm_evidence(org_id, journey_id, id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'UPLOAD_REQUESTED','UPLOAD_VERIFIED','UPLOAD_REJECTED','DOWNLOAD_URL_ISSUED'
  )),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sjm_evidence_events_recorded
  ON public.sjm_evidence_events(org_id, journey_id, evidence_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.sjm_evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(
    NEW.id, NEW.org_id, NEW.journey_id, NEW.category, NEW.file_name,
    NEW.mime_type, NEW.size_bytes, NEW.storage_key,
    NEW.captured_at, NEW.capture_time_quality, NEW.location_lat,
    NEW.location_lng, NEW.location_accuracy_m, NEW.location_source,
    NEW.access_classification, NEW.created_by, NEW.device_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.org_id, OLD.journey_id, OLD.category, OLD.file_name,
    OLD.mime_type, OLD.size_bytes, OLD.storage_key,
    OLD.captured_at, OLD.capture_time_quality, OLD.location_lat,
    OLD.location_lng, OLD.location_accuracy_m, OLD.location_source,
    OLD.access_classification, OLD.created_by, OLD.device_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'SJM evidence identity and capture metadata are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('VERIFIED','REJECTED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'SJM evidence terminal status cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status='UPLOAD_PENDING' AND NEW.status NOT IN ('UPLOAD_PENDING','VERIFIED','REJECTED') THEN
    RAISE EXCEPTION 'Invalid SJM evidence status transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status='UPLOAD_PENDING' AND NEW.status='UPLOAD_PENDING' AND NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'Pending SJM evidence hash cannot be changed before verification'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('VERIFIED','REJECTED') AND NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'SJM evidence integrity hash is immutable after resolution'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status='VERIFIED' AND ROW(NEW.uploaded_at,NEW.verified_at) IS DISTINCT FROM ROW(OLD.uploaded_at,OLD.verified_at) THEN
    RAISE EXCEPTION 'Verified SJM evidence timestamps are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status='VERIFIED' AND (
    NEW.sha256 IS NULL OR NEW.uploaded_at IS NULL OR NEW.verified_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Verified SJM evidence requires an integrity hash and verification timestamps'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sjm_evidence_guard_update ON public.sjm_evidence;
CREATE TRIGGER trg_sjm_evidence_guard_update
BEFORE UPDATE ON public.sjm_evidence
FOR EACH ROW EXECUTE FUNCTION public.sjm_evidence_guard_update();

DO $sjm_evidence$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sjm_evidence','sjm_evidence_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS sjm_org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY sjm_org_isolation ON public.%I USING (org_id=current_setting(''app.current_org_id'',true)::uuid) WITH CHECK (org_id=current_setting(''app.current_org_id'',true)::uuid)',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardening ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_hardening ON public.%I AS RESTRICTIVE FOR ALL USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''')) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
      t
    );
  END LOOP;
END
$sjm_evidence$;

GRANT SELECT,INSERT,UPDATE ON public.sjm_evidence TO sonalit_app;
GRANT SELECT,INSERT ON public.sjm_evidence_events TO sonalit_app;

COMMIT;
