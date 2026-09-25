'use strict';

const EARTH_R_M = 6371000;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function validLatLon(lat, lon) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
    Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
}

function toRad(v) { return Number(v) * Math.PI / 180; }
function toDeg(v) { return Number(v) * 180 / Math.PI; }

function haversineM(a, b) {
  const p1 = toRad(a.latitude), p2 = toRad(b.latitude);
  const dp = p2 - p1;
  const dl = toRad(b.longitude - a.longitude);
  const h = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(clamp(h,0,1)));
}

function bearingDeg(a, b) {
  const p1 = toRad(a.latitude), p2 = toRad(b.latitude);
  const dl = toRad(b.longitude - a.longitude);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (toDeg(Math.atan2(y,x)) + 360) % 360;
}

function angularDeltaDeg(a, b) {
  return Math.abs(((Number(b) - Number(a) + 540) % 360) - 180);
}

function normaliseCamera(camera) {
  if (!camera || !camera.pose || !validLatLon(camera.pose.latitude, camera.pose.longitude)) return null;
  const heading = camera.pose.headingDeg == null ? null : ((Number(camera.pose.headingDeg) % 360) + 360) % 360;
  const fov = clamp(Number(camera.viewshed?.horizontalFovDeg) || 90, 1, 180);
  const range = Math.max(1, Number(camera.viewshed?.maxRangeM) || 5000);
  const minRange = clamp(Number(camera.viewshed?.minRangeM) || 0, 0, range);
  return {
    ...camera,
    pose: { ...camera.pose, latitude: Number(camera.pose.latitude), longitude: Number(camera.pose.longitude), headingDeg: heading },
    viewshed: { ...camera.viewshed, horizontalFovDeg: fov, maxRangeM: range, minRangeM: minRange },
  };
}

function pointInViewshed(camera, target) {
  const cam = normaliseCamera(camera);
  if (!cam || !target || !validLatLon(target.latitude, target.longitude)) return {
    visible: false, reason: 'invalid_geometry', distanceM: null, bearingDeg: null
  };
  const distanceM = haversineM(cam.pose, target);
  if (distanceM < cam.viewshed.minRangeM) return {
    visible: false, reason: 'inside_min_range', distanceM, bearingDeg: bearingDeg(cam.pose, target)
  };
  if (distanceM > cam.viewshed.maxRangeM) return {
    visible: false, reason: 'outside_max_range', distanceM, bearingDeg: bearingDeg(cam.pose, target)
  };
  if (cam.pose.headingDeg == null) return {
    visible: false, reason: 'heading_unknown', distanceM, bearingDeg: bearingDeg(cam.pose, target)
  };
  const targetBearing = bearingDeg(cam.pose, target);
  const delta = angularDeltaDeg(cam.pose.headingDeg, targetBearing);
  const visible = delta <= cam.viewshed.horizontalFovDeg / 2;
  return {
    visible,
    reason: visible ? 'inside_viewshed' : 'outside_horizontal_fov',
    distanceM,
    bearingDeg: targetBearing,
    angularOffsetDeg: delta
  };
}

function buildViewshedPolygon(camera, samples = 16) {
  const cam = normaliseCamera(camera);
  if (!cam || cam.pose.headingDeg == null) return [];
  const count = clamp(Number(samples) || 16, 4, 64);
  const start = cam.pose.headingDeg - cam.viewshed.horizontalFovDeg / 2;
  const points = [[cam.pose.longitude, cam.pose.latitude]];
  for (let i = 0; i <= count; i++) {
    const brg = start + cam.viewshed.horizontalFovDeg * (i / count);
    const d = cam.viewshed.maxRangeM;
    const lat1 = toRad(cam.pose.latitude), lon1 = toRad(cam.pose.longitude), br = toRad(brg);
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d/EARTH_R_M) +
      Math.cos(lat1)*Math.sin(d/EARTH_R_M)*Math.cos(br));
    const lon2 = lon1 + Math.atan2(
      Math.sin(br)*Math.sin(d/EARTH_R_M)*Math.cos(lat1),
      Math.cos(d/EARTH_R_M)-Math.sin(lat1)*Math.sin(lat2)
    );
    points.push([toDeg(lon2), toDeg(lat2)]);
  }
  points.push([cam.pose.longitude, cam.pose.latitude]);
  return points;
}

function rankNearest(cameras, target, limit = 5, requireVisible = false) {
  return (Array.isArray(cameras) ? cameras : [])
    .map(camera => {
      const relation = pointInViewshed(camera, target);
      return { camera, relation };
    })
    .filter(x => !requireVisible || x.relation.visible)
    .sort((a,b) => (a.relation.distanceM ?? Infinity) - (b.relation.distanceM ?? Infinity))
    .slice(0, Math.max(1, Number(limit) || 5));
}

module.exports = { haversineM, bearingDeg, angularDeltaDeg, normaliseCamera, pointInViewshed, buildViewshedPolygon, rankNearest };
