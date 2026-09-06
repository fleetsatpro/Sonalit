/**
 * S2-F1 Geofence Engine
 * Evaluates a GPS fix against org geofences and convoy route corridors.
 * All DB writes go through withOrg() per RULE C.
 */
const { distanceToSegment, haversine } = require('./haversine');
const { withOrg } = require('./orgScopedDb');
const { getRedis } = require('../config/redis');
const { publish } = require('../realtime/centrifugo');
const logger = require('./logger');

// ── In-memory geofence cache (60s per org) ───────────────────────────────────
const _fenceCache = new Map(); // orgId → { ts, fences }

async function loadGeofences(orgId) {
  const cached = _fenceCache.get(orgId);
  if (cached && Date.now() - cached.ts < 60_000) return cached.fences;

  const fences = await withOrg(orgId, async (db) => {
    const r = await db.query(
      `SELECT id, name, type, coordinates, active,
              corridor_width_km, active_from_time, active_to_time,
              days_of_week, checkpoint_order, dwell_alert_min
         FROM geofences
        WHERE active = true`,
    );
    return r.rows;
  });

  _fenceCache.set(orgId, { ts: Date.now(), fences });
  return fences;
}

// ── isGeofenceActiveNow ───────────────────────────────────────────────────────
function isGeofenceActiveNow(fence) {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun

  if (fence.days_of_week && fence.days_of_week.length > 0) {
    if (!fence.days_of_week.includes(dayOfWeek)) return false;
  }

  if (fence.active_from_time && fence.active_to_time) {
    const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    if (hhmm < fence.active_from_time || hhmm > fence.active_to_time) return false;
  }

  return true;
}

// ── isPointInPolygon (ray casting, GeoJSON coordinates or custom path) ────────
function extractRing(coordinates) {
  if (!coordinates) return null;
  const c = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
  // GeoJSON Polygon: { type: 'Polygon', coordinates: [[[lng, lat], ...]] }
  if (c?.type === 'Polygon' && Array.isArray(c.coordinates?.[0])) {
    return c.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
  }
  // Custom array format: [[lat, lng], ...]
  if (Array.isArray(c?.path)) return c.path.map(([lat, lng]) => ({ lat, lng }));
  if (Array.isArray(c) && Array.isArray(c[0])) return c.map(([lat, lng]) => ({ lat, lng }));
  return null;
}

