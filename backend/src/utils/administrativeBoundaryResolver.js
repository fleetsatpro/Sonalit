'use strict';

const crypto = require('node:crypto');
const { normalizeBoundaryGeometry } = require('./geofenceAutoGeometry');

const BOUNDARY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const BOUNDARY_STALE_CACHE_TTL_SECONDS = 180 * 24 * 60 * 60;
const LAYER_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_JSON_CHARS = 30 * 1024 * 1024;
const REDIS_TIMEOUT_MS = 350;

const boundaryMemoryCache = new Map();
const layerMemoryCache = new Map();
const inFlightBoundary = new Map();
let lastNominatimRequestAt = 0;

const ISO2_TO_ISO3 = Object.freeze({
  KE: 'KEN', TZ: 'TZA', CD: 'COD', CG: 'COG', UG: 'UGA', RW: 'RWA',
  BI: 'BDI', SS: 'SSD', SD: 'SDN', ET: 'ETH', SO: 'SOM', DJ: 'DJI',
  ER: 'ERI', ZA: 'ZAF', ZW: 'ZWE', ZM: 'ZMB', MW: 'MWI', MZ: 'MOZ',
  BW: 'BWA', NA: 'NAM', AO: 'AGO', NG: 'NGA', GH: 'GHA', SN: 'SEN',
  ML: 'MLI', NE: 'NER', BF: 'BFA', CI: 'CIV', CM: 'CMR', CF: 'CAF',
  TD: 'TCD', GA: 'GAB', GQ: 'GNQ', LR: 'LBR', SL: 'SLE', GM: 'GMB',
  GN: 'GIN', MR: 'MRT', MA: 'MAR', DZ: 'DZA', TN: 'TUN', LY: 'LBY',
  EG: 'EGY', SA: 'SAU', AE: 'ARE', QA: 'QAT', TR: 'TUR', IN: 'IND',
  PK: 'PAK', BD: 'BGD', LK: 'LKA', NP: 'NPL', TH: 'THA', VN: 'VNM',
  MY: 'MYS', ID: 'IDN', PH: 'PHL', CN: 'CHN', JP: 'JPN', KR: 'KOR',
  AU: 'AUS', NZ: 'NZL', US: 'USA', CA: 'CAN', MX: 'MEX', BR: 'BRA',
  AR: 'ARG', CL: 'CHL', CO: 'COL', PE: 'PER', GB: 'GBR', IE: 'IRL',
  FR: 'FRA', DE: 'DEU', ES: 'ESP', PT: 'PRT', IT: 'ITA', NL: 'NLD',
  BE: 'BEL', CH: 'CHE', AT: 'AUT', SE: 'SWE', NO: 'NOR', DK: 'DNK',
  FI: 'FIN', PL: 'POL', UA: 'UKR', RO: 'ROU', GR: 'GRC', CY: 'CYP',
  IL: 'ISR', JO: 'JOR', IQ: 'IRQ', IR: 'IRN', AF: 'AFG', RU: 'RUS',
  KZ: 'KAZ', UZ: 'UZB', GE: 'GEO', AM: 'ARM', AZ: 'AZE',
});

const ISO2_TO_COUNTRY_NAME = Object.freeze({
  KE: 'Kenya', TZ: 'Tanzania', CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo', UG: 'Uganda', RW: 'Rwanda', BI: 'Burundi',
  SS: 'South Sudan', SD: 'Sudan', ET: 'Ethiopia', SO: 'Somalia',
  ZA: 'South Africa', ZW: 'Zimbabwe', ZM: 'Zambia', MW: 'Malawi',
  MZ: 'Mozambique', BW: 'Botswana', NA: 'Namibia', AO: 'Angola',
  NG: 'Nigeria', GH: 'Ghana', SN: 'Senegal', ML: 'Mali', NE: 'Niger',
  BF: 'Burkina Faso', CI: 'Côte d’Ivoire', CM: 'Cameroon', CF: 'Central African Republic',
  TD: 'Chad', GA: 'Gabon', EG: 'Egypt', MA: 'Morocco', DZ: 'Algeria',
  TN: 'Tunisia', LY: 'Libya', US: 'United States', CA: 'Canada',
  GB: 'United Kingdom', FR: 'France', DE: 'Germany', NL: 'Netherlands',
  BE: 'Belgium', ES: 'Spain', IT: 'Italy', PT: 'Portugal', CH: 'Switzerland',
  AU: 'Australia', NZ: 'New Zealand', IN: 'India', PK: 'Pakistan',
  AE: 'United Arab Emirates', SA: 'Saudi Arabia', BR: 'Brazil', MX: 'Mexico',
});

