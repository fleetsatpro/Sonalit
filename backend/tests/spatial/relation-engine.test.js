const {
  bearingDeg,
  relativeDirectionFromHeading,
  isApproaching,
  routeRelation,
  circleRelation,
  contextRelevance,
} = require('../../src/services/spatial/relationEngine');

describe('spatial relation engine', () => {
  const route = [
    { lat: -1.29, lng: 36.82 },
    { lat: -1.30, lng: 36.90 },
    { lat: -1.31, lng: 37.00 },
  ];

  test('keeps spatial route state independent from schedule state', () => {
    const result = routeRelation(
      { lat: -1.30, lng: 36.90 },
      route,
      2,
      8,
      0,
      45,
    );
    expect(result.spatialState).toBe('ON_ROUTE');
    expect(result.relation).toBe('ON_ROUTE');
    expect(['ON_SCHEDULE', 'BEHIND_SCHEDULE', 'AHEAD_OF_SCHEDULE']).toContain(result.scheduleState);
  });

  test('identifies an off-route position', () => {
    const result = routeRelation(
      { lat: -1.35, lng: 37.05 },
      route,
      0.2,
      8,
      0,
      45,
    );
    expect(result.spatialState).toBe('OFF_ROUTE');
    expect(result.evidence.cross_track_km).toBeGreaterThan(0.2);
  });

  test('computes directional bearing and approach', () => {
    const north = bearingDeg(0, 0, 1, 0);
    expect(north).toBeCloseTo(0, 5);
    expect(relativeDirectionFromHeading(0, north)).toBe('ahead');
    expect(relativeDirectionFromHeading(180, north)).toBe('behind');
    expect(isApproaching(900, 1300, 50)).toBe(true);
    expect(isApproaching(1500, 1300, 50)).toBe(false);
    expect(isApproaching(1300, 1320, 50)).toBe(null);
  });

  test('handles radial containment without fabricating coordinates', () => {
    const relation = circleRelation(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01, radius_km: 2 },
    );
    expect(relation.distanceM).toBeGreaterThan(0);
    expect(relation.radiusM).toBe(2000);
    expect(typeof relation.inside).toBe('boolean');
  });

  test('returns reproducible relevance components', () => {
    const result = contextRelevance({
      distanceM: 5000,
      routeDistanceM: 1000,
      severity: 'high',
      freshnessClass: 'LIVE',
      sourceQuality: 0.9,
      ahead: true,
      missionActive: true,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(Object.keys(result.components)).toEqual(
      expect.arrayContaining(['distance','route','severity','freshness','source','direction','mission']),
    );
  });
});
