const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 */
function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Haversine point-to-point distance in kilometres.
 */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Minimum distance from point P to the line segment A→B, in kilometres.
 * Uses spherical projection — accurate for distances < 500 km.
 */
function distanceToSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
  // Convert all to radians
  const pLatR = toRad(pLat), pLngR = toRad(pLng);
  const aLatR = toRad(aLat), aLngR = toRad(aLng);
  const bLatR = toRad(bLat), bLngR = toRad(bLng);

  // Project onto a flat plane centred on A (equirectangular approximation)
  const cosLat = Math.cos((aLatR + bLatR) / 2);

  const ax = 0, ay = 0;
  const bx = (bLngR - aLngR) * cosLat, by = bLatR - aLatR;
  const px = (pLngR - aLngR) * cosLat, py = pLatR - aLatR;

  const segLenSq = bx * bx + by * by;

  let t = 0;
  if (segLenSq > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / segLenSq));
  }

  const closestX = ax + t * (bx - ax);
  const closestY = ay + t * (by - ay);

  // Convert closest point back to lat/lng
  const closestLat = aLat + (closestY * (180 / Math.PI));
  const closestLng = aLng + (closestX / cosLat) * (180 / Math.PI);

  return haversine(pLat, pLng, closestLat, closestLng);
}

module.exports = { haversine, distanceToSegment };
