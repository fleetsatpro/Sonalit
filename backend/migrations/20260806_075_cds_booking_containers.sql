-- Per-container records for a booking.
-- A Bill of Lading can list 1–hundreds of containers; this table captures
-- all of them at booking time so each can be tracked independently through
-- the dispatch lifecycle. When a container is dispatched a trip row is
-- created and trip_id is back-filled here.
CREATE TABLE IF NOT EXISTS cds_booking_containers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL,
  booking_id     UUID        NOT NULL REFERENCES cds_bookings(id) ON DELETE CASCADE,
  container_number VARCHAR(20),
  iso_type       VARCHAR(10) NOT NULL DEFAULT '20GP',
  seal_number    VARCHAR(50),
  weight_kg      DECIMAL(10,2),
  notes          TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','assigned','in_transit','at_port','delivered','completed')),
  trip_id        UUID        REFERENCES cds_trips(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cds_booking_containers_booking ON cds_booking_containers(booking_id);
CREATE INDEX IF NOT EXISTS idx_cds_booking_containers_org    ON cds_booking_containers(org_id);