const PLACE_COUNTRY_HINTS = Object.freeze([
  { iso2: 'KE', terms: ['nairobi', 'mombasa', 'kisumu', 'nakuru', 'eldoret', 'kenya'] },
  { iso2: 'TZ', terms: ['dar es salaam', 'dodoma', 'arusha', 'mwanza', 'tanzania', 'tanzania'] },
  { iso2: 'CD', terms: ['kinshasa', 'goma', 'bukavu', 'lubumbashi', 'kolwezi', 'democratic republic of the congo', 'dr congo', 'drc'] },
  { iso2: 'CG', terms: ['brazzaville', 'pointe noire', 'republic of the congo'] },
  { iso2: 'UG', terms: ['kampala', 'gulu', 'uganda'] },
  { iso2: 'RW', terms: ['kigali', 'rwanda'] },
  { iso2: 'BI', terms: ['bujumbura', 'burundi'] },
  { iso2: 'SS', terms: ['juba', 'south sudan'] },
  { iso2: 'ZA', terms: ['johannesburg', 'cape town', 'durban', 'south africa'] },
  { iso2: 'ZM', terms: ['lusaka', 'zambia'] },
  { iso2: 'MW', terms: ['lilongwe', 'malawi'] },
  { iso2: 'MZ', terms: ['maputo', 'mozambique'] },
  { iso2: 'NG', terms: ['lagos', 'abuja', 'nigeria'] },
  { iso2: 'GH', terms: ['accra', 'kumasi', 'ghana'] },
  { iso2: 'SN', terms: ['dakar', 'senegal'] },
  { iso2: 'ML', terms: ['bamako', 'mali'] },
  { iso2: 'FR', terms: ['paris', 'marseille', 'france'] },
  { iso2: 'GB', terms: ['london', 'manchester', 'united kingdom', 'england'] },
  { iso2: 'US', terms: ['new york', 'washington dc', 'los angeles', 'united states', 'usa'] },
  { iso2: 'CA', terms: ['toronto', 'ottawa', 'canada'] },
  { iso2: 'AE', terms: ['dubai', 'abu dhabi', 'united arab emirates'] },
]);

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedCore(value) {
  return normalizeName(value)
    .replace(/\b(?:the|city|county|municipality|municipal|district|province|state|region|prefecture|governorate|administrative|boundary|division|department|metropolitan|metro)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeKey(place) {
  return crypto.createHash('sha256').update(normalizeName(place)).digest('hex').slice(0, 40);
}

function trimCache(cache, maxEntries) {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function putMemory(cache, key, value, maxEntries) {
  cache.delete(key);
  cache.set(key, { value, storedAt: Date.now() });
  trimCache(cache, maxEntries);
}

function readMemory(cache, key, ttlMs) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.storedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, item);
  return item.value;
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('cache_timeout')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function getRedisSafely() {
  try {
    return require('../config/redis').getRedis();
  } catch (_) {
    return null;
  }
}

async function redisRead(key) {
  const redis = getRedisSafely();
  if (!redis || typeof redis.get !== 'function') return null;
  try {
    const raw = await withTimeout(redis.get(key), REDIS_TIMEOUT_MS);
    if (!raw || typeof raw !== 'string' || raw.length > MAX_JSON_CHARS) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function redisWrite(key, value, ttlSeconds) {
  const redis = getRedisSafely();
  if (!redis || typeof redis.set !== 'function') return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_JSON_CHARS) return;
    await withTimeout(redis.set(key, serialized, 'EX', ttlSeconds), REDIS_TIMEOUT_MS);
  } catch (_) {
    // The process-local cache remains available if shared Redis is down.
  }
}

async function requestJson(url, { timeoutMs = 9000, headers = {} } = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const declaredSize = Number(response.headers?.get?.('content-length') || 0);
  if (declaredSize > MAX_JSON_CHARS) throw new Error('Response exceeded the boundary-data size limit.');
  const text = await response.text();
  if (text.length > MAX_JSON_CHARS) throw new Error('Response exceeded the boundary-data size limit.');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('The boundary provider returned invalid JSON.');
  }
}

function countryCodeFromCandidates(candidates) {
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const code = String(candidate?.address?.country_code || candidate?.country_code || '').trim().toUpperCase();
    if (ISO2_TO_ISO3[code]) return code;
  }
  return null;
}

