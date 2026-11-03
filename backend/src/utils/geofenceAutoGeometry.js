'use strict';

const { normalizePolygonGeometry } = require('./geofenceGeometry');

const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_POLYGON_SEGMENTS = 48;
const MIN_POLYGON_SEGMENTS = 16;
const MAX_POLYGON_SEGMENTS = 96;
const MAX_BOUNDARY_VERTICES = 500;

function assertCenter(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError('A geofence needs finite centre coordinates.');
  }
  if (Math.abs(latitude) > 85 || Math.abs(longitude) > 180) {
    throw new RangeError('Polygon centre is outside the supported map bounds.');
  }
}

function destinationPoint(latitude, longitude, radiusM, bearingRad) {
  const angularDistance = radiusM / EARTH_RADIUS_M;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);
  const lat2 = Math.asin(
    sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearingRad),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * sinAngular * cosLat1,
    cosAngular - sinLat1 * Math.sin(lat2),
  );
  const lng = ((lon2 * 180 / Math.PI + 540) % 360) - 180;
  const lat = lat2 * 180 / Math.PI;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85) {
    throw new RangeError('Generated polygon crosses the supported latitude bounds.');
  }
  return [lng, lat];
}

/**
 * A bounded regular-polygon approximation to a geodesic radius buffer.
 * This is deliberately not described as an official administrative boundary.
 */
function createRadiusPolygon(latitude, longitude, radiusM, segments = DEFAULT_POLYGON_SEGMENTS) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const radius = Number(radiusM);
  const count = Number(segments);
  assertCenter(lat, lng);
  if (!Number.isFinite(radius) || radius < 10 || radius > 100000) {
    throw new RangeError('Polygon radius must be between 10 and 100000 metres.');
  }
  if (!Number.isInteger(count) || count < MIN_POLYGON_SEGMENTS || count > MAX_POLYGON_SEGMENTS) {
    throw new RangeError('Polygon segments must be between ' + MIN_POLYGON_SEGMENTS + ' and ' + MAX_POLYGON_SEGMENTS + '.');
  }

  const ring = [];
  for (let i = 0; i < count; i += 1) {
    ring.push(destinationPoint(lat, lng, radius, (2 * Math.PI * i) / count));
  }
  ring.push([...ring[0]]);
  return normalizePolygonGeometry({ type: 'Polygon', coordinates: [ring] });
}

/**
 * Accept one bounded OSM Polygon ring only. Do not silently discard holes,
 * disconnected MultiPolygon components, or detailed boundaries.
 */
function normalizeBoundaryGeometry(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    throw new TypeError('The source did not return one administrative Polygon.');
  }
  if (geometry.coordinates.length !== 1) {
    throw new RangeError('This administrative boundary contains holes or multiple rings and cannot be safely simplified automatically.');
  }
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > MAX_BOUNDARY_VERTICES + 1) {
    throw new RangeError('Administrative boundary must contain at least 3 and no more than ' + MAX_BOUNDARY_VERTICES + ' vertices.');
  }
  return normalizePolygonGeometry(geometry);
}

module.exports = {
  DEFAULT_POLYGON_SEGMENTS,
  MAX_BOUNDARY_VERTICES,
  createRadiusPolygon,
  normalizeBoundaryGeometry,
};
