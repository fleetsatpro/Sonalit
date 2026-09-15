const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/convoyController');
const cfo = require('../controllers/convoysCfoController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const requireIdempotencyKey = require('../middleware/idempotency');
const { query } = require('../config/database');
const { evaluateCorridor } = require('../services/geofence/corridor');
const { reconcileWorldState } = require('../services/geofence/worldStateSwarm');
const { scoreRoute } = require('../services/geo/routeRisk');
const logger = require('../utils/logger');

const convoyReportRegenerateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => `${req.user?.id || req.ip}:${req.params.id || ''}`, standardHeaders: true, legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }) });
router.use(authenticate);
router.get('/', c.getConvoys);
router.post('/', requireIdempotencyKey, authorize('admin', 'dispatcher'), auditLog('convoys'), (req, res, next) => { if (req.body.trucks !== undefined || req.body.cfos !== undefined) return cfo.createConvoyCfo(req, res, next); return c.createConvoy(req, res, next); });
router.get('/:id', c.getConvoy);
router.put('/:id', authorize('admin', 'dispatcher'), auditLog('convoys'), c.updateConvoy);
router.patch('/:id/status', authorize('admin', 'dispatcher', 'operator'), auditLog('convoys'), c.updateConvoyStatus);
router.post('/:id/assign', authorize('admin', 'dispatcher'), auditLog('convoy_assignments'), c.assignVehicles);
router.delete('/:id', authorize('admin'), auditLog('convoys'), c.deleteConvoy);
router.get('/:id/events', c.getConvoyEvents);
router.post('/:id/trucks', authorize('admin', 'dispatcher'), cfo.addTruck);
router.delete('/:id/trucks/:truckId', authorize('admin', 'dispatcher'), cfo.removeTruck);
router.get('/:id/route-waypoints', authorize('admin', 'dispatcher', 'analyst'), cfo.getRouteWaypoints);
router.put('/:id/route-waypoints', authorize('admin', 'dispatcher'), auditLog('convoy_route_waypoints'), cfo.setRouteWaypoints);
router.post('/:id/cfos', authorize('admin', 'dispatcher'), cfo.addCfo);
router.delete('/:id/cfos/:cfoId', authorize('admin', 'dispatcher'), cfo.removeCfo);
router.patch('/:id/cfos/:cfoId/device', authorize('admin', 'dispatcher'), cfo.linkDevice);
router.post('/:id/cfo-assignments', authorize('admin', 'dispatcher'), cfo.assignTruckToCfo);
router.delete('/:id/cfo-assignments/:assignmentId', authorize('admin', 'dispatcher'), cfo.removeAssignment);
router.get('/reports/overview', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportsOverview);
router.get('/:id/reports', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReports);
router.get('/:id/report-days', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportDays);
router.get('/:id/reports/:date/detail', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportDetail);
router.post('/:id/reports/:date/regenerate', authorize('admin', 'dispatcher'), convoyReportRegenerateLimiter, cfo.regenerateReport);
router.get('/:id/reports/:date/download', authorize('admin', 'dispatcher', 'analyst'), cfo.downloadReport);

