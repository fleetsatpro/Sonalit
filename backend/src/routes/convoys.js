const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/convoyController');
const cfo = require('../controllers/convoysCfoController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const requireIdempotencyKey = require('../middleware/idempotency');
const { query } = require('../config/database');
const { evaluateCorridor } = require('../services/geofence/corridor');

const convoyReportRegenerateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.user?.id || req.ip}:${req.params.id || ''}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

router.use(authenticate);

// Standard convoy routes
router.get('/', c.getConvoys);
router.post('/', requireIdempotencyKey, authorize('admin', 'dispatcher'), auditLog('convoys'), (req, res, next) => {
  if (req.body.trucks !== undefined || req.body.cfos !== undefined) {
    return cfo.createConvoyCfo(req, res, next);
  }
  return c.createConvoy(req, res, next);
});
router.get('/:id', c.getConvoy);
router.put('/:id', authorize('admin', 'dispatcher'), auditLog('convoys'), c.updateConvoy);
router.patch('/:id/status', authorize('admin', 'dispatcher', 'operator'), auditLog('convoys'), c.updateConvoyStatus);
router.post('/:id/assign', authorize('admin', 'dispatcher'), auditLog('convoy_assignments'), c.assignVehicles);
router.delete('/:id', authorize('admin'), auditLog('convoys'), c.deleteConvoy);
router.get('/:id/events', c.getConvoyEvents);

// CFO truck management (B2)
router.post('/:id/trucks', authorize('admin', 'dispatcher'), cfo.addTruck);
router.delete('/:id/trucks/:truckId', authorize('admin', 'dispatcher'), cfo.removeTruck);

// Known route waypoints (dispatcher-entered towns/checkpoints for the planned route)
router.get('/:id/route-waypoints', authorize('admin', 'dispatcher', 'analyst'), cfo.getRouteWaypoints);
router.put('/:id/route-waypoints', authorize('admin', 'dispatcher'), auditLog('convoy_route_waypoints'), cfo.setRouteWaypoints);

// CFO user management (B2)
router.post('/:id/cfos', authorize('admin', 'dispatcher'), cfo.addCfo);
router.delete('/:id/cfos/:cfoId', authorize('admin', 'dispatcher'), cfo.removeCfo);
router.patch('/:id/cfos/:cfoId/device', authorize('admin', 'dispatcher'), cfo.linkDevice);

// CFO truck assignment management (B2)
router.post('/:id/cfo-assignments', authorize('admin', 'dispatcher'), cfo.assignTruckToCfo);
router.delete('/:id/cfo-assignments/:assignmentId', authorize('admin', 'dispatcher'), cfo.removeAssignment);

// Daily report admin (E5)
// E5 — org-wide report overview (must come before /:id routes)
router.get('/reports/overview', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportsOverview);
router.get('/:id/reports', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReports);
router.get('/:id/report-days', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportDays);
router.get('/:id/reports/:date/detail', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportDetail);
router.post('/:id/reports/:date/regenerate', authorize('admin', 'dispatcher'), convoyReportRegenerateLimiter, cfo.regenerateReport);
router.get('/:id/reports/:date/download', authorize('admin', 'dispatcher', 'analyst'), cfo.downloadReport);

// GET /:id/corridor — live 4D geofence status for a convoy. Evaluates every
// member device against the planned route swept over time: off_route (space),
// behind / ahead (schedule), or on_track. Config is tunable via query params
// (avg_speed_kmh, corridor_km, schedule_tol_km, started_at) with safe defaults.
// Raw query() + explicit org verification (convoy ownership) — same pattern as
// the incident dossier — so it's scoped without depending on the RLS role's
// grants across the mixed device/convoy tables.
router.get('/:id/corridor', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const convoyId = req.params.id;

    const cv = await query(
      `SELECT id, name, departure_time, status FROM convoys
        WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [convoyId, orgId]
    );
    if (!cv.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    const convoy = cv.rows[0];

    const rw = await query(
      `SELECT seq, name, lat, lng FROM convoy_route_waypoints
        WHERE convoy_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY seq ASC`,
      [convoyId]
    );
    const route = rw.rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lng), name: r.name, seq: r.seq }));
    if (route.length < 2) {
      return res.status(422).json({ error: 'Convoy has no planned route (need at least two waypoints) to form a corridor.' });
    }

    const mem = await query(
      `SELECT d.id, d.name, fo.name AS officer_name, d.last_lat, d.last_lng, d.last_fix_at
         FROM convoy_cfos cc
         JOIN guardian_devices d ON d.id = cc.guardian_device_id
         LEFT JOIN field_officers fo ON fo.device_id = d.id
        WHERE cc.convoy_id = $1 AND d.deleted_at IS NULL`,
      [convoyId]
    );

    const num = v => (v == null ? null : Number(v));
    const cfg = {
      avg_speed_kmh: clampNum(req.query.avg_speed_kmh, 45, 5, 120),
      corridor_km: clampNum(req.query.corridor_km, 2, 0.2, 50),
      schedule_tol_km: clampNum(req.query.schedule_tol_km, 8, 1, 100),
    };
    const startedAt = req.query.started_at ? new Date(req.query.started_at)
      : (convoy.departure_time ? new Date(convoy.departure_time) : null);
    const now = Date.now();
    const elapsedMs = startedAt && !isNaN(startedAt.getTime()) ? Math.max(0, now - startedAt.getTime()) : 0;

    const members = mem.rows.map(m => {
      const lat = num(m.last_lat), lng = num(m.last_lng);
      const base = { id: m.id, name: m.name, officer_name: m.officer_name ?? null,
        lat, lng, last_fix_at: m.last_fix_at };
      if (lat == null || lng == null) return { ...base, status: 'no_fix', severity: 'low' };
      const verdict = evaluateCorridor({
        route, lat, lng, elapsedMs,
        avgSpeedKmh: cfg.avg_speed_kmh, corridorKm: cfg.corridor_km, scheduleTolKm: cfg.schedule_tol_km,
      });
      return { ...base, ...verdict };
    });

    const summary = members.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {});
    res.json({ data: {
      convoy: { id: convoy.id, name: convoy.name, status: convoy.status, departure_time: convoy.departure_time },
      config: { ...cfg, started_at: startedAt && !isNaN(startedAt.getTime()) ? startedAt.toISOString() : null,
        schedule_known: elapsedMs > 0 },
      route, members, summary, evaluated_at: new Date(now).toISOString(),
    } });
  } catch (err) { next(err); }
});

function clampNum(v, def, lo, hi) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}

module.exports = router;
