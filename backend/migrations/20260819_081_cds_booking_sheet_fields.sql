-- Fields that come off the physical booking sheet.
--
-- The booking number TZ_26_08_OB_00123910 is NOT ours to invent — it is
-- printed on the booking sheet the customer/line issues, and it arrives with
-- the document. Migration 080 built a counter to allocate one, which is right
-- for a booking raised in-app with no sheet (the field clamp path), but the
-- primary path is capture, not generation: when a sheet is uploaded the number
-- on it is the number, and the counter's job shrinks to never handing out one
-- that collides with a sheet-provided reference later.
--
-- The same sheet carries a second, unrelated reference and a richer container
-- table than the schema had room for. This adds the missing columns.

-- The sheet shows two references side by side:
--   Booking Reference        TZ_26_08_OB_00123910   -> booking_number (ours)
--   Carrier Booking Reference 274570179             -> the LINE's own booking
-- They are different identifiers for different parties and both get quoted, so
-- conflating them would make one un-findable.
ALTER TABLE cds_bookings
  ADD COLUMN IF NOT EXISTS carrier_reference VARCHAR(60);

-- The container table on the sheet is:
--   Packing List No   Conveyance No   Seal1   Seal2
-- Conveyance No is the container number (already stored). The other three had
-- nowhere to go: a packing-list number ties the container back to the shipper's
-- own paperwork, and a container genuinely carries two seals — a line seal and
-- a shipper/customs seal — so a single seal_number column silently dropped one.
ALTER TABLE cds_booking_containers
  ADD COLUMN IF NOT EXISTS packing_list_no VARCHAR(60),
  ADD COLUMN IF NOT EXISTS seal_number_2   VARCHAR(50);

-- The second seal is scanned by the integrity check the same way the first is,
-- so give the reused-seal query an index to match idx_cds_bc_seal_number.
CREATE INDEX IF NOT EXISTS idx_cds_bc_seal_number_2
  ON cds_booking_containers(org_id, seal_number_2) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cds_bc_packing_list
  ON cds_booking_containers(org_id, packing_list_no) WHERE deleted_at IS NULL;
