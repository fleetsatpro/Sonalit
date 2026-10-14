'use strict';

const { getOpenMeteoAccess } = require('./weatherProviderAccess');

const CACHE_TTL_MS = 90_000;
const MAX_CACHE_ENTRIES = 128;

const cache = new Map();
const inflight = new Map();

let health = {
  providerId: 'open-meteo',
  status: 'UNKNOWN',
  requestCount: 0,
  cacheHits: 0,
  dedupeHits: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
};

const WMO = {
  0:'clear',1:'mainly_clear',2:'partly_cloudy',3:'overcast',
  45:'fog',48:'rime_fog',51:'light_drizzle',53:'drizzle',55:'heavy_drizzle',
  56:'freezing_drizzle',57:'heavy_freezing_drizzle',61:'light_rain',63:'rain',
  65:'heavy_rain',66:'freezing_rain',67:'heavy_freezing_rain',
  71:'light_snow',73:'snow',75:'heavy_snow',77:'snow_grains',
  80:'light_showers',81:'showers',82:'violent_showers',
  85:'snow_showers',86:'heavy_snow_showers',95:'thunderstorm',
  96:'thunderstorm_hail',99:'severe_thunderstorm_hail',
};

function isValidLatLon(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function classifyFreshness(observedAtIso, receivedAtIso) {
  if (!observedAtIso) return 'UNKNOWN';
  const observed = Date.parse(observedAtIso);
  const received = Date.parse(receivedAtIso);
  if (!Number.isFinite(observed) || !Number.isFinite(received)) return 'UNKNOWN';
  const ageMs = Math.max(0, received - observed);
  if (ageMs <= 10 * 60 * 1000) return 'LIVE';
  if (ageMs <= 90 * 60 * 1000) return 'DELAYED';
  return 'STALE';
}

function buildQuality(freshnessClass, reason) {
  const state = freshnessClass === 'LIVE' ? 'good' : freshnessClass === 'DELAYED' ? 'degraded' : freshnessClass === 'STALE' ? 'stale' : 'unknown';
  return { state, freshnessClass, reason };
}

function keyFor(lat, lng) {
  return Number(lat).toFixed(3) + ',' + Number(lng).toFixed(3);
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const p1 = toRad(aLat);
  const p2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function makeObservation(requested, data, receivedAt) {
  const current = data && data.current || {};
  const observedAt = current.time
    ? new Date(String(current.time).endsWith('Z') ? String(current.time) : String(current.time) + 'Z').toISOString()
    : null;
  const freshness = observedAt ? classifyFreshness(observedAt, receivedAt) : 'UNKNOWN';
  const weather = classifyCurrent(current);
  const latitude = Number.isFinite(Number(data && data.latitude)) ? Number(data.latitude) : requested.latitude;
  const longitude = Number.isFinite(Number(data && data.longitude)) ? Number(data.longitude) : requested.longitude;
  const gridCellDistanceM = Math.round(distanceMeters(requested.latitude, requested.longitude, latitude, longitude));
  const quality = buildQuality(freshness, observedAt ? undefined : 'provider returned no observation timestamp');

  return {
    id: 'open-meteo:weather:grid:' + keyFor(latitude, longitude),
    entityType: 'weather',
    source: 'open-meteo',
    sourceReference: requested.key,
    latitude,
    longitude,
    observedAt,
    receivedAt,
    freshnessMs: observedAt ? Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt)) : undefined,
    observationConfidence: 0.82,
    interpretationConfidence: null,
    operationalConfidence: null,
    accuracyM: gridCellDistanceM,
    confidence: 0.82,
    headingDeg: null,
    speedMps: null,
    status: weather.severity,
    attributes: Object.assign({}, weather, {
      timezone: data && data.timezone || 'UTC',
      requestedLatitude: requested.latitude,
      requestedLongitude: requested.longitude,
      gridCellDistanceM,
      modelGridPoint: true,
    }),
    provenance: {
      sourceName: 'Open-Meteo',
      sourceUrl: 'https://open-meteo.com/',
      observationType: 'current_weather_model_grid_point',
      sourceReference: requested.key,
    },
    coverage: {
      complete: false,
      bounded: true,
      queryScope: 'model-grid-point:' + requested.key,
    },
    quality,
  };
}

