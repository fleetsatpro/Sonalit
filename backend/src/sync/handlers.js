/**
 * Operation handlers — the business rules for everything a device may push.
 *
 * Two hard boundaries shape this file:
 *
 * 1. **No second business-rule engine.** Operations that already have a
 *    hardened HTTP route (clamp, unclamp, e-lock commands, anything that moves
 *    money or issues an authorisation) are NOT here. The client's outbox
 *    replays those against their own routes with `x-idempotency-key`, so the
 *    existing validation, authorisation and audit path stays the only one.
 *    What lives here is the set of operations that had no offline story at all.
 *
 * 2. **Every handler runs inside the caller's transaction** (see operations.js)
 *    on a client already switched to `sonalit_app` with `app.current_org_id`
 *    set, so RLS is live. A handler must never open its own connection, and
 *    must never read org_id from the payload — `ctx.user.org_id` is the only
 *    tenant identity that exists here.
 *
 * A handler returns an outcome, it does not throw for business failures:
 *   accepted  — applied; `result` is what the device stores
 *   rejected  — will never succeed; the device must stop retrying
 *   conflict  — the entity moved on; the local event is preserved for review
 * Throwing is reserved for infrastructure failure, which rolls the whole
 * operation back and is reported to the device as retryable.
 */

const OUTCOME = { ACCEPTED: 'accepted', REJECTED: 'rejected', CONFLICT: 'conflict' };

/** Roles allowed to push each operation type. Server-side; the client's claim is irrelevant. */
function allowed(ctx, roles) {
  return roles.includes(ctx.user.role);
}

function reject(code, message) {
  return { outcome: OUTCOME.REJECTED, error_code: code, error_message: message };
}

const FIELD_ROLES = ['admin', 'dispatcher', 'operator', 'cfo', 'yard_agent', 'port_agent', 'response_crew'];

// ─────────────────────────────────────────────────────────────────────────────
// cds_container.status_change
// ─────────────────────────────────────────────────────────────────────────────
/**
 * OFFLINE_ALLOWED_WITH_RESTRICTIONS.
 *
 * A container's status is shared state, so this is the one handler that uses
 * optimistic concurrency: the device must send the `expected_revision` it was
 * looking at when the worker acted. If the server has moved on, the change is
 * NOT applied and NOT overwritten — it becomes a conflict for a human to
 * resolve. Blanket last-write-wins here would mean a device that was offline
 * for six hours could silently revert a delivery someone else recorded.
 *
 * `delivered` is excluded deliberately. Marking a container delivered has
 * downstream consequences (custody chain, invoicing, POD) that the existing
 * trip routes own; letting a raw status write reach it offline would be a
 * second path to the same business transaction. The device records a delivery
 * through the trip route instead.
 */
