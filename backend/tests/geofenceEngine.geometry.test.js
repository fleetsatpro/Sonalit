'use strict';

jest.mock('../src/utils/orgScopedDb', () => ({ withOrg: jest.fn() }));
jest.mock('../src/config/redis', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('../src/realtime/centrifugo', () => ({ publish: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { isPointInPolygon, isPointInGeofence } = require('../src/utils/geofenceEngine');

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

  test('circle geofences use their persisted metre radius for containment', () => {
    const fence = { type: 'circle', radius: 5000, coordinates: { lat: -1.2864, lng: 36.8172 } };
    expect(isPointInGeofence(-1.2864, 36.8172, fence)).toBe(true);
    expect(isPointInGeofence(-1.30, 36.8172, fence)).toBe(true);
    expect(isPointInGeofence(-1.35, 36.8172, fence)).toBe(false);
  });

  test('supports GeoJSON Point centre and rejects malformed circle geometry', () => {
    const pointCircle = { type: 'circle', radius: 1500, coordinates: { type: 'Point', coordinates: [36.8172, -1.2864] } };
    expect(isPointInGeofence(-1.2864, 36.8172, pointCircle)).toBe(true);
    expect(isPointInGeofence(-1.31, 36.8172, pointCircle)).toBe(false);
    expect(isPointInGeofence(-1.2864, 36.8172, { type: 'circle', radius: 0, coordinates: { lat: -1.2864, lng: 36.8172 } })).toBe(false);
    expect(isPointInGeofence(-1.2864, 36.8172, { type: 'circle', radius: 1000, coordinates: '{bad json' })).toBe(false);
  });

  test('polygon boundary points count as inside, without changing outside behaviour', () => {
    const polygon = { type: 'Polygon', coordinates: [[[30, -2], [31, -2], [31, -1], [30, -1], [30, -2]]] };
    expect(isPointInGeofence(-1.5, 30, { type: 'polygon', coordinates: polygon })).toBe(true);
    expect(isPointInGeofence(-1.5, 30.5, { type: 'polygon', coordinates: polygon })).toBe(true);
    expect(isPointInGeofence(-3, 30.5, { type: 'polygon', coordinates: polygon })).toBe(false);
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
