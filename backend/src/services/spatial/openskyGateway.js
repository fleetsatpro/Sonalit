'use strict';

const logger = require('../../utils/logger');

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const TOKEN_SKEW_MS = 60_000;
const CACHE_TTL_MS = 20_000;
const MAX_LIVE_MS = 45_000;
const MAX_DELAYED_MS = 180_000;
const MAX_STALE_CACHE_MS = 300_000;
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_REQUESTS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;

let tokenCache = null;
const responseCache = new Map();
const inflight = new Map();
const requestTimestamps = [];
let activeRequests = 0;
let circuit = { state: 'CLOSED', failures: 0, openedAt: null };

let health = {
  providerId: 'opensky',
  status: 'UNKNOWN',
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
  recordCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  requestCount: 0,
  cacheHits: 0,
  dedupeHits: 0,
  activeRequests: 0,
  rateLimitRemaining: MAX_REQUESTS_PER_MINUTE,
  circuitState: 'CLOSED',
  circuitFailures: 0,
};

function classifyFreshness(observedAtIso, receivedAtIso) {
  if (!observedAtIso) return 'UNKNOWN';
  const observed = Date.parse(observedAtIso);
  const received = Date.parse(receivedAtIso);
  if (!Number.isFinite(observed) || !Number.isFinite(received)) return 'UNKNOWN';
  const age = Math.max(0, received - observed);
  if (age <= MAX_LIVE_MS) return 'LIVE';
  if (age <= MAX_DELAYED_MS) return 'DELAYED';
  return 'STALE';
}

function isValidLatLon(lat, lon) {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

function unixToIso(sec) {
  if (sec == null || !Number.isFinite(sec) || sec <= 0 || sec > 4e9) return null;
  return new Date(sec * 1000).toISOString();
}

function normalizeState(row, receivedAt) {
  const icao24 = row[0];
  const lat = row[6];
  const lon = row[5];
  if (!icao24 || !isValidLatLon(lat, lon)) return null;
  const observedAt = unixToIso(row[3]) ?? unixToIso(row[4]);
  const freshnessClass = classifyFreshness(observedAt, receivedAt);
  const callsign = (row[1] || '').trim() || null;
  return {
    id: `opensky:${icao24}`,
    entityType: 'aircraft',
    source: 'opensky',
    sourceReference: icao24,
    latitude: lat,
    longitude: lon,
    altitudeM: typeof row[13] === 'number' && Number.isFinite(row[13]) ? row[13]
      : typeof row[7] === 'number' && Number.isFinite(row[7]) ? row[7] : null,
    observedAt,
    receivedAt,
    freshnessMs: observedAt ? Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt)) : undefined,
    headingDeg: typeof row[10] === 'number' && Number.isFinite(row[10]) ? row[10] : null,
    speedMps: typeof row[9] === 'number' && Number.isFinite(row[9]) ? row[9] : null,
    status: row[8] ? 'on_ground' : 'airborne',
    attributes: {
      icao24, callsign, origin_country: row[2] || null,
      baro_altitude: row[7], geo_altitude: row[13], vertical_rate: row[11],
      squawk: row[14], on_ground: row[8],
    },
    provenance: {
      sourceName: 'OpenSky Network',
      sourceUrl: 'https://opensky-network.org/',
      license: 'OpenSky Network terms',
      attribution: 'OpenSky Network',
      observationType: 'adsb_state_vector',
      sourceReference: icao24,
    },
    coverage: { complete: false, bounded: true, queryScope: 'bbox' },
    quality: {
      state: freshnessClass === 'LIVE' ? 'good' : freshnessClass === 'DELAYED' ? 'degraded'
        : freshnessClass === 'STALE' ? 'stale' : 'unknown',
      freshnessClass,
      reason: observedAt ? undefined : 'missing source timestamp',
    },
  };
}

async function getAccessToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_SKEW_MS) {
    return tokenCache.accessToken;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`OpenSky auth failed: ${res.status}`), {
      class: res.status === 401 ? 'auth_required' : 'http_error',
    });
  }
  const data = await res.json();
  const expiresIn = Number(data.expires_in) || 1800;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return tokenCache.accessToken;
}

function validateBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const values = bbox.map(Number);
  if (values.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  if ((east - west) * (north - south) > 25) return null;
  return [west, south, east, north];
}

function bboxKey(bbox) {
  return bbox.map((n) => Number(n).toFixed(3)).join(',');
}

function purgeRateWindow(now) {
  while (requestTimestamps.length && requestTimestamps[0] <= now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
}

function canRequest(now) {
  purgeRateWindow(now);
  return requestTimestamps.length < MAX_REQUESTS_PER_MINUTE;
}

function recordRequest(now) {
  purgeRateWindow(now);
  requestTimestamps.push(now);
  health.rateLimitRemaining = Math.max(0, MAX_REQUESTS_PER_MINUTE - requestTimestamps.length);
}

function circuitIsOpen(now) {
  if (circuit.state !== 'OPEN') return false;
  if (circuit.openedAt != null && now - circuit.openedAt >= CIRCUIT_COOLDOWN_MS) {
    circuit = { state: 'HALF_OPEN', failures: circuit.failures, openedAt: circuit.openedAt };
    health.circuitState = 'HALF_OPEN';
    return false;
  }
  return true;
}

function recordProviderFailure(now) {
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit = { state: 'OPEN', failures: circuit.failures, openedAt: now };
  }
  health.circuitState = circuit.state;
  health.circuitFailures = circuit.failures;
}

function recordProviderSuccess() {
  circuit = { state: 'CLOSED', failures: 0, openedAt: null };
  health.circuitState = 'CLOSED';
  health.circuitFailures = 0;
}

function staleCachedResult(key, warning) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  const ageMs = Date.now() - cached.at;
  if (ageMs > MAX_STALE_CACHE_MS) return null;
  return {
    ...cached.result,
    observations: (cached.result.observations || []).map((observation) => ({
      ...observation,
      quality: {
        ...observation.quality,
        state: 'stale',
        freshnessClass: 'STALE',
        reason: warning,
      },
    })),
    health: {
      ...health,
      status: 'STALE',
    },
    cache: { hit: true, ageMs },
    warnings: [...(cached.result.warnings || []), warning],
  };
}


