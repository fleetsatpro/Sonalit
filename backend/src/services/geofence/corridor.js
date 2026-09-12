'use strict';

/**
 * 4D geofence — a route corridor with a time dimension.
 *
 * A normal geofence is a static shape: inside or outside. A convoy needs more —
 * a truck can be exactly on the road and still be wrong, because it's an hour
 * behind, or stopped, or has raced ahead of its escort. So the "fence" here is
 * the planned route swept over time: the 4th dimension is WHERE the convoy
 * should be BY NOW.
 *
 * Two independent checks per device:
 *   - space: cross-track distance from the route polyline (off the corridor?)
 *   - time:  how far along the route it actually is vs how far it SHOULD be by
 *            now (elapsed x expected speed). Behind = a stop/detour/delay;
 *            ahead = it outran its protection.
 *
 * Pure and planar-approximated (equirectangular around the route's start —
 * accurate to well under a percent over convoy-scale distances), so it's
 * deterministic and unit-testable with no DB, clock, or map library.
 */

const R_KM = 6371;
const RAD = Math.PI / 180;

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * RAD, dLng = (bLng - aLng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Local flat projection (km) anchored at (lat0, lng0).
function toXY(lat, lng, lat0, lng0) {
  return { x: (lng - lng0) * Math.cos(lat0 * RAD) * RAD * R_KM, y: (lat - lat0) * RAD * R_KM };
}

/**
 * Nearest point on the route polyline to (lat,lng): its perpendicular
 * ("cross-track") distance in km and how far along the route that nearest point
 * sits (km from the start).
 * @param {Array<{lat:number,lng:number}>} route ordered waypoints
 */
function projectOntoRoute(route, lat, lng) {
  if (!route || route.length === 0) return { crossTrackKm: Infinity, alongKm: 0, routeLenKm: 0 };
  const lat0 = route[0].lat, lng0 = route[0].lng;
  const pts = route.map(w => toXY(w.lat, w.lng, lat0, lng0));
  const P = toXY(lat, lng, lat0, lng0);

  if (pts.length === 1) {
    return { crossTrackKm: Math.hypot(P.x - pts[0].x, P.y - pts[0].y), alongKm: 0, routeLenKm: 0 };
  }

  let cum = 0, best = { crossTrackKm: Infinity, alongKm: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B.x - A.x, dy = B.y - A.y;
    const segLen = Math.hypot(dx, dy);
    let t = 0;
    if (segLen > 0) t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / (segLen * segLen)));
    const cx = A.x + t * dx, cy = A.y + t * dy;
    const d = Math.hypot(P.x - cx, P.y - cy);
    if (d < best.crossTrackKm) best = { crossTrackKm: d, alongKm: cum + t * segLen };
    cum += segLen;
  }
  return { crossTrackKm: best.crossTrackKm, alongKm: best.alongKm, routeLenKm: cum };
}

/**
 * Evaluate one device against the 4D corridor.
 * @param {object} p
 * @param {Array<{lat,lng}>} p.route planned waypoints
 * @param {number} p.lat @param {number} p.lng device position
 * @param {number} p.elapsedMs time since the convoy departed
 * @param {number} [p.avgSpeedKmh=45] expected average progress speed
 * @param {number} [p.corridorKm=2] allowed distance off the route line
 * @param {number} [p.scheduleTolKm=8] allowed schedule slip before flagged
 */
function evaluateCorridor(p) {
  const avgSpeedKmh = p.avgSpeedKmh ?? 45;
  const corridorKm = p.corridorKm ?? 2;
  const scheduleTolKm = p.scheduleTolKm ?? 8;

  const proj = projectOntoRoute(p.route, p.lat, p.lng);
  const expectedAlongKm = Math.max(0, Math.min(proj.routeLenKm,
    (Math.max(0, p.elapsedMs) / 3600000) * avgSpeedKmh));
  const scheduleDeltaKm = proj.alongKm - expectedAlongKm; // + ahead, - behind

  let status, severity;
  if (proj.crossTrackKm > corridorKm) { status = 'off_route'; severity = 'high'; }
  else if (scheduleDeltaKm < -scheduleTolKm) { status = 'behind'; severity = 'medium'; }
  else if (scheduleDeltaKm > scheduleTolKm) { status = 'ahead'; severity = 'low'; }
  else { status = 'on_track'; severity = 'ok'; }

  return {
    status, severity,
    cross_track_km: round(proj.crossTrackKm),
    along_km: round(proj.alongKm),
    expected_along_km: round(expectedAlongKm),
    schedule_delta_km: round(scheduleDeltaKm),
    // Minutes ahead(+)/behind(-) at the expected pace.
    schedule_delta_min: avgSpeedKmh > 0 ? Math.round((scheduleDeltaKm / avgSpeedKmh) * 60) : 0,
    route_len_km: round(proj.routeLenKm),
  };
}

function round(n) { return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }

module.exports = { evaluateCorridor, projectOntoRoute, haversineKm };
