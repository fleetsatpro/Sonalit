'use strict';

const { evaluateCorridor, projectOntoRoute, haversineKm } = require('../src/services/geofence/corridor');

// A ~simple east-west route near the equator: 0,0 -> 0,1 (~111 km).
const route = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];
const H = 3600000;

describe('projectOntoRoute', () => {
  test('point on the line has ~zero cross-track and correct along', () => {
    const proj = projectOntoRoute(route, 0, 0.5);
    expect(proj.crossTrackKm).toBeLessThan(0.01);
    expect(proj.alongKm).toBeGreaterThan(50);
    expect(proj.alongKm).toBeLessThan(62);
    expect(proj.routeLenKm).toBeGreaterThan(110);
  });

  test('point off the line reports the perpendicular distance', () => {
    const proj = projectOntoRoute(route, 0.05, 0.5); // ~5.5 km north
    expect(proj.crossTrackKm).toBeGreaterThan(4);
    expect(proj.crossTrackKm).toBeLessThan(7);
  });

  test('clamps to the route ends (does not project past the last point)', () => {
    const proj = projectOntoRoute(route, 0, 2); // well past the end
    expect(proj.alongKm).toBeLessThanOrEqual(proj.routeLenKm + 0.01);
  });
});

describe('evaluateCorridor', () => {
  test('on the road and on schedule → on_track', () => {
    // 1h elapsed at 45 km/h → expected ~45 km along; place device there.
    const v = evaluateCorridor({ route, lat: 0, lng: 0.405, elapsedMs: 1 * H });
    expect(v.status).toBe('on_track');
    expect(Math.abs(v.schedule_delta_km)).toBeLessThan(8);
  });

  test('on the road but far behind schedule → behind', () => {
    // 3h should be ~135 km along; device barely moved (~11 km).
    const v = evaluateCorridor({ route, lat: 0, lng: 0.1, elapsedMs: 3 * H });
    expect(v.status).toBe('behind');
    expect(v.schedule_delta_min).toBeLessThan(0);
  });

  test('off the route line → off_route regardless of schedule', () => {
    const v = evaluateCorridor({ route, lat: 0.1, lng: 0.4, elapsedMs: 1 * H }); // ~11 km north
    expect(v.status).toBe('off_route');
    expect(v.severity).toBe('high');
  });

  test('raced ahead of the escort → ahead', () => {
    // 0.5h → expected ~22 km; device already ~89 km along.
    const v = evaluateCorridor({ route, lat: 0, lng: 0.8, elapsedMs: 0.5 * H });
    expect(v.status).toBe('ahead');
    expect(v.schedule_delta_min).toBeGreaterThan(0);
  });

  test('custom corridor width is respected', () => {
    const tight = evaluateCorridor({ route, lat: 0.02, lng: 0.4, elapsedMs: 1 * H, corridorKm: 1 });
    expect(tight.status).toBe('off_route'); // ~2.2 km off, tol 1 km
    const loose = evaluateCorridor({ route, lat: 0.02, lng: 0.405, elapsedMs: 1 * H, corridorKm: 5 });
    expect(loose.status).toBe('on_track'); // within 5 km and on schedule
  });
});

describe('haversineKm sanity', () => {
  test('~111 km per degree of longitude at the equator', () => {
    const d = haversineKm(0, 0, 0, 1);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});
