// The dispatch log is derived from the records the field and the devices
// actually write — the custody chain, e-lock events, trip transitions and
// alerts — not from a feed table someone has to remember to append to. An
// append-on-write feed table is exactly what was here before: `cds_activity_feed`
// was read by the dashboard and the Comms Centre and written by nothing, so the
// control room showed "no activity" while the yard had containers queued. A
// derived feed cannot drift from the work, because it IS the work.
//
// Four sources, each capped and time-ordered, merged in JS. Every source is
// explicitly scoped to the requesting organisation as well as protected by
// the request's RLS transaction. Clamp-time assignment is read from the clamp
// audit snapshot; mutable trip/manifest values must never rewrite history.
// Heartbeats and GPS pings are telemetry, not events an operator needs in a log.

const CUSTODY_LABEL = {
  clamped: ['clamp', 'E-lock clamped on'],
  dispatched: ['depart', 'Dispatched'],
  checkpoint: ['checkpoint', 'Checkpoint logged for'],
  seal_check: ['checkpoint', 'Seal checked on'],
  arrived: ['arrival', 'Arrived at port'],
  unclamped: ['unclamp', 'E-lock removed from'],
  delivered: ['arrival', 'Delivered'],
  exception: ['alert', 'Exception raised on'],
};

const LOCK_LABEL = {
  lock: ['lock', 'locked'],
  unlock: ['unlock', 'unlocked'],
  tamper: ['alert', 'reported TAMPER'],
  battery_low: ['alert', 'battery low'],
  offline: ['alert', 'went offline'],
  online: ['sync', 'came back online'],
  firmware_update: ['sync', 'firmware updated'],
};

// A container reference an operator can act on: the container number when the
// yard has entered one, else the booking it belongs to.
const containerRef = (containerNumber, bookingNumber) =>
  containerNumber || (bookingNumber ? `booking ${bookingNumber}` : 'container');

const coords = (lat, lng) =>
  lat != null && lng != null ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : null;

const metaLine = (...parts) => parts.filter(Boolean).join(' · ') || null;

