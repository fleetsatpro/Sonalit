-- Structured booking references, and the counter that makes them unique.
--
-- Bookings were numbered `BK-<base36 timestamp>-<random hex>` — unique, and
-- unreadable. Ops identify a booking out loud, over the radio, on a printed
-- manifest and in an email subject line, and "BK-MFQ2K1-3A9F" carries no
-- information at all: not the branch, not the month, not the direction, and
-- nothing that sorts.
--
-- The new form is  TZ_26_08_OB_00123910:
--
--   TZ         branch / country code the booking belongs to
--   26_08      year and month it was raised
--   OB         direction — OB outbound, IB inbound
--   00123910   running number, unique per org
--
-- Every part earns its place: the branch and direction are what a controller
-- filters on, the year-month is what makes a stack of manifests sortable by
-- eye, and the running number is what makes two bookings impossible to
-- confuse. Together they also make a duplicate reference visible as a
-- duplicate rather than as two unrelated strings.

ALTER TABLE cds_bookings
  -- Two letters, not free text: this is a code that gets read aloud and typed
  -- into other systems, and 'TZ' vs 'Tanzania' vs 'tz' would fragment it.
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'TZ',
  ADD COLUMN IF NOT EXISTS direction    CHAR(2) NOT NULL DEFAULT 'OB';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cds_bookings'::regclass
       AND conname  = 'cds_bookings_direction_check'
  ) THEN
    ALTER TABLE cds_bookings
      ADD CONSTRAINT cds_bookings_direction_check CHECK (direction IN ('OB','IB'));
  END IF;
END $$;

-- booking_number is VARCHAR(30); TZ_26_08_OB_00123910 is 20, so the format
-- fits with room for a longer branch code later.

-- ─── The running number ──────────────────────────────────────────────────────
-- A table rather than a Postgres sequence, because the number has to be unique
-- *per org* and sequences are global objects — one shared sequence would leak
-- one tenant's booking volume to every other tenant, which is exactly the kind
-- of cross-tenant inference the RLS everywhere else is there to prevent.
--
-- Allocation is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, which
-- is atomic under concurrency: two clamps racing to raise a booking get two
-- different numbers rather than one number and one unique-violation.
CREATE TABLE IF NOT EXISTS cds_booking_counters (
  org_id     UUID        PRIMARY KEY,
  next_seq   BIGINT      NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cds_booking_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cds_booking_counters'
       AND policyname = 'org_isolation_cds_booking_counters'
  ) THEN
    CREATE POLICY org_isolation_cds_booking_counters ON cds_booking_counters
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cds_booking_counters TO sonalit_app;

-- Start each org's counter above whatever its highest existing structured
-- number is, so re-running this on a database that already has some cannot
-- hand out a number twice. Legacy BK-… references contribute nothing here:
-- they are left exactly as they are. Renumbering historical bookings would
-- invalidate every printed manifest, email and invoice that quotes them.
INSERT INTO cds_booking_counters (org_id, next_seq)
SELECT org_id,
       COALESCE(MAX(NULLIF(regexp_replace(booking_number, '^.*_', ''), '')::BIGINT), 0) + 1
  FROM cds_bookings
 WHERE booking_number ~ '^[A-Z]{2}_[0-9]{2}_[0-9]{2}_(OB|IB)_[0-9]+$'
 GROUP BY org_id
ON CONFLICT (org_id) DO NOTHING;

-- The manifest's duplicate detection scans these constantly.
CREATE INDEX IF NOT EXISTS idx_cds_bc_container_number
  ON cds_booking_containers(org_id, container_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_bc_seal_number
  ON cds_booking_containers(org_id, seal_number) WHERE deleted_at IS NULL;
