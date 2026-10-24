const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');
const { evaluateConvoyOperationalState } = require('../services/convoyOperationalResilience');
const logger = require('../utils/logger');
const { routePointList, calculateTruckRouteProgress } = require('../services/convoyTruckProgress');

const VALID_TRANSITIONS = {
  planned: ['active', 'cancelled'],
  active: ['completing', 'completed', 'aborted', 'cancelled'],
  completing: ['completed', 'aborted', 'cancelled'],
  completed: [],
  aborted: [],
  cancelled: [],
};

const convoySchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  region: Joi.string().valid('Kenya', 'DRC', 'Tanzania', 'Mali').required(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  description: Joi.string().max(500).allow('', null),
  departureTime: Joi.date().iso().allow(null),
  estimatedArrival: Joi.date().iso().allow(null),
  routeOrigin: Joi.string().max(100).required(),
  routeDestination: Joi.string().max(100).required(),
  clientId: Joi.string().uuid().allow('', null),
  // Local consignment: this convoy's CFO hands it over themselves (uploads the
  // handover form directly from the field app) instead of a dedicated
  // handover_officer — see updateConvoyStatus's completion gate. No .default()
  // here deliberately: this schema is also .fork()'d for updateConvoy, where an
  // omitted field must stay untouched (via COALESCE), not get defaulted to false
  // and silently reset on every unrelated edit.
  localConsignment: Joi.boolean(),
});

// Confirms a client belongs to the requesting org before it's attached to a
// convoy — cargo_clients has no direct org check at the DB layer here since
// this runs through the raw (unscoped) query() helper, not req.db/RLS.
async function assertClientInOrg(clientId, orgId) {
  if (!clientId) return true;
  const result = await query(
    'SELECT id FROM cargo_clients WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
    [clientId, orgId]
  );
  return result.rows.length > 0;
}

function buildPagination(page, limit, total) {
  return { page: parseInt(page), limit: parseInt(limit), totalCount: parseInt(total), totalPages: Math.ceil(total / limit) };
}

/**
 * Adds observed, per-truck route progress to convoy rows using the canonical
 * convoy_trucks roster (falling back to convoy_assignments for legacy convoys),
 * latest vehicle GPS fixes, and the planned route geometry. A clock/ETA
 * estimate is deliberately never substituted for a missing GPS observation.
 */
