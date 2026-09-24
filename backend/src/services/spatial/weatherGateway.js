'use strict';

const {
  classifyFreshness,
  isValidLatLon,
  buildQuality,
} = require('../../../../packages/spatial-intelligence/dist/model/observation.js');

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

function keyFor(lat, lng) {
  return Number(lat).toFixed(3) + ',' + Number(lng).toFixed(3);
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
        ? new Date(String(current.time) + 'Z').toISOString()
        : null;

      const freshness = observedAt
        ? classifyFreshness(observedAt, receivedAt, { maxLiveMs: 10 * 60 * 1000, maxDelayedMs: 90 * 60 * 1000 })
        : 'UNKNOWN';

      const weather = classifyCurrent(current);
      const quality = buildQuality(
        freshness,
        observedAt ? undefined : { reason: 'provider returned no observation timestamp' },
      );

      const observation = {
        id: 'open-meteo:weather:' + key,
        entityType: 'weather',
        source: 'open-meteo',
        sourceReference: key,
        latitude: lat,
        longitude: lng,
        observedAt: observedAt,
        receivedAt: receivedAt,
        freshnessMs: observedAt ? Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt)) : undefined,
        observationConfidence: 0.82,
        interpretationConfidence: null,
        operationalConfidence: null,
        accuracyM: null,
        confidence: 0.82,
        headingDeg: null,
        speedMps: null,
        status: weather.severity,
        attributes: Object.assign({}, weather, {
          timezone: data && data.timezone || 'UTC',
        }),
        provenance: {
          sourceName: 'Open-Meteo',
          sourceUrl: 'https://open-meteo.com/',
          observationType: 'current_weather',
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
