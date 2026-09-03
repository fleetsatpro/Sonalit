-- Index the CDS event tables for an org-wide, time-ordered dispatch log.
--
-- The Comms Centre used to read `cds_activity_feed`, a table nothing ever wrote
-- to, so it was permanently empty. It now derives the log from the records the
-- field and the devices actually write: cds_custody_events, cds_lock_events,
-- cds_trip_events and cds_alerts.
--
-- Those tables were indexed for the "show me this container's / this lock's /
-- this trip's history" query — (lock_id, created_at DESC), (trip_id,
-- created_at DESC), (org_id) — which is the wrong shape for "show me the last
-- 50 things that happened in this org". Without a leading org_id plus
-- created_at the planner scans and sorts the whole table on every 20s poll of
-- the log.
--
-- cds_alerts already has (org_id, created_at DESC), so it is not repeated here.

CREATE INDEX IF NOT EXISTS idx_cds_custody_org_created
  ON cds_custody_events(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cds_lock_events_org_created
  ON cds_lock_events(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cds_trip_events_org_created
  ON cds_trip_events(org_id, created_at DESC);
