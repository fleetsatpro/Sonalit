'use strict';

const { geocode } = require('../src/services/geo/geocode');

const feature = (name, lng, lat) => ({ place_name: name, center: [lng, lat] });

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
    let seen = '';
    const fetchImpl = async (url) => { seen = url; return { ok: true, json: async () => ({ features: [] }) }; };
    await geocode('Mombasa Rd depot', { mapboxToken: 'tok', fetchImpl, proximity: { lat: -1.3, lng: 36.8 } });
    expect(seen).toContain('/geocoding/v5/mapbox.places/Mombasa%20Rd%20depot.json');
    expect(seen).toContain('access_token=tok');
    expect(seen).toContain('proximity=36.8%2C-1.3');
  });

  test('no token → empty, provider null', async () => {
    expect(await geocode('anywhere', {})).toEqual({ results: [], provider: null });
  });

  test('blank query → empty without calling the API', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const r = await geocode('   ', { mapboxToken: 'tok', fetchImpl });
    expect(r.results).toEqual([]);
    expect(called).toBe(false);
  });

  test('API error → empty, not a throw', async () => {
    const fetchImpl = async () => { throw new Error('network'); };
    await expect(geocode('x', { mapboxToken: 'tok', fetchImpl })).resolves.toEqual({ results: [], provider: null });
  });
});
