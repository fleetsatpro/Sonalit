-- Extend booking lifecycle with completed and billed statuses.
-- 'completed' = all trips delivered and unclamped (ready for invoice)
-- 'billed'    = invoice raised and sent to customer

DO $$
BEGIN
  -- Drop whatever the auto-named status check is called
  EXECUTE (
    SELECT 'ALTER TABLE cds_bookings DROP CONSTRAINT ' || quote_ident(conname)
    FROM pg_constraint
    WHERE conrelid = 'cds_bookings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE cds_bookings ADD CONSTRAINT cds_bookings_status_check
  CHECK (status IN (
    'draft','pending','approved','assigned','in_progress',
    'delivered','completed','billed','cancelled'
  ));

-- Add billed status badge styles note (no DDL change needed — handled in frontend)
