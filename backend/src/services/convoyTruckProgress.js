'use strict';

const { projectOntoRoute } = require('./geofence/corridor');

const GPS_STALE_AFTER_SECONDS = 15 * 60;
const GPS_FUTURE_TOLERANCE_MS = 2 * 60 * 1000;

function validCoordinatePair(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Parse saved route geometry without silently joining across malformed points.
 * A partial route can create a fictitious straight segment, so one invalid
 * vertex invalidates this route rather than being filtered out.
 */
function routePointList(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value) || value.length < 2) return [];

  const points = value.map(point => ({
    lat: point?.lat == null ? NaN : Number(point.lat),
    lng: point?.lng == null ? NaN : Number(point.lng),
  }));

  return points.every(point => validCoordinatePair(point.lat, point.lng)) ? points : [];
}

/**
 * Convert one authoritative latest GPS observation into UI-safe progress.
 * A percentage is only returned for a valid fix near a usable planned route.
 * Missing, stale, clock-skewed or off-route data never receives a fabricated
 * percentage. The clock is injectable to keep tests deterministic.
 */
function calculateTruckRouteProgress(row, route, nowMs = Date.now()) {
  const vehicleId = row?.vehicle_id ?? null;
  const lat = row?.gps_lat == null ? NaN : Number(row.gps_lat);
  const lng = row?.gps_lng == null ? NaN : Number(row.gps_lng);
  const hasLocation = validCoordinatePair(lat, lng);
  const rawFixDate = row?.last_fix_at == null ? null : new Date(row.last_fix_at);
  const fixDate = rawFixDate && Number.isFinite(rawFixDate.getTime()) ? rawFixDate : null;
  const hasTimestamp = !!fixDate;
  const ageMs = fixDate ? nowMs - fixDate.getTime() : null;
  const futureSkew = ageMs != null && ageMs < -GPS_FUTURE_TOLERANCE_MS;
  const ageSeconds = ageMs == null || futureSkew ? null : Math.max(0, Math.floor(ageMs / 1000));
  const validRoute = route && Array.isArray(route.points) && route.points.length >= 2
    && route.points.every(point => validCoordinatePair(Number(point.lat), Number(point.lng)));
  const corridorKm = Number(route?.corridorKm);
  const allowedCrossTrackKm = Number.isFinite(corridorKm) && corridorKm > 0 && corridorKm <= 50
    ? corridorKm : 2;

  let state = 'no_fix';
  let progressPct = null;
  let alongKm = null;
  let routeLenKm = null;
  let crossTrackKm = null;
  let crossTrackLimitKm = null;

  if (!vehicleId) {
    state = 'unassigned';
  } else if (!hasLocation || !hasTimestamp) {
    state = 'no_fix';
  } else if (futureSkew) {
    state = 'clock_skew';
  } else if (!validRoute) {
    state = 'no_route';
  } else {
    const projected = projectOntoRoute(route.points, lat, lng);
    if (!Number.isFinite(projected.routeLenKm) || projected.routeLenKm <= 0
        || !Number.isFinite(projected.alongKm) || !Number.isFinite(projected.crossTrackKm)) {
      state = 'no_route';
    } else {
      routeLenKm = Math.round(projected.routeLenKm * 100) / 100;
      alongKm = Math.round(projected.alongKm * 100) / 100;
      crossTrackKm = Math.round(projected.crossTrackKm * 100) / 100;
      // A saved corridor is routed geometry and uses its configured width.
      // Waypoint fallback may connect only named stops with straight segments;
      // road curvature can legitimately place a truck farther from those
      // chords. Relax the tolerance proportionally (4% of route length, capped
      // at 25 km) while keeping that result explicitly labelled an estimate.
      const waypointToleranceKm = route.source === 'waypoints'
        ? Math.min(25, projected.routeLenKm * 0.04) : 0;
      crossTrackLimitKm = Math.round(Math.max(allowedCrossTrackKm, waypointToleranceKm) * 100) / 100;
      if (projected.crossTrackKm > crossTrackLimitKm) {
        state = 'off_route';
        // Preserve measured distance diagnostics, but do not imply route
        // completion for a GPS point outside the accepted geometry tolerance.
      } else {
        progressPct = Math.max(0, Math.min(100,
          Math.round((projected.alongKm / projected.routeLenKm) * 100)));
        state = ageSeconds > GPS_STALE_AFTER_SECONDS ? 'stale' : 'live';
      }
    }
  }

  const speed = row?.speed_kph == null ? null : Number(row.speed_kph);
  return {
    state,
    progress_pct: progressPct,
    along_km: alongKm,
    route_len_km: routeLenKm,
    cross_track_km: crossTrackKm,
    cross_track_limit_km: crossTrackLimitKm,
    route_source: routeLenKm != null && routeLenKm > 0
      ? (route.source === 'waypoints' ? 'waypoints' : 'corridor') : null,
    last_fix_at: fixDate ? fixDate.toISOString() : null,
    age_seconds: ageSeconds,
    speed_kph: Number.isFinite(speed) && speed >= 0 ? speed : null,
  };
}

module.exports = {
  GPS_STALE_AFTER_SECONDS,
  GPS_FUTURE_TOLERANCE_MS,
  routePointList,
  calculateTruckRouteProgress,
};
