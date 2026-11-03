'use strict';

const {
  createRadiusPolygon,
  DEFAULT_POLYGON_SEGMENTS,
  normalizeBoundaryGeometry,
} = require('../src/utils/geofenceAutoGeometry');

function distanceM(a, b) {
  const radius = 6371008.8;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

describe('autonomous geofence polygon geometry', () => {
  test('creates a closed, valid 48-vertex radius polygon by default', () => {
    const polygon = createRadiusPolygon(-1.2864, 36.8172, 2000);
    const ring = polygon.coordinates[0];
    expect(polygon.type).toBe('Polygon');
    expect(ring).toHaveLength(DEFAULT_POLYGON_SEGMENTS + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const vertex of ring.slice(0, -1)) {
      expect(distanceM([36.8172, -1.2864], vertex)).toBeCloseTo(2000, -1);
    }
  });

  test('rejects non-finite centres, unsupported bounds, and unsafe radii/segment counts', () => {
    expect(() => createRadiusPolygon(NaN, 36.8, 2000)).toThrow(/finite centre/);
    expect(() => createRadiusPolygon(86, 36.8, 2000)).toThrow(/supported map bounds/);
    expect(() => createRadiusPolygon(-1.2, 36.8, 9)).toThrow(/between 10 and 100000/);
    expect(() => createRadiusPolygon(-1.2, 36.8, 2000, 8)).toThrow(/segments must be between/);
  });

  test('normalizes a supported single-ring source boundary', () => {
    const geometry = normalizeBoundaryGeometry({
      type: 'Polygon',
      coordinates: [[[36.7, -1.3], [36.9, -1.3], [36.9, -1.45], [36.7, -1.45]]],
    });
    expect(geometry.coordinates[0]).toHaveLength(5);
    expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0][4]);
  });

  test('fails closed for multipolygons, holes, oversized boundaries and invalid rings', () => {
    const ring = [[36.7, -1.3], [36.9, -1.3], [36.9, -1.45], [36.7, -1.45]];
    expect(() => normalizeBoundaryGeometry({ type: 'MultiPolygon', coordinates: [] })).toThrow(/administrative Polygon/);
    expect(() => normalizeBoundaryGeometry({ type: 'Polygon', coordinates: [ring, ring] })).toThrow(/holes or multiple rings/);
    expect(() => normalizeBoundaryGeometry({
      type: 'Polygon',
      coordinates: [Array.from({ length: 502 }, (_, i) => [36 + i * 0.0001, -1.3])],
    })).toThrow(/no more than/);
    expect(() => normalizeBoundaryGeometry({
      type: 'Polygon',
      coordinates: [[[36, -1], [37, -2], [36, -2], [37, -1], [36, -1]]],
    })).toThrow(/self-intersects/);
  });
});