async function attachTruckProgress(rows, orgId) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const convoyIds = [...new Set(rows.map(row => row.id).filter(Boolean).map(String))];
  if (convoyIds.length === 0) return rows;

  try {
    const [rosterResult, corridorResult, waypointResult] = await Promise.all([
      query(
        `WITH roster AS (
           SELECT ct.convoy_id, ct.id AS convoy_truck_id, v.id AS vehicle_id,
                  ct.position,
                  COALESCE(NULLIF(ct.registration, ''), v.registration) AS registration,
                  ct.driver_name
             FROM convoy_trucks ct
             JOIN convoys c ON c.id = ct.convoy_id
                           AND c.org_id = $2 AND c.deleted_at IS NULL
             LEFT JOIN vehicles v ON v.id = ct.vehicle_id
                                  AND v.org_id = c.org_id AND v.deleted_at IS NULL
            WHERE ct.convoy_id = ANY($1::uuid[])
           UNION ALL
           SELECT ca.convoy_id, NULL::uuid AS convoy_truck_id, v.id AS vehicle_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY ca.convoy_id
                    ORDER BY ca.joined_at NULLS LAST, ca.vehicle_id
                  )::int AS position,
                  v.registration AS registration,
                  NULL::text AS driver_name
             FROM convoy_assignments ca
             JOIN convoys c ON c.id = ca.convoy_id
                           AND c.org_id = $2 AND c.deleted_at IS NULL
             JOIN vehicles v ON v.id = ca.vehicle_id
                            AND v.org_id = c.org_id AND v.deleted_at IS NULL
            WHERE ca.convoy_id = ANY($1::uuid[])
              AND NOT EXISTS (
                SELECT 1 FROM convoy_trucks ct WHERE ct.convoy_id = ca.convoy_id
              )
         )
         SELECT r.convoy_id, r.convoy_truck_id, r.vehicle_id, r.position,
                r.registration, r.driver_name,
                gps.lat AS gps_lat, gps.lng AS gps_lng,
                gps.speed AS speed_kph, gps.last_fix_at
           FROM roster r
           LEFT JOIN LATERAL (
             SELECT g.lat, g.lng, g.speed, g.timestamp AS last_fix_at
               FROM gps_logs g
              WHERE g.vehicle_id = r.vehicle_id
              ORDER BY g.timestamp DESC, g.id DESC
              LIMIT 1
           ) gps ON r.vehicle_id IS NOT NULL
          ORDER BY r.convoy_id, r.position`,
        [convoyIds, orgId]
      ),
      query(
        `SELECT crc.convoy_id, crc.route_line, crc.width_km
           FROM convoy_route_corridors crc
           JOIN convoys c ON c.id = crc.convoy_id
                         AND c.org_id = $2 AND c.deleted_at IS NULL
          WHERE crc.convoy_id = ANY($1::uuid[]) AND crc.active = true`,
        [convoyIds, orgId]
      ),
      query(
        `SELECT rw.convoy_id, rw.seq, rw.lat, rw.lng
           FROM convoy_route_waypoints rw
           JOIN convoys c ON c.id = rw.convoy_id
                         AND c.org_id = $2 AND c.deleted_at IS NULL
          WHERE rw.convoy_id = ANY($1::uuid[])
            AND rw.lat IS NOT NULL AND rw.lng IS NOT NULL
          ORDER BY rw.convoy_id, rw.seq`,
        [convoyIds, orgId]
      ),
    ]);

    const routes = new Map();
    for (const row of corridorResult.rows || []) {
      const points = routePointList(row.route_line);
      if (points.length >= 2) {
        const width = Number(row.width_km);
        routes.set(String(row.convoy_id), {
          points,
          corridorKm: Number.isFinite(width) && width > 0 ? width : 2,
        });
      }
    }

    const waypointRoutes = new Map();
    for (const row of waypointResult.rows || []) {
      const key = String(row.convoy_id);
      if (!waypointRoutes.has(key)) waypointRoutes.set(key, []);
      waypointRoutes.get(key).push({
        lat: row.lat == null ? NaN : Number(row.lat),
        lng: row.lng == null ? NaN : Number(row.lng),
      });
    }
    for (const [id, points] of waypointRoutes) {
      if (!routes.has(id) && points.length >= 2
          && points.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)
            && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)) {
        routes.set(id, { points, corridorKm: 2 });
      }
    }

    const byConvoy = new Map(convoyIds.map(id => [id, []]));
    const now = Date.now();
    for (const row of rosterResult.rows || []) {
      const convoyId = String(row.convoy_id);
      const route = routes.get(convoyId);
      const position = Number(row.position) || 1;
      const progress = calculateTruckRouteProgress(row, route, now);
      const truck = {
        id: row.convoy_truck_id ? String(row.convoy_truck_id) : convoyId + ':' + (row.vehicle_id ?? position),
        vehicle_id: row.vehicle_id ? String(row.vehicle_id) : null,
        position,
        registration: row.registration ?? null,
        driver_name: row.driver_name ?? null,
        ...progress,
      };
      if (byConvoy.has(convoyId)) byConvoy.get(convoyId).push(truck);
    }

    return rows.map(row => {
      const truckProgress = byConvoy.get(String(row.id)) || [];
      return {
        ...row,
        vehicle_count: truckProgress.length,
        truck_progress: truckProgress,
        truck_progress_available: true,
      };
    });
  } catch (err) {
    // Telemetry must not take the core convoy register offline.
    logger.warn('[convoyProgress] live truck progress unavailable: ' + err.message);
    return rows.map(row => ({
      ...row,
      truck_progress: [],
      truck_progress_available: false,
      vehicle_count: Number(row.vehicle_count) || 0,
    }));
  }
}