function countryCodeFromPlace(place) {
  const normalized = normalizeName(place);
  for (const hint of PLACE_COUNTRY_HINTS) {
    if (hint.terms.some(term => {
      const normalizedTerm = normalizeName(term);
      return normalized === normalizedTerm
        || normalized.startsWith(normalizedTerm + ' ')
        || normalized.endsWith(' ' + normalizedTerm);
    })) return hint.iso2;
  }
  for (const [iso2, name] of Object.entries(ISO2_TO_COUNTRY_NAME)) {
    const normalizedName = normalizeName(name);
    if (normalized === normalizedName || normalized.endsWith(' ' + normalizedName)) return iso2;
  }
  return null;
}

function placeNameVariants(place) {
  const raw = String(place || '').trim();
  const variants = [raw];
  if (raw.includes(',')) variants.push(raw.split(',')[0].trim());
  for (const [iso2, countryName] of Object.entries(ISO2_TO_COUNTRY_NAME)) {
    const country = normalizeName(countryName);
    const normalized = normalizeName(raw);
    if (normalized.endsWith(' ' + country)) variants.push(normalized.slice(0, -(country.length + 1)));
    if (normalized.endsWith(' ' + iso2.toLowerCase())) variants.push(normalized.slice(0, -(iso2.length + 1)));
  }
  return [...new Set(variants.map(normalizeName).filter(Boolean))];
}

function candidateNameMatches(place, feature) {
  const properties = feature?.properties || {};
  const exactInputs = placeNameVariants(place);
  const requestedCores = [...new Set(exactInputs.map(normalizedCore).filter(Boolean))];
  const names = [
    properties.shapeName,
    properties.shapeNameAlt,
    properties.shapeNameLocal,
    properties.name,
    properties.NAME_1,
    properties.NAME_2,
    properties.admin,
  ].flatMap(value => Array.isArray(value) ? value : String(value || '').split(/[;|]/));
  const exact = names.map(normalizeName).filter(Boolean);
  if (exact.some(name => exactInputs.includes(name))) return true;
  const cores = exact.map(normalizedCore).filter(Boolean);
  return requestedCores.some(core => cores.includes(core));
}

function validateBoundaryPayload(geometry) {
  const normalized = normalizeBoundaryGeometry(geometry);
  const ring = normalized.coordinates[0];
  return { geometry: normalized, vertexCount: ring.length - 1 };
}

function makeBoundaryResult({ geometry, locationName, latitude, longitude, admin1, country, source, sourceUrl, sourceYear, license, attribution, osmType, osmId, simplificationToleranceDegrees, sourceId }) {
  const normalized = normalizeBoundaryGeometry(geometry);
  const ring = normalized.coordinates[0];
  const fetchedAt = new Date().toISOString();
  return {
    geometry: normalized,
    simplification_tolerance_degrees: simplificationToleranceDegrees ?? null,
    location: {
      latitude,
      longitude,
      name: locationName || locationNameFromPlace(locationName, country),
      admin1: admin1 || null,
      country: country || null,
      precision: 'source-backed-administrative-boundary',
      source,
      source_url: sourceUrl || null,
      source_year: sourceYear || null,
      license: license || null,
      attribution: attribution || source,
      source_id: sourceId || null,
      osm_type: osmType || null,
      osm_id: osmId || null,
      fetched_at: fetchedAt,
      vertex_count: ring.length - 1,
    },
  };
}

function locationNameFromPlace(name, country) {
  return [name, country].filter(Boolean).join(', ');
}

function boundaryCenter(geometry) {
  const ring = geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || !ring.length) return { latitude: null, longitude: null };
  const points = ring.slice(0, -1);
  const latitudes = points.map(point => Number(point[1])).filter(Number.isFinite);
  const longitudes = points.map(point => Number(point[0])).filter(Number.isFinite);
  if (!latitudes.length || !longitudes.length) return { latitude: null, longitude: null };
  // A bounded-box centre is a display anchor only; the polygon remains the
  // source geometry and this point is never used to generate its boundary.
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };
}