function isPointInPolygon(lat, lng, coordinates) {
  const ring = extractRing(coordinates);
  if (!ring || ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── isPointInCorridor ─────────────────────────────────────────────────────────
function isPointInCorridor(lat, lng, routeLine, widthKm) {
  if (!routeLine || routeLine.length < 2) return { inside: false, deviationKm: Infinity };

  let minDist = Infinity;
  for (let i = 0; i < routeLine.length - 1; i++) {
    const a = routeLine[i], b = routeLine[i + 1];
    const d = distanceToSegment(lat, lng, a.lat, a.lng, b.lat, b.lng);
    if (d < minDist) minDist = d;
  }

  return { inside: minDist <= widthKm, deviationKm: minDist };
}

// ── Redis helpers (graceful fallback if Redis unavailable) ────────────────────
async function redisGet(key) {
  try { return await getRedis()?.get(key); } catch (_) { return null; }
}
async function redisSet(key, value, ttlSec) {
  try { await getRedis()?.set(key, value, 'EX', ttlSec); } catch (_) {}
}
async function redisDel(key) {
  try { await getRedis()?.del(key); } catch (_) {}
}

// ── insertGeofenceEvent ───────────────────────────────────────────────────────
async function insertGeofenceEvent(orgId, eventData) {
  await withOrg(orgId, async (db) => {
    await db.query(
      `INSERT INTO geofence_events
         (org_id, geofence_id, vehicle_id, device_id, convoy_id,
          event_type, location, dwell_minutes, deviation_km)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        orgId, eventData.geofence_id ?? null, eventData.vehicle_id ?? null,
        eventData.device_id ?? null, eventData.convoy_id ?? null,
        eventData.event_type,
        JSON.stringify({ lat: eventData.lat, lng: eventData.lng }),
        eventData.dwell_minutes ?? null,
        eventData.deviation_km ?? null,
      ],
    );
  });
}

// ── loadConvoyCorridor ────────────────────────────────────────────────────────
async function loadConvoyCorridor(orgId, convoyId) {
  if (!convoyId) return null;
  try {
    const result = await withOrg(orgId, async (db) => db.query(
      `SELECT route_line, width_km FROM convoy_route_corridors
        WHERE convoy_id = $1 AND active = true`,
      [convoyId],
    ));
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const routeLine = typeof row.route_line === 'string'
      ? JSON.parse(row.route_line) : row.route_line;
    return { routeLine, widthKm: parseFloat(row.width_km) };
  } catch (_) { return null; }
}

// ── enqueueAlert ─────────────────────────────────────────────────────────────
async function enqueueAlert(type, severity, message, vehicleId, convoyId) {
  try {
    const { getQueues } = require('../config/queue');
    const { alertQueue } = getQueues();
    if (alertQueue) {
      await alertQueue.add('geofence-alert', { vehicle_id: vehicleId, convoy_id: convoyId, type, severity, message });
    }
  } catch (_) {}
}

// ── Main evaluation function ──────────────────────────────────────────────────
async function evaluateVehiclePosition(orgId, vehicleId, deviceId, convoyId, fix) {
  const { lat, lng } = fix;

  // 1. Load and filter active geofences
  let fences = [];
  try { fences = await loadGeofences(orgId); } catch (_) {}

  for (const fence of fences) {
    if (!isGeofenceActiveNow(fence)) continue;

    const stateKey = `geo:state:${orgId}:${vehicleId}:${fence.id}`;
    const dwellKey = `geo:dwell:${orgId}:${vehicleId}:${fence.id}`;

    const inPolygon = isPointInPolygon(lat, lng, fence.coordinates);
    const prevState = await redisGet(stateKey); // 'in' | 'out' | null

    if (inPolygon && prevState !== 'in') {
      // Enter event
      await redisSet(stateKey, 'in', 3600);
      await redisSet(dwellKey, String(Date.now()), 3600);

      const eventType = fence.checkpoint_order != null ? 'checkpoint_signin' : 'enter';
      try {
        await insertGeofenceEvent(orgId, {
          geofence_id: fence.id, vehicle_id: vehicleId, device_id: deviceId,
          convoy_id: convoyId, event_type: eventType, lat, lng,
        });
        publish(`org#${orgId}`, { type: 'geofence:event', event_type: eventType, geofence_id: fence.id, vehicle_id: vehicleId });
      } catch (e) { logger.warn(`geofenceEngine enter event failed: ${e.message}`); }

    } else if (!inPolygon && prevState === 'in') {
      // Exit event
      await redisSet(stateKey, 'out', 3600);
      const enteredAt = await redisGet(dwellKey);
      await redisDel(dwellKey);

      try {
        await insertGeofenceEvent(orgId, {
          geofence_id: fence.id, vehicle_id: vehicleId, device_id: deviceId,
          convoy_id: convoyId, event_type: 'exit', lat, lng,
        });
        publish(`org#${orgId}`, { type: 'geofence:event', event_type: 'exit', geofence_id: fence.id, vehicle_id: vehicleId });
      } catch (e) { logger.warn(`geofenceEngine exit event failed: ${e.message}`); }

      // Dwell check on exit
      if (fence.dwell_alert_min && enteredAt) {
        const dwellMs = Date.now() - parseInt(enteredAt);
        const dwellMin = dwellMs / 60000;
        if (dwellMin >= fence.dwell_alert_min) {
          try {
            await insertGeofenceEvent(orgId, {
              geofence_id: fence.id, vehicle_id: vehicleId, device_id: deviceId,
              convoy_id: convoyId, event_type: 'dwell_exceeded',
              lat, lng, dwell_minutes: parseFloat(dwellMin.toFixed(1)),
            });
            await enqueueAlert('dwell_exceeded', 'warning',
              `Vehicle ${vehicleId} dwelled ${dwellMin.toFixed(0)} min in "${fence.name}"`,
              vehicleId, convoyId);
          } catch (e) { logger.warn(`geofenceEngine dwell event failed: ${e.message}`); }
        }
      }

    } else if (!inPolygon) {
      await redisSet(stateKey, 'out', 3600);
    }
  }

  // 2. Corridor check
  if (convoyId) {
    try {
      const corridor = await loadConvoyCorridor(orgId, convoyId);
      if (corridor) {
        const { inside, deviationKm } = isPointInCorridor(lat, lng, corridor.routeLine, corridor.widthKm);
        if (!inside) {
          const deviationRatio = deviationKm / corridor.widthKm;
          const severity = deviationRatio >= 4 ? 'critical' : 'high';

          try {
            await insertGeofenceEvent(orgId, {
              vehicle_id: vehicleId, device_id: deviceId, convoy_id: convoyId,
              event_type: 'route_deviation', lat, lng,
              deviation_km: parseFloat(deviationKm.toFixed(3)),
            });
            publish(`org#${orgId}`, {
              type: 'geofence:event', event_type: 'route_deviation',
              convoy_id: convoyId, vehicle_id: vehicleId,
              deviation_km: deviationKm,
            });
            await enqueueAlert('route_deviation', severity,
              `Vehicle ${vehicleId} is ${deviationKm.toFixed(1)} km off convoy corridor`,
              vehicleId, convoyId);
          } catch (e) { logger.warn(`geofenceEngine corridor event failed: ${e.message}`); }
        }
      }
    } catch (e) { logger.warn(`geofenceEngine corridor check failed: ${e.message}`); }
  }
}

// ── Invalidate cache when geofences change ────────────────────────────────────
function invalidateGeofenceCache(orgId) {
  if (orgId) _fenceCache.delete(orgId);
  else _fenceCache.clear();
}

module.exports = {
  isPointInPolygon,
  isPointInCorridor,
  isGeofenceActiveNow,
  evaluateVehiclePosition,
  invalidateGeofenceCache,
};
