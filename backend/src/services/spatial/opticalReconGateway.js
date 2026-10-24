'use strict';

/**
 * Optical reconnaissance evidence fabric.
 *
 * Primary:
 *   Digital Earth Africa Sentinel-2 L2A C1 STAC + public OWS
 *
 * Secondary:
 *   OpenAerialMap STAC/TiTiler for opportunistic higher-resolution
 *   openly licensed aerial/drone imagery.
 *
 * Fallback:
 *   NASA GIBS daily MODIS true-colour tile service.
 *
 * This gateway discovers evidence; it does not claim that an image is live
 * telemetry or that display enhancement creates native resolution.
 */

const DEA_STAC_SEARCH = 'https://explorer.digitalearth.africa/stac/search';
const DEA_WMS = 'https://ows.digitalearth.africa/wms';
const DEA_COLLECTION = 's2_l2a_c1';
const OAM_STAC_SEARCH = 'https://api.imagery.hotosm.org/stac/search';
const OAM_TILE_BASE = 'https://api.imagery.hotosm.org/raster/collections/openaerialmap/items';
const OAM_GLOBAL_TILE_BASE = 'https://global.imagery.hotosm.org';
const OPEN_CITIES_COG_BASE = 'https://data.source.coop/open-cities/ai-challenge';
const OPEN_CITIES_ITEMS = Object.freeze({
  'dar-5fe6fb': Object.freeze({
    id: 'open-cities:dar:5fe6fb', itemId: 'dar-5fe6fb',
    mission: 'Open Cities drone archive · Dar es Salaam', area: 'Dar es Salaam, Tanzania',
    acquiredAt: '2017-11-01T00:00:00Z', date: '2017-11-01',
    bbox: [39.19532486780871, -6.805003033328566, 39.227786910904726, -6.773897997440206],
    licence: 'ODbL-1.0', licenceVerified: true, licenceSource: 'catalog_metadata',
    sourceMetadataUrl: OPEN_CITIES_COG_BASE + '/train_tier_2/dar/5fe6fb/5fe6fb.json',
    cogUrl: OPEN_CITIES_COG_BASE + '/train_tier_2/dar/5fe6fb/5fe6fb.tif', nativeResolutionM: null,
  }),
});
function openCitiesTilerBase() {
  return String(process.env.OPEN_CITIES_TITILER_BASE_URL || 'https://titiler.xyz').trim().replace(/[/]+$/, '');
}
const NASA_GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default';
const VANTOR_BASEMAP_WMTS = 'https://api.maxar.com/basemaps/v1/ogc/gwc/service/wmts';
const VANTOR_PRODUCTS = Object.freeze({
  VIVID_STANDARD_30: { productGsdM: 0.3, productGsdLabel: '30 cm product GSD' },
  VIVID_ADVANCED_15: { productGsdM: 0.15, productGsdLabel: '15 cm HD product GSD' },
});
const MAX_RADIUS_M = 120_000;
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 96;
const searchCache = new Map();
const inflight = new Map();
const tileCache = new Map();

/**
 * Commercial Vantor streaming is deliberately fail-closed.
 * Enable only after the account is provisioned and the signed licence
 * explicitly permits streaming/embedding in Sonalit's multi-tenant product.
 * Never send VANTOR_API_KEY to the browser.
 */
function getVantorBasemapConfig() {
  const requestedProduct = String(process.env.VANTOR_VIVID_PRODUCT || 'VIVID_STANDARD_30').trim().toUpperCase();
  const product = VANTOR_PRODUCTS[requestedProduct] ? requestedProduct : null;
  const enabledFlag = String(process.env.VANTOR_VIVID_ENABLED || '').toLowerCase() === 'true';
  const licenseConfirmed = String(process.env.VANTOR_VIVID_LICENSE_CONFIRMED || '').toLowerCase() === 'true';
  const apiKey = String(process.env.VANTOR_API_KEY || '').trim();
  let state = 'disabled';
  if (enabledFlag) {
    if (!licenseConfirmed) state = 'license_confirmation_required';
    else if (!product) state = 'invalid_product';
    else if (!apiKey) state = 'api_key_required';
    else state = 'ready';
  }
  const productSpec = product ? VANTOR_PRODUCTS[product] : null;
  return {
    provider: 'Vantor Vivid Mosaic',
    enabled: state === 'ready',
    state,
    product,
    productGsdM: productSpec?.productGsdM ?? null,
    productGsdLabel: productSpec?.productGsdLabel ?? null,
    resolutionSemantics: 'provider_product_gsd_not_native_sensor_resolution',
  };
}

