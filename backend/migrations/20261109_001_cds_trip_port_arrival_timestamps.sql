-- Persist port arrival from the first recorded transition into at_port.
-- Backfill only from actual transition evidence; never derive arrival from delivery.
BEGIN;

WITH arrival_events AS (
  SELECT a.org_id, a.entity_id AS trip_id, a.created_at AS arrived_at
    FROM cds_audit_logs a
   WHERE a.entity_type = 'trip'
     AND a.action = 'transition'
     AND a.after_data->>'status' = 'at_port'
  UNION ALL
  SELECT e.org_id, e.trip_id, e.created_at AS arrived_at
    FROM cds_trip_events e
   WHERE e.to_status = 'at_port'
     AND e.from_status IS DISTINCT FROM 'at_port'
),
first_arrivals AS (
  SELECT org_id, trip_id, MIN(arrived_at) AS arrived_at
    FROM arrival_events
   GROUP BY org_id, trip_id
)
UPDATE cds_trips AS trip
   SET arrived_at = arrival.arrived_at
  FROM first_arrivals AS arrival
 WHERE trip.org_id = arrival.org_id
   AND trip.id = arrival.trip_id
   AND trip.deleted_at IS NULL
   AND trip.arrived_at IS NULL;

COMMIT;
