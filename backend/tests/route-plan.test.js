'use strict';

const { planRoute, buildRouteUrl, parseRoute, capPoints } = require('../src/services/geo/routePlan');

const origin = { lat: 1.0, lng: 2.0 };
const dest = { lat: 1.1, lng: 2.1 };

// A believable driving geometry that bends between the endpoints (not a straight line).
const roadGeom = {
  code: 'Ok',
  routes: [{
    distance: 15230, duration: 1080,
    geometry: { coordinates: [[2.0, 1.0], [2.03, 1.02], [2.05, 1.07], [2.1, 1.1]] },
  }],
};

describe('parseRoute', () => {
  test('reads geometry into {lat,lng} waypoints + distance/duration', () => {
    const r = parseRoute(roadGeom);
    expect(r.route[0]).toEqual({ lat: 1.0, lng: 2.0 });
    expect(r.route).toHaveLength(4);
    expect(r.distanceKm).toBeCloseTo(15.23, 2);
    expect(r.durationMin).toBeCloseTo(18, 0);
  });
  test('rejects a too-short / missing geometry', () => {
    expect(parseRoute({ routes: [{ geometry: { coordinates: [[2, 1]] } }] })).toBeNull();
    expect(parseRoute({})).toBeNull();
  });
});

describe('buildRouteUrl', () => {
  test('mapbox directions url carries the token', () => {
    const u = buildRouteUrl({ name: 'mapbox', token: 'tok' }, [origin, dest]);
    expect(u).toContain('api.mapbox.com/directions/v5/mapbox/driving/');
    expect(u).toContain('2,1;2.1,1.1');
    expect(u).toContain('access_token=tok');
  });
  test('osrm route url', () => {
    const u = buildRouteUrl({ name: 'osrm', base: 'http://osrm.test/' }, [origin, dest]);
    expect(u).toContain('http://osrm.test/route/v1/driving/2,1;2.1,1.1');
    expect(u).not.toContain('access_token');
  });
});

describe('capPoints', () => {
  test('caps a dense polyline but keeps first and last', () => {
    const dense = Array.from({ length: 5000 }, (_, i) => ({ lat: i, lng: i }));
    const out = capPoints(dense, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out[0]).toEqual(dense[0]);
    expect(out[out.length - 1]).toEqual(dense[dense.length - 1]);
  });
});

describe('planRoute', () => {
  test('turns endpoints into road-following waypoints', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => roadGeom });
    const r = await planRoute([origin, dest], { mapboxToken: 'tok', osrmUrl: 'http://osrm.test', fetchImpl });
    expect(r.routed).toBe(true);
    expect(r.provider).toBe('mapbox');
    expect(r.route.length).toBeGreaterThan(2);   // gained the intermediate bend points
    expect(r.distance_km).toBeCloseTo(15.23, 2);
  });

  test('prefers Mapbox, falls back to OSRM when Mapbox fails', async () => {
    const hosts = [];
    const fetchImpl = async (url) => {
      hosts.push(url);
      if (url.includes('api.mapbox.com')) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, json: async () => roadGeom };
    };
    const r = await planRoute([origin, dest], { mapboxToken: 'tok', osrmUrl: 'http://osrm.test', fetchImpl });
    expect(r.routed).toBe(true);
    expect(r.provider).toBe('osrm');
    expect(hosts.some(u => u.includes('api.mapbox.com'))).toBe(true);
  });

  test('falls back to the input waypoints when no router is reachable', async () => {
    const fetchImpl = async () => { throw new Error('network'); };
    const r = await planRoute([origin, dest], { osrmUrl: 'http://osrm.test', fetchImpl });
    expect(r.routed).toBe(false);
    expect(r.route).toEqual([origin, dest]);
  });

  test('no provider configured → unchanged, routed false', async () => {
    const r = await planRoute([origin, dest], {});
    expect(r.routed).toBe(false);
    expect(r.route).toEqual([origin, dest]);
  });
});