async function getAircraftInBbox(opts) {
  const { bbox, orgId } = opts;
  const safeBbox = validateBbox(bbox);
  if (!safeBbox) {
    return Promise.resolve({
      observations: [],
      health: { ...health, status: 'COVERAGE_LIMITED', lastErrorClass: 'coverage_limited', lastErrorMessage: 'Invalid or oversized bbox' },
      coverage: { complete: false, queryScope: 'invalid_bbox' },
    });
  }
  const key = bboxKey(safeBbox);
  const now = Date.now();
  health.requestCount += 1;
  health.lastAttemptAt = new Date(now).toISOString();
  purgeRateWindow(now);
  health.rateLimitRemaining = Math.max(0, MAX_REQUESTS_PER_MINUTE - requestTimestamps.length);

  if (circuitIsOpen(now)) {
    const stale = staleCachedResult(key, 'provider_circuit_open');
    if (stale) return stale;
    health.status = 'UNAVAILABLE';
    health.lastErrorClass = 'unknown';
    health.lastErrorMessage = 'OpenSky circuit breaker is open';
    return {
      observations: [],
      health: { ...health },
      coverage: { complete: false, queryScope: \`bbox:\${key}\` },
      warnings: ['provider_circuit_open'],
    };
  }

  if (!canRequest(now)) {
    const stale = staleCachedResult(key, 'rate_limited_serving_stale_cache');
    if (stale) return stale;
    health.status = 'RATE_LIMITED';
    health.lastErrorClass = 'rate_limited';
    health.lastErrorMessage = 'OpenSky local rate budget exhausted';
    return {
      observations: [],
      health: { ...health },
      coverage: { complete: false, queryScope: \`bbox:\${key}\` },
      warnings: ['local_provider_rate_limit'],
    };
  }

  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    const stale = staleCachedResult(key, 'concurrency_limited_serving_stale_cache');
    if (stale) return stale;
    health.status = 'RATE_LIMITED';
    health.lastErrorClass = 'rate_limited';
    health.lastErrorMessage = 'OpenSky local concurrency budget exhausted';
    return {
      observations: [],
      health: { ...health },
      coverage: { complete: false, queryScope: \`bbox:\${key}\` },
      warnings: ['local_provider_concurrency_limit'],
    };
  }

  recordRequest(now);
  activeRequests += 1;
  health.activeRequests = activeRequests;

  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    health.cacheHits += 1;
    return { ...cached.result, cache: { hit: true, ageMs: Date.now() - cached.at } };
  }
  if (inflight.has(key)) {
    health.dedupeHits += 1;
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      let token = null;
      try { token = await getAccessToken(); }
      catch (err) {
        logger.warn({ err: err.message, orgId }, 'opensky token acquire failed — anonymous');
      }
      const url = new URL(OPENSKY_STATES_URL);
      url.searchParams.set('lamin', String(safeBbox[1]));
      url.searchParams.set('lomin', String(safeBbox[0]));
      url.searchParams.set('lamax', String(safeBbox[3]));
      url.searchParams.set('lomax', String(safeBbox[2]));
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let res;
      try {
        res = await fetch(url.toString(), { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) {
        health.status = 'RATE_LIMITED';
        health.lastErrorClass = 'rate_limited';
        health.lastErrorMessage = 'OpenSky rate limited';
        const stale = staleCachedResult(key, 'rate_limited_serving_stale_cache');
        if (stale) return stale;
        return { observations: [], health: { ...health }, coverage: { complete: false, queryScope: \`bbox:\${key}\` } };
      }
      if (!res.ok) {
        health.status = 'UNAVAILABLE';
        health.lastErrorClass = res.status === 401 ? 'auth_required' : 'http_error';
        health.lastErrorMessage = `HTTP ${res.status}`;
        return { observations: [], health: { ...health }, coverage: { complete: false, queryScope: `bbox:${key}` } };
      }
      const payload = await res.json();
      const receivedAt = new Date().toISOString();
      const states = Array.isArray(payload.states) ? payload.states : [];
      const observations = [];
      let rejected = 0;
      for (const row of states) {
        const obs = normalizeState(row, receivedAt);
        if (obs) {
          obs.coverage.queryScope = `bbox:${key}`;
          observations.push(obs);
        } else rejected += 1;
      }
      const hasLive = observations.some((o) => o.quality.freshnessClass === 'LIVE');
      const hasDelayed = observations.some((o) => o.quality.freshnessClass === 'DELAYED');
      recordProviderSuccess();
      health = {
        ...health,
        status: observations.length === 0 ? 'UNAVAILABLE' : hasLive ? 'LIVE' : hasDelayed ? 'DELAYED' : 'STALE',
        lastSuccessAt: receivedAt,
        lastAttemptAt: receivedAt,
        lastErrorClass: null,
        lastErrorMessage: null,
        recordCount: states.length,
        acceptedCount: observations.length,
        rejectedCount: rejected,
      };
      const result = {
        observations,
        health: { ...health },
        coverage: { complete: false, omittedCount: rejected, queryScope: `bbox:${key}`, bounded: true },
      };
      responseCache.set(key, { at: Date.now(), result });
      if (responseCache.size > 64) {
        responseCache.delete(responseCache.keys().next().value);
      }
      return result;
    } catch (err) {
      const message = err.name === 'AbortError' ? 'timeout' : err.message;
      health.status = 'UNAVAILABLE';
      health.lastErrorClass = err.name === 'AbortError' ? 'timeout' : 'unknown';
      health.lastErrorMessage = message;
      logger.warn({ err: message, orgId, bbox: key }, 'opensky fetch failed');
      return { observations: [], health: { ...health }, coverage: { complete: false, queryScope: `bbox:${key}` } };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function getProviderHealth() {
  return { opensky: { ...health } };
}

module.exports = { getAircraftInBbox, getProviderHealth, validateBbox, normalizeState };
