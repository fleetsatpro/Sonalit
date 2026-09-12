// The dispatch log is derived from the records the field and the devices
// actually write — the custody chain, e-lock events, trip transitions and
// alerts — not from a feed table someone has to remember to append to. An
// append-on-write feed table is exactly what was here before: `cds_activity_feed`
// was read by the dashboard and the Comms Centre and written by nothing, so the
// control room showed "no activity" while the yard had containers queued. A
// derived feed cannot drift from the work, because it IS the work.
//
// Four sources, each capped and time-ordered, merged in JS: one UNION with four
// different shapes forced into common columns reads far worse than four honest
// queries. Heartbeats and GPS pings are excluded — they are telemetry, not
// events an operator needs in a log.

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

async function activityFeed(db, limit) {
  const [custody, locks, trips, alerts] = await Promise.all([
    db(
      `SELECT ce.id, ce.created_at, ce.kind, ce.actor_name, ce.lat, ce.lng, ce.notes,
              ce.seal_number, ce.lock_serial, ce.booking_container_id,
              bc.container_number, b.booking_number
         FROM cds_custody_events ce
         JOIN cds_booking_containers bc ON bc.id = ce.booking_container_id
         LEFT JOIN cds_bookings b ON b.id = bc.booking_id
        ORDER BY ce.created_at DESC LIMIT $1`, [limit]
    ),
    db(
      `SELECT le.id, le.created_at, le.type, le.lat, le.lng, le.lock_id, el.serial
         FROM cds_lock_events le
         LEFT JOIN cds_electronic_locks el ON el.id = le.lock_id
        WHERE le.type NOT IN ('heartbeat','gps_update')
        ORDER BY le.created_at DESC LIMIT $1`, [limit]
    ),
    db(
      `SELECT te.id, te.created_at, te.to_status, te.from_status, te.actor_name,
              te.notes, te.lat, te.lng, te.trip_id, b.booking_number
         FROM cds_trip_events te
         LEFT JOIN cds_trips t ON t.id = te.trip_id
         LEFT JOIN cds_bookings b ON b.id = t.booking_id
        ORDER BY te.created_at DESC LIMIT $1`, [limit]
    ),
    db(
      `SELECT id, created_at, type, severity, title, message, entity_type, entity_id, acknowledged
         FROM cds_alerts
        ORDER BY created_at DESC LIMIT $1`, [limit]
    ),
  ]);

  const items = [
    ...custody.rows.map(r => {
      const [icon, verb] = CUSTODY_LABEL[r.kind] ?? ['checkpoint', r.kind];
      return {
        id: `custody:${r.id}`,
        icon,
        text: `${verb} ${containerRef(r.container_number, r.booking_number)}`,
        meta: metaLine(
          r.actor_name, r.lock_serial && `lock ${r.lock_serial}`,
          r.seal_number && `seal ${r.seal_number}`, coords(r.lat, r.lng), r.notes
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
        icon,
        text: `E-lock ${r.serial || 'device'} ${verb}`,
        meta: metaLine(coords(r.lat, r.lng)),
        entity_type: 'lock',
        entity_id: r.lock_id,
        created_at: r.created_at,
      };
    }),
    ...trips.rows.map(r => ({
      id: `trip:${r.id}`,
      icon: r.to_status === 'delivered' ? 'arrival' : r.to_status === 'dispatched' ? 'depart' : 'checkpoint',
      text: `Trip ${r.booking_number ? `on booking ${r.booking_number} ` : ''}moved to ${String(r.to_status).replace(/_/g, ' ')}`,
      meta: metaLine(r.actor_name, coords(r.lat, r.lng), r.notes),
      entity_type: 'trip',
      entity_id: r.trip_id,
      created_at: r.created_at,
    })),
    ...alerts.rows.map(r => ({
      id: `alert:${r.id}`,
      icon: 'alert',
      text: r.title,
      meta: metaLine(
        r.severity && r.severity.toUpperCase(), r.message,
        r.acknowledged ? 'acknowledged' : null
      ),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      created_at: r.created_at,
    })),
  ];

  // Each source was capped at `limit`, so the merge holds at most 4x that
  // before the slice — bounded, and the newest `limit` across all four is
  // exactly what the log should show.
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items.slice(0, limit);
}

module.exports = { activityFeed, CUSTODY_LABEL, LOCK_LABEL };
