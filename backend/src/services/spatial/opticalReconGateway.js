'use strict';

/**
 * Free optical reconnaissance fabric.
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
const NASA_GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default';
const MAX_RADIUS_M = 120_000;
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 96;
const searchCache = new Map();
const inflight = new Map();
const tileCache = new Map();

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
      const license = String(p.license || item.license || 'CC-BY 4.0');
      const licenseOk = /cc[-_ ]?by/i.test(license) || /public/i.test(license);
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
        freshness: freshnessClass(acquiredAt),
        capabilities: ['high-detail', 'aerial', 'drone'],
        score: scoreCandidate({ acquiredAt, cloudPct, gsdM, licenceOk }),
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
    return { ...cached.value, cache: { hit: true, ageMs: Date.now() - cached.createdAt } };
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const [sentinelResult, oamResult] = await Promise.all([
      searchSentinel2(bbox, signal).catch(error => ({ items: [], error: String(error && error.message || error) })),
      searchOam(bbox, signal),
    ]);
    const sentinel = sentinelResult.items || [];
    const oam = oamResult.items || [];
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
      primary: s2.selected ? {
        ...s2.selected,
        recommendation: Number(s2.selected.cloudPct ?? 100) <= 20
          ? 'Best current optical scene: fresh + low cloud.'
          : Number(s2.selected.cloudPct ?? 100) <= 40
            ? 'Best current optical scene within the free global backbone.'
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
      },
      warnings: [
        ...(sentinelResult.error ? ['sentinel_catalog_unavailable'] : []),
        ...(oamResult.error ? ['openaerialmap_catalog_unavailable'] : []),
        ...(s2.selected && Number(s2.selected.cloudPct ?? 0) > 40 ? ['latest_sentinel2_scene_has_high_cloud_cover'] : []),
      ],
      semantics: [
        'Acquisition time is source metadata; imagery is not live telemetry.',
        'Native resolution is reported separately from any display enhancement.',
        'No paid commercial imagery is used by this module.',
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
  if (![zoom, tx, ty].every(Number.isInteger) || zoom < 0 || zoom > 19 || tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) {
    const error = new Error('Invalid optical tile coordinates');
    error.failureClass = 'malformed';
    throw error;
  }

  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const key = [source, safeDate, itemId || '', zoom, tx, ty].join(':');
  const cached = tileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  let url;
  if (source === 'oam' && /^[A-Za-z0-9._-]+$/.test(String(itemId || ''))) {
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
    headers: { Accept: 'image/png,image/jpeg,image/*', 'User-Agent': 'Sonalit-Optical-Recon/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error('Optical imagery tile HTTP ' + response.status);
    error.failureClass = response.status === 429 ? 'rate_limited' : 'http_error';
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const result = {
    buffer,
    contentType: response.headers.get('content-type') || (source === 'nasa' || source === 'oam' ? 'image/jpeg' : 'image/png'),
    expiresAt: Date.now() + 5 * 60_000,
  };
  tileCache.set(key, result);
  trim(tileCache, 256);
  return result;
}

module.exports = {
  bboxFromCenter,
  getOpticalRecon,
  getOpticalTile,
  freshnessClass,
};