async function activityFeed(db, orgId, limit) {
  if (!orgId) throw new Error('activity_feed_org_required');
  const [custody, locks, trips, alerts] = await Promise.all([
    db(
      `SELECT ce.id, ce.created_at, ce.kind, ce.actor_name, ce.lat, ce.lng, ce.notes,
              ce.seal_number, ce.lock_serial, ce.booking_container_id, ce.trip_id,
              bc.container_number, b.booking_number, t.trip_number,
              COALESCE(clamp_audit.after_data->>'transporter_name', bc.transporter_name) AS transporter_name,
              COALESCE(clamp_audit.after_data->>'truck_reg', bc.horse_reg) AS vehicle_registration,
              COALESCE(clamp_audit.after_data->>'driver_name', bc.driver_name) AS driver_name,
              (clamp_audit.after_data IS NOT NULL) AS has_clamp_audit_snapshot
         FROM cds_custody_events ce
         JOIN cds_booking_containers bc
           ON bc.id=ce.booking_container_id AND bc.org_id=ce.org_id AND bc.deleted_at IS NULL
         LEFT JOIN cds_bookings b
           ON b.id=bc.booking_id AND b.org_id=bc.org_id AND b.deleted_at IS NULL
         LEFT JOIN cds_trips t
           ON t.id=ce.trip_id AND t.org_id=ce.org_id AND t.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT a.after_data
             FROM cds_audit_logs a
            WHERE a.org_id=ce.org_id
              AND a.entity_type='booking_container'
              AND a.entity_id=bc.id
              AND a.action='clamp'
            ORDER BY a.created_at ASC, a.id ASC
            LIMIT 1
         ) clamp_audit ON true
        WHERE ce.org_id=$1
        ORDER BY ce.created_at DESC LIMIT $2`, [orgId, limit]
    ),
    db(
      `SELECT le.id, le.created_at, le.type, le.lat, le.lng, le.lock_id, el.serial
         FROM cds_lock_events le
         LEFT JOIN cds_electronic_locks el
           ON el.id=le.lock_id AND el.org_id=le.org_id
        WHERE le.org_id=$1 AND le.type NOT IN ('heartbeat','gps_update')
        ORDER BY le.created_at DESC LIMIT $2`, [orgId, limit]
    ),
    db(
      `SELECT te.id, te.created_at, te.to_status, te.from_status, te.actor_name,
              te.notes, te.lat, te.lng, te.trip_id, b.booking_number
         FROM cds_trip_events te
         LEFT JOIN cds_trips t
           ON t.id=te.trip_id AND t.org_id=te.org_id AND t.deleted_at IS NULL
         LEFT JOIN cds_bookings b
           ON b.id=t.booking_id AND b.org_id=t.org_id AND b.deleted_at IS NULL
        WHERE te.org_id=$1
        ORDER BY te.created_at DESC LIMIT $2`, [orgId, limit]
    ),
    db(
      `SELECT id, created_at, type, severity, title, message, entity_type, entity_id, acknowledged
         FROM cds_alerts
        WHERE org_id=$1
        ORDER BY created_at DESC LIMIT $2`, [orgId, limit]
    ),
  ]);

  const items = [
    ...custody.rows.map(r => {
      const [icon, verb] = CUSTODY_LABEL[r.kind] ?? ['checkpoint', r.kind];
      const assignmentSource = r.has_clamp_audit_snapshot ? 'clamp_audit_snapshot'
        : (r.driver_name || r.vehicle_registration || r.transporter_name) ? 'manifest_record' : 'not_recorded';
      return {
        id: `custody:${r.id}`,
        source: 'custody',
        icon,
        text: `${verb} ${containerRef(r.container_number, r.booking_number)}`,
        actor: r.actor_name,
        container_number: r.container_number,
        booking_number: r.booking_number,
        trip_number: r.trip_number,
        event_kind: r.kind,
        lock_serial: r.lock_serial,
        driver_name: r.driver_name,
        vehicle_registration: r.vehicle_registration,
        transporter_name: r.transporter_name,
        assignment_source: assignmentSource,
        evidence: 'hash_chained_custody_record',
        meta: metaLine(
          r.actor_name, r.lock_serial && `lock ${r.lock_serial}`,
          r.driver_name && `driver ${r.driver_name}`,
          r.vehicle_registration && `vehicle ${r.vehicle_registration}`,
          r.transporter_name,
          assignmentSource === 'clamp_audit_snapshot' ? 'assignment captured at clamp'
            : assignmentSource === 'manifest_record' ? 'assignment from manifest' : null,
          r.seal_number && `seal ${r.seal_number}`,
          coords(r.lat, r.lng), r.notes
        ),
        entity_type: 'booking_container',
        entity_id: r.booking_container_id,
        created_at: r.created_at,
      };
    }),
    ...locks.rows.map(r => {
      const [icon, verb] = LOCK_LABEL[r.type] ?? ['lock', r.type];
      return {
        id: `lock:${r.id}`,
        source: 'lock',
        icon,
        text: `E-lock ${r.serial || 'device'} ${verb}`,
        actor: null,
        lock_serial: r.serial,
        event_kind: r.type,
        evidence: 'device_event',
        meta: metaLine(coords(r.lat, r.lng)),
        entity_type: 'lock',
        entity_id: r.lock_id,
        created_at: r.created_at,
      };
    }),
    ...trips.rows.map(r => ({
      id: `trip:${r.id}`,
      source: 'trip',
      icon: r.to_status === 'delivered' ? 'arrival' : r.to_status === 'dispatched' ? 'depart' : 'checkpoint',
      text: `Trip ${r.booking_number ? `on booking ${r.booking_number} ` : ''}moved to ${String(r.to_status).replace(/_/g, ' ')}`,
      actor: r.actor_name,
      booking_number: r.booking_number,
      event_kind: r.to_status,
      evidence: 'trip_transition',
      meta: metaLine(r.actor_name, coords(r.lat, r.lng), r.notes),
      entity_type: 'trip',
      entity_id: r.trip_id,
      created_at: r.created_at,
    })),
    ...alerts.rows.map(r => ({
      id: `alert:${r.id}`,
      source: 'alert',
      icon: 'alert',
      text: r.title,
      actor: null,
      severity: r.severity,
      event_kind: r.type,
      evidence: 'alert_record',
      meta: metaLine(
        r.severity && r.severity.toUpperCase(), r.message,
        r.acknowledged ? 'acknowledged' : null
      ),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      created_at: r.created_at,
    })),
  ];

  // Each source was capped at limit, so the merge holds at most 4x that before
  // slicing. Sorting after the merge gives the newest limit across all sources.
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items.slice(0, limit);
}

module.exports = { activityFeed, CUSTODY_LABEL, LOCK_LABEL };
