'use strict';

const crypto = require('node:crypto');
const { normalizeBoundaryGeometry } = require('./geofenceAutoGeometry');

const BOUNDARY_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const BOUNDARY_STALE_CACHE_TTL_SECONDS = 180 * 24 * 60 * 60;
const LAYER_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_JSON_CHARS = 30 * 1024 * 1024;
const REDIS_TIMEOUT_MS = 350;
const MAX_BOUNDARY_INPUT_VERTICES = 50000;
const MAX_BOUNDARY_SIMPLIFICATION_COMPARISONS = 3000000;
const MAX_BOUNDARY_SIMPLIFICATION_TOLERANCE_M = 250;
const BOUNDARY_SIMPLIFICATION_TOLERANCES_M = Object.freeze([10, 20, 35, 50, 75, 100, 150, 200, 250]);
const PROVIDER_CIRCUIT_FAILURE_THRESHOLD = 3;
const PROVIDER_CIRCUIT_BASE_COOLDOWN_MS = 30000;
const PROVIDER_CIRCUIT_MAX_COOLDOWN_MS = 5 * 60 * 1000;

const boundaryMemoryCache = new Map();
const layerMemoryCache = new Map();
const inFlightBoundary = new Map();
const providerCircuits = new Map();
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

function getProviderCircuit(provider) {
  if (!providerCircuits.has(provider)) {
    providerCircuits.set(provider, {
      failures: 0,
      openUntil: 0,
      cooldownMs: PROVIDER_CIRCUIT_BASE_COOLDOWN_MS,
      lastFailureAt: null,
      lastSuccessAt: null,
      lastError: null,
    });
  }
  return providerCircuits.get(provider);
}

function providerCircuitHealth(provider) {
  const state = getProviderCircuit(provider);
  const open = state.openUntil > Date.now();
  return {
    provider,
    state: open ? 'open' : 'closed',
    retry_in_ms: open ? state.openUntil - Date.now() : 0,
    failures: state.failures,
    last_failure_at: state.lastFailureAt,
    last_success_at: state.lastSuccessAt,
    last_error: state.lastError,
  };
}

function ensureProviderCircuitClosed(provider) {
  const state = getProviderCircuit(provider);
  if (state.openUntil > Date.now()) {
    throw new Error(provider + ' circuit breaker is open for another ' + Math.ceil((state.openUntil - Date.now()) / 1000) + ' seconds.');
  }
  if (state.openUntil && state.openUntil <= Date.now()) state.openUntil = 0;
}

function isTransientProviderError(error) {
  const status = Number(error?.status || String(error?.message || '').match(/HTTP (\d{3})/)?.[1] || 0);
  if (status) return status === 408 || status === 425 || status === 429 || status >= 500;
  return true;
}

async function requestProviderJson(provider, url, options = {}) {
  ensureProviderCircuitClosed(provider);
  try {
    const result = await requestJson(url, options);
    const state = getProviderCircuit(provider);
    state.failures = 0;
    state.openUntil = 0;
    state.cooldownMs = PROVIDER_CIRCUIT_BASE_COOLDOWN_MS;
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    return result;
  } catch (error) {
    const state = getProviderCircuit(provider);
    state.lastFailureAt = new Date().toISOString();
    state.lastError = String(error?.message || error).slice(0, 220);
    if (isTransientProviderError(error)) {
      state.failures += 1;
      if (state.failures >= PROVIDER_CIRCUIT_FAILURE_THRESHOLD) {
        state.openUntil = Date.now() + state.cooldownMs;
        state.cooldownMs = Math.min(PROVIDER_CIRCUIT_MAX_COOLDOWN_MS, state.cooldownMs * 2);
        state.failures = 0;
      }
    }
    throw error;
  }
}