async function getCurrentWeatherBatch(input) {
  const requested = [];
  const seen = new Set();
  for (const raw of (Array.isArray(input && input.points) ? input.points : []).slice(0, 36)) {
    const latitude = Number(raw && raw.latitude);
    const longitude = Number(raw && raw.longitude);
    if (!isValidLatLon(latitude, longitude)) continue;
    const key = keyFor(latitude, longitude);
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push({ latitude, longitude, key });
  }

  if (!requested.length) {
    return {
      observations: [],
      health: Object.assign({}, health, { status: 'UNAVAILABLE' }),
      error: 'invalid_weather_grid_points',
      coverage: { complete: false, sampleCount: 0, successfulSamples: 0, failedSamples: 0 },
    };
  }

  const access = getOpenMeteoAccess();
  const customerApiKey = access.apiKey;
  if (!access.allowed) {
    health = Object.assign({}, health, {
      status: 'UNAVAILABLE',
      lastErrorClass: 'commercial_api_key_not_configured',
      lastErrorMessage: 'Open-Meteo free service is restricted to non-commercial use. Configure OPEN_METEO_API_KEY for the paid customer API.',
    });
    return {
      observations: [],
      health: Object.assign({}, health),
      error: 'commercial_api_key_not_configured',
      coverage: {
        complete: false,
        sampleCount: requested.length,
        successfulSamples: 0,
        failedSamples: requested.length,
      },
    };
  }

  const now = Date.now();
  const observationsByKey = new Map();
  const missing = [];
  for (const point of requested) {
    const cached = cache.get(point.key);
    if (cached && cached.expiresAt > now) {
      observationsByKey.set(point.key, cached.observation);
      health = Object.assign({}, health, { cacheHits: health.cacheHits + 1 });
    } else {
      missing.push(point);
    }
  }

  const receivedAt = new Date().toISOString();
  if (missing.length) {
    health = Object.assign({}, health, {
      requestCount: health.requestCount + 1,
      lastAttemptAt: receivedAt,
    });
    try {
      const apiBase = access.apiBase;
      const url = apiBase + '?latitude=' + encodeURIComponent(missing.map(p => p.latitude).join(',')) +
        '&longitude=' + encodeURIComponent(missing.map(p => p.longitude).join(',')) +
        '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,visibility' +
        '&timezone=UTC&forecast_days=1' +
        (customerApiKey ? '&apikey=' + encodeURIComponent(customerApiKey) : '');
      const timeoutSignal = AbortSignal.timeout(7000);
      const requestSignal = input && input.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([input.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Request-ID': String(input && input.requestId || '') },
        signal: requestSignal,
      });
      if (!response.ok) {
        throw Object.assign(new Error('Open-Meteo HTTP ' + response.status), {
          failureClass: response.status === 429 ? 'rate_limited' : 'http_error',
        });
      }
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : [payload];
      rows.forEach((row, index) => {
        const point = missing[index];
        if (!point || !row || !row.current) return;
        const observation = makeObservation(point, row, receivedAt);
        observationsByKey.set(point.key, observation);
        cache.set(point.key, { observation, cachedAt: now, expiresAt: now + CACHE_TTL_MS });
      });
      trimCache();
      health = Object.assign({}, health, {
        status: observationsByKey.size === requested.length ? 'LIVE' : 'PARTIAL',
        lastSuccessAt: receivedAt,
        lastErrorClass: null,
        lastErrorMessage: null,
      });
    } catch (error) {
      const failureClass = error && error.failureClass
        ? error.failureClass
        : error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'unknown';
      health = Object.assign({}, health, {
        status: 'UNAVAILABLE',
        lastErrorClass: failureClass,
        lastErrorMessage: String(error && error.message || error),
      });
      for (const point of missing) {
        const stale = cache.get(point.key);
        if (stale) {
          observationsByKey.set(point.key, Object.assign({}, stale.observation, {
            quality: { state: 'stale', freshnessClass: 'STALE', reason: 'provider failed; serving cached model-grid observation' },
          }));
        }
      }
      const observations = requested.map(p => observationsByKey.get(p.key)).filter(Boolean);
      return {
        observations,
        health: Object.assign({}, health, { status: observations.length ? 'STALE' : 'UNAVAILABLE' }),
        coverage: {
          complete: observations.length === requested.length,
          sampleCount: requested.length,
          successfulSamples: observations.length,
          failedSamples: requested.length - observations.length,
        },
        warning: observations.length ? 'provider_failed_using_stale_cache' : undefined,
        error: observations.length ? undefined : 'provider_unavailable',
      };
    }
  }

  const observations = requested.map(p => observationsByKey.get(p.key)).filter(Boolean);
  const freshnessClasses = observations.map(o => String(o.quality && o.quality.freshnessClass || 'UNKNOWN').toUpperCase());
  const complete = observations.length === requested.length && freshnessClasses.every(s => s === 'LIVE' || s === 'DELAYED');
  const status = !observations.length
    ? 'UNAVAILABLE'
    : observations.length !== requested.length || freshnessClasses.some(s => s === 'STALE' || s === 'UNKNOWN')
      ? 'PARTIAL'
      : freshnessClasses.includes('LIVE') ? 'LIVE' : 'DELAYED';
  health = Object.assign({}, health, { status });
  return {
    observations,
    health: Object.assign({}, health),
    coverage: {
      complete,
      sampleCount: requested.length,
      successfulSamples: observations.length,
      failedSamples: requested.length - observations.length,
    },
    cache: { hit: missing.length === 0 },
  };
}

