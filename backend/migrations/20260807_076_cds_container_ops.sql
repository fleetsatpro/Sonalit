-- Operational columns for the container manifest.
--
-- The yard runs off a per-container sheet, not a per-booking one: one row per
-- container, carrying clamp times, terminal, yard state and the truck/driver
-- that moved it. Most of that is already reachable relationally through
-- cds_trips (transporter, horse reg, driver, lock serial), but a container is
-- clamped and parked in the yard long before a trip exists — so the sheet needs
-- somewhere to record it in the meantime.
--
-- These columns are that somewhere. The manifest query COALESCEs them over the
-- trip-derived values, so a row reads correctly whether or not it has been
-- dispatched yet, and assigning a trip later does not erase what ops typed in.

ALTER TABLE cds_booking_containers
  ADD COLUMN IF NOT EXISTS clamped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unclamped_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminal         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS yard_status      VARCHAR(20) NOT NULL DEFAULT 'yard',
  ADD COLUMN IF NOT EXISTS invoiced         BOOLEAN     NOT NULL DEFAULT false,
  -- Overrides for the trip-derived columns, used before dispatch.
  ADD COLUMN IF NOT EXISTS lock_number      VARCHAR(30),
  ADD COLUMN IF NOT EXISTS transporter_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS horse_reg        VARCHAR(20),
  -- No relational source: cds_trips carries a single vehicle_id, which is the
  -- horse. The trailer is only ever recorded on the sheet.
  ADD COLUMN IF NOT EXISTS trailer_reg      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS driver_name      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS driver_contact   VARCHAR(50);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard on pg_constraint to
-- keep this re-runnable — same shape as 20260601_035_fix_client_fks.sql.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cds_booking_containers'::regclass
       AND conname  = 'cds_booking_containers_yard_status_check'
  ) THEN
    ALTER TABLE cds_booking_containers
      ADD CONSTRAINT cds_booking_containers_yard_status_check
      CHECK (yard_status IN ('yard', 'inbound', 'outbound', 'complete'));
  END IF;
END $$;

-- The controller is the person who owns the booking on the desk. It belongs to
-- the booking, not the container — every container on a booking shares one.
ALTER TABLE cds_bookings
  ADD COLUMN IF NOT EXISTS controller VARCHAR(100);

-- The manifest sorts by clamp time and filters by yard state, so index both.
CREATE INDEX IF NOT EXISTS idx_cds_booking_containers_clamped
  ON cds_booking_containers(clamped_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cds_booking_containers_yard
  ON cds_booking_containers(yard_status) WHERE deleted_at IS NULL;