async function requestJson(url, { timeoutMs = 9000, headers = {} } = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
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

function projectedMetres(point, referenceLatitude) {
  const earthRadius = 6371008.8;
  const radians = Math.PI / 180;
  const latitudeScale = Math.cos(referenceLatitude * radians);
  return [
    earthRadius * Number(point[0]) * radians * latitudeScale,
    earthRadius * Number(point[1]) * radians,
  ];
}

function segmentDistanceMetres(point, start, end, referenceLatitude) {
  const p = projectedMetres(point, referenceLatitude);
  const a = projectedMetres(start, referenceLatitude);
  const b = projectedMetres(end, referenceLatitude);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const t = denominator > 0
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator))
    : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplifyOpenBoundaryArc(points, toleranceM, referenceLatitude, budget) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    let farthest = -1;
    let maxDistance = toleranceM;
    for (let i = first + 1; i < last; i += 1) {
      budget.comparisons += 1;
      if (budget.comparisons > MAX_BOUNDARY_SIMPLIFICATION_COMPARISONS) {
        throw new RangeError('Administrative boundary is too complex to simplify within the computation budget.');
      }
      const distance = segmentDistanceMetres(points[i], points[first], points[last], referenceLatitude);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function ringEquals(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}

function simplifyAdministrativePolygon(geometry) {
  const source = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  if (!source || source.type !== 'Polygon' || !Array.isArray(source.coordinates)) {
    throw new TypeError('The source did not return one administrative Polygon.');
  }
  if (source.coordinates.length !== 1) {
    throw new RangeError('This administrative boundary contains holes or multiple rings and cannot be simplified as one safe ring.');
  }
  const raw = source.coordinates[0];
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > MAX_BOUNDARY_INPUT_VERTICES + 1) {
    throw new RangeError('Administrative boundary must contain at least 3 and no more than ' + MAX_BOUNDARY_INPUT_VERTICES + ' source vertices.');
  }
  const points = [];
  let minLatitude = Infinity, maxLatitude = -Infinity;
  let minLongitude = Infinity, maxLongitude = -Infinity;
  for (let index = 0; index < raw.length; index += 1) {
    const point = raw[index];
    if (!Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) {
      throw new TypeError('Administrative boundary has a non-numeric coordinate at source vertex ' + (index + 1) + '.');
    }
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (Math.abs(lng) > 180 || Math.abs(lat) > 85) {
      throw new RangeError('Administrative boundary has a coordinate outside supported map bounds.');
    }
    minLatitude = Math.min(minLatitude, lat);
    maxLatitude = Math.max(maxLatitude, lat);
    minLongitude = Math.min(minLongitude, lng);
    maxLongitude = Math.max(maxLongitude, lng);
    const normalizedPoint = [lng, lat];
    if (!points.length || !ringEquals(points[points.length - 1], normalizedPoint)) points.push(normalizedPoint);
  }
  if (points.length > 1 && ringEquals(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) throw new RangeError('Administrative boundary contains fewer than 3 distinct vertices.');

  if (maxLongitude - minLongitude > 180) {
    throw new RangeError('Administrative boundary crosses the antimeridian; this single-ring simplifier will not distort it.');
  }
  const originalVertexCount = points.length;
  if (originalVertexCount <= 500) {
    const normalized = normalizeBoundaryGeometry({ type: 'Polygon', coordinates: [points] });
    return {
      geometry: normalized,
      vertex_count: normalized.coordinates[0].length - 1,
      source_original_vertex_count: originalVertexCount,
      simplification_tolerance_m: null,
      simplification_method: 'none; source ring fits Sonalit geometry limits',
    };
  }

  const referenceLatitude = (minLatitude + maxLatitude) / 2;
  // Split the closed ring at an approximate diameter into two open arcs. This
  // avoids the degenerate equal-endpoint problem when applying Douglas–Peucker
  // to a closed polygon boundary.
  let anchorA = 0;
  let anchorB = 1;
  let maximumDistance = -1;
  const origin = projectedMetres(points[anchorA], referenceLatitude);
  for (let index = 1; index < points.length; index += 1) {
    const projected = projectedMetres(points[index], referenceLatitude);
    const distance = Math.hypot(projected[0] - origin[0], projected[1] - origin[1]);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      anchorB = index;
    }
  }
  const arcOne = [];
  for (let index = anchorA; ; index = (index + 1) % points.length) {
    arcOne.push(points[index]);
    if (index === anchorB) break;
  }
  const arcTwo = [];
  for (let index = anchorB; ; index = (index + 1) % points.length) {
    arcTwo.push(points[index]);
    if (index === anchorA) break;
  }

  let lastError = null;
  for (const toleranceM of BOUNDARY_SIMPLIFICATION_TOLERANCES_M) {
    const budget = { comparisons: 0 };
    try {
      const first = simplifyOpenBoundaryArc(arcOne, toleranceM, referenceLatitude, budget);
      const second = simplifyOpenBoundaryArc(arcTwo, toleranceM, referenceLatitude, budget);
      const simplified = first.concat(second.slice(1, -1));
      if (simplified.length > 500) continue;
      const closed = simplified.map(point => [point[0], point[1]]);
      closed.push([...closed[0]]);
      const normalized = normalizeBoundaryGeometry({ type: 'Polygon', coordinates: [closed] });
      return {
        geometry: normalized,
        vertex_count: normalized.coordinates[0].length - 1,
        source_original_vertex_count: originalVertexCount,
        simplification_tolerance_m: toleranceM,
        simplification_method: 'closed-ring Douglas–Peucker simplification in a local metre projection; result topology validated',
      };
    } catch (error) {
      lastError = error;
      if (error instanceof RangeError && /computation budget/.test(String(error.message))) {
        // Higher tolerances generally prune at least as much geometry, but the
        // input is still expensive to scan. Continue only within the fixed
        // set of bounded tolerance passes.
        continue;
      }
    }
  }
  const detail = lastError?.message ? ' Last validation: ' + String(lastError.message).slice(0, 180) : '';
  throw new RangeError(
    'Administrative boundary has ' + originalVertexCount + ' source vertices and could not be reduced to 500 or fewer vertices '
    + 'within the ' + MAX_BOUNDARY_SIMPLIFICATION_TOLERANCE_M + ' m maximum simplification budget. No coarse or substituted geofence was created.'
    + detail,
  );
}

