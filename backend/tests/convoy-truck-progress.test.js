'use strict';

const {
  GPS_STALE_AFTER_SECONDS,
  GPS_FUTURE_TOLERANCE_MS,
  routePointList,
  calculateTruckRouteProgress,
} = require('../src/services/convoyTruckProgress');

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const ROUTE = { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], corridorKm: 2 };
const base = {
  vehicle_id: 'vehicle-1',
  gps_lat: 0,
  gps_lng: 0.5,
  last_fix_at: new Date(NOW - 30_000).toISOString(),
  speed_kph: 42,
};

describe('routePointList', () => {
  test('parses both JSON text and JSON arrays', () => {
    expect(routePointList('[{"lat":0,"lng":0},{"lat":0,"lng":1}]')).toEqual(ROUTE.points);
    expect(routePointList(ROUTE.points)).toEqual(ROUTE.points);
  });

  test('rejects malformed geometry instead of joining across invalid points', () => {
    expect(routePointList('[{"lat":0,"lng":0},{"lat":"bad","lng":0.5},{"lat":0,"lng":1}]')).toEqual([]);
    expect(routePointList('not-json')).toEqual([]);
    expect(routePointList([{ lat: 91, lng: 0 }, { lat: 0, lng: 1 }])).toEqual([]);
    expect(routePointList([{ lat: 0, lng: 0 }])).toEqual([]);
  });
});

describe('calculateTruckRouteProgress', () => {
  test('calculates a route percentage from a real, fresh GPS fix', () => {
    const result = calculateTruckRouteProgress(base, ROUTE, NOW);
    expect(result.state).toBe('live');
    expect(result.progress_pct).toBeGreaterThanOrEqual(49);
    expect(result.progress_pct).toBeLessThanOrEqual(51);
    expect(result.along_km).toBeGreaterThan(50);
    expect(result.route_len_km).toBeGreaterThan(110);
    expect(result.speed_kph).toBe(42);
    expect(result.age_seconds).toBe(30);
    expect(result.route_source).toBe('corridor');
  });

  test('returns no percentage when GPS is absent or coordinates are invalid', () => {
    for (const row of [
      { ...base, gps_lat: null },
      { ...base, gps_lat: 91 },
      { ...base, gps_lng: 'not-a-number' },
      { ...base, last_fix_at: 'not-a-date' },
    ]) {
      const result = calculateTruckRouteProgress(row, ROUTE, NOW);
      expect(result.state).toBe('no_fix');
      expect(result.progress_pct).toBeNull();
    }
  });

  test('does not fabricate progress for an unassigned roster slot', () => {
    const result = calculateTruckRouteProgress({ ...base, vehicle_id: null }, ROUTE, NOW);
    expect(result.state).toBe('unassigned');
    expect(result.progress_pct).toBeNull();
  });

  test('shows no route when valid GPS exists but route geometry is unavailable', () => {
    const result = calculateTruckRouteProgress(base, null, NOW);
    expect(result.state).toBe('no_route');
    expect(result.progress_pct).toBeNull();
  });

  test('flags stale GPS and retains measured position without calling it live', () => {
    const result = calculateTruckRouteProgress({
      ...base, last_fix_at: new Date(NOW - (GPS_STALE_AFTER_SECONDS + 1) * 1000).toISOString(),
    }, ROUTE, NOW);
    expect(result.state).toBe('stale');
    expect(result.progress_pct).not.toBeNull();
    expect(result.age_seconds).toBe(GPS_STALE_AFTER_SECONDS + 1);
  });

  test('rejects future-dated GPS fixes beyond allowed clock skew', () => {
    const result = calculateTruckRouteProgress({
      ...base, last_fix_at: new Date(NOW + GPS_FUTURE_TOLERANCE_MS + 1).toISOString(),
    }, ROUTE, NOW);
    expect(result.state).toBe('clock_skew');
    expect(result.progress_pct).toBeNull();
    expect(result.age_seconds).toBeNull();
  });

  test('marks an off-route fix without reporting a completion percentage', () => {
    const result = calculateTruckRouteProgress({ ...base, gps_lat: 0.1 }, ROUTE, NOW);
    expect(result.state).toBe('off_route');
    expect(result.cross_track_km).toBeGreaterThan(2);
    expect(result.progress_pct).toBeNull();
  });

  test('uses a clearly labelled wider tolerance for long straight waypoint fallbacks', () => {
    const longRoute = {
      points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 5 }],
      corridorKm: 2, source: 'waypoints',
    };
    const fix = { ...base, gps_lat: 0.1, gps_lng: 2.5 };

    const estimate = calculateTruckRouteProgress(fix, longRoute, NOW);
    expect(estimate.state).toBe('live');
    expect(estimate.route_source).toBe('waypoints');
    expect(estimate.cross_track_km).toBeGreaterThan(10);
    expect(estimate.cross_track_limit_km).toBeGreaterThan(estimate.cross_track_km);
    expect(estimate.progress_pct).toBeGreaterThanOrEqual(49);
    expect(estimate.progress_pct).toBeLessThanOrEqual(51);

    const strictCorridor = calculateTruckRouteProgress(fix, {
      ...longRoute, source: 'corridor',
    }, NOW);
    expect(strictCorridor.state).toBe('off_route');
    expect(strictCorridor.progress_pct).toBeNull();
  });

  test('uses a safe default for missing, invalid or absurd corridor widths', () => {
    const result = calculateTruckRouteProgress(base, {
      points: ROUTE.points, corridorKm: 999, source: 'waypoints',
    }, NOW);
    expect(result.state).toBe('live');
    expect(result.progress_pct).not.toBeNull();
    expect(result.route_source).toBe('waypoints');
  });

  test('does not accept a zero-length route as progress geometry', () => {
    const result = calculateTruckRouteProgress(base, {
      points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }], corridorKm: 2,
    }, NOW);
    expect(result.state).toBe('no_route');
    expect(result.progress_pct).toBeNull();
  });
});
