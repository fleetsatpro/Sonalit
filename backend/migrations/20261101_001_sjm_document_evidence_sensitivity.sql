-- Traveller and identity documents are manager-only material in SJM.
-- Promote any legacy generic evidence rows before enforcing the category rule.
BEGIN;

LOCK TABLE public.sjm_evidence IN ACCESS EXCLUSIVE MODE;
-- The migration connection has no tenant context. The exclusive table lock
-- prevents concurrent access while the cross-tenant sensitivity backfill runs.
ALTER TABLE public.sjm_evidence DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sjm_evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- A legacy document record may only be promoted to the stronger
  -- classification. Never allow a document row to remain operational-only.
  IF NEW.category = 'document' AND NEW.access_classification = 'INTERNAL_OPERATIONS' THEN
    NEW.access_classification := 'HIGHLY_SENSITIVE';
  END IF;

  IF ROW(
    NEW.id, NEW.org_id, NEW.journey_id, NEW.category, NEW.file_name,
    NEW.mime_type, NEW.size_bytes, NEW.storage_key,
    NEW.captured_at, NEW.capture_time_quality, NEW.location_lat,
    NEW.location_lng, NEW.location_accuracy_m, NEW.location_source,
    NEW.created_by, NEW.device_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.org_id, OLD.journey_id, OLD.category, OLD.file_name,
    OLD.mime_type, OLD.size_bytes, OLD.storage_key,
    OLD.captured_at, OLD.capture_time_quality, OLD.location_lat,
    OLD.location_lng, OLD.location_accuracy_m, OLD.location_source,
    OLD.created_by, OLD.device_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'SJM evidence identity and capture metadata are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.access_classification IS DISTINCT FROM OLD.access_classification
     AND NOT (
       OLD.category = 'document'
       AND NEW.category = 'document'
       AND OLD.access_classification = 'INTERNAL_OPERATIONS'
       AND NEW.access_classification = 'HIGHLY_SENSITIVE'
     ) THEN
    RAISE EXCEPTION 'SJM evidence sensitivity classification is immutable except for document promotion'
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

UPDATE public.sjm_evidence
SET access_classification='HIGHLY_SENSITIVE', updated_at=NOW()
WHERE category='document'
  AND access_classification IS DISTINCT FROM 'HIGHLY_SENSITIVE';

DO $sjm_document_sensitivity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid='public.sjm_evidence'::regclass
      AND conname='ck_sjm_evidence_document_sensitive'
  ) THEN
    ALTER TABLE public.sjm_evidence
      ADD CONSTRAINT ck_sjm_evidence_document_sensitive
      CHECK (category <> 'document' OR access_classification='HIGHLY_SENSITIVE')
      NOT VALID;
  END IF;
END
$sjm_document_sensitivity$;

ALTER TABLE public.sjm_evidence
  VALIDATE CONSTRAINT ck_sjm_evidence_document_sensitive;

-- Restore the exact tenant-isolation posture before releasing the table lock.
ALTER TABLE public.sjm_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_evidence FORCE ROW LEVEL SECURITY;

COMMIT;