function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function bboxFromCenter(lat, lng, radiusM) {
  const r = Math.min(Math.max(Number(radiusM) || 25_000, 2_000), MAX_RADIUS_M);
  const dLat = (r / 6371000) * (180 / Math.PI);
  const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
  const dLng = (r / 6371000) * (180 / Math.PI) / cos;
  return [
    Math.max(-180, lng - dLng),
    Math.max(-90, lat - dLat),
    Math.min(180, lng + dLng),
    Math.min(90, lat + dLat),
  ];
}

function isoDate(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function freshnessClass(acquiredAt) {
  const t = Date.parse(String(acquiredAt || ''));
  if (!Number.isFinite(t)) return 'UNKNOWN';
  const age = Math.max(0, Date.now() - t);
  if (age <= 24 * 3600000) return 'FRESH';
  if (age <= 72 * 3600000) return 'RECENT';
  if (age <= 14 * 86400000) return 'AGING';
  return 'OLD';
}

function bboxIntersects(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4
    && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function openCitiesScenesForBbox(bbox) {
  return Object.values(OPEN_CITIES_ITEMS).filter(scene => bboxIntersects(scene.bbox, bbox)).map(scene => ({
    id: scene.id, provider: 'open-cities-ai-challenge', mission: scene.mission,
    sensor: 'drone orthomosaic (archive)', itemId: scene.itemId,
    acquiredAt: scene.acquiredAt, date: scene.date, cloudPct: null,
    nativeResolutionM: scene.nativeResolutionM, footprintBbox: scene.bbox, geometry: null,
    licence: scene.licence, licenceVerified: scene.licenceVerified, licenceSource: scene.licenceSource,
    sourceMetadataUrl: scene.sourceMetadataUrl, freshness: freshnessClass(scene.acquiredAt),
    capabilities: ['drone', 'high-detail', 'historical-archive', 'rgb-cog'],
    score: scoreCandidate({ acquiredAt: scene.acquiredAt, gsdM: undefined, coverage: 1, licenceOk: true }),
    renderable: true,
    recommendation: 'Historical drone archive acquired 2017-11-01. The item metadata does not declare native GSD; this is not current reconnaissance.',
    render: { source: 'open-cities', date: scene.date, itemId: scene.itemId },
  }));
}

function trim(map, max) {
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

function scoreCandidate({ acquiredAt, cloudPct, gsdM, coverage = 1, licenceOk = true }) {
  const t = Date.parse(String(acquiredAt || ''));
  const ageHours = Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 3600000) : 9999;
  const freshness = Math.max(0, 1 - Math.min(ageHours, 24 * 30) / (24 * 30));
  const cloud = Number.isFinite(Number(cloudPct))
    ? Math.max(0, 1 - Math.min(Number(cloudPct), 100) / 100)
    : 0.45;
  const resolution = Number.isFinite(Number(gsdM))
    ? Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, Number(gsdM))) / 2.5))
    : 0.25;
  return (freshness * 0.48) + (cloud * 0.27) + (resolution * 0.20) + (Math.max(0, Math.min(1, coverage)) * 0.05) + (licenceOk ? 0.02 : -0.5);
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/geo+json, application/json',
      'User-Agent': 'Sonalit-Optical-Recon/1.0',
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function searchSentinel2(bbox, signal) {
  const params = new URLSearchParams({
    collections: DEA_COLLECTION,
    bbox: bbox.map(v => Number(v).toFixed(6)).join(','),
    datetime: daysAgoIso(21) + '/' + new Date().toISOString(),
    limit: '24',
    sortby: '-datetime',
  });
  const data = await jsonFetch(DEA_STAC_SEARCH + '?' + params.toString(), { signal });
  const items = (data.features || []).map((item) => {
    const p = item.properties || {};
    const acquiredAt = isoDate(p.datetime || p['start_datetime'] || item.datetime);
    const cloudPct = Number(p['eo:cloud_cover'] ?? p.cloud_cover);
    const gsdM = Number(p.gsd ?? 10);
    const geometry = item.geometry || null;
    return {
      id: 'sentinel2:' + String(item.id),
      provider: 'digital-earth-africa',
      mission: 'Sentinel-2',
      sensor: String(p['instruments'] || p.instrument || 'MSI'),
      itemId: String(item.id),
      acquiredAt,
      date: acquiredAt ? acquiredAt.slice(0, 10) : null,
      cloudPct: Number.isFinite(cloudPct) ? cloudPct : null,
      nativeResolutionM: gsdM,
      geometry,
      licence: 'Copernicus Sentinel data — free/open for commercial use',
      freshness: freshnessClass(acquiredAt),
      capabilities: ['true-color', 'false-color', 'ndvi', '10m'],
      score: scoreCandidate({ acquiredAt, cloudPct, gsdM }),
      renderable: true,
      render: {
        source: 'sentinel',
        date: acquiredAt ? acquiredAt.slice(0, 10) : null,
        layer: DEA_COLLECTION,
      },
    };
  }).filter(x => x.acquiredAt);
  return { items, error: null };
}

