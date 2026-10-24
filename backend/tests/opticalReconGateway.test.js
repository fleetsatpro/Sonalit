const {
  bboxFromCenter,
  freshnessClass,
  getOpticalRecon,
  getOpticalTile,
  getVantorBasemapConfig,
} = require('../src/services/spatial/opticalReconGateway');

describe('free optical reconnaissance gateway', () => {
  const originalFetch = global.fetch;
  const originalVantorEnv = {
    VANTOR_API_KEY: process.env.VANTOR_API_KEY,
    VANTOR_VIVID_ENABLED: process.env.VANTOR_VIVID_ENABLED,
    VANTOR_VIVID_LICENSE_CONFIRMED: process.env.VANTOR_VIVID_LICENSE_CONFIRMED,
    VANTOR_VIVID_PRODUCT: process.env.VANTOR_VIVID_PRODUCT,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalVantorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
    expect(freshnessClass(new Date(Date.now() - 4 * 86400000).toISOString())).toBe('AGING');
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
      latitude: -1.287389,
      longitude: 36.818223,
      radiusM: 36_000,
    });

    expect(result.primary.provider).toBe('nasa-gibs');
    expect(result.quality.state).toBe('provider_degraded_fallback');
    expect(result.warnings).toContain('sentinel_catalog_unavailable');
  });

  test('keeps Vantor disabled until enablement, API key and licence confirmation are all present', () => {
    delete process.env.VANTOR_VIVID_ENABLED;
    delete process.env.VANTOR_API_KEY;
    delete process.env.VANTOR_VIVID_LICENSE_CONFIRMED;
    expect(getVantorBasemapConfig()).toMatchObject({ enabled: false, state: 'disabled' });
    process.env.VANTOR_VIVID_ENABLED = 'true';
    process.env.VANTOR_API_KEY = 'unit-test-key';
    process.env.VANTOR_VIVID_LICENSE_CONFIRMED = 'false';
    expect(getVantorBasemapConfig()).toMatchObject({ enabled: false, state: 'license_confirmation_required' });
    process.env.VANTOR_VIVID_LICENSE_CONFIRMED = 'true';
    expect(getVantorBasemapConfig()).toMatchObject({ enabled: true, state: 'ready', product: 'VIVID_STANDARD_30', productGsdM: 0.3, productGsdLabel: '30 cm product GSD', resolutionSemantics: 'provider_product_gsd_not_native_sensor_resolution' });
  });

  test('requests Vantor Vivid tiles server-side and does not locally cache commercial tiles', async () => {
    process.env.VANTOR_VIVID_ENABLED = 'true';
    process.env.VANTOR_API_KEY = 'unit-test-key';
    process.env.VANTOR_VIVID_LICENSE_CONFIRMED = 'true';
    process.env.VANTOR_VIVID_PRODUCT = 'VIVID_STANDARD_30';
    const requests = [];
    global.fetch = jest.fn(async (url, init) => {
      requests.push({ url: String(url), init });
      return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    });
    const args = { source: 'vantor', z: 19, x: 83913, y: 202939, date: 'mosaic' };
    const first = await getOpticalTile(args);
    const second = await getOpticalTile(args);
    const requestUrl = new URL(requests[0].url);
    expect(first.contentType).toBe('image/jpeg');
    expect(second.buffer).toBeInstanceOf(Buffer);
    expect(requests).toHaveLength(2);
    expect(requestUrl.pathname).toBe('/basemaps/v1/ogc/gwc/service/wmts');
    expect(requestUrl.searchParams.get('layer')).toBe('Maxar:Imagery');
    expect(requestUrl.searchParams.get('tileMatrix')).toBe('EPSG:3857:19');
    expect(requestUrl.searchParams.get('tileCol')).toBe('83913');
    expect(requestUrl.searchParams.get('tileRow')).toBe('202939');
    expect(requestUrl.searchParams.get('cql_filter')).toBe("productName='VIVID_STANDARD_30'");
    expect(requests[0].init.headers['maxar-api-key']).toBe('unit-test-key');
    expect(requests[0].url).not.toContain('unit-test-key');
  });

  test('rejects unlicensed Vantor tiles before contacting the provider', async () => {
    process.env.VANTOR_VIVID_ENABLED = 'true'; process.env.VANTOR_API_KEY = 'unit-test-key'; process.env.VANTOR_VIVID_LICENSE_CONFIRMED = 'false';
    global.fetch = jest.fn();
    await expect(getOpticalTile({ source: 'vantor', z: 4, x: 2, y: 3, date: 'mosaic' })).rejects.toMatchObject({ failureClass: 'provider_unconfigured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects a Vantor HTTP 200 response that is not an image tile', async () => {
    process.env.VANTOR_VIVID_ENABLED = 'true';
    process.env.VANTOR_API_KEY = 'unit-test-key';
    process.env.VANTOR_VIVID_LICENSE_CONFIRMED = 'true';
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/xml' },
      arrayBuffer: async () => new TextEncoder().encode('<Exception>not entitled</Exception>').buffer,
    }));
    await expect(getOpticalTile({ source: 'vantor', z: 4, x: 2, y: 3, date: 'mosaic' }))
      .rejects.toMatchObject({ failureClass: 'provider_invalid_response' });
  });

  test('rejects malformed tile coordinates before touching an upstream provider', async () => {
    await expect(getOpticalTile({ source: 'sentinel', z: 99, x: 0, y: 0, date: '2026-10-05' }))
      .rejects.toMatchObject({ failureClass: 'malformed' });
  });
});