function resultFromGeoBoundaryFeature(feature, metadata, url) {
  const geometry = feature?.geometry;
  const { geometry: normalized, vertexCount } = validateBoundaryPayload(geometry);
  const center = boundaryCenter(normalized);
  const properties = feature.properties || {};
  const sourceName = properties.shapeName || properties.name || properties.NAME_1 || properties.NAME_2;
  const boundaryYear = metadata.boundaryYearRepresented || null;
  const source = 'geoBoundaries open administrative boundary dataset';
  return {
    geometry: normalized,
    simplification_tolerance_degrees: null,
    location: {
      latitude: center.latitude,
      longitude: center.longitude,
      name: String(sourceName || 'Administrative boundary') + (metadata.boundaryISO ? ', ' + (ISO2_TO_COUNTRY_NAME[String(metadata.boundaryISO).slice(0, 2)] || metadata.boundaryISO) : ''),
      admin1: String(sourceName || '') || null,
      country: ISO2_TO_COUNTRY_NAME[String(metadata.boundaryISO || '').slice(0, 2)] || null,
      precision: 'source-backed-administrative-boundary',
      source,
      source_url: url || metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL || null,
      source_year: String(boundaryYear || ''),
      license: String(metadata.boundaryLicense || 'See geoBoundaries source metadata'),
      attribution: 'geoBoundaries; boundary source: ' + String(metadata.boundarySource || 'as identified in source metadata'),
      source_id: String(properties.shapeID || properties.shapeISO || properties.shapeName || ''),
      fetched_at: new Date().toISOString(),
      vertex_count: vertexCount,
    },
  };
}

async function cacheBoundary(place, result) {
  const key = 'sonalit:geo:admin-boundary:v2:' + placeKey(place);
  const cacheable = { ...result, cache_saved_at: Date.now() };
  putMemory(boundaryMemoryCache, key, cacheable, 250);
  await redisWrite(key, cacheable, BOUNDARY_STALE_CACHE_TTL_SECONDS);
}

async function readBoundaryCache(place, { includeExpired = false } = {}) {
  const key = 'sonalit:geo:admin-boundary:v2:' + placeKey(place);
  const maxAgeMs = (includeExpired ? BOUNDARY_STALE_CACHE_TTL_SECONDS : BOUNDARY_CACHE_TTL_SECONDS) * 1000;
  const memoryItem = boundaryMemoryCache.get(key);
  if (memoryItem) {
    const savedAt = Number(memoryItem.value?.cache_saved_at || memoryItem.storedAt);
    if (Date.now() - savedAt <= maxAgeMs) {
      boundaryMemoryCache.delete(key);
      boundaryMemoryCache.set(key, memoryItem);
      try {
        return {
          ...memoryItem.value,
          geometry: normalizeBoundaryGeometry(memoryItem.value.geometry),
          cache_hit: true,
          cache_layer: 'process',
        };
      } catch (_) {
        boundaryMemoryCache.delete(key);
      }
    }
  }

  const redis = await redisRead(key);
  if (!redis || !redis.geometry || !redis.location) return null;
  const savedAt = Number(redis.cache_saved_at || Date.parse(redis.location.fetched_at) || 0);
  if (!savedAt || Date.now() - savedAt > maxAgeMs) return null;
  try {
    const cached = { ...redis, geometry: normalizeBoundaryGeometry(redis.geometry) };
    putMemory(boundaryMemoryCache, key, cached, 250);
    return { ...cached, cache_hit: true, cache_layer: 'redis' };
  } catch (_) {
    return null;
  }
}

async function readCachedBoundary(place) {
  return readBoundaryCache(place, { includeExpired: false });
}

async function readLastKnownBoundary(place) {
  const result = await readBoundaryCache(place, { includeExpired: true });
  if (!result) return null;
  if (Date.now() - Number(result.cache_saved_at || 0) <= BOUNDARY_CACHE_TTL_SECONDS * 1000) {
    return { ...result, stale_fallback: false };
  }
  return {
    ...result,
    stale_fallback: true,
    stale_warning: 'Using previously verified administrative-boundary geometry because all live boundary providers failed. This dataset is beyond the 30-day freshness window; confirm the source year and current legal boundary before critical operational use.',
  };
}

