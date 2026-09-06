import { describe, test, expect } from 'vitest';
import {
  clampSpikes, speedsKmh, cumulativeMeters, trailStats, speedBucket, speedColor,
  detectStops, headingsDeg, bearingDeg, fmtDuration, type TP,
} from './driveTrail.js';

const mk = (n: number, gapDeg = 0.001, t0 = Date.UTC(2026, 0, 1)): TP[] =>
  Array.from({ length: n }, (_, i) => ({
    lat: 1 + i * gapDeg, lng: 2, speed: 50, heading: 0, ts: new Date(t0 + i * 10000).toISOString(),
  }));

describe('clampSpikes', () => {
  test('drops a lone teleport that implies an impossible speed', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts: TP[] = [
      { lat: 1, lng: 2, speed: 50, heading: 0, ts: new Date(t0).toISOString() },
      { lat: 40, lng: 2, speed: 50, heading: 0, ts: new Date(t0 + 5000).toISOString() }, // teleport
      { lat: 1.001, lng: 2, speed: 50, heading: 0, ts: new Date(t0 + 10000).toISOString() },
    ];
    const out = clampSpikes(pts, 200);
    expect(out.every(p => p.lat < 2)).toBe(true);
    expect(out).toHaveLength(2);
  });
  test('leaves a clean trail intact', () => {
    expect(clampSpikes(mk(5))).toHaveLength(5);
  });
});

describe('speedsKmh', () => {
  test('uses reported speed, derives when missing', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts: TP[] = [
      { lat: 1, lng: 2, speed: 42, heading: 0, ts: new Date(t0).toISOString() },
      { lat: 1.001, lng: 2, speed: null, heading: 0, ts: new Date(t0 + 10000).toISOString() },
    ];
    const s = speedsKmh(pts);
    expect(s[0]).toBe(42);
    expect(s[1]).toBeGreaterThan(0); // derived ~40 km/h
  });
});

describe('cumulativeMeters + trailStats', () => {
  test('accumulates and summarises', () => {
    const pts = mk(4, 0.001);
    const cum = cumulativeMeters(pts);
    expect(cum[0]).toBe(0);
    expect(cum[3]).toBeGreaterThan(cum[1]!);
    const st = trailStats(pts);
    expect(st.distanceKm).toBeGreaterThan(0);
    expect(st.maxKmh).toBe(50);
    expect(st.durationMs).toBe(30000);
  });
});

describe('speed ramp', () => {
  test('buckets by speed', () => {
    expect(speedBucket(0)).toBe(0);
    expect(speedBucket(10)).toBe(1);
    expect(speedBucket(45)).toBe(2);
    expect(speedBucket(90)).toBe(3);
    expect(speedColor(0)).toBe('#ef4444');
  });
});

describe('detectStops', () => {
  test('emits a stop for a long stationary run, median-anchored', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts: TP[] = [
      { lat: 1, lng: 2, speed: 50, heading: 0, ts: new Date(t0).toISOString() },
      ...Array.from({ length: 5 }, (_, i) => ({
        lat: 1.01 + (i % 2) * 0.0001, lng: 2, speed: 0, heading: 0,
        ts: new Date(t0 + (60000 + i * 60000)).toISOString(),
      })),
      { lat: 1.02, lng: 2, speed: 50, heading: 0, ts: new Date(t0 + 400000).toISOString() },
    ];
    const stops = detectStops(pts, { stoppedKmh: 3, minStopMs: 120000 });
    expect(stops).toHaveLength(1);
    expect(stops[0]!.durationMs).toBeGreaterThanOrEqual(120000);
    expect(stops[0]!.lat).toBeCloseTo(1.01, 3);
  });
  test('ignores brief pauses', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts: TP[] = [
      { lat: 1, lng: 2, speed: 0, heading: 0, ts: new Date(t0).toISOString() },
      { lat: 1, lng: 2, speed: 0, heading: 0, ts: new Date(t0 + 30000).toISOString() },
      { lat: 1, lng: 2, speed: 50, heading: 0, ts: new Date(t0 + 60000).toISOString() },
    ];
    expect(detectStops(pts, { minStopMs: 120000 })).toHaveLength(0);
  });
});

describe('bearingDeg + headingsDeg', () => {
  test('due north is ~0°, due east ~90°', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 1);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 1);
  });
  test('headings align to travel and last repeats', () => {
    const h = headingsDeg(mk(3, 0.001)); // heading north
    expect(h).toHaveLength(3);
    expect(h[0]).toBeCloseTo(0, 0);
    expect(h[2]).toBe(h[1]);
  });
});

describe('fmtDuration', () => {
  test('formats h/m/s', () => {
    expect(fmtDuration(3864000)).toBe('1h 04m');
    expect(fmtDuration(750000)).toBe('12m 30s');
    expect(fmtDuration(9000)).toBe('9s');
  });
});
