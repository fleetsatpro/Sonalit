const {
  bboxFromCenter,
  freshnessClass,
  getOpticalRecon,
  getOpticalTile,
} = require('../src/services/spatial/opticalReconGateway');

describe('free optical reconnaissance gateway', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('bounds reconnaissance AOI without producing invalid longitude/latitude extents', () => {
    expect(bboxFromCenter(0, 0, 25_000)).toHaveLength(4);
    const polar = bboxFromCenter(89.9, 179.9, 120_000);
    expect(polar[0]).toBeGreaterThanOrEqual(-180);
    expect(polar[2]).toBeLessThanOrEqual(180);
    expect(polar[1]).toBeGreaterThanOrEqual(-90);
    expect(polar[3]).toBeLessThanOrEqual(90);
  });

  test('classifies observation freshness explicitly', () => {
    expect(freshnessClass(new Date().toISOString())).toBe('FRESH');
    expect(freshnessClass(new Date(Date.now() - 3 * 86400000).toISOString())).toBe('AGING');
    expect(freshnessClass(new Date(Date.now() - 30 * 86400000).toISOString())).toBe('OLD');
    expect(freshnessClass('not-a-date')).toBe('UNKNOWN');
  });

  test('prefers a recent low-cloud Sentinel scene over a newer cloud-obscured scene', async () => {
    process.env.NASA_FIRMS_MAP_KEY = '';
    global.fetch = jest.fn(async (url, init) => {
      const textUrl = String(url);
      if (textUrl.includes('explorer.digitalearth.africa/stac/search')) {
        return {
          ok: true,
          json: async () => ({
            features: [
              {
                id: 'latest-cloudy',
                geometry: { type: 'Polygon', coordinates: [] },
                properties: { datetime: new Date(Date.now() - 24 * 3600000).toISOString(), 'eo:cloud_cover': 78, gsd: 10 },
              },
              {
                id: 'recent-clear',
                geometry: { type: 'Polygon', coordinates: [] },
                properties: { datetime: new Date(Date.now() - 48 * 3600000).toISOString(), 'eo:cloud_cover': 8, gsd: 10 },
              },
            ],
          }),
        };
      }
      if (textUrl.includes('api.imagery.hotosm.org/stac/search')) {
        return {
          ok: true,
          json: async () => ({ features: [] }),
        };
      }
      throw new Error('unexpected fetch: ' + textUrl);
    });

    const result = await getOpticalRecon({
      latitude: -1.286389,
      longitude: 36.817223,
      radiusM: 35_000,
    });

    expect(result.primary.id).toBe('sentinel2:recent-clear');
    expect(result.primary.cloudPct).toBe(8);
    expect(result.primary.nativeResolutionM).toBe(10);
    expect(result.semantics.some(x => x.includes('not live telemetry'))).toBe(true);
  });


  test('reports provider degradation separately from a genuine empty catalog', async () => {
    global.fetch = jest.fn(async url => {
      if (String(url).includes('explorer.digitalearth.africa/stac/search')) {
        throw new Error('Sentinel catalog unavailable');
      }
      if (String(url).includes('api.imagery.hotosm.org/stac/search')) {
        return { ok: true, json: async () => ({ features: [] }) };
      }
      throw new Error('unexpected fetch: ' + String(url));
    });

    const result = await getOpticalRecon({
      latitude: -1.286389,
      longitude: 36.817223,
      radiusM: 35_000,
    });

    expect(result.primary.provider).toBe('nasa-gibs');
    expect(result.quality.state).toBe('provider_degraded_fallback');
    expect(result.warnings).toContain('sentinel_catalog_unavailable');
  });

  test('rejects malformed tile coordinates before touching an upstream provider', async () => {
    await expect(getOpticalTile({ source: 'sentinel', z: 99, x: 0, y: 0, date: '2026-10-05' }))
      .rejects.toMatchObject({ failureClass: 'malformed' });
  });
});