async function fetchGeoBoundaryLayer(countryIso3, level) {
  const key = 'sonalit:geo:admin-layer:v2:' + countryIso3 + ':' + level;
  const memory = readMemory(layerMemoryCache, key, LAYER_CACHE_TTL_SECONDS * 1000);
  if (memory) return { metadata: memory.metadata, collection: memory.collection, cacheHit: true };
  const cached = await redisRead(key);
  if (cached?.metadata && cached?.collection) {
    putMemory(layerMemoryCache, key, cached, 100);
    return { ...cached, cacheHit: true };
  }

  const metadataUrl = 'https://www.geoboundaries.org/api/current/gbOpen/' + countryIso3 + '/' + level + '/';
  const metadata = await requestJson(metadataUrl, { timeoutMs: 10000 });
  const downloadUrl = metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL;
  if (!downloadUrl) throw new Error('geoBoundaries metadata did not provide a GeoJSON download URL.');
  const parsedUrl = new URL(downloadUrl);
  if (parsedUrl.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com', 'media.githubusercontent.com'].includes(parsedUrl.hostname)) {
    throw new Error('geoBoundaries returned an unsupported geometry host.');
  }
  const collection = await requestJson(parsedUrl.toString(), { timeoutMs: 12000 });
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('geoBoundaries returned an invalid FeatureCollection.');
  }
  const cachedValue = { metadata, collection };
  putMemory(layerMemoryCache, key, cachedValue, 100);
  await redisWrite(key, cachedValue, LAYER_CACHE_TTL_SECONDS);
  return { ...cachedValue, cacheHit: false };
}

async function resolveGeoBoundaries(place, countryIso2) {
  const countryIso3 = ISO2_TO_ISO3[countryIso2];
  if (!countryIso3) throw new Error('The country for this place has no configured geoBoundaries ISO mapping.');

  const failures = [];
  // Level 1 (states/counties/provinces) first, then deeper admin levels. Layers
  // are cached and shared across operators, so the second place in the same
  // country avoids downloading the national boundary data again.
  for (const level of ['ADM1', 'ADM2', 'ADM3']) {
    try {
      const layer = await fetchGeoBoundaryLayer(countryIso3, level);
      const matches = (layer.collection.features || []).filter(feature => candidateNameMatches(place, feature));
      if (matches.length > 1) {
        const exact = matches.filter(feature => {
          const p = feature.properties || {};
          const name = p.shapeName || p.name || p.NAME_1 || p.NAME_2;
          return normalizeName(name) === normalizeName(place);
        });
        if (exact.length === 1) matches.splice(0, matches.length, exact[0]);
      }
      if (matches.length !== 1) {
        failures.push(level + ': ' + (matches.length ? 'ambiguous name match' : 'no exact normalized boundary-name match'));
        continue;
      }
      const feature = matches[0];
      const metadata = layer.metadata;
      const result = resultFromGeoBoundaryFeature(
        feature,
        metadata,
        metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL,
      );
      const properties = feature.properties || {};
      result.location.country = countryCodeFromPlace(place)
        ? (ISO2_TO_COUNTRY_NAME[countryCodeFromPlace(place)] || result.location.country)
        : (ISO2_TO_COUNTRY_NAME[countryIso2] || result.location.country);
      result.location.admin1 = String(properties.shapeName || properties.name || result.location.admin1 || '');
      result.location.cache_layer = layer.cacheHit ? 'geoBoundaries-layer-cache' : null;
      return result;
    } catch (error) {
      failures.push(level + ': ' + String(error?.message || error).slice(0, 200));
    }
  }
  throw new Error('geoBoundaries fallback did not resolve "' + place + '": ' + failures.join('; '));
}

function isAdministrativeCandidate(item) {
  return item
    && String(item.class || '').toLowerCase() === 'boundary'
    && String(item.type || '').toLowerCase() === 'administrative'
    && (item.geojson || item.geometry);
}

function resultFromNominatimCandidate(candidate, place, tolerance) {
  const geometry = normalizeBoundaryGeometry(candidate.geojson || candidate.geometry);
  const latitude = Number(candidate.lat);
  const longitude = Number(candidate.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) {
    throw new Error('Nominatim boundary coordinates were invalid.');
  }
  return {
    geometry,
    simplification_tolerance_degrees: tolerance,
    location: {
      latitude,
      longitude,
      name: candidate.display_name || place,
      admin1: candidate.address?.state || candidate.address?.county || null,
      country: candidate.address?.country || null,
      precision: 'source-backed-administrative-boundary',
      source: 'OpenStreetMap Nominatim',
      source_url: 'https://nominatim.openstreetmap.org/',
      source_year: null,
      license: 'Open Database License (ODbL)',
      attribution: '© OpenStreetMap contributors',
      source_id: (candidate.osm_type && candidate.osm_id) ? String(candidate.osm_type) + String(candidate.osm_id) : null,
      osm_type: candidate.osm_type || null,
      osm_id: candidate.osm_id || null,
      fetched_at: new Date().toISOString(),
      vertex_count: geometry.coordinates[0].length - 1,
    },
  };
}