function validateBoundaryPayload(geometry) {
  return simplifyAdministrativePolygon(geometry);
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
  const validated = validateBoundaryPayload(geometry);
  const normalized = validated.geometry;
  const vertexCount = validated.vertex_count;
  const center = boundaryCenter(normalized);
  const properties = feature.properties || {};
  const sourceName = properties.shapeName || properties.name || properties.NAME_1 || properties.NAME_2;
  const boundaryYear = metadata.boundaryYearRepresented || null;
  const source = 'geoBoundaries open administrative boundary dataset';
  return {
    geometry: normalized,
    simplification_tolerance_degrees: null,
    simplification_tolerance_m: validated.simplification_tolerance_m,
    source_original_vertex_count: validated.source_original_vertex_count,
    simplification_method: validated.simplification_method,
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
      source_original_vertex_count: validated.source_original_vertex_count,
      simplification_tolerance_m: validated.simplification_tolerance_m,
      simplification_method: validated.simplification_method,
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
  const metadata = await requestProviderJson('geoBoundaries', metadataUrl, { timeoutMs: 10000 });
  const downloadUrl = metadata.simplifiedGeometryGeoJSON || metadata.gjDownloadURL;
  if (!downloadUrl) throw new Error('geoBoundaries metadata did not provide a GeoJSON download URL.');
  const parsedUrl = new URL(downloadUrl);
  if (parsedUrl.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com', 'media.githubusercontent.com'].includes(parsedUrl.hostname)) {
    throw new Error('geoBoundaries returned an unsupported geometry host.');
  }
  const collection = await requestProviderJson('geoBoundaries', parsedUrl.toString(), { timeoutMs: 12000 });
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

function nominatimCandidateMatches(place, item) {
  const wanted = placeNameVariants(place);
  const address = item?.address || {};
  const names = [
    item?.name,
    ...(Array.isArray(item?.display_name) ? item.display_name : String(item?.display_name || '').split(',')),
    item?.namedetails?.name,
    address.city,
    address.municipality,
    address.town,
    address.village,
    address.county,
    address.state_district,
    address.state,
    address.province,
    address.district,
    address.region,
  ].flatMap(value => Array.isArray(value) ? value : [value]).map(normalizeName).filter(Boolean);
  const wantedCores = [...new Set(wanted.map(normalizedCore).filter(Boolean))];
  const nameCores = names.map(normalizedCore).filter(Boolean);
  return wanted.some(name => names.includes(name))
    || wantedCores.some(core => nameCores.includes(core));
}

function resultFromNominatimCandidate(candidate, place, tolerance) {
  const validated = validateBoundaryPayload(candidate.geojson || candidate.geometry);
  const geometry = validated.geometry;
  const latitude = Number(candidate.lat);
  const longitude = Number(candidate.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) {
    throw new Error('Nominatim boundary coordinates were invalid.');
  }
  return {
    geometry,
    simplification_tolerance_degrees: tolerance,
    simplification_tolerance_m: validated.simplification_tolerance_m,
    source_original_vertex_count: validated.source_original_vertex_count,
    simplification_method: validated.simplification_method,
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
      source_original_vertex_count: validated.source_original_vertex_count,
      simplification_tolerance_m: validated.simplification_tolerance_m,
      simplification_method: validated.simplification_method,
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
        if (reserved === 'OK') return true;
      } catch (_) {
        // If shared coordination is unhealthy, skip Nominatim rather than
        // risk breaching its application-wide usage policy across replicas.
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
  }
  // Process-local limiter is only used when shared Redis is deliberately absent.
  const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();
  return true;
}

async function lookupNominatim(place) {
  const rateSlotAvailable = await acquireNominatimSlot();
  if (!rateSlotAvailable) {
    return {
      result: null,
      countryIso2: countryCodeFromPlace(place),
      candidates: [],
      reason: 'Nominatim was skipped because its shared rate-limit slot was unavailable; the independent geoBoundaries provider will be tried.',
    };
  }
  ensureProviderCircuitClosed('nominatim');
  const tolerance = 0.0001;
  const endpoint = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold='
    + tolerance + '&limit=5&q=' + encodeURIComponent(place);
  const candidates = await requestProviderJson('nominatim', endpoint, {
    timeoutMs: 9000,
    headers: {
      'User-Agent': 'Sonalit-CommandCenter/1.0 (ops@sonalit.io)',
      'Accept-Language': 'en',
    },
  });
  if (!Array.isArray(candidates)) throw new Error('Nominatim returned an invalid search response.');
  const countryIso2 = countryCodeFromCandidates(candidates);
  const administrative = candidates
    .filter(item => isAdministrativeCandidate(item) && nominatimCandidateMatches(place, item))
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
      : administrative.length === 0
        ? 'Nominatim did not return an exact-name boundary=administrative geometry for the requested place.'
        : 'Nominatim did not return a usable single-ring boundary=administrative geometry.',
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
  providerCircuits.clear();
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
  nominatimCandidateMatches,
  placeNameVariants,
  fetchGeoBoundaryLayer,
  providerCircuitHealth,
};
