'use strict';

const { makeVehicle } = require('../../src/services/spatial/worldContextService');

function row(now, previousAgeMs) {
  return {
    id: 'v1',
    registration: 'KCA 123A',
    status: 'active',
    type: 'truck',
    region: 'Kenya',
    latitude: -1.29,
    longitude: 36.82,
    heading: 90,
    speed: 40,
    last_ping: new Date(now - 30_000).toISOString(),
    driver_id: null,
    assigned_convoy_id: 'c1',
    gps_lat: null,
    gps_lng: null,
    gps_heading: null,
    gps_speed: null,
    gps_accuracy: null,
    gps_at: null,
    prev_lat: -1.291,
    prev_lng: 36.819,
    prev_heading: 90,
    prev_speed: 40,
    prev_at: new Date(now - previousAgeMs).toISOString(),
    recent_points: '[]',
  };
}

describe('spatial vehicle telemetry transitions', () => {
  test('marks recovery only when previous observation was stale', () => {
    const now = Date.now();
    const recovered = makeVehicle(row(now, 10 * 60 * 1000), null, { route: [], widthKm: 2 }, [], now);
    expect(recovered.previousFreshnessClass).toBe('STALE');
    expect(recovered.recoveredFreshness).toBe(true);

    const continuouslyFresh = makeVehicle(row(now, 60_000), null, { route: [], widthKm: 2 }, [], now);
    expect(continuouslyFresh.previousFreshnessClass).toBe('LIVE');
    expect(continuouslyFresh.recoveredFreshness).toBe(false);
  });
});
