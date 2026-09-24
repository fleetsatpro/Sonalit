'use strict';

const {
  planRouteQueries,
  adaptiveSamplePoints,
  queryAcrossAois,
} = require('../../src/services/spatial/routeQueryPlanner');

describe('bounded route query planner', () => {
  test('does not collapse a roughly 440 km route to center-only', () => {
    const plan = planRouteQueries([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 4 },
    ]);

    expect(plan.mode).toBe('multi_aoi');
    expect(plan.aois.length).toBeGreaterThan(1);
    expect(plan.aois.length).toBeLessThanOrEqual(8);
    expect(plan.coverageRatio).toBeGreaterThanOrEqual(0.99);
    expect(plan.routeLengthCoveredM).toBeGreaterThan(400000);
  });

  test('keeps AOI area and count bounded for long routes', () => {
    const plan = planRouteQueries([
      { lat: -1, lng: 0 },
      { lat: 0, lng: 5 },
      { lat: 1, lng: 10 },
      { lat: 0, lng: 15 },
      { lat: -1, lng: 20 },
    ], { maxAois: 6, maxAoiAreaDeg2: 20 });

    expect(plan.aois.length).toBeLessThanOrEqual(6);
    expect(plan.coverageRatio).toBeGreaterThanOrEqual(0);
    for (const aoi of plan.aois) {
      const area = (aoi.bbox[2] - aoi.bbox[0]) * (aoi.bbox[3] - aoi.bbox[1]);
      expect(area).toBeLessThanOrEqual(20);
    }
  });

  test('splits an antimeridian crossing into provider-safe AOIs', () => {
    const plan = planRouteQueries([
      { lat: 10, lng: 179.2 },
      { lat: 10, lng: -179.2 },
    ]);

    expect(plan.reason).toContain('antimeridian');
    expect(plan.aois.length).toBeGreaterThanOrEqual(2);
    for (const aoi of plan.aois) {
      expect(aoi.bbox[0]).toBeGreaterThanOrEqual(-180);
      expect(aoi.bbox[2]).toBeLessThanOrEqual(180);
      expect(aoi.bbox[0]).toBeLessThan(aoi.bbox[2]);
    }
  });

  test('adaptive samples grow with route length but stay bounded', () => {
    const short = adaptiveSamplePoints([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], 16);
    const long = adaptiveSamplePoints([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 4 },
      { lat: 0, lng: 6 },
      { lat: 0, lng: 8 },
    ], 16);

    expect(short.length).toBeGreaterThanOrEqual(3);
    expect(long.length).toBeGreaterThan(short.length);
    expect(long.length).toBeLessThanOrEqual(16);
  });

  test('aggregates AOI responses, dedupes observations, and reports partial coverage', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce({
          observations: [{ id: 'a' }],
          health: { status: 'LIVE' },
        })
        .mockRejectedValueOnce(Object.assign(new Error('429'), { failureClass: 'rate_limited' })),
    };

    const plan = {
      mode: 'multi_aoi',
      coverageRatio: 1,
      routeLengthCoveredM: 1000,
      aois: [
        { id: 'a1', bbox: [0, 0, 1, 1] },
        { id: 'a2', bbox: [1, 0, 2, 1] },
      ],
    };

    const result = await queryAcrossAois(manager, 'opensky', plan, { orgId: 'org-a' }, { concurrency: 2 });

    expect(result.observations).toEqual([{ id: 'a' }]);
    expect(result.coverage.aoisPlanned).toBe(2);
    expect(result.coverage.aoisSucceeded).toBe(1);
    expect(result.coverage.aoisFailed).toBe(1);
    expect(result.coverage.complete).toBe(false);
    expect(result.health.status).toBe('LIVE');
    expect(result.warnings).toContain('route_aoi_partial_coverage');
  });
});
