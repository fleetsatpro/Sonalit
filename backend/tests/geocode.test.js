'use strict';

const { geocode } = require('../src/services/geo/geocode');

const feature = (name, lng, lat) => ({ place_name: name, center: [lng, lat] });
const osmHit = (name, lng, lat) => ({ display_name: name, lat: String(lat), lon: String(lng) });

// Every case injects fetchImpl: geocode now has a keyless fallback provider, so
// a test that omits it would reach the real Nominatim over the network.
describe('geocode', () => {
  test('maps Mapbox features to {name,lat,lng}', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ features: [feature('Nairobi CBD, Kenya', 36.8219, -1.2921)] }),
    });
    const { results, provider } = await geocode('Nairobi CBD', { mapboxToken: 'tok', fetchImpl });
    expect(provider).toBe('mapbox');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ name: 'Nairobi CBD, Kenya', lat: -1.2921, lng: 36.8219 });
  });

  test('URL-encodes the query, carries the token, and honours proximity bias', async () => {
    // An empty Mapbox answer now falls through to the fallback, so assert on
    // the Mapbox call specifically rather than on whichever ran last.
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ features: [] }) }; };
    await geocode('Mombasa Rd depot', { mapboxToken: 'tok', fetchImpl, proximity: { lat: -1.3, lng: 36.8 } });
    const mapbox = calls.find(u => u.includes('api.mapbox.com'));
    expect(mapbox).toContain('/geocoding/v5/mapbox.places/Mombasa%20Rd%20depot.json');
    expect(mapbox).toContain('access_token=tok');
    expect(mapbox).toContain('proximity=36.8%2C-1.3');
  });

  test('blank query → empty without calling any API', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const r = await geocode('   ', { mapboxToken: 'tok', fetchImpl });
    expect(r.results).toEqual([]);
    expect(called).toBe(false);
  });

  // ── Keyless fallback ───────────────────────────────────────────────────────
  // Without this, a deployment with no Mapbox token had no geocoding at all,
  // so the corridor planner could never resolve a place name.
  describe('without a Mapbox token', () => {
    test('falls back to Nominatim and maps its shape', async () => {
      let seen = '';
      const fetchImpl = async (url) => {
        seen = url;
        return { ok: true, json: async () => [osmHit('Kisumu, Kenya', 34.7541761, -0.1029109)] };
      };
      const { results, provider } = await geocode('Kisumu', { fetchImpl });
      expect(provider).toBe('nominatim');
      expect(seen).toContain('nominatim.openstreetmap.org/search');
      expect(seen).toContain('format=jsonv2');
      expect(results[0]).toEqual({ name: 'Kisumu, Kenya', lat: -0.1029109, lng: 34.7541761 });
    });

    test('translates proximity into a viewbox', async () => {
      let seen = '';
      const fetchImpl = async (url) => { seen = url; return { ok: true, json: async () => [] }; };
      await geocode('depot', { fetchImpl, proximity: { lat: -1.3, lng: 36.8 } });
      expect(seen).toContain('viewbox=');
      // lng-3, lat+3, lng+3, lat-3
      expect(decodeURIComponent(seen)).toContain('viewbox=33.8,1.7,39.8,-4.3');
    });

    test('a non-array Nominatim body is empty, not a crash', async () => {
      const fetchImpl = async () => ({ ok: true, json: async () => ({ error: 'rate limited' }) });
      await expect(geocode('x', { fetchImpl })).resolves.toEqual({ results: [], provider: null });
    });
  });

  test('falls through to Nominatim when Mapbox answers with nothing', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes('mapbox')) return { ok: true, json: async () => ({ features: [] }) };
      return { ok: true, json: async () => [osmHit('Mombasa, Kenya', 39.6682, -4.0435)] };
    };
    const { results, provider } = await geocode('Mombasa', { mapboxToken: 'tok', fetchImpl });
    expect(calls).toHaveLength(2);
    expect(provider).toBe('nominatim');
    expect(results[0].lat).toBeCloseTo(-4.0435, 4);
  });

  test('a Mapbox outage falls through rather than failing the lookup', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('mapbox')) throw new Error('network');
      return { ok: true, json: async () => [osmHit('Nairobi, Kenya', 36.8219, -1.2921)] };
    };
    const { provider } = await geocode('Nairobi', { mapboxToken: 'tok', fetchImpl });
    expect(provider).toBe('nominatim');
  });

  test('both providers failing → empty, not a throw', async () => {
    const fetchImpl = async () => { throw new Error('network'); };
    await expect(geocode('x', { mapboxToken: 'tok', fetchImpl }))
      .resolves.toEqual({ results: [], provider: null });
  });

  test('drops results with unusable coordinates', async () => {
    const fetchImpl = async () => ({
      ok: true, json: async () => [osmHit('Bad', 'abc', 'def'), osmHit('Good', 34.75, -0.1)],
    });
    const { results } = await geocode('x', { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Good');
  });
});
