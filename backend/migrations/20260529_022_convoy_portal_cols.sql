-- Cargo portal columns on convoys.
-- Adds seal_intact (new runtime boolean) and origin/destination/departed_at/
-- arrived_at/estimated_arrival_at/reference as aliases-in-schema so the portal
-- query can use clean names without breaking the existing convoy controller.
-- All additions are idempotent (IF NOT EXISTS).

DO $$
BEGIN
  -- Runtime seal-status flag (set by GPS/IoT events or manually by dispatcher)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='seal_intact') THEN
    ALTER TABLE convoys ADD COLUMN seal_intact BOOLEAN;
  END IF;

  -- Human-readable reference number / code (separate from the convoy name)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='reference') THEN
    ALTER TABLE convoys ADD COLUMN reference VARCHAR(100);
  END IF;

  -- Short origin / destination strings (mirrors route_origin/destination but
  -- used by portal and the S2 CfoConvoyForm; old columns stay for compatibility)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='origin') THEN
    ALTER TABLE convoys ADD COLUMN origin VARCHAR(100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='destination') THEN
    ALTER TABLE convoys ADD COLUMN destination VARCHAR(100);
  END IF;

  -- ISO-8601 timestamps with the names the portal / S2 use
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='departed_at') THEN
    ALTER TABLE convoys ADD COLUMN departed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='arrived_at') THEN
    ALTER TABLE convoys ADD COLUMN arrived_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='convoys' AND column_name='estimated_arrival_at') THEN
    ALTER TABLE convoys ADD COLUMN estimated_arrival_at TIMESTAMPTZ;
  END IF;
END $$;

-- Back-fill origin/destination/departed_at/estimated_arrival_at from the old
-- column names so existing convoys show data in the portal immediately.
UPDATE convoys SET
  origin               = route_origin          WHERE origin IS NULL AND route_origin IS NOT NULL;
UPDATE convoys SET
  destination          = route_destination     WHERE destination IS NULL AND route_destination IS NOT NULL;
UPDATE convoys SET
  departed_at          = departure_time        WHERE departed_at IS NULL AND departure_time IS NOT NULL;
UPDATE convoys SET
  estimated_arrival_at = estimated_arrival     WHERE estimated_arrival_at IS NULL AND estimated_arrival IS NOT NULL;
UPDATE convoys SET
  arrived_at           = arrival_time          WHERE arrived_at IS NULL AND arrival_time IS NOT NULL;
-- reference defaults to name when not set explicitly
UPDATE convoys SET
  reference = name                             WHERE reference IS NULL AND name IS NOT NULL;