const getConvoys = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const filters = [], params = [req.user.org_id];

  if (req.query.status) { params.push(req.query.status); filters.push(`c.status = $${params.length}`); }
  if (req.query.region) { params.push(req.query.region); filters.push(`c.region = $${params.length}`); }
  if (req.query.priority) { params.push(req.query.priority); filters.push(`c.priority = $${params.length}`); }
  if (req.query.clientId) { params.push(req.query.clientId); filters.push(`c.client_id = $${params.length}`); }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const countResult = await query(`SELECT COUNT(*) FROM convoys c WHERE c.org_id = $1 AND c.deleted_at IS NULL ${where}`, params);

  params.push(limit, offset);
  const result = await query(
    `SELECT c.*,
            u.name AS created_by_name,
            cl.name AS client_name,
            cl.company AS client_company,
            CASE WHEN EXISTS (SELECT 1 FROM convoy_trucks ct WHERE ct.convoy_id = c.id)
                 THEN (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id)
                 ELSE (SELECT COUNT(DISTINCT ca.vehicle_id)
                         FROM convoy_assignments ca
                         JOIN vehicles v ON v.id = ca.vehicle_id
                                       AND v.org_id = c.org_id AND v.deleted_at IS NULL
                        WHERE ca.convoy_id = c.id)
            END AS vehicle_count,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS open_alert_count,
            (SELECT COUNT(*) FROM incidents i WHERE i.convoy_id = c.id AND i.status NOT IN ('resolved','closed')) AS open_incident_count
     FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN cargo_clients cl ON cl.id = c.client_id
     WHERE c.org_id = $1 AND c.deleted_at IS NULL ${where}
     ORDER BY c.created_at DESC
     LIMIT ${params.length - 1} OFFSET ${params.length}`,
    params
  );

  const data = await attachTruckProgress(result.rows, req.user.org_id);
  res.json({ data, pagination: buildPagination(page, limit, countResult.rows[0].count) });
});

