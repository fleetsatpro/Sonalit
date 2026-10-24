const {
  bboxFromCenter,
  freshnessClass,
  getOpticalRecon,
  getOpticalTile,
  getVantorBasemapConfig,
  resetOpticalReconCaches,
} = require('../src/services/spatial/opticalReconGateway');

describe('free optical reconnaissance gateway', () => {
  const originalFetch = global.fetch;
  const originalVantorEnv = {
    VANTOR_API_KEY: process.env.VANTOR_API_KEY,
    VANTOR_VIVID_ENABLED: process.env.VANTOR_VIVID_ENABLED,
    VANTOR_VIVID_LICENSE_CONFIRMED: process.env.VANTOR_VIVID_LICENSE_CONFIRMED,
    VANTOR_VIVID_PRODUCT: process.env.VANTOR_VIVID_PRODUCT,
    OPEN_CITIES_TITILER_BASE_URL: process.env.OPEN_CITIES_TITILER_BASE_URL,
  };

  beforeEach(() => {
    resetOpticalReconCaches();
  });

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

  test('recognises an explicit Creative Commons licence URL on an OpenAerialMap item', async () => {
    global.fetch = jest.fn(async url => {
      const target = String(url);
      if (target.includes('explorer.digitalearth.africa/stac/search')) return { ok: true, json: async () => ({ features: [] }) };
      if (target.includes('api.imagery.hotosm.org/stac/search')) return { ok: true, json: async () => ({ features: [{
        id: 'licensed-item',
        geometry: { type: 'Polygon', coordinates: [] },
        properties: { datetime: '2026-10-10T10:00:00Z', gsd: 0.05, license: 'https://creativecommons.org/licenses/by/4.0/' },
      }] }) };
      throw new Error('unexpected fetch: ' + target);
    });
    const result = await getOpticalRecon({ latitude: 8.1264, longitude: 34.5618, radiusM: 18_000 });
    expect(result.coverage.openAerialMapCandidates).toBe(1);
    expect(result.warnings).not.toContain('openaerialmap_catalog_unavailable');
    const candidate = result.candidates.find(item => item.id === 'oam:licensed-item');
    expect(candidate).toMatchObject({ renderable: true, licenceVerified: true, licenceSource: 'item_metadata' });
    expect(candidate.render).toMatchObject({ source: 'oam', itemId: 'licensed-item' });
    expect(result.precisionAlternative?.id).toBe('oam:licensed-item');
  });

  test('does not render an OpenAerialMap item when item-level licence metadata is absent', async () => {
    global.fetch = jest.fn(async (url) => {
      const target = String(url);
      if (target.includes('explorer.digitalearth.africa/stac/search')) {
        return { ok: true, json: async () => ({ features: [] }) };
      }
      if (target.includes('api.imagery.hotosm.org/stac/search')) {
        return { ok: true, json: async () => ({ features: [{
          id: 'no-license-item',
          geometry: { type: 'Polygon', coordinates: [] },
          properties: { datetime: '2026-09-20T10:00:00Z', gsd: 0.08 },
        }] }) };
      }
      throw new Error('unexpected fetch: ' + target);
    });
    const result = await getOpticalRecon({ latitude: 8.1234, longitude: 34.5678, radiusM: 18_000 });
    expect(result.coverage.openAerialMapCandidates).toBe(1);
    expect(result.warnings).not.toContain('openaerialmap_catalog_unavailable');
    const candidate = result.candidates.find(item => item.id === 'oam:no-license-item');
    expect(candidate).toMatchObject({
      renderable: false,
      licenceVerified: false,
      licenceSource: 'missing_item_metadata',
      render: null,
      licence: 'Item-level licence metadata unavailable',
      nativeResolutionM: 0.08,
    });
    expect(result.precisionAlternative).toBeNull();
  });

  test('requests and briefly caches the documented HOTOSM global XYZ mosaic tiles', async () => {
    const requests = [];
    global.fetch = jest.fn(async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      };
    });
    const args = { source: 'oam-global', date: 'mosaic', z: 14, x: 8299, y: 6377 };
    const first = await getOpticalTile(args);
    const second = await getOpticalTile(args);
    expect(first.contentType).toBe('image/png');
    expect(second.buffer).toBeInstanceOf(Buffer);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toBe('https://global.imagery.hotosm.org/14/8299/6377.png');
  });

  test('rejects a global open-imagery response that is not an image', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html' },
      arrayBuffer: async () => new TextEncoder().encode('upstream error').buffer,
    }));
    await expect(getOpticalTile({ source: 'oam-global', z: 14, x: 8300, y: 6377, date: 'mosaic' }))
      .rejects.toMatchObject({ failureClass: 'provider_invalid_response' });
  });

  test('indexes the published Dar es Salaam Open Cities archive only when the AOI intersects its real footprint', async () => {
    global.fetch = jest.fn(async url => {
      const target = String(url);
      if (target.includes('explorer.digitalearth.africa/stac/search')) return { ok: true, json: async () => ({ features: [] }) };
      if (target.includes('api.imagery.hotosm.org/stac/search')) return { ok: true, json: async () => ({ features: [] }) };
      throw new Error('unexpected fetch: ' + target);
    });
    const covered = await getOpticalRecon({ latitude: -6.79, longitude: 39.21, radiusM: 8_000 });
    expect(covered.openCitiesScenes).toHaveLength(1);
    expect(covered.openCitiesScenes[0]).toMatchObject({
      id: 'open-cities:dar:5fe6fb', provider: 'open-cities-ai-challenge',
      acquiredAt: '2017-11-01T00:00:00Z', nativeResolutionM: null,
      licence: 'ODbL-1.0', licenceVerified: true, renderable: true,
      render: { source: 'open-cities', itemId: 'dar-5fe6fb' },
    });
    expect(covered.openCitiesScenes[0].recommendation).toContain('does not declare native GSD');
    const outside = await getOpticalRecon({ latitude: -1.286389, longitude: 36.817223, radiusM: 8_000 });
    expect(outside.openCitiesScenes).toHaveLength(0);
  });

  test('renders only allow-listed Open Cities COGs through TiTiler and reports their licence', async () => {
    process.env.OPEN_CITIES_TITILER_BASE_URL = 'https://tiler.example.test/';
    const requests = [];
    global.fetch = jest.fn(async (url, init) => {
      requests.push({ url: String(url), init });
      return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
    });
    const first = await getOpticalTile({ source: 'open-cities', itemId: 'dar-5fe6fb', date: '2017-11-01', z: 18, x: 159623, y: 136027 });
    expect(first.contentType).toBe('image/png');
    expect(first.licence).toBe('ODbL-1.0');
    expect(first.sourceMetadataUrl).toContain('/train_tier_2/dar/5fe6fb/5fe6fb.json');
    expect(requests).toHaveLength(1);
    const requestUrl = new URL(requests[0].url);
    expect(requestUrl.origin).toBe('https://tiler.example.test');
    expect(requestUrl.pathname).toBe('/cog/tiles/WebMercatorQuad/18/159623/136027.png');
    expect(requestUrl.searchParams.get('url')).toBe('https://data.source.coop/open-cities/ai-challenge/train_tier_2/dar/5fe6fb/5fe6fb.tif');
    expect(requestUrl.searchParams.getAll('bidx')).toEqual(['1', '2', '3']);
    global.fetch = jest.fn();
    await expect(getOpticalTile({ source: 'open-cities', itemId: 'https://attacker.example/payload.tif', z: 18, x: 1, y: 1 }))
      .rejects.toMatchObject({ failureClass: 'invalid_archive_item' });
    expect(global.fetch).not.toHaveBeenCalled();
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
