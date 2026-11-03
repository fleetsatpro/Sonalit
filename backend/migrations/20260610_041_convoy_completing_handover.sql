-- Add 'completing' status to convoys and handover form columns to convoy_reports
-- 'completing' means admin has signalled the convoy is on its final day

-- Drop old unnamed check constraint on convoys.status and replace with extended one
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'convoys'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%planned%active%completed%aborted%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE convoys DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE convoys ADD CONSTRAINT convoys_status_check
  CHECK (status IN ('planned','active','completing','completed','aborted','cancelled'));

-- Handover form document uploaded by CFO on final EOD report
ALTER TABLE convoy_reports ADD COLUMN IF NOT EXISTS handover_form_key TEXT;
ALTER TABLE convoy_reports ADD COLUMN IF NOT EXISTS handover_form_url  TEXT;
