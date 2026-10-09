'use strict';

jest.mock('../src/utils/orgScopedDb', () => ({ withOrg: jest.fn() }));
jest.mock('../src/config/redis', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('../src/realtime/centrifugo', () => ({ publish: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { isPointInPolygon } = require('../src/utils/geofenceEngine');

describe('geofence engine corridor-envelope containment', () => {
  const corridor = {
    type: 'corridor',
    // The real centreline for a two-point OSRM route is not a polygon.
    path: [[0, 0], [0, 1]],
    buffer_m: 1000,
    // buildCorridorPolygon stores this custom ring as [lat, lng].
    buffer_polygon: [
      [-0.01, 0],
      [-0.01, 1],
      [0.01, 1],
      [0.01, 0],
      [-0.01, 0],
    ],
  };

  test('uses the stored buffer envelope for a two-point route', () => {
    expect(isPointInPolygon(0.005, 0.5, corridor)).toBe(true);
    expect(isPointInPolygon(0.02, 0.5, corridor)).toBe(false);
  });

  test('keeps ordinary custom [lat, lng] polygon handling intact', () => {
    const polygon = [
      [-2, 30],
      [-2, 31],
      [-1, 31],
      [-1, 30],
      [-2, 30],
    ];
    expect(isPointInPolygon(-1.5, 30.5, polygon)).toBe(true);
    expect(isPointInPolygon(30.5, -1.5, polygon)).toBe(false);
    expect(isPointInPolygon(-3, 30.5, polygon)).toBe(false);
  });

  test('keeps GeoJSON Polygon [lng, lat] handling intact', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[
        [30, -2],
        [31, -2],
        [31, -1],
        [30, -1],
        [30, -2],
      ]],
    };
    expect(isPointInPolygon(-1.5, 30.5, polygon)).toBe(true);
    expect(isPointInPolygon(30.5, -1.5, polygon)).toBe(false);
    expect(isPointInPolygon(-3, 30.5, polygon)).toBe(false);
  });
});