async function searchOam(bbox, signal) {
  try {
    const body = {
      bbox,
      limit: 12,
      sortby: [{ field: 'datetime', direction: 'desc' }],
    };
    const data = await jsonFetch(OAM_STAC_SEARCH, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
    const items = (data.features || []).map((item) => {
      const p = item.properties || {};
      const acquiredAt = isoDate(p.datetime || p.created || item.datetime);
      const gsdM = Number(p.gsd ?? p['gsd'] ?? p.resolution);
      const cloudPct = Number(p['eo:cloud_cover'] ?? p.cloud_cover);
      const rawLicense = p.license || item.license || null;
      const license = rawLicense ? String(rawLicense) : 'Item-level licence metadata unavailable';
      const licenseText = license.toLowerCase();
      const licenseOk = Boolean(rawLicense)
        && /(?:cc[-_ ]?by(?:[-_ ]?sa)?|creativecommons\.org\/licenses\/(?:by|by-sa)\/|cc0|public[- ]domain)/i.test(licenseText)
        && !/(?:non[- ]?commercial|cc[-_ ]?by[-_ ]?nc|no[-_ ]?derivatives|cc[-_ ]?by[-_ ]?nd)/i.test(licenseText);
      return {
        id: 'oam:' + String(item.id),
        provider: 'openaerialmap',
        mission: 'OpenAerialMap',
        sensor: String(p.sensor || p.platform || 'aerial / drone'),
        itemId: String(item.id),
        acquiredAt,
        date: acquiredAt ? acquiredAt.slice(0, 10) : null,
        cloudPct: Number.isFinite(cloudPct) ? cloudPct : null,
        nativeResolutionM: Number.isFinite(gsdM) ? gsdM : null,
        geometry: item.geometry || null,
        licence: license,
        licenceVerified: Boolean(rawLicense),
        licenceSource: rawLicense ? 'item_metadata' : 'missing_item_metadata',
        freshness: freshnessClass(acquiredAt),
        capabilities: ['high-detail', 'aerial', 'drone'],
        score: scoreCandidate({ acquiredAt, cloudPct, gsdM, licenceOk: licenseOk }),
        renderable: licenseOk,
        render: licenseOk ? {
          source: 'oam',
          itemId: String(item.id),
        } : null,
      };
    }).filter(x => x.acquiredAt);
    return { items, error: null };
  } catch (error) {
    return { items: [], error: String(error && error.message || error) };
  }
}

function chooseSentinel(items) {
  const usable = items.filter(x => Number.isFinite(x.cloudPct) && x.cloudPct <= 40);
  const latest = items[0] || null;
  const selected = usable[0] || latest;
  return { selected, latest, usableCount: usable.length };
}

async function getOpticalRecon({ latitude, longitude, radiusM = 25_000, signal } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!validPoint(lat, lng)) {
    const error = new Error('Invalid reconnaissance centre coordinates');
    error.failureClass = 'malformed';
    throw error;
  }

  const bbox = bboxFromCenter(lat, lng, radiusM);
  const key = bbox.map(v => v.toFixed(3)).join(',');
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, premiumBasemap: getVantorBasemapConfig(), cache: { hit: true, ageMs: Date.now() - cached.createdAt } };
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const [sentinelResult, oamResult] = await Promise.all([
      searchSentinel2(bbox, signal).catch(error => ({ items: [], error: String(error && error.message || error) })),
      searchOam(bbox, signal),
    ]);
    const sentinel = sentinelResult.items || [];
    const oam = oamResult.items || [];
    const openCitiesScenes = openCitiesScenesForBbox(bbox);
    const s2 = chooseSentinel(sentinel);
    const fallbackDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const render = s2.selected
      ? s2.selected.render
      : { source: 'nasa', date: fallbackDate };

    const allCandidates = [...sentinel, ...oam].sort((a, b) => {
      const at = Date.parse(String(a.acquiredAt || '')) || 0;
      const bt = Date.parse(String(b.acquiredAt || '')) || 0;
      if (at !== bt) return bt - at;
      return Number(b.score || 0) - Number(a.score || 0);
    });

    const value = {
      centre: { latitude: lat, longitude: lng },
      bbox,
      generatedAt: new Date().toISOString(),
      premiumBasemap: getVantorBasemapConfig(),
      primary: s2.selected ? {
        ...s2.selected,
        recommendation: Number(s2.selected.cloudPct ?? 100) <= 20
          ? 'Best current optical scene: fresh + low cloud.'
          : Number(s2.selected.cloudPct ?? 100) <= 40
            ? 'Best current optical scene after freshness, cloud and resolution screening.'
            : 'Newest scene found, but cloud contamination is material.',
      } : {
        provider: 'nasa-gibs',
        mission: 'NASA MODIS',
        acquiredAt: fallbackDate + 'T00:00:00Z',
        date: fallbackDate,
        nativeResolutionM: 250,
        freshness: 'RAPID_FALLBACK',
        licence: 'NASA Earth observation data',
        recommendation: 'Sentinel-2 scene search returned no usable current scene; rapid Earth-observation fallback is shown.',
        render: { source: 'nasa', date: fallbackDate },
      },
      precisionAlternative: oam
        .filter(x => x.renderable)
        .sort((a, b) => (a.nativeResolutionM ?? 999) - (b.nativeResolutionM ?? 999) || b.score - a.score)[0] || null,
      candidates: allCandidates.slice(0, 18),
      openCitiesScenes,
      render,
      quality: {
        state: s2.selected
          ? ((sentinelResult.error || oamResult.error) ? 'available_with_provider_warnings' : 'available')
          : ((sentinelResult.error || oamResult.error) ? 'provider_degraded_fallback' : 'fallback'),
        freshness: s2.selected?.freshness || 'RAPID_FALLBACK',
        nativeResolutionM: s2.selected?.nativeResolutionM ?? 250,
        cloudPct: s2.selected?.cloudPct ?? null,
        provider: render.source === 'sentinel' ? 'Digital Earth Africa / Sentinel-2' : 'NASA GIBS / MODIS',
      },
      coverage: {
        sentinel2Scenes: sentinel.length,
        lowCloudScenes: s2.usableCount,
        openAerialMapCandidates: oam.length,
      openCitiesArchiveScenes: openCitiesScenesForBbox(bbox).length,
      },
      warnings: [
        ...(sentinelResult.error ? ['sentinel_catalog_unavailable'] : []),
        ...(oamResult.error ? ['openaerialmap_catalog_unavailable'] : []),
        ...(s2.selected && Number(s2.selected.cloudPct ?? 0) > 40 ? ['latest_sentinel2_scene_has_high_cloud_cover'] : []),
      ],
      semantics: [
        'Acquisition time is source metadata; imagery is not live telemetry.',
        'Open Cities scenes are historical, fixed-footprint COGs; coverage and native GSD are item-specific.',
        'The public TiTiler endpoint is a shared community service; set OPEN_CITIES_TITILER_BASE_URL to a Sonalit-managed deployment for production-grade control.',
        'Native resolution is reported separately from any display enhancement.',
        "Commercial tasking and live-imaging claims are outside this module's evidence contract.",
      ],
    };

    searchCache.set(key, { value, createdAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS });
    trim(searchCache, CACHE_MAX);
    return { ...value, cache: { hit: false } };
  })();

  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