router.get('/:id/corridor', async (req, res, next) => {
  try {
    const orgId = req.user.org_id, convoyId = req.params.id;
    const cv = await query(`SELECT c.id, c.name, c.departure_time, c.status, c.route_origin, c.route_destination, cl.name AS client_name FROM convoys c LEFT JOIN cargo_clients cl ON cl.id=c.client_id WHERE c.id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL`, [convoyId, orgId]);
    if (!cv.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    const convoy = cv.rows[0];
    const cr = await query(`SELECT route_line, width_km FROM convoy_route_corridors WHERE convoy_id=$1 AND org_id=$2 AND active=true`, [convoyId, orgId]);
    let route = [], plannedWidthKm = null;
    if (cr.rows.length) {
      const raw = cr.rows[0].route_line;
      const line = typeof raw === 'string' ? safeJsonArray(raw) : (Array.isArray(raw) ? raw : []);
      route = line.map((p, i) => ({ lat: Number(p?.lat), lng: Number(p?.lng), name: p?.name || null, seq: i })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (route.length >= 2) plannedWidthKm = Number(cr.rows[0].width_km);
    }
    if (route.length < 2) {
      const rw = await query(`SELECT seq, name, lat, lng FROM convoy_route_waypoints WHERE convoy_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY seq ASC`, [convoyId]);
      route = rw.rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lng), name: r.name, seq: r.seq }));
    }
    if (route.length < 2) return res.status(422).json({ error: 'Convoy has no planned route yet — plan one from an origin and destination, or add at least two route waypoints.' });

    // A convoy device can have a durable Guardian cache even when the detailed
    // device_locations history has not arrived yet. Prefer history, but never
    // make a selected-convoy device disappear just because that table is empty.
    const mem = await query(`
      SELECT d.id, d.name, fo.name AS officer_name,
             cur.lat AS history_lat, cur.lng AS history_lng, cur.heading AS live_heading,
             cur.speed AS live_speed, cur.accuracy AS live_accuracy, cur.ts AS live_ts,
             prev.lat AS prev_lat, prev.lng AS prev_lng, prev.heading AS prev_heading,
             prev.speed AS prev_speed, prev.ts AS prev_ts,
             d.last_lat AS cache_lat, d.last_lng AS cache_lng, d.last_speed AS cache_speed,
             d.last_fix_at AS cache_fix_at, d.last_seen AS cache_seen
        FROM convoy_cfos cc
        JOIN guardian_devices d ON d.id=cc.guardian_device_id
        LEFT JOIN field_officers fo ON fo.device_id=d.id
        LEFT JOIN LATERAL (SELECT lat, lng, heading, speed, accuracy, timestamp AS ts FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC, id DESC LIMIT 1) cur ON true
        LEFT JOIN LATERAL (SELECT lat, lng, heading, speed, timestamp AS ts FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC, id DESC OFFSET 1 LIMIT 1) prev ON true
       WHERE cc.convoy_id=$1 AND d.deleted_at IS NULL`, [convoyId]);

    const num = v => v == null ? null : Number(v), cfg = { avg_speed_kmh: clampNum(req.query.avg_speed_kmh, 45, 5, 120), corridor_km: clampNum(req.query.corridor_km, plannedWidthKm ?? 2, 0.2, 50), schedule_tol_km: clampNum(req.query.schedule_tol_km, 8, 1, 100) };
    const startedAt = req.query.started_at ? new Date(req.query.started_at) : (convoy.departure_time ? new Date(convoy.departure_time) : null), now = Date.now();
    const elapsedMs = startedAt && !isNaN(startedAt.getTime()) ? Math.max(0, now - startedAt.getTime()) : 0;
    const members = mem.rows.map(m => {
      const hasHistory = m.history_lat != null && m.history_lng != null;
      const observedLat = num(hasHistory ? m.history_lat : m.cache_lat), observedLng = num(hasHistory ? m.history_lng : m.cache_lng);
      const observedAt = hasHistory ? (m.live_ts || m.cache_fix_at || m.cache_seen) : (m.cache_fix_at || m.cache_seen);
      const base = { id: m.id, name: m.name, officer_name: m.officer_name ?? null, convoy_name: convoy.name, client_name: convoy.client_name ?? null, lat: observedLat, lng: observedLng, last_fix_at: observedAt || null, heading: num(m.live_heading), speed_kph: num(hasHistory ? m.live_speed : m.cache_speed), position_source: hasHistory ? 'device_locations' : observedLat != null ? 'guardian_cache' : 'none' };
      if (observedLat == null || observedLng == null) return { ...base, status: 'no_fix', severity: 'low', position_state: 'no_confident_estimate', position_confidence: 0, position_reason: 'No coordinate is available for this convoy device.' };

      // Cached Guardian coordinates are displayable evidence but must never be
      // mistaken for a fresh observation or passed through route reconciliation.
      if (!hasHistory) {
        const verdict = evaluateCorridor({ route, lat: observedLat, lng: observedLng, elapsedMs, avgSpeedKmh: cfg.avg_speed_kmh, corridorKm: cfg.corridor_km, scheduleTolKm: cfg.schedule_tol_km });
        return { ...base, ...verdict, status: 'no_fix', severity: 'low', position_state: 'stale', position_confidence: 0, position_uncertainty_m: null, position_reason: 'Showing last Guardian device cache because no device_locations fix is available.', world_state_version: 'world-state-swarm-v1', world_state_agents: [], world_state_disagreement: 'stale-cache', observed_lat: observedLat, observed_lng: observedLng, observed_at: observedAt || null };
      }

      const previous = m.prev_lat != null && m.prev_lng != null ? { lat: num(m.prev_lat), lng: num(m.prev_lng), heading: num(m.prev_heading) } : null;
      const elapsedSeconds = previous && m.prev_ts && observedAt ? Math.max(0, (new Date(observedAt).getTime() - new Date(m.prev_ts).getTime()) / 1000) : 0;
      const world = reconcileWorldState({ previous, observed: { lat: observedLat, lng: observedLng, accuracy_m: num(m.live_accuracy), heading: num(m.live_heading) }, route, elapsedSeconds, observedAt, now });
      const renderLat = world.estimate?.lat ?? observedLat, renderLng = world.estimate?.lng ?? observedLng;
      const verdict = evaluateCorridor({ route, lat: renderLat, lng: renderLng, elapsedMs, avgSpeedKmh: cfg.avg_speed_kmh, corridorKm: cfg.corridor_km, scheduleTolKm: cfg.schedule_tol_km });
      const remainingKm = Math.max(0, (verdict.route_len_km ?? 0) - (verdict.along_km ?? 0)), etaMs = cfg.avg_speed_kmh > 0 ? (remainingKm / cfg.avg_speed_kmh) * 3600000 : null;
      return { ...base, lat: renderLat, lng: renderLng, observed_lat: observedLat, observed_lng: observedLng, observed_at: observedAt, ...verdict, remaining_km: Math.round(remainingKm * 100) / 100, eta: etaMs == null ? null : new Date(now + etaMs).toISOString(), eta_min: etaMs == null ? null : Math.round(etaMs / 60000), position_state: world.state, position_confidence: world.confidence, position_uncertainty_m: world.uncertainty_m, position_reason: world.reason, world_state_version: world.version, world_state_agents: world.agents.map(a => ({ id: a.id, verdict: a.verdict, score: a.score })), world_state_disagreement: world.disagreement };
    });
    let risk = { zones: [], exposed_km: 0, worst: null, blocked: false };
    try {
      const rz = await query(`SELECT id, name, risk_level, zone_type, lat, lng, radius_km FROM risk_zones WHERE active=true AND (org_id=$1 OR org_id IS NULL) AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())`, [orgId]);
      const scored = scoreRoute(route, rz.rows), byId = new Map(rz.rows.map(z => [String(z.id), z]));
      risk = { zones: scored.exposures.map(e => { const z = byId.get(String(e.zone_id)); return { ...e, lat: Number(z.lat), lng: Number(z.lng), radius_km: Number(z.radius_km) }; }), exposed_km: scored.exposed_km, worst: scored.worst, blocked: scored.blocked };
    } catch (e) { logger.warn(`corridor risk overlay unavailable: ${e.message}`); }
    const summary = members.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {});
    res.json({ data: { convoy: { id: convoy.id, name: convoy.name, status: convoy.status, departure_time: convoy.departure_time, route_origin: convoy.route_origin ?? null, route_destination: convoy.route_destination ?? null, client_name: convoy.client_name ?? null }, config: { ...cfg, started_at: startedAt && !isNaN(startedAt.getTime()) ? startedAt.toISOString() : null, schedule_known: elapsedMs > 0 }, route, members, summary, risk, evaluated_at: new Date(now).toISOString() } });
  } catch (err) { next(err); }
});
function clampNum(v, def, lo, hi) { const n = parseFloat(v), chosen = Number.isFinite(n) ? n : parseFloat(def); return Number.isFinite(chosen) ? Math.max(lo, Math.min(hi, chosen)) : def; }
function safeJsonArray(text) { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } }
module.exports = router;
