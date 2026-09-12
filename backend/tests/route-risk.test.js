'use strict';

const { scoreRoute, rankRoutes, exposureKm } = require('../src/services/geo/routeRisk');

// A ~111 km east-west leg along the equator: (0,0) -> (0,1).
const leg = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];

const zone = (over) => ({
  id: 'z1', name: 'Zone', risk_level: 'high', zone_type: 'theft_hotspot',
  lat: 0, lng: 0.5, radius_km: 5, ...over,
});

describe('exposureKm', () => {
  test('measures the distance actually spent inside a zone', () => {
    // A 5 km-radius circle centred on the line: the road crosses its diameter.
    const { insideKm } = exposureKm(leg, zone());
    expect(insideKm).toBeGreaterThan(9);
    expect(insideKm).toBeLessThan(11);
  });

  test('a zone the road never enters costs nothing', () => {
    const { insideKm, nearestKm } = exposureKm(leg, zone({ lat: 1.0, radius_km: 5 }));
    expect(insideKm).toBe(0);
    expect(nearestKm).toBeGreaterThan(100);
  });

  test('catches a crossing that falls between two waypoints', () => {
    // Endpoints are ~111 km apart, the zone sits between them and is only 2 km
    // across — an endpoint-only test would miss it entirely.
    const { insideKm } = exposureKm(leg, zone({ radius_km: 1 }));
    expect(insideKm).toBeGreaterThan(1.5);
  });
});

describe('scoreRoute', () => {
  test('a clean route scores near zero', () => {
    const v = scoreRoute(leg, [zone({ lat: 5 })]);
    expect(v.score).toBe(0);
    expect(v.exposures).toHaveLength(0);
    expect(v.blocked).toBe(false);
  });

  test('severity dominates the score', () => {
    const low = scoreRoute(leg, [zone({ risk_level: 'low' })]).score;
    const high = scoreRoute(leg, [zone({ risk_level: 'high' })]).score;
    const critical = scoreRoute(leg, [zone({ risk_level: 'critical' })]).score;
    expect(high).toBeGreaterThan(low);
    expect(critical).toBeGreaterThan(high);
  });

  test('deeper exposure costs more than clipping the edge', () => {
    const through = scoreRoute(leg, [zone({ radius_km: 20 })]).score;
    const clipped = scoreRoute(leg, [zone({ radius_km: 2 })]).score;
    expect(through).toBeGreaterThan(clipped);
  });

  test('a no-go zone flags the route as blocked', () => {
    const v = scoreRoute(leg, [zone({ risk_level: 'no_go' })]);
    expect(v.blocked).toBe(true);
    expect(v.worst).toBe('no_go');
  });

  test('drive time breaks ties between equally safe routes', () => {
    const quick = scoreRoute(leg, [], { durationMin: 60 }).score;
    const slow = scoreRoute(leg, [], { durationMin: 240 }).score;
    expect(slow).toBeGreaterThan(quick);
  });

  test('ignores zones with unusable coordinates instead of throwing', () => {
    const v = scoreRoute(leg, [zone({ lat: null }), zone({ lng: 'abc' }), null]);
    expect(v.score).toBe(0);
  });
});

describe('rankRoutes', () => {
  // The fast road runs through a hotspot; the slower one goes around it.
  const viaHotspot = { route: leg, distance_km: 111, duration_min: 90 };
  const detour = {
    route: [{ lat: 0.5, lng: 0 }, { lat: 0.5, lng: 1 }],
    distance_km: 150, duration_min: 130,
  };

  test('prefers the safer road over the quicker one', () => {
    const { best } = rankRoutes([viaHotspot, detour], [zone({ risk_level: 'critical' })]);
    expect(best.index).toBe(1);
    expect(best.exposed_km).toBe(0);
  });

  test('with no risk zones the quicker road wins', () => {
    const { best } = rankRoutes([viaHotspot, detour], []);
    expect(best.index).toBe(0);
  });

  test('a no-go road is never chosen while an alternative exists', () => {
    const { best, all_blocked } = rankRoutes([viaHotspot, detour], [zone({ risk_level: 'no_go' })]);
    expect(best.index).toBe(1);
    expect(best.blocked).toBe(false);
    expect(all_blocked).toBe(false);
  });

  test('when every road is blocked it still returns one, flagged', () => {
    const wide = zone({ risk_level: 'no_go', lat: 0.25, radius_km: 200 });
    const { best, all_blocked } = rankRoutes([viaHotspot, detour], [wide]);
    expect(all_blocked).toBe(true);
    expect(best).not.toBeNull();
    expect(best.blocked).toBe(true);
  });

  test('ranks safest-first and reports what it hit', () => {
    const { ranked } = rankRoutes([viaHotspot, detour], [zone({ risk_level: 'high' })]);
    expect(ranked[0].index).toBe(1);
    expect(ranked[1].exposures[0]).toMatchObject({ risk_level: 'high', name: 'Zone' });
  });
});
