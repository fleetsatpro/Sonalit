/**
 * Convoy route corridor endpoints.
 * Mounted at /api/v1/convoys, AFTER routes/convoys.js, so that:
 *   POST /api/v1/convoys/:id/corridor
 *   POST /api/v1/convoys/:id/corridor/auto
 *   GET  /api/v1/convoys/:id/corridor/deviations
 *
 * GET /:id/corridor deliberately lives in routes/convoys.js instead: the 4D
 * Geofence page needs the live per-device evaluation against the corridor, not
 * the raw stored row. That handler reads the centre-line this router writes.
 */
const router = require('express').Router({ mergeParams: true });
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { planRoute, planRouteAlternatives } = require('../services/geo/routePlan');
const { rankRoutes } = require('../services/geo/routeRisk');
const { evaluateCorridor } = require('../services/geofence/corridor');
const { reconcileWorldState } = require('../services/geofence/worldStateSwarm');
const { geocode } = require('../services/geo/geocode');
const geoEnv = require('../services/geo/providerEnv');

router.use(authenticate, attachOrgDb);

const pt = Joi.object({ lat: Joi.number().required(), lng: Joi.number().required() });
const corridorSchema = Joi.object({
  route_line: Joi.array().items(pt).min(2), origin: pt, destination: pt,
  via: Joi.array().items(pt).default([]), width_km: Joi.number().positive().default(2.0),
  from_analysis: Joi.boolean(), plan: Joi.boolean(),
}).oxor('route_line', 'origin');

router.post('/:id/corridor', asyncHandler(async (req, res) => {
  const { error, value } = corridorSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const convoyCheck = await req.db(`SELECT id FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
  if (!convoyCheck.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  let routeLine = value.route_line;
  if (value.origin && value.destination) routeLine = [value.origin, ...value.via, value.destination];
  if (value.from_analysis && !routeLine) {
    const analysis = await req.db(`SELECT waypoints FROM route_analyses WHERE convoy_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.id]);
    if (!analysis.rows.length) return res.status(404).json({ error: 'No route analysis found for this convoy' });
    const wp = typeof analysis.rows[0].waypoints === 'string' ? JSON.parse(analysis.rows[0].waypoints) : analysis.rows[0].waypoints;
    routeLine = Array.isArray(wp) ? wp : [];
  }
  if (!routeLine || routeLine.length < 2) return res.status(400).json({ error: 'Provide route_line (2+ points), or origin + destination' });
  let planned = null;
  const wantPlan = value.plan === true || (value.plan !== false && value.from_analysis !== true && routeLine.length <= 25);
  if (wantPlan) {
    const r = await planRoute(routeLine, { osrmUrl: geoEnv.osrmUrl(), mapboxToken: geoEnv.mapboxToken() });
    if (r.routed && r.route.length >= 2) { routeLine = r.route; planned = r; }
  }
  const result = await req.db(
    `INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3)
     ON CONFLICT (convoy_id) DO UPDATE SET route_line = EXCLUDED.route_line, width_km = EXCLUDED.width_km, active = true
     RETURNING *`,
    [req.params.id, JSON.stringify(routeLine), value.width_km],
  );
  res.status(201).json({ data: { ...result.rows[0], planned: !!planned, routing_provider: planned ? planned.provider : null, distance_km: planned ? planned.distance_km : null, duration_min: planned ? planned.duration_min : null, waypoint_count: routeLine.length } });
}));

