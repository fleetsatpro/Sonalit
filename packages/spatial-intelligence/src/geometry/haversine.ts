/**
 * Pure spatial geometry helpers for Sonalit spatial-intelligence.
 * No Cesium dependency. Deterministic. Unit-tested.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  pointLat: number,
  pointLon: number,
  radiusM: number,
): boolean {
  if (radiusM < 0) return false;
  return distanceM(centerLat, centerLon, pointLat, pointLon) <= radiusM;
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceMetres: number,
): { latitude: number; longitude: number } {
  const δ = distanceMetres / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return {
    latitude: (φ2 * 180) / Math.PI,
    longitude: ((((λ2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}

export function distanceToPolylineM(
  lat: number,
  lon: number,
  path: [number, number][],
): number {
  if (!path.length) return Infinity;
  if (path.length === 1) {
    const p = path[0]!;
    return distanceM(lat, lon, p[0], p[1]);
  }
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const d = distancePointToSegmentM(lat, lon, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

function distancePointToSegmentM(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const x = (pLon - aLon) * Math.cos(toRad((aLat + pLat) / 2));
  const y = pLat - aLat;
  const dx = (bLon - aLon) * Math.cos(toRad((aLat + bLat) / 2));
  const dy = bLat - aLat;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projLat = aLat + t * (bLat - aLat);
  const projLon = aLon + t * (bLon - aLon);
  return distanceM(pLat, pLon, projLat, projLon);
}

export function bboxFromCenterRadius(
  lat: number,
  lon: number,
  radiusM: number,
): [number, number, number, number] {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon =
    (radiusM / (EARTH_RADIUS_M * Math.cos(toRad(lat)))) * (180 / Math.PI);
  return [
    Math.max(-180, lon - dLon),
    Math.max(-90, lat - dLat),
    Math.min(180, lon + dLon),
    Math.min(90, lat + dLat),
  ];
}
