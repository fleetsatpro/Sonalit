-- Departure — making "the truck has left" a fact the system can establish.
--
-- THE BUG THIS FIXES
-- `departed_at` is written in exactly one place: the trip transition handler,
-- when a trip moves to 'dispatched'. Nothing calls it. The Field app's clamp
-- flow creates the trip at 'locked' and stops; the operator hook that could
-- transition it (useTransitionTrip) exists but no screen imports it; no worker,
-- cron or geofence ever writes 'dispatched'.
--
-- So every trip sits at 'locked' forever. The Live Operations panel derives its
-- phase from trip status, which means a truck actively streaming GPS from the
-- Nairobi road still reads "awaiting departure". Two downstream things are also
-- broken by it: avg_transit_hours is delivered_at - departed_at and can never
-- produce a value, and the intelligence rule about "trips stuck in dispatched
-- >24h" can never fire because nothing is ever dispatched.
--
-- THREE WAYS TO DEPART, because one is never enough in a yard
--   manual    the yard marks it — the case that must always work, because a
--             driver who never scanned the QR leaves no telemetry at all and
--             would otherwise strand the trip at 'locked' permanently
--   derived   tracking shows sustained movement away from the clamp point
--   operator  the control room, for corrections after the fact
--
-- Manual is not a fallback for derived; it is the primary path. Derivation
-- exists so a departure is never MISSED, not so a human is never involved.

ALTER TABLE cds_trips
  -- Which of the three established it. NULL while the trip has not departed,
  -- so "how do we know it left?" is answerable rather than assumed.
  ADD COLUMN IF NOT EXISTS departure_source TEXT
    CHECK (departure_source IN ('manual','derived','operator')),
  ADD COLUMN IF NOT EXISTS departed_by      UUID,
  ADD COLUMN IF NOT EXISTS departure_note   TEXT,

  -- The yard anchor. The clamp already receives lat/lng from the field device
  -- but only buries them in an audit JSON blob, which cannot be queried and so
  -- cannot answer "has this truck moved away from where it was clamped?".
  -- Nullable because a clamp submitted with location denied is still a valid
  -- clamp — the physical operation must never depend on GPS.
  ADD COLUMN IF NOT EXISTS clamp_lat        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS clamp_lng        DOUBLE PRECISION;

-- The live board asks "what has departed?" on every poll, and the derivation
-- job asks "what is still staged but might have moved?". Both want the same
-- narrow slice: open trips that have not departed yet.
CREATE INDEX IF NOT EXISTS idx_cds_trips_awaiting_departure
  ON cds_trips(org_id, status)
  WHERE departed_at IS NULL AND deleted_at IS NULL;

-- Backfill nothing. A trip that departed before this migration has no record of
-- HOW that was established, and inventing 'operator' for it would fabricate
-- provenance we never observed — the same lie the evidence fabric exists to
-- prevent. Historic rows keep departed_at with a NULL source, which reads
-- honestly as "departed, method unknown".