function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const key = cache.keys().next().value;
    if (key === undefined) break;
    cache.delete(key);
  }
}

function classifyCurrent(current) {
  const c = current || {};
  const code = Number(c.weather_code);
  const precipitation = Number(c.precipitation);
  const wind = Number(c.wind_speed_10m);
  const visibility = Number(c.visibility);

  const hazards = [];
  if (Number.isFinite(code) && code >= 95) hazards.push('thunderstorm');
  if (Number.isFinite(precipitation) && precipitation >= 10) hazards.push('heavy_precipitation');
  if (Number.isFinite(wind) && wind >= 50) hazards.push('high_wind');
  if (Number.isFinite(visibility) && visibility < 2000) hazards.push('poor_visibility');

  return {
    weatherCode: Number.isFinite(code) ? code : null,
    conditions: WMO[code] || 'unknown',
    temperatureC: Number.isFinite(Number(c.temperature_2m)) ? Number(c.temperature_2m) : null,
    humidityPct: Number.isFinite(Number(c.relative_humidity_2m)) ? Number(c.relative_humidity_2m) : null,
    precipitationMm: Number.isFinite(precipitation) ? precipitation : null,
    windSpeedKmh: Number.isFinite(wind) ? wind : null,
    visibilityM: Number.isFinite(visibility) ? visibility : null,
    hazards: hazards,
    severity: hazards.includes('thunderstorm') || hazards.includes('poor_visibility')
      ? 'high'
      : hazards.length ? 'medium' : 'low',
  };
}