const getConvoy = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.*, u.name AS created_by_name, cl.name AS client_name, cl.company AS client_company,
            CASE WHEN EXISTS (SELECT 1 FROM convoy_trucks ct WHERE ct.convoy_id = c.id)
                 THEN (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id)
                 ELSE (SELECT COUNT(DISTINCT ca.vehicle_id)
                         FROM convoy_assignments ca
                         JOIN vehicles v ON v.id = ca.vehicle_id
                                       AND v.org_id = c.org_id AND v.deleted_at IS NULL
                        WHERE ca.convoy_id = c.id)
            END AS vehicle_count,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS open_alert_count,
            (SELECT COUNT(*) FROM incidents i WHERE i.convoy_id = c.id AND i.status NOT IN ('resolved','closed')) AS open_incident_count
     FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN cargo_clients cl ON cl.id = c.client_id
     WHERE c.id = $1 AND c.org_id = $2 AND c.deleted_at IS NULL`,
    [req.params.id, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const [vehicles, trucks, cfos, assignments] = await Promise.all([
    query(
      `SELECT v.*, ca.role AS assignment_role, ca.joined_at
       FROM convoy_assignments ca
       JOIN vehicles v ON v.id = ca.vehicle_id AND v.deleted_at IS NULL
       WHERE ca.convoy_id = $1`,
      [req.params.id]
    ),
    query(
      `SELECT * FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position`,
      [req.params.id]
    ),
    query(
      `SELECT cc.*, u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc
       JOIN users u ON u.id = cc.cfo_user_id
       WHERE cc.convoy_id = $1`,
      [req.params.id]
    ),
    query(
      `SELECT * FROM convoy_cfo_truck_assignments WHERE convoy_id = $1`,
      [req.params.id]
    ),
  ]);

  const [enriched] = await attachTruckProgress([{
    ...result.rows[0],
    vehicles: vehicles.rows,
    trucks: trucks.rows,
    cfos: cfos.rows,
    cfo_truck_assignments: assignments.rows,
  }], req.user.org_id);

  res.json({ data: enriched });
});

const createConvoy = asyncHandler(async (req, res) => {
  const { error, value } = convoySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const clientId = value.clientId || null;
  if (clientId && !(await assertClientInOrg(clientId, req.user.org_id))) {
    return res.status(422).json({ error: 'client_not_found' });
  }

  const result = await query(
    `INSERT INTO convoys
       (name, region, priority, description, departure_time, estimated_arrival,
        route_origin, route_destination, client_id, local_consignment, status, created_by, org_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,$12,NOW(),NOW())
     RETURNING *`,
    [value.name, value.region, value.priority, value.description || null,
     value.departureTime || null, value.estimatedArrival || null,
     value.routeOrigin, value.routeDestination, clientId, value.localConsignment ?? false, req.user.id, req.user.org_id]
  );

  req.auditAction = 'INSERT';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];

  res.status(201).json({ data: result.rows[0] });
});

const updateConvoy = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.org_id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const { error, value } = convoySchema.fork(Object.keys(convoySchema.describe().keys), (f) => f.optional()).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const clientId = value.clientId || null;
  if (clientId && !(await assertClientInOrg(clientId, req.user.org_id))) {
    return res.status(422).json({ error: 'client_not_found' });
  }

  const result = await query(
    `UPDATE convoys SET
       name = COALESCE($1, name), region = COALESCE($2, region),
       priority = COALESCE($3, priority), description = COALESCE($4, description),
       departure_time = COALESCE($5, departure_time),
       estimated_arrival = COALESCE($6, estimated_arrival),
       route_origin = COALESCE($7, route_origin),
       route_destination = COALESCE($8, route_destination),
       client_id = COALESCE($9, client_id),
       local_consignment = COALESCE($10, local_consignment),
       updated_at = NOW()
     WHERE id = $11 AND org_id = $12 AND deleted_at IS NULL RETURNING *`,
    [value.name, value.region, value.priority, value.description,
     value.departureTime, value.estimatedArrival, value.routeOrigin,
     value.routeDestination, clientId, value.localConsignment, req.params.id, req.user.org_id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];
  req.auditAfter = result.rows[0];

  res.json({ data: result.rows[0] });
});

const updateConvoyStatus = asyncHandler(async (req, res) => {
  const schema = Joi.object({ status: Joi.string().valid('planned', 'active', 'completing', 'completed', 'aborted', 'cancelled').required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const current = await query('SELECT * FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.org_id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const currentStatus = current.rows[0].status;
  if (!VALID_TRANSITIONS[currentStatus]?.includes(value.status)) {
    return res.status(422).json({
      error: `Invalid status transition: ${currentStatus} → ${value.status}. Allowed: ${VALID_TRANSITIONS[currentStatus].join(', ') || 'none'}`,
    });
  }

  // Material operational exceptions block completion; a pure telemetry gap
  // remains informational so GPS silence does not prevent documented handover.
  if (value.status === 'completed') {
    const resilience = await evaluateConvoyOperationalState(query, req.user.org_id, req.params.id);
    const blockers = resilience.evaluation.exceptions.filter(e => ['critical','high'].includes(e.severity) && e.exception_type !== 'telemetry_gap');
    if (blockers.length) return res.status(422).json({
      error:'operational_exceptions_open',
      detail:'Resolve or explicitly waive material convoy operational exceptions before completion.',
      posture:resilience.evaluation.posture,
      exceptions:blockers.map(e => ({type:e.exception_type,severity:e.severity,truck_id:e.convoy_truck_id,fingerprint:e.fingerprint})),
    });
  }

  // A convoy can't reach 'completed' without a signed-off handover: either one
  // whole-convoy record, or every one of its trucks individually covered
  // (some convoys hand off truck-by-truck as each peels off at a different
  // destination). See convoy_handovers (migration 083) and its upload routes
  // in guardianCfo.js (CFO self-handover, local_consignment convoys only) and
  // convoyHandover.js (handover_officer / admin / dispatcher).
  if (value.status === 'completed') {
    const handoverCheck = await query(
      `SELECT
         EXISTS (SELECT 1 FROM convoy_handovers WHERE convoy_id = $1 AND convoy_truck_id IS NULL AND deleted_at IS NULL) AS convoy_wide,
         NOT EXISTS (
           SELECT 1 FROM convoy_trucks ct WHERE ct.convoy_id = $1
             AND NOT EXISTS (SELECT 1 FROM convoy_handovers ch WHERE ch.convoy_truck_id = ct.id AND ch.deleted_at IS NULL)
         ) AS all_trucks_covered`,
      [req.params.id]
    );
    const { convoy_wide, all_trucks_covered } = handoverCheck.rows[0];
    if (!convoy_wide && !all_trucks_covered) {
      return res.status(422).json({
        error: 'handover_required',
        detail: 'Upload a handover form (whole-convoy or per-truck) before marking this convoy completed.',
      });
    }
  }

  const setDeparture = value.status === 'active';
  const setArrival = value.status === 'completed' || value.status === 'aborted' || value.status === 'cancelled';

  const result = await query(
    `UPDATE convoys SET status = $1, updated_at = NOW()
     ${setDeparture ? ', departure_time = NOW()' : ''}
     ${setArrival ? ', arrival_time = NOW()' : ''}
     WHERE id = $2 RETURNING *`,
    [value.status, req.params.id]
  );

  const eventMap = { active: 'convoy:activated', completing: 'convoy:completing', completed: 'convoy:completed', cancelled: 'convoy:cancelled', aborted: 'convoy:aborted' };
  publish(`org#${req.user.org_id}`, { type: 'convoy.update', convoyId: req.params.id, status: value.status, updatedBy: req.user.id });

  // A finished convoy owns the end of its vehicles' Hybrid Tracking: every
  // session whose termination policy is CONVOY_ENDED stops, and any QR still
  // waiting to be scanned is invalidated so a late scan cannot revive a journey
  // that is over. Sessions running on a container policy are left alone — a box
  // still on the road keeps reporting even after its convoy disbands.
  if (['completed', 'aborted', 'cancelled'].includes(value.status)) {
    try {
      const T = require('../utils/trackingEngine');
      await T.onConvoyEnded(T.dbForOrg(req.user.org_id), req.user.org_id, req.params.id,
        { id: req.user.id, name: req.user.name, type: 'operator' });
    } catch (err) {
      // Never fail the status change over tracking cleanup; a sweeper can
      // reconcile, but a convoy that cannot be closed blocks the control room.
      require('../utils/logger').warn(`convoy tracking teardown failed (${req.params.id}): ${err.message}`);
    }
  }

  // D4: on completion, enqueue archive PDF generation
  if (value.status === 'completed') {
    try {
      const { getQueues } = require('../config/queue');
      const { convoyArchiveQueue } = getQueues();
      if (convoyArchiveQueue) {
        convoyArchiveQueue.add('generateArchive', { convoy_id: req.params.id },
          { jobId: `archive:${req.params.id}`, removeOnComplete: { count: 100 } }
        ).catch(() => {});
      }
    } catch {}
  }

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = { status: currentStatus };
  req.auditAfter = { status: value.status };

  res.json({ data: result.rows[0] });
});