function tileBbox3857(z, x, y) {
  const n = Math.pow(2, z);
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat1 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat2 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const R = 6378137;
  const project = (lon, lat) => {
    const mx = R * lon * Math.PI / 180;
    const my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    return [mx, my];
  };
  const a = project(lon1, lat2);
  const b = project(lon2, lat1);
  return [a[0], a[1], b[0], b[1]];
}

async function getOpticalTile({ source = 'sentinel', date, z, x, y, itemId } = {}) {
  const zoom = Number(z);
  const tx = Number(x);
  const ty = Number(y);
  const maxTile = 2 ** zoom;
  if (![zoom, tx, ty].every(Number.isInteger) || zoom < 0 || zoom > 21 || tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) {
    const error = new Error('Invalid optical tile coordinates');
    error.failureClass = 'malformed';
    throw error;
  }

  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const cacheKey = [source, safeDate, itemId || '', zoom, tx, ty].join(':');
  // Keep commercial Vantor imagery out of local caches until the provider
  // licence explicitly establishes the permitted caching model.
  const cacheable = source !== 'vantor';
  const cached = cacheable ? tileCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached;

  let url;
  let headers = { Accept: 'image/png,image/jpeg,image/*', 'User-Agent': 'Sonalit-Optical-Recon/1.0' };
  let archiveScene = null;
  if (source === 'oam-global') {
    // HOTOSM documents a coverage grid at z0–13 and contributed imagery
    // from z14 onward; this is not a uniform-resolution global satellite map.
    url = OAM_GLOBAL_TILE_BASE + '/' + zoom + '/' + tx + '/' + ty + '.png';
  } else if (source === 'open-cities') {
    archiveScene = OPEN_CITIES_ITEMS[String(itemId || '')] || null;
    if (!archiveScene) {
      const error = new Error('Unknown Open Cities archive item');
      error.failureClass = 'invalid_archive_item';
      throw error;
    }
    const params = new URLSearchParams({ url: archiveScene.cogUrl, resampling: 'bilinear' });
    params.append('bidx', '1'); params.append('bidx', '2'); params.append('bidx', '3');
    url = openCitiesTilerBase() + '/cog/tiles/WebMercatorQuad/' + zoom + '/' + tx + '/' + ty + '.png?' + params.toString();
  } else if (source === 'vantor') {
    const config = getVantorBasemapConfig();
    if (!config.enabled) {
      const error = new Error('Vantor high-resolution imagery is not licensed and configured');
      error.failureClass = 'provider_unconfigured';
      throw error;
    }
    const params = new URLSearchParams({
      service: 'WMTS', request: 'GetTile', version: '1.0.0', layer: 'Maxar:Imagery', style: 'raster',
      tileMatrixSet: 'EPSG:3857', tileMatrix: 'EPSG:3857:' + zoom, tileCol: String(tx), tileRow: String(ty),
      format: 'image/jpeg', cql_filter: "productName='" + config.product + "'",
    });
    url = VANTOR_BASEMAP_WMTS + '?' + params.toString();
    headers['maxar-api-key'] = String(process.env.VANTOR_API_KEY).trim();
  } else if (source === 'oam' && /^[A-Za-z0-9._-]+$/.test(String(itemId || ''))) {
    url = OAM_TILE_BASE + '/' + encodeURIComponent(String(itemId)) + '/tiles/WebMercatorQuad/' + zoom + '/' + tx + '/' + ty + '?assets=visual&nodata=0';
  } else if (source === 'nasa') {
    const n = Math.pow(2, zoom);
    const datePath = safeDate;
    url = NASA_GIBS + '/' + datePath + '/GoogleMapsCompatible_Level9/' + zoom + '/' + ty + '/' + tx + '.jpg';
  } else {
    const bbox = tileBbox3857(zoom, tx, ty);
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      REQUEST: 'GetMap',
      LAYERS: DEA_COLLECTION,
      STYLES: '',
      CRS: 'EPSG:3857',
      BBOX: bbox.join(','),
      WIDTH: '256',
      HEIGHT: '256',
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
      TIME: safeDate,
      SHOWLOGO: 'false',
    });
    url = DEA_WMS + '?' + params.toString();
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error('Optical imagery tile HTTP ' + response.status);
    error.failureClass = response.status === 429 ? 'rate_limited' : 'http_error';
    throw error;
  }
  const upstreamContentType = response.headers.get('content-type');
  if (!upstreamContentType || !/^image\//i.test(upstreamContentType)) {
    const error = new Error(source === 'vantor'
      ? 'Vantor imagery service returned a non-image response'
      : source === 'open-cities'
        ? 'Open Cities COG tiler returned a non-image response'
        : 'Open imagery provider returned a non-image response');
    error.failureClass = 'provider_invalid_response';
    throw error;
  }
  const contentType = upstreamContentType || (source === 'nasa' || source === 'oam' || source === 'vantor' ? 'image/jpeg' : 'image/png');
  const buffer = Buffer.from(await response.arrayBuffer());
  const result = { buffer, contentType, expiresAt: Date.now() + 5 * 60_000,
    ...(archiveScene ? { licence: archiveScene.licence, sourceMetadataUrl: archiveScene.sourceMetadataUrl } : {}),
  };
  if (cacheable) {
    tileCache.set(cacheKey, result);
    trim(tileCache, 256);
  }
  return result;
}

function resetOpticalReconCaches() {
  searchCache.clear();
  inflight.clear();
  tileCache.clear();
}

module.exports = {
  bboxFromCenter,
  getOpticalRecon,
  getOpticalTile,
  getVantorBasemapConfig,
  freshnessClass,
  resetOpticalReconCaches,
  searchOam,
};
