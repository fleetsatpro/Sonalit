'use strict';

const { snapToRoads, downsample, chunk, applyOsrmTracepoints } = require('../src/services/geo/mapMatch');

const mkTrail = (n, t0 = Date.UTC(2026, 0, 1)) =>
  Array.from({ length: n }, (_, i) => ({
    lat: 1 + i * 0.0002, lng: 2 + i * 0.0002, speed: 40, heading: 90,
    ts: new Date(t0 + i * 10000).toISOString(),
  }));

describe('downsample', () => {
  test('keeps first and last, thins the middle', () => {
    const pts = mkTrail(50);
    const out = downsample(pts, { minGapM: 100, minGapMs: 60000, maxPoints: 250 });
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
    expect(out.length).toBeLessThan(pts.length);
  });
  test('caps to maxPoints', () => {
    const out = downsample(mkTrail(2000), { minGapM: 0, minGapMs: 0, maxPoints: 100 });
    expect(out.length).toBeLessThanOrEqual(100);
  });
  test('short trails pass through', () => {
    const pts = mkTrail(2);
    expect(downsample(pts)).toHaveLength(2);
  });
});

describe('chunk', () => {
  test('splits into fixed sizes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('applyOsrmTracepoints', () => {
  test('maps locations and nulls the misses', () => {
    const json = { tracepoints: [{ location: [2.5, 1.5] }, null, { location: [2.6, 1.6] }] };
    expect(applyOsrmTracepoints(json, 3)).toEqual([{ lng: 2.5, lat: 1.5 }, null, { lng: 2.6, lat: 1.6 }]);
  });
  test('all null when tracepoints missing', () => {
    expect(applyOsrmTracepoints({}, 2)).toEqual([null, null]);
  });
});

describe('snapToRoads', () => {
  test('snaps coordinates but keeps timestamps', async () => {
    const pts = mkTrail(6);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ code: 'Ok', tracepoints: pts.map(p => ({ location: [p.lng + 0.001, p.lat + 0.001] })) }),
    });
    const { points, snapped } = await snapToRoads(pts, {
      osrmUrl: 'http://osrm.test', fetchImpl, downsample: { minGapM: 0, minGapMs: 0 },
    });
    expect(snapped).toBe(true);
    expect(points[0].lng).toBeCloseTo(pts[0].lng + 0.001, 6);
    expect(points[0].ts).toBe(pts[0].ts); // timing preserved
  });

  test('falls back to raw when the matcher errors', async () => {
    const pts = mkTrail(6);
    const fetchImpl = async () => { throw new Error('network'); };
    const { snapped } = await snapToRoads(pts, { osrmUrl: 'http://osrm.test', fetchImpl });
    expect(snapped).toBe(false);
  });

  test('no matcher configured → raw, snapped false', async () => {
    const { snapped } = await snapToRoads(mkTrail(6), {});
    expect(snapped).toBe(false);
  });

  test('mostly-unmatched trail is not pretended snapped', async () => {
    const pts = mkTrail(6);
    const fetchImpl = async () => ({
      ok: true, json: async () => ({ code: 'Ok', tracepoints: [null, null, null, null, null, { location: [9, 9] }] }),
    });
    const { snapped } = await snapToRoads(pts, {
      osrmUrl: 'http://osrm.test', fetchImpl, downsample: { minGapM: 0, minGapMs: 0 },
    });
    expect(snapped).toBe(false);
  });
});
