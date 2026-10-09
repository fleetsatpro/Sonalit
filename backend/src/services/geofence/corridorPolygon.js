'use strict';

/**
 * Build a corridor envelope around a [latitude, longitude] route centreline.
 *
 * Geometry is calculated in a local metric plane, then returned in Sonalit's
 * persisted [lat, lng] order. Miter distance is computed against the segment
 * normal (not its tangent), keeping straight-route half-width equal to the
 * requested buffer and limiting acute-corner spikes.
 */
const EARTH_RADIUS_M = 6371008.8;
const MAX_MITER_RATIO = 2.5;

function buildCorridorPolygon(path, bufferM) {
  if (!Array.isArray(path) || path.length < 2) return null;
  if (!Number.isFinite(Number(bufferM)) || Number(bufferM) <= 0) return null;

  const normalized = [];
  for (const point of path) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lat = Number(point[0]);
    const lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const previous = normalized[normalized.length - 1];
    if (!previous || previous[0] !== lat || previous[1] !== lng) {
      normalized.push([lat, lng]);
    }
  }
  if (normalized.length < 2) return null;

  const latitudeOrigin = normalized.reduce((sum, p) => sum + p[0], 0) / normalized.length;
  const cosine = Math.cos(latitudeOrigin * Math.PI / 180);
  // Equirectangular local projection becomes ill-conditioned near the poles.
  if (Math.abs(cosine) < 0.05) return null;

  const toXY = ([lat, lng]) => [
    EARTH_RADIUS_M * cosine * lng * Math.PI / 180,
    EARTH_RADIUS_M * lat * Math.PI / 180,
  ];
  const toLatLng = ([x, y]) => [
    y / EARTH_RADIUS_M * 180 / Math.PI,
    x / (EARTH_RADIUS_M * cosine) * 180 / Math.PI,
  ];
  const xy = normalized.map(toXY);

  const unit = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    return length > 1e-6 ? [dx / length, dy / length] : null;
  };
  const normals = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const direction = unit(xy[i], xy[i + 1]);
    if (!direction) return null;
    normals.push([-direction[1], direction[0]]);
  }

  const left = [];
  const right = [];
  const width = Number(bufferM);
  for (let i = 0; i < xy.length; i++) {
    let nx, ny, distance = width;
    if (i === 0) {
      [nx, ny] = normals[0];
    } else if (i === xy.length - 1) {
      [nx, ny] = normals[normals.length - 1];
    } else {
      const previousNormal = normals[i - 1];
      const nextNormal = normals[i];
      nx = previousNormal[0] + nextNormal[0];
      ny = previousNormal[1] + nextNormal[1];
      const norm = Math.hypot(nx, ny);

      // A near 180-degree reversal has no stable bisector; bevel at this
      // vertex using the outgoing normal rather than producing NaN/infinity.
      if (norm < 1e-8) {
        [nx, ny] = nextNormal;
      } else {
        nx /= norm;
        ny /= norm;
      }

      // The miter projection is onto the next segment's NORMAL. Dotting the
      // miter with its tangent (the former calculation) approaches zero on a
      // straight line and silently inflated a 300m corridor to 750m.
      const dot = Math.abs(nx * nextNormal[0] + ny * nextNormal[1]);
      distance = Math.min(width * MAX_MITER_RATIO, width / Math.max(1e-6, dot));
      distance = Math.max(width, distance);
    }

    left.push([xy[i][0] + nx * distance, xy[i][1] + ny * distance]);
    right.push([xy[i][0] - nx * distance, xy[i][1] - ny * distance]);
  }

  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return ring.map(toLatLng);
}

module.exports = { buildCorridorPolygon };
