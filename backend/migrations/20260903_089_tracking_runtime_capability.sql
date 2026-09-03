-- Separate RUNTIME from PLATFORM on a tracking session.
--
-- Migration 088 stored a single `platform` column holding 'web' or 'capacitor',
-- which conflated two independent facts and made one of them unanswerable:
--
--   RUNTIME  — what is executing the tracker: a browser page, or the native
--              Capacitor shell. This is what decides whether background
--              location is even possible.
--   PLATFORM — what OS it is running on: browser, android, ios. This is what
--              decides which background rules apply.
--
-- An operator needs both. "Android" alone does not tell you whether the driver
-- is in the installed app or just opened the link in Chrome, and those two have
-- completely different reliability once the phone is locked — which is exactly
-- the distinction Guardian is required to see rather than infer from a green
-- LIVE dot.
--
-- Capability is never derived from permission. A granted location permission in
-- a browser still yields background_status='unsupported', because the page
-- stops getting fixes the moment it leaves the foreground. Recording the two
-- separately is what stops Sonalit claiming a reliability it does not have.

ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS runtime TEXT
    CHECK (runtime IN ('web','capacitor','unknown'));

-- Backfill from the old conflated column, then normalise `platform` to the OS.
-- Sessions written by 088 used platform='web'|'capacitor'.
UPDATE tracking_sessions
   SET runtime = CASE
                   WHEN platform = 'capacitor' THEN 'capacitor'
                   WHEN platform = 'web'       THEN 'web'
                   ELSE 'unknown'
                 END
 WHERE runtime IS NULL;

UPDATE tracking_sessions
   SET platform = 'browser'
 WHERE platform = 'web';

-- Old rows recorded the runtime here, not the OS; 'unknown' is honest, and
-- inventing 'android' for them would be exactly the fabrication this migration
-- exists to prevent.
UPDATE tracking_sessions
   SET platform = 'unknown'
 WHERE platform = 'capacitor';

ALTER TABLE tracking_sessions
  ALTER COLUMN runtime SET DEFAULT 'unknown';

UPDATE tracking_sessions SET runtime = 'unknown' WHERE runtime IS NULL;

-- Location services and GPS availability were nullable three-state booleans.
-- Keep them nullable: NULL means "the client did not report", which is a
-- different operational fact from "reported false", and collapsing the two
-- would hide a client that is not telling us anything.

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_capability
  ON tracking_sessions(org_id, runtime, background_status)
  WHERE status IN ('awaiting_location','active','paused','signal_lost')
    AND deleted_at IS NULL;