const CONTAINER_STATUSES = ['available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'maintenance'];

const containerStatusChange = {
  entityType: 'cds_container',
  async apply(client, ctx, op) {
    if (!allowed(ctx, FIELD_ROLES)) {
      return reject('forbidden', 'Your role cannot change container status.');
    }

    const payload = op.payload || {};
    const status = payload.status;
    const containerId = op.entity_id;

    if (!containerId) return reject('invalid_operation', 'entity_id (container) is required.');
    if (!CONTAINER_STATUSES.includes(status)) {
      return reject('invalid_status', `status must be one of: ${CONTAINER_STATUSES.join(', ')}`);
    }
    if (!Number.isFinite(payload.expected_revision)) {
      return reject('missing_revision', 'expected_revision is required for a status change.');
    }

    const cur = await client.query(
      `SELECT id, number, status, revision FROM cds_containers
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [containerId]
    );
    if (cur.rows.length === 0) {
      // RLS-invisible or deleted. Either way retrying will not help.
      return reject('not_found', 'Container not found.');
    }

    const row = cur.rows[0];
    const actual = Number(row.revision);

    if (actual !== Number(payload.expected_revision)) {
      return {
        outcome: OUTCOME.CONFLICT,
        expected_revision: Number(payload.expected_revision),
        actual_revision: actual,
        server_snapshot: { id: row.id, number: row.number, status: row.status, revision: actual },
        error_code: 'revision_conflict',
        error_message: 'This container was updated elsewhere while the device was offline.',
        entity_id: containerId,
      };
    }

    // No-op writes still count as accepted: the device asked for a state the
    // server is already in, which is a successful outcome, not a failure.
    const upd = await client.query(
      `UPDATE cds_containers
          SET status = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, number, status, revision`,
      [containerId, status]
    );

    const after = upd.rows[0];
    return {
      outcome: OUTCOME.ACCEPTED,
      entity_id: containerId,
      result: {
        id: after.id,
        number: after.number,
        status: after.status,
        revision: Number(after.revision),
        previous_status: row.status,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// cds_incident.create
// ─────────────────────────────────────────────────────────────────────────────
/**
 * OFFLINE_ALLOWED. An incident is an append-only event: "the driver saw a
 * broken seal at 16:42". Two similar-looking incidents may be two real
 * occurrences, so nothing here deduplicates on content — only the operation id
 * does, which is what makes a retry safe without collapsing genuine repeats.
 *
 * The device-observed time is preserved as the incident's `created_at`, because
 * that is when the thing happened; server receipt time is already recorded
 * separately on the ledger row. Overwriting it with NOW() would misdate every
 * incident recorded in a dead zone by however long the outage lasted.
 */
const INCIDENT_TYPES = ['tamper', 'theft', 'accident', 'breakdown', 'route_deviation', 'unauthorized_stop', 'lock_failure'];
const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

const incidentCreate = {
  entityType: 'cds_incident',
  async apply(client, ctx, op) {
    if (!allowed(ctx, FIELD_ROLES)) {
      return reject('forbidden', 'Your role cannot record incidents.');
    }

    const p = op.payload || {};
    if (!INCIDENT_TYPES.includes(p.type)) {
      return reject('invalid_type', `type must be one of: ${INCIDENT_TYPES.join(', ')}`);
    }
    if (p.severity && !INCIDENT_SEVERITIES.includes(p.severity)) {
      return reject('invalid_severity', `severity must be one of: ${INCIDENT_SEVERITIES.join(', ')}`);
    }
    if (typeof p.title !== 'string' || p.title.trim().length === 0) {
      return reject('invalid_title', 'title is required.');
    }

    // Derived from the operation id so a retry that got as far as generating a
    // number produces the same one, and two devices cannot collide on the
    // UNIQUE constraint.
    const incidentNumber = `INC-${String(op.operation_id).replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    const observedAt = op.client_created_at || new Date().toISOString();

    const ins = await client.query(
      `INSERT INTO cds_incidents
         (id, org_id, incident_number, type, severity, title, description,
          trip_id, container_id, lat, lng, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, NOW())
       RETURNING id, incident_number, type, severity, title, status, created_at`,
      [
        ctx.user.org_id,
        incidentNumber,
        p.type,
        p.severity || 'medium',
        p.title.trim().slice(0, 255),
        typeof p.description === 'string' ? p.description : null,
        p.trip_id || null,
        p.container_id || null,
        Number.isFinite(p.lat) ? p.lat : null,
        Number.isFinite(p.lng) ? p.lng : null,
        observedAt,
      ]
    );

    const row = ins.rows[0];
    return {
      outcome: OUTCOME.ACCEPTED,
      entity_id: row.id,
      result: { ...row, observed_at: observedAt },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// cds_trip.observation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * OFFLINE_ALLOWED. A field note against a trip, recorded on the existing
 * cds_trip_events timeline so it shows up wherever trip history already shows
 * up. `to_status` is set to the trip's current status: this is an observation,
 * not a state transition, and inventing a status here would corrupt the trip
 * state machine that routes/cds.js owns.
 */
const tripObservation = {
  entityType: 'cds_trip',
  async apply(client, ctx, op) {
    if (!allowed(ctx, FIELD_ROLES)) {
      return reject('forbidden', 'Your role cannot record trip observations.');
    }

    const p = op.payload || {};
    const tripId = op.entity_id;
    if (!tripId) return reject('invalid_operation', 'entity_id (trip) is required.');
    if (typeof p.notes !== 'string' || p.notes.trim().length === 0) {
      return reject('invalid_notes', 'notes is required.');
    }

    const trip = await client.query(
      'SELECT id, status FROM cds_trips WHERE id = $1 AND deleted_at IS NULL',
      [tripId]
    );
    if (trip.rows.length === 0) return reject('not_found', 'Trip not found.');

    const ins = await client.query(
      `INSERT INTO cds_trip_events
         (org_id, trip_id, from_status, to_status, actor_id, actor_name, notes,
          lat, lng, metadata, created_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at`,
      [
        ctx.user.org_id,
        tripId,
        trip.rows[0].status,
        ctx.user.id,
        ctx.user.name || null,
        p.notes.trim().slice(0, 4000),
        Number.isFinite(p.lat) ? p.lat : null,
        Number.isFinite(p.lng) ? p.lng : null,
        JSON.stringify({ source: 'offline_sync', device_id: ctx.deviceId }),
        op.client_created_at || new Date().toISOString(),
      ]
    );

    return {
      outcome: OUTCOME.ACCEPTED,
      entity_id: tripId,
      result: { event_id: ins.rows[0].id, trip_id: tripId, created_at: ins.rows[0].created_at },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// gps.batch
// ─────────────────────────────────────────────────────────────────────────────
/**
 * OFFLINE_ALLOWED. Telemetry, buffered on the device and uploaded in one
 * request rather than one request per fix — a 30-minute dead zone at 1Hz is
 * 1800 points, which is one batch here and 1800 TLS handshakes otherwise.
 *
 * Deduplication is on (vehicle, device_time) inside the batch and against what
 * is already stored, because a retried batch legitimately re-sends points the
 * server already has. Two fixes for the same vehicle at the same instant are
 * always the same fix; unlike incidents, there is no such thing as a genuine
 * repeat.
 *
 * `device_time` is the fix's own timestamp and is stored as such; `server_time`
 * defaults to receipt. Collapsing them would make an entire offline stretch
 * look like it happened the moment connectivity returned.
 */
const MAX_GPS_POINTS = 1000;

const gpsBatch = {
  entityType: 'gps',
  async apply(client, ctx, op) {
    if (!allowed(ctx, FIELD_ROLES)) {
      return reject('forbidden', 'Your role cannot submit telemetry.');
    }

    const p = op.payload || {};
    const points = Array.isArray(p.points) ? p.points : null;
    if (!points || points.length === 0) return reject('invalid_batch', 'points must be a non-empty array.');
    if (points.length > MAX_GPS_POINTS) {
      return reject('batch_too_large', `A batch may carry at most ${MAX_GPS_POINTS} points.`);
    }
    if (!p.vehicle_id) return reject('invalid_batch', 'vehicle_id is required.');

    // The vehicle must be visible to this caller under RLS. Without this a
    // device could file telemetry against any vehicle id it can guess.
    const veh = await client.query(
      'SELECT id FROM cds_vehicles WHERE id = $1 AND deleted_at IS NULL',
      [p.vehicle_id]
    );
    if (veh.rows.length === 0) return reject('not_found', 'Vehicle not found.');

    const seen = new Set();
    const rows = [];
    for (const pt of points) {
      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) continue;
      if (pt.lat < -90 || pt.lat > 90 || pt.lng < -180 || pt.lng > 180) continue;
      if (!pt.device_time) continue;
      const key = String(pt.device_time);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(pt);
    }
    if (rows.length === 0) return reject('invalid_batch', 'No valid points in batch.');

    // ON CONFLICT is unavailable here (cds_gps_history is partitioned with no
    // suitable unique index), so the existing-point check is an explicit
    // anti-join against the device times in this batch.
    const times = rows.map(r => new Date(r.device_time).toISOString());
    const existing = await client.query(
      `SELECT device_time FROM cds_gps_history
        WHERE vehicle_id = $1 AND device_time = ANY($2::timestamptz[])`,
      [p.vehicle_id, times]
    );
    const already = new Set(existing.rows.map(r => new Date(r.device_time).toISOString()));

    const fresh = rows.filter(r => !already.has(new Date(r.device_time).toISOString()));

    let inserted = 0;
    for (const pt of fresh) {
      await client.query(
        `INSERT INTO cds_gps_history
           (org_id, vehicle_id, trip_id, lat, lng, speed, heading, altitude,
            signal_strength, device_time, server_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [
          ctx.user.org_id,
          p.vehicle_id,
          p.trip_id || null,
          pt.lat,
          pt.lng,
          Number.isFinite(pt.speed) ? pt.speed : null,
          Number.isFinite(pt.heading) ? pt.heading : null,
          Number.isFinite(pt.altitude) ? pt.altitude : null,
          Number.isFinite(pt.signal_strength) ? pt.signal_strength : null,
          pt.device_time,
        ]
      );
      inserted++;
    }

    return {
      outcome: OUTCOME.ACCEPTED,
      entity_id: p.vehicle_id,
      result: {
        received: points.length,
        inserted,
        duplicates: points.length - inserted,
      },
    };
  },
};

const REGISTRY = Object.freeze({
  'cds_container.status_change': containerStatusChange,
  'cds_incident.create': incidentCreate,
  'cds_trip.observation': tripObservation,
  'gps.batch': gpsBatch,
});

module.exports = {
  has: (type) => Object.prototype.hasOwnProperty.call(REGISTRY, type),
  get: (type) => REGISTRY[type],
  types: () => Object.keys(REGISTRY),
  OUTCOME,
  CONTAINER_STATUSES,
  INCIDENT_TYPES,
  MAX_GPS_POINTS,
};