// Shared by the handover upload routes: once a qualifying convoy_handovers
// row makes a 'completing' convoy's handover gate satisfied (see the check
// in updateConvoyStatus above), flip it straight to 'completed' rather than
// making someone come back and click a separate "mark completed" button —
// the handover *is* the completing action. The `status = 'completing'` guard
// makes this safe to call from a race (e.g. the last two trucks of a
// truck-by-truck handover finishing within moments of each other): only the
// first call's UPDATE actually matches a row.
async function finalizeConvoyCompletion(convoyId, orgId, actorUserId) {
  const result = await query(
    `UPDATE convoys SET status = 'completed', arrival_time = NOW(), updated_at = NOW()
     WHERE id = $1 AND org_id = $2 AND status = 'completing' RETURNING *`,
    [convoyId, orgId]
  );
  if (!result.rows.length) return null;

  publish(`org#${orgId}`, { type: 'convoy.update', convoyId, status: 'completed', updatedBy: actorUserId ?? null });

  // Same teardown as the explicit status route — a handover-driven completion
  // is still a completion, and leaving live sessions behind here is exactly how
  // a "finished" convoy keeps drawing moving trucks on the command map.
  try {
    const T = require('../utils/trackingEngine');
    await T.onConvoyEnded(T.dbForOrg(orgId), orgId, convoyId,
      { id: actorUserId ?? null, type: 'operator' });
  } catch (err) {
    require('../utils/logger').warn(`convoy tracking teardown failed (${convoyId}): ${err.message}`);
  }

  try {
    const { getQueues } = require('../config/queue');
    const { convoyArchiveQueue } = getQueues();
    if (convoyArchiveQueue) {
      convoyArchiveQueue.add('generateArchive', { convoy_id: convoyId },
        { jobId: `archive:${convoyId}`, removeOnComplete: { count: 100 } }
      ).catch(() => {});
    }
  } catch {}

  return result.rows[0];
}