async function acquireNominatimSlot() {
  const redis = getRedisSafely();
  const token = crypto.randomUUID();
  if (redis && typeof redis.set === 'function') {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const reserved = await withTimeout(
          redis.set('sonalit:geo:nominatim:public-rate-limit', token, 'PX', 1100, 'NX'),
          REDIS_TIMEOUT_MS,
        );
        if (reserved === 'OK') return;
      } catch (_) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();
}

async function lookupNominatim(place) {
  // The public OSMF endpoint is rate-limited at application scope. Coordinate
  // requests through Redis when available and retain a process-local fallback.
  await acquireNominatimSlot();
  const tolerance = 0.0001;
  const endpoint = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold='
    + tolerance + '&limit=5&q=' + encodeURIComponent(place);
  const candidates = await requestJson(endpoint, {
    timeoutMs: 9000,
    headers: {
      'User-Agent': 'Sonalit-CommandCenter/1.0 (ops@sonalit.io)',
      'Accept-Language': 'en',
    },
  });
  if (!Array.isArray(candidates)) throw new Error('Nominatim returned an invalid search response.');
  const countryIso2 = countryCodeFromCandidates(candidates);
  const administrative = candidates
    .filter(isAdministrativeCandidate)
    .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0));

  let lastGeometryError = null;
  for (const candidate of administrative.slice(0, 5)) {
    try {
      return {
        result: resultFromNominatimCandidate(candidate, place, tolerance),
        countryIso2,
        candidates,
      };
    } catch (error) {
      lastGeometryError = error;
    }
  }

  return {
    result: null,
    countryIso2,
    candidates,
    reason: lastGeometryError
      ? String(lastGeometryError.message || lastGeometryError).slice(0, 220)
      : 'Nominatim did not return a matching boundary=administrative geometry.',
  };
}

async function resolveAdministrativeBoundary(locationName) {
  const place = String(locationName || '').trim().slice(0, 200);
  if (!place) throw new Error('Specify a named place for the administrative boundary.');
  const normalized = normalizeName(place);
  if (!normalized || normalized.length < 2) throw new Error('The administrative-boundary name is too short to resolve safely.');

  const existingFlight = inFlightBoundary.get(normalized);
  if (existingFlight) return existingFlight;

  const flight = (async () => {
    const cached = await readCachedBoundary(place);
    if (cached) return cached;

    const failures = [];
    let countryIso2 = countryCodeFromPlace(place);
    try {
      const osm = await lookupNominatim(place);
      countryIso2 = osm.countryIso2 || countryIso2;
      if (osm.result) {
        await cacheBoundary(place, osm.result);
        return { ...osm.result, cache_hit: false };
      }
      failures.push('OpenStreetMap Nominatim: ' + osm.reason);
    } catch (error) {
      failures.push('OpenStreetMap Nominatim: ' + String(error?.message || error).slice(0, 220));
    }

    if (!countryIso2) countryIso2 = countryCodeFromPlace(place);
    if (countryIso2) {
      try {
        const fallback = await resolveGeoBoundaries(place, countryIso2);
        await cacheBoundary(place, fallback);
        return { ...fallback, cache_hit: false };
      } catch (error) {
        failures.push('geoBoundaries: ' + String(error?.message || error).slice(0, 260));
      }
    } else {
      failures.push('geoBoundaries: could not establish the country; include the country name for a safe second-source lookup.');
    }

    // We read verified cached geometry before trying providers above. Redis may
    // have become available on another application instance after a provider
    // failure, so make one bounded final read before returning a hard failure.
    const lastKnown = await readLastKnownBoundary(place);
    if (lastKnown) return lastKnown;
    throw new Error(
      'No geofence was created. Administrative boundary resolution exhausted independent sources. '
      + failures.join(' | ').slice(0, 850)
      + ' Try adding the country name, or request a radius-based polygon if an approximation is acceptable.',
    );
  })();

  inFlightBoundary.set(normalized, flight);
  try {
    return await flight;
  } finally {
    inFlightBoundary.delete(normalized);
  }
}

function clearBoundaryResolverCache() {
  boundaryMemoryCache.clear();
  layerMemoryCache.clear();
  inFlightBoundary.clear();
  lastNominatimRequestAt = 0;
}

module.exports = {
  resolveAdministrativeBoundary,
  clearBoundaryResolverCache,
  normalizeName,
  normalizedCore,
  countryCodeFromPlace,
  countryCodeFromCandidates,
  candidateNameMatches,
  placeNameVariants,
  fetchGeoBoundaryLayer,
};
