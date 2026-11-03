'use strict';

const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { query } = require('../config/database');
const { runXdSurveillanceSwarm } = require('../services/geofence/xdSurveillanceSwarm');
const { reconcileWorldState } = require('../services/geofence/worldStateSwarm');

router.use(authenticate);

router.post('/:id/xd-surveillance/run', authorize('admin', 'dispatcher', 'operator', 'analyst'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const convoyId = req.params.id;
    const convoyResult = await query(`
      SELECT c.id, c.name, c.status, c.route_origin, c.route_destination, c.departure_time,
             cl.name AS client_name
      FROM convoys c
      LEFT JOIN cargo_clients cl ON cl.id = c.client_id
      WHERE c.id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL
    `, [convoyId, orgId]);
    if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    const convoy = convoyResult.rows[0];

    const corridorResult = await query(`SELECT route_line, width_km FROM convoy_route_corridors WHERE convoy_id=$1 AND org_id=$2 AND active=true LIMIT 1`, [convoyId, orgId]);
    let route = [];
    let corridorKm = corridorResult.rows[0]?.width_km != null ? Number(corridorResult.rows[0].width_km) : 2;
    if (corridorResult.rows[0]?.route_line) {
      const raw = corridorResult.rows[0].route_line;
      const points = typeof raw === 'string' ? safeJson(raw) : raw;
      route = Array.isArray(points) ? points.map(p => ({ lat: Number(p?.lat), lng: Number(p?.lng), name: p?.name || null })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
    }
    if (route.length < 2) {
      const waypoints = await query(`SELECT seq, name, lat, lng FROM convoy_route_waypoints WHERE convoy_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY seq ASC`, [convoyId]);
      route = waypoints.rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lng), name: r.name || null }));
    }

    const membersResult = await query(`
      SELECT d.id, d.name, fo.name AS officer_name,
             cur.lat, cur.lng, cur.heading, cur.speed, cur.accuracy, cur.ts,
             prev.lat AS prev_lat, prev.lng AS prev_lng, prev.ts AS prev_ts
      FROM convoy_cfos cc
      JOIN guardian_devices d ON d.id=cc.guardian_device_id
      LEFT JOIN field_officers fo ON fo.device_id=d.id
      LEFT JOIN LATERAL (SELECT lat, lng, heading, speed, accuracy, timestamp AS ts FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC, id DESC LIMIT 1) cur ON true
      LEFT JOIN LATERAL (SELECT lat, lng, timestamp AS ts FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC, id DESC OFFSET 1 LIMIT 1) prev ON true
      WHERE cc.convoy_id=$1 AND d.deleted_at IS NULL
    `, [convoyId]);

    const members = membersResult.rows.map(row => {
      const lat = row.lat == null ? null : Number(row.lat);
      const lng = row.lng == null ? null : Number(row.lng);
      const previous = row.prev_lat != null && row.prev_lng != null ? { lat: Number(row.prev_lat), lng: Number(row.prev_lng) } : null;
      let world = { state: 'no_confident_estimate', confidence: 0, uncertainty_m: null, reason: 'No position fix' };
      if (lat != null && lng != null) {
        try {
          const observedAt = row.ts || null;
          const elapsedSeconds = previous && observedAt && row.prev_ts ? Math.max(0, (new Date(observedAt).getTime() - new Date(row.prev_ts).getTime()) / 1000) : 0;
          world = reconcileWorldState({ previous, observed: { lat, lng, accuracy_m: row.accuracy == null ? null : Number(row.accuracy), heading: row.heading == null ? null : Number(row.heading) }, route, elapsedSeconds, observedAt, now: Date.now() });
        } catch (_) {}
      }
      return {
        id: row.id, name: row.name, officer_name: row.officer_name || null,
        convoy_name: convoy.name, client_name: convoy.client_name || null,
        observed: lat != null && lng != null ? { lat, lng } : null,
        speed_kph: row.speed == null ? null : Number(row.speed),
        heading: row.heading == null ? null : Number(row.heading),
        observed_at: row.ts || null,
        previous_observed_at: row.prev_ts || null,
        world_state: world.state,
        world_confidence: world.confidence,
        uncertainty_m: world.uncertainty_m,
        world_reason: world.reason,
      };
    });

    const riskResult = await query(`
      SELECT id, name, risk_level, zone_type, lat, lng, radius_km, valid_from, valid_until
      FROM risk_zones
      WHERE active=true AND (org_id=$1 OR org_id IS NULL)
        AND (valid_from IS NULL OR valid_from <= now())
        AND (valid_until IS NULL OR valid_until >= now())
      ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, name
      LIMIT 250
    `, [orgId]);

    const snapshot = {
      as_of: new Date().toISOString(),
      convoy: { id: convoy.id, name: convoy.name, status: convoy.status, client_name: convoy.client_name || null, origin: convoy.route_origin || null, destination: convoy.route_destination || null, departure_time: convoy.departure_time || null, corridor_km: corridorKm },
      route,
      members,
      risk_zones: riskResult.rows.map(z => ({ id: z.id, name: z.name, risk_level: z.risk_level, zone_type: z.zone_type, lat: Number(z.lat), lng: Number(z.lng), radius_km: Number(z.radius_km) })),
      authority: 'canonical server-side convoy, telemetry and risk records; AI output is advisory only',
    };

    const result = await runXdSurveillanceSwarm(snapshot);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

function safeJson(value) {
  try { const parsed = JSON.parse(value); return parsed; } catch (_) { return []; }
}

module.exports = router;