// Re-runs the same convoy_handovers coverage check updateConvoyStatus uses,
// standalone so the upload routes can decide whether to call
// finalizeConvoyCompletion after recording a handover.
async function isConvoyHandoverComplete(convoyId) {
  const result = await query(
    `SELECT
       EXISTS (SELECT 1 FROM convoy_handovers WHERE convoy_id = $1 AND convoy_truck_id IS NULL AND deleted_at IS NULL) AS convoy_wide,
       NOT EXISTS (
         SELECT 1 FROM convoy_trucks ct WHERE ct.convoy_id = $1
           AND NOT EXISTS (SELECT 1 FROM convoy_handovers ch WHERE ch.convoy_truck_id = ct.id AND ch.deleted_at IS NULL)
       ) AS all_trucks_covered`,
    [convoyId]
  );
  const { convoy_wide, all_trucks_covered } = result.rows[0];
  return convoy_wide || all_trucks_covered;
}

const assignVehicles = asyncHandler(async (req, res) => {
  const schema = Joi.object({ vehicleIds: Joi.array().items(Joi.string().uuid()).min(1).required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  for (const vid of value.vehicleIds) {
    await query(
      `INSERT INTO convoy_assignments (convoy_id, vehicle_id, role, joined_at)
       VALUES ($1, $2, 'escort', NOW())
       ON CONFLICT (convoy_id, vehicle_id) DO NOTHING`,
      [req.params.id, vid]
    );
    await query(
      'UPDATE vehicles SET assigned_convoy_id = $1, updated_at = NOW() WHERE id = $2',
      [req.params.id, vid]
    );
  }

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditAfter = { assigned_vehicles: value.vehicleIds };

  res.json({ message: `${value.vehicleIds.length} vehicle(s) assigned to convoy` });
});

const deleteConvoy = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  await query('UPDATE convoys SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];

  res.json({ message: 'Convoy deleted' });
});

const getConvoyEvents = asyncHandler(async (req, res) => {
  const alerts = await query(
    `SELECT id, 'alert' AS event_type, type, severity, message, created_at FROM alerts
     WHERE convoy_id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  const incidents = await query(
    `SELECT id, 'incident' AS event_type, title AS type, severity, description AS message, created_at FROM incidents
     WHERE convoy_id = $1`,
    [req.params.id]
  );

  const events = [...alerts.rows, ...incidents.rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ data: events });
});

const PRIORITY_MAP = { standard: 'low', express: 'high', critical: 'critical' };

const dispatchConvoy = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    vehicle_id: Joi.string().uuid().required(),
    driver_id: Joi.string().uuid().required(),
    route_id: Joi.string().allow('', null).optional(),
    priority: Joi.string().valid('standard', 'express', 'critical').required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const vehicle = await query(
    'SELECT registration, region FROM vehicles WHERE id = $1 AND deleted_at IS NULL',
    [value.vehicle_id]
  );
  if (!vehicle.rows.length) return res.status(404).json({ error: 'Vehicle not found' });

  const region = vehicle.rows[0].region || 'Kenya';
  const name = `QD-${vehicle.rows[0].registration}-${Date.now().toString(36).toUpperCase()}`;
  const mappedPriority = PRIORITY_MAP[value.priority];

  const convoy = await query(
    `INSERT INTO convoys
       (name, region, priority, status, route_origin, route_destination, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,'active','Dispatch Point','In Transit',$4,NOW(),NOW())
     RETURNING *`,
    [name, region, mappedPriority, req.user.id]
  );
  const convoyId = convoy.rows[0].id;

  await query(
    `INSERT INTO convoy_assignments (convoy_id, vehicle_id, role, joined_at)
     VALUES ($1,$2,'escort',NOW()) ON CONFLICT (convoy_id, vehicle_id) DO NOTHING`,
    [convoyId, value.vehicle_id]
  );
  await query(
    'UPDATE vehicles SET assigned_convoy_id = $1, updated_at = NOW() WHERE id = $2',
    [convoyId, value.vehicle_id]
  );

  publish(`org#${req.user.org_id}`, { type: 'convoy.dispatched', convoyId, vehicleId: value.vehicle_id, dispatchedBy: req.user.id });

  req.auditAction = 'INSERT';
  req.auditRecordId = convoyId;
  req.auditAfter = convoy.rows[0];

  res.status(201).json({ data: convoy.rows[0] });
});

module.exports = {
  getConvoys, getConvoy, createConvoy, updateConvoy, updateConvoyStatus, assignVehicles, deleteConvoy, getConvoyEvents, dispatchConvoy,
  finalizeConvoyCompletion, isConvoyHandoverComplete,
  // Exported for focused regression tests; the HTTP contract remains unchanged.
  attachTruckProgress,
};
