'use strict';

const { evaluateCorridor, projectOntoRoute, haversineKm } = require('../geofence/corridor');

const RAD = Math.PI / 180;

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bearingDeg(fromLat, fromLng, toLat, toLng) {
  const phi1 = fromLat * RAD;
  const phi2 = toLat * RAD;
  const dl = (toLng - fromLng) * RAD;
  const y = Math.sin(dl) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angularDelta(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function relativeDirectionFromHeading(heading, targetBearing) {
  if (heading == null || targetBearing == null) return 'unknown';
  const d = angularDelta(targetBearing, heading);
  if (Math.abs(d) <= 20) return 'ahead';
  if (Math.abs(d) >= 160) return 'behind';
  return d < 0 ? 'left' : 'right';
}

function isApproaching(currentDistanceM, previousDistanceM, toleranceM = 50) {
  if (!Number.isFinite(currentDistanceM) || !Number.isFinite(previousDistanceM)) return null;
  if (currentDistanceM < previousDistanceM - toleranceM) return true;
  if (currentDistanceM > previousDistanceM + toleranceM) return false;
  return null;
}

function routeRelation(position, route, corridorKm, scheduleTolKm, elapsedMs, avgSpeedKmh) {
  if (!position || !route || route.length < 2) {
    return { relation: 'UNKNOWN', spatialState: 'UNKNOWN', scheduleState: 'UNKNOWN', evidence: [], projection: null };
  }

  const verdict = evaluateCorridor({
    route,
    lat: position.lat,
    lng: position.lng,
    elapsedMs,
    avgSpeedKmh,
    corridorKm,
    scheduleTolKm,
  });

  const spatialState = verdict.status === 'off_route' ? 'OFF_ROUTE' : 'ON_ROUTE';
  const scheduleState = verdict.status === 'behind'
    ? 'BEHIND_SCHEDULE'
    : verdict.status === 'ahead'
      ? 'AHEAD_OF_SCHEDULE'
      : 'ON_SCHEDULE';

  return {
    relation: spatialState,
    spatialState,
    scheduleState,
    evidence: {
      cross_track_km: verdict.cross_track_km,
      along_km: verdict.along_km,
      expected_along_km: verdict.expected_along_km,
      schedule_delta_km: verdict.schedule_delta_km,
      schedule_delta_min: verdict.schedule_delta_min,
      route_len_km: verdict.route_len_km,
      corridor_km: corridorKm,
    },
    projection: projectOntoRoute(route, position.lat, position.lng),
  };
}

function circleRelation(point, zone) {
  const lat = num(point?.lat);
  const lng = num(point?.lng);
  const zLat = num(zone?.lat);
  const zLng = num(zone?.lng);
  const radiusM = Math.max(0, (num(zone?.radius_km) ?? 0) * 1000);
  if (lat == null || lng == null || zLat == null || zLng == null) {
    return { inside: false, distanceM: null, boundaryDistanceM: null };
  }
  const distanceM = haversineKm(lat, lng, zLat, zLng) * 1000;
  return {
    inside: distanceM <= radiusM,
    distanceM: Math.round(distanceM),
    boundaryDistanceM: Math.round(Math.abs(distanceM - radiusM)),
    radiusM,
  };
}

function contextRelevance({
  distanceM,
  severity,
  freshnessClass,
  sourceQuality,
  routeDistanceM,
  ahead,
  missionActive = true,
}) {
  const d = Number.isFinite(distanceM) ? Math.max(0, distanceM) : Infinity;
  const distanceScore = d === Infinity ? 0 : Math.max(0, 1 - d / 50_000);
  const routeScore = Number.isFinite(routeDistanceM)
    ? Math.max(0, 1 - Math.max(0, routeDistanceM) / 50_000)
    : 0;
  const severityScore = {
    critical: 1,
    high: 0.8,
    medium: 0.55,
    low: 0.3,
    info: 0.1,
  }[String(severity || '').toLowerCase()] ?? 0.2;
  const freshnessScore = {
    LIVE: 1,
    DELAYED: 0.75,
    STALE: 0.25,
    PARTIAL: 0.4,
    UNKNOWN: 0.2,
    UNAVAILABLE: 0,
  }[freshnessClass] ?? 0.2;
  const sourceScore = Number.isFinite(sourceQuality) ? Math.max(0, Math.min(1, sourceQuality)) : 0.5;
  const directionScore = ahead === true ? 1 : ahead === false ? 0.4 : 0.6;
  const missionScore = missionActive ? 1 : 0.5;

  const score = distanceScore * 0.22 +
    routeScore * 0.25 +
    severityScore * 0.16 +
    freshnessScore * 0.14 +
    sourceScore * 0.08 +
    directionScore * 0.10 +
    missionScore * 0.05;

  return {
    score: Math.round(score * 1000) / 1000,
    components: {
      distance: Math.round(distanceScore * 1000) / 1000,
      route: Math.round(routeScore * 1000) / 1000,
      severity: Math.round(severityScore * 1000) / 1000,
      freshness: Math.round(freshnessScore * 1000) / 1000,
      source: Math.round(sourceScore * 1000) / 1000,
      direction: Math.round(directionScore * 1000) / 1000,
      mission: Math.round(missionScore * 1000) / 1000,
    },
  };
}

module.exports = {
  bearingDeg,
  angularDelta,
  relativeDirectionFromHeading,
  isApproaching,
  routeRelation,
  circleRelation,
  contextRelevance,
};
