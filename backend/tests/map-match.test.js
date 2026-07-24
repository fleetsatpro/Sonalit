'use strict';

const {
  snapToRoads, downsample, chunk, applyOsrmTracepoints,
  rejectSpikes, collapseStationary, cleanTrail,
} = require('../src/services/geo/mapMatch');

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

describe('rejectSpikes', () => {
  const t0 = Date.UTC(2026, 0, 1);
  test('drops a lone teleport fix but keeps its neighbours', () => {
    const pts = [
      { lat: 1.0000, lng: 1.0000, speed: 40, ts: new Date(t0).toISOString() },
      { lat: 9.0000, lng: 9.0000, speed: 40, ts: new Date(t0 + 10000).toISOString() }, // teleport
      { lat: 1.0002, lng: 1.0002, speed: 40, ts: new Date(t0 + 20000).toISOString() },
    ];
    const out = rejectSpikes(pts, { maxKmh: 180 });
    expect(out).toHaveLength(2);
    expect(out.every(p => p.lat < 2)).toBe(true);
  });
  test('keeps genuine fast travel (all points advance)', () => {
    const pts = Array.from({ length: 4 }, (_, i) => ({
      lat: 1 + i * 0.01, lng: 1, speed: 100, ts: new Date(t0 + i * 60000).toISOString(),
    }));
    expect(rejectSpikes(pts, { maxKmh: 180 })).toHaveLength(4);
  });
});

describe('collapseStationary', () => {
  const t0 = Date.UTC(2026, 0, 1);
  test('folds a jittery parked run into two coincident dwell points', () => {
    // 6 fixes drifting within ~15 m over 50 s, then two moving fixes.
    const parked = Array.from({ length: 6 }, (_, i) => ({
      lat: 1 + (i % 2) * 0.0001, lng: 1 + (i % 2) * 0.0001, speed: 0,
      ts: new Date(t0 + i * 10000).toISOString(),
    }));
    const moving = [
      { lat: 1.01, lng: 1.01, speed: 40, ts: new Date(t0 + 80000).toISOString() },
      { lat: 1.02, lng: 1.02, speed: 40, ts: new Date(t0 + 140000).toISOString() },
    ];
    const out = collapseStationary([...parked, ...moving], { radiusM: 25, minRunMs: 20000 });
    // dwell → 2 identical points, then the 2 moving points pass through
    expect(out).toHaveLength(4);
    expect(out[0].lat).toBeCloseTo(out[1].lat, 9);
    expect(out[0].lng).toBeCloseTo(out[1].lng, 9);
    expect(out[0].speed).toBe(0);
    expect(new Date(out[1].ts).getTime()).toBe(t0 + 50000); // last dwell ts preserved
  });
  test('leaves a genuinely moving trail alone', () => {
    const pts = Array.from({ length: 5 }, (_, i) => ({
      lat: 1 + i * 0.01, lng: 1, speed: 50, ts: new Date(t0 + i * 30000).toISOString(),
    }));
    expect(collapseStationary(pts)).toHaveLength(5);
  });
});

describe('cleanTrail', () => {
  test('de-sprays: spike removed and parked cluster collapsed', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts = [
      ...Array.from({ length: 5 }, (_, i) => ({
        lat: 1 + (i % 2) * 0.0001, lng: 1, speed: 0, ts: new Date(t0 + i * 10000).toISOString(),
      })),
      { lat: 40, lng: 40, speed: 0, ts: new Date(t0 + 50000).toISOString() }, // spike
      { lat: 1.001, lng: 1, speed: 40, ts: new Date(t0 + 110000).toISOString() },
    ];
    const out = cleanTrail(pts);
    expect(out.every(p => p.lat < 2)).toBe(true); // spike gone
    expect(out.length).toBeLessThan(pts.length);  // cluster collapsed
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