async function getCurrentWeather(input) {
  if (input && Array.isArray(input.points)) return getCurrentWeatherBatch(input);
  const lat = Number(input && input.latitude);
  const lng = Number(input && input.longitude);

  if (!isValidLatLon(lat, lng)) {
    return {
      observations: [],
      health: Object.assign({}, health, { status: 'UNAVAILABLE' }),
      error: 'invalid_coordinates',
    };
  }

  const key = keyFor(lat, lng);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    health = Object.assign({}, health, {
      status: cached.observation.quality.freshnessClass,
      cacheHits: health.cacheHits + 1,
    });
    return {
      observations: [cached.observation],
      health: Object.assign({}, health),
      cache: { hit: true, ageMs: now - cached.cachedAt },
    };
  }

  if (inflight.has(key)) {
    health = Object.assign({}, health, { dedupeHits: health.dedupeHits + 1 });
    return inflight.get(key);
  }

  const request = (async function() {
    const receivedAt = new Date().toISOString();
    health = Object.assign({}, health, {
      requestCount: health.requestCount + 1,
      lastAttemptAt: receivedAt,
    });

    try {
      const url =
        'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(lat) +
        '&longitude=' + encodeURIComponent(lng) +
        '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,visibility' +
        '&timezone=UTC&forecast_days=1';

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Request-ID': String(input && input.requestId || ''),
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        throw Object.assign(new Error('Open-Meteo HTTP ' + response.status), {
          failureClass: response.status === 429 ? 'rate_limited' : 'http_error',
        });
      }

      const data = await response.json();
      const current = data && data.current || {};
      const observedAt = current.time
        ? new Date(String(current.time).endsWith('Z') ? String(current.time) : String(current.time) + 'Z').toISOString()
        : null;

      const freshness = observedAt
        ? classifyFreshness(observedAt, receivedAt, { maxLiveMs: 10 * 60 * 1000, maxDelayedMs: 90 * 60 * 1000 })
        : 'UNKNOWN';

      const weather = classifyCurrent(current);
      const quality = buildQuality(
        freshness,
        observedAt ? undefined : 'provider returned no observation timestamp',
      );
      const observedLatitude = Number.isFinite(Number(data && data.latitude)) ? Number(data.latitude) : lat;
      const observedLongitude = Number.isFinite(Number(data && data.longitude)) ? Number(data.longitude) : lng;
      const gridCellDistanceM = Math.round(distanceMeters(lat, lng, observedLatitude, observedLongitude));

      const observation = {
        id: 'open-meteo:weather:' + key,
        entityType: 'weather',
        source: 'open-meteo',
        sourceReference: key,
        latitude: observedLatitude,
        longitude: observedLongitude,
        observedAt: observedAt,
        receivedAt: receivedAt,
        freshnessMs: observedAt ? Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt)) : undefined,
        observationConfidence: 0.82,
        interpretationConfidence: null,
        operationalConfidence: null,
        accuracyM: gridCellDistanceM,
        confidence: 0.82,
        headingDeg: null,
        speedMps: null,
        status: weather.severity,
        attributes: Object.assign({}, weather, {
          timezone: data && data.timezone || 'UTC',
          requestedLatitude: lat,
          requestedLongitude: lng,
          gridCellDistanceM,
          modelGridPoint: true,
        }),
        provenance: {
          sourceName: 'Open-Meteo',
          sourceUrl: 'https://open-meteo.com/',
          observationType: 'current_weather_model_grid_point',
          sourceReference: key,
        },
        coverage: {
          complete: false,
          bounded: true,
          queryScope: 'point:' + key,
        },
        quality: quality,
      };

      cache.set(key, {
        observation: observation,
        cachedAt: now,
        expiresAt: now + CACHE_TTL_MS,
      });
      trimCache();

      health = Object.assign({}, health, {
        status: freshness,
        lastSuccessAt: receivedAt,
        lastErrorClass: null,
        lastErrorMessage: null,
      });

      return {
        observations: [observation],
        health: Object.assign({}, health),
        cache: { hit: false },
      };
    } catch (error) {
      const failureClass = error && error.failureClass
        ? error.failureClass
        : error && error.name === 'TimeoutError' ? 'timeout' : 'unknown';

      health = Object.assign({}, health, {
        status: 'UNAVAILABLE',
        lastErrorClass: failureClass,
        lastErrorMessage: String(error && error.message || error),
      });

      const stale = cache.get(key);
      if (stale) {
        const ageMs = Math.max(0, now - stale.cachedAt);
        const staleObservation = Object.assign({}, stale.observation, {
          quality: {
            state: 'stale',
            freshnessClass: 'STALE',
            reason: 'provider failed; serving cached observation',
          },
        });

        return {
          observations: [staleObservation],
          health: Object.assign({}, health, { status: 'STALE' }),
          cache: { hit: true, ageMs: ageMs },
          warning: 'provider_failed_using_stale_cache',
        };
      }

      return {
        observations: [],
        health: Object.assign({}, health),
        error: 'provider_unavailable',
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

function getProviderHealth() {
  return Object.assign({}, health);
}

module.exports = {
  getCurrentWeather,
  getProviderHealth,
};