const autoSchema = Joi.object({ width_km: Joi.number().positive().default(2.0), origin_name: Joi.string().max(200), destination_name: Joi.string().max(200), ignore_risk: Joi.boolean().default(false) });
router.post('/:id/corridor/auto', asyncHandler(async (req, res) => {
  const { error, value } = autoSchema.validate(req.body || {});
  if (error) return res.status(400).json({ error: error.message });
  const cv = await req.db(`SELECT id, name, route_origin, route_destination FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
  if (!cv.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const convoy = cv.rows[0];
  const originName = (value.origin_name || convoy.route_origin || '').trim();
  const destName = (value.destination_name || convoy.route_destination || '').trim();
  if (!originName || !destName) return res.status(422).json({ error: 'This convoy has no origin and destination set. Add them to the convoy, or plan the corridor manually.', missing: { origin: !originName, destination: !destName } });
  const mapboxToken = geoEnv.mapboxToken();
  const [o, d] = await Promise.all([geocode(originName, { mapboxToken, limit: 1 }), geocode(destName, { mapboxToken, limit: 1 })]);
  const origin = o.results[0], destination = d.results[0];
  if (!origin || !destination) return res.status(422).json({ error: `Could not place ${!origin ? `"${originName}"` : `"${destName}"`} on the map. Check the spelling on the convoy, or plan the corridor manually.`, resolved: { origin: origin ?? null, destination: destination ?? null } });
  const candidates = await planRouteAlternatives([origin, destination], { osrmUrl: geoEnv.osrmUrl(), mapboxToken });
  if (!candidates.length) return res.status(502).json({ error: 'No routing engine could return a road between those two points. Try again shortly.' });
  const zonesResult = value.ignore_risk ? { rows: [] } : await req.db(`SELECT id, name, risk_level, zone_type, lat, lng, radius_km FROM risk_zones WHERE active = true AND (org_id = $1 OR org_id IS NULL) AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())`, [req.user.org_id]);
  const { ranked, best, all_blocked } = rankRoutes(candidates, zonesResult.rows);
  if (!best) return res.status(502).json({ error: 'Could not evaluate any candidate route.' });
  const saved = await req.db(`INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km) VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3) ON CONFLICT (convoy_id) DO UPDATE SET route_line = EXCLUDED.route_line, width_km = EXCLUDED.width_km, active = true RETURNING id, width_km`, [req.params.id, JSON.stringify(best.route), value.width_km]);
  res.status(201).json({ data: {
    id: saved.rows[0].id, width_km: Number(saved.rows[0].width_km),
    origin: { name: originName, resolved: origin.name, lat: origin.lat, lng: origin.lng },
    destination: { name: destName, resolved: destination.name, lat: destination.lat, lng: destination.lng },
    chosen: summarise(best), candidates: ranked.map(summarise), zones_considered: zonesResult.rows.length,
    all_blocked, planned: true, routing_provider: best.provider, waypoint_count: best.route.length,
  } });
}));

function summarise(c) { return { index: c.index, provider: c.provider, distance_km: c.distance_km, duration_min: c.duration_min, risk_score: c.score, blocked: c.blocked, worst_risk: c.worst, exposed_km: c.exposed_km, waypoint_count: c.route.length, exposures: c.exposures }; }

router.get('/:id/corridor/replay', asyncHandler(async (req, res) => {
  const hours = Math.min(72, Math.max(1, parseFloat(req.query.hours) || 12));
  const frames = Math.min(240, Math.max(2, parseInt(req.query.frames, 10) || 60));
  const cv = await req.db(`SELECT id, departure_time FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
  if (!cv.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const corridor = await req.db(`SELECT route_line, width_km FROM convoy_route_corridors WHERE convoy_id = $1 AND active = true`, [req.params.id]);
  if (!corridor.rows.length) return res.status(422).json({ error: 'No corridor to replay against. Plan one first.' });
  const raw = corridor.rows[0].route_line;
  const route = (typeof raw === 'string' ? JSON.parse(raw) : raw).map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (route.length < 2) return res.status(422).json({ error: 'Stored corridor is unusable.' });
  const until = new Date(), since = new Date(until.getTime() - hours * 3600_000);
  const fixes = await req.db(
    `SELECT dl.device_id, dl.lat, dl.lng, dl.heading, dl.speed, dl.accuracy, dl.timestamp, d.name, fo.name AS officer_name
       FROM device_locations dl
       JOIN convoy_cfos cc ON cc.guardian_device_id = dl.device_id
       JOIN guardian_devices d ON d.id = dl.device_id
       LEFT JOIN field_officers fo ON fo.device_id = dl.device_id
      WHERE cc.convoy_id = $1 AND dl.timestamp BETWEEN $2 AND $3 AND dl.lat IS NOT NULL AND dl.lng IS NOT NULL
      ORDER BY dl.device_id, dl.timestamp ASC`,
    [req.params.id, since, until],
  );

  const byDevice = new Map();
  for (const r of fixes.rows) {
    const key = String(r.device_id);
    if (!byDevice.has(key)) byDevice.set(key, { id: key, name: r.name, officer_name: r.officer_name ?? null, fixes: [] });
    byDevice.get(key).fixes.push({ lat: Number(r.lat), lng: Number(r.lng), heading: r.heading == null ? null : Number(r.heading), speed: r.speed == null ? null : Number(r.speed), accuracy_m: r.accuracy == null ? null : Number(r.accuracy), t: new Date(r.timestamp).getTime() });
  }

  // Reconstruct each recorded trajectory once, chronologically. The replay then
  // renders the same world-state semantics as live monitoring: an impossible
  // raw point remains evidence but does not teleport the reconstructed vehicle.
  for (const dev of byDevice.values()) {
    let previous = null;
    dev.fixes = dev.fixes.map(fix => {
      const world = reconcileWorldState({
        previous: previous ? { lat: previous.lat, lng: previous.lng, heading: previous.heading } : null,
        observed: { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, heading: fix.heading },
        route,
        elapsedSeconds: previous ? Math.max(0, (fix.t - previous.t) / 1000) : 0,
        observedAt: new Date(fix.t).toISOString(),
        now: fix.t,
      });
      const estimate = world.estimate || { lat: fix.lat, lng: fix.lng };
      const reconciled = {
        ...fix, lat: estimate.lat, lng: estimate.lng,
        observed_lat: fix.lat, observed_lng: fix.lng,
        position_state: world.state, position_confidence: world.confidence,
        position_uncertainty_m: world.uncertainty_m, position_reason: world.reason,
        world_state_agents: world.agents.map(a => ({ id: a.id, verdict: a.verdict, score: a.score })),
      };
      // Continue from the reconstructed position, not an outlier raw point.
      previous = { lat: estimate.lat, lng: estimate.lng, heading: fix.heading, t: fix.t };
      return reconciled;
    });
  }

  const cfg = { avgSpeedKmh: clampNum(req.query.avg_speed_kmh, 45, 5, 120), corridorKm: clampNum(req.query.corridor_km, Number(corridor.rows[0].width_km) || 2, 0.2, 50), scheduleTolKm: clampNum(req.query.schedule_tol_km, 8, 1, 100) };
  const departedAt = cv.rows[0].departure_time ? new Date(cv.rows[0].departure_time).getTime() : since.getTime();
  const step = (until.getTime() - since.getTime()) / (frames - 1);
  const cursors = new Map([...byDevice.keys()].map(k => [k, -1]));
  const out = [];
  for (let f = 0; f < frames; f++) {
    const t = since.getTime() + step * f;
    const members = [];
    for (const [key, dev] of byDevice) {
      let i = cursors.get(key);
      while (i + 1 < dev.fixes.length && dev.fixes[i + 1].t <= t) i++;
      cursors.set(key, i);
      const fix = dev.fixes[i];
      if (!fix || fix.t > t) continue;
      const verdict = evaluateCorridor({ route, lat: fix.lat, lng: fix.lng, elapsedMs: Math.max(0, t - departedAt), ...cfg });
      members.push({ id: dev.id, name: dev.name, officer_name: dev.officer_name, lat: fix.lat, lng: fix.lng, observed_lat: fix.observed_lat, observed_lng: fix.observed_lng, fix_age_ms: t - fix.t, position_state: fix.position_state, position_confidence: fix.position_confidence, position_uncertainty_m: fix.position_uncertainty_m, position_reason: fix.position_reason, ...verdict });
    }
    out.push({ t: new Date(t).toISOString(), members });
  }
  res.json({ data: { route, width_km: cfg.corridorKm, since: since.toISOString(), until: until.toISOString(), frames: out, device_count: byDevice.size, fix_count: fixes.rows.length } });
}));

function clampNum(v, def, lo, hi) { const n = parseFloat(v); const chosen = Number.isFinite(n) ? n : parseFloat(def); return Number.isFinite(chosen) ? Math.max(lo, Math.min(hi, chosen)) : def; }

router.get('/:id/corridor/deviations', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const result = await req.db(`SELECT e.* FROM geofence_events e WHERE e.convoy_id = $1 AND e.event_type = 'route_deviation' ORDER BY e.created_at DESC LIMIT $2`, [req.params.id, limit]);
  res.json({ data: result.rows });
}));

module.exports = router;
