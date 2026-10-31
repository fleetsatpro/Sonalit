-- SJM-owned private evidence register and append-only custody history.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sjm_evidence (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES public.sjm_journeys(id) ON DELETE RESTRICT,
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
  uploaded_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, storage_key),
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
  journey_id UUID NOT NULL REFERENCES public.sjm_journeys(id) ON DELETE RESTRICT,
  evidence_id UUID NOT NULL REFERENCES public.sjm_evidence(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'UPLOAD_REQUESTED','UPLOAD_VERIFIED','UPLOAD_REJECTED','DOWNLOAD_URL_ISSUED'
  )),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sjm_evidence_events_recorded
  ON public.sjm_evidence_events(org_id, journey_id, evidence_id, created_at DESC);

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
