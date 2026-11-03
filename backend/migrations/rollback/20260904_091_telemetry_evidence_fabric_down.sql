-- DOWN for 20260904_091_telemetry_evidence_fabric.sql
--
-- Drops only what the UP created. Ordered so the foreign keys unwind cleanly:
-- reconciliation_decisions references telemetry_conflicts, so it goes first.
--
-- NOTE: this discards telemetry_conflicts and reconciliation_decisions, which
-- are the audit record of WHY Sonalit concluded a journey went the way it did.
-- The raw evidence in tracking_locations survives — that is the point of
-- keeping observation and conclusion in different layers — but the reasoning
-- that produced each derived state does not. Export both tables before running
-- this anywhere the provenance matters.
--
-- The three tracking_locations columns are dropped last. They are additive and
-- nullable, so dropping them loses client event ids, sequence numbers and clock
-- offsets, but leaves every observation itself intact and every pre-091
-- uniqueness guarantee exactly as it was.

DROP INDEX IF EXISTS idx_tracking_locations_sequence;
DROP INDEX IF EXISTS uq_tracking_locations_event;

ALTER TABLE tracking_locations
  DROP COLUMN IF EXISTS clock_offset_ms,
  DROP COLUMN IF EXISTS sequence_number,
  DROP COLUMN IF EXISTS event_id;

DROP TABLE IF EXISTS reconciliation_decisions;
DROP TABLE IF EXISTS telemetry_conflicts;
DROP TABLE IF EXISTS telemetry_sources;
