'use strict';

const CACHE_TTL_MS = 90_000;
const MAX_CACHE_ENTRIES = 128;
const cache = new Map();
const inflight = new Map();

let health = {
  providerId: 'open-meteo',
  status: 'UNKNOWN',
  requestCount: 0,
  cacheHits: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
};

const WMO = {
  0: 'clear',
  1: 'mainly_clear',
  2: 'partly_cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime_fog',
  51: 'light_drizzle',
  53: 'drizzle',
  55: 'heavy_drizzle',
  56: 'freezing_drizzle',
  57: 'heavy_freezing_drizzle',
  61: 'light_rain',
  63: 'rain',
  65: 'heavy_rain',
  66: 'freezing_rain',
  67: 'heavy_freezing_rain',
  71: 'light_snow',
  73: 'snow',
  75: 'heavy_snow',
  77: 'snow_grains',
  80: 'light_showers',
  81: 'showers',
  82: 'violent_showers',
  85: 'snow_showers',
  86: 'heavy_snow_showers',
  95: 'thunderstorm',
  96: 'thunderstorm_hail',
  99: 'severe_thunderstorm_hail',
};

function keyFor(lat, lng) {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
}

function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

function classifyCurrent(current = {}) {
  const code = Number(current.weather_code);
  const precipitation = Number(current.precipitation);
  const wind = Number(current.wind_speed_10m);
  const visibility = Number(current.visibility);

  const hazards = [];
  if (Number.isFinite(code) && code >= 95) hazards.push('thunderstorm');
  if (Number.isFinite(precipitation) && precipitation >= 10) hazards.push('heavy_precipitation');
  if (Number.isFinite(wind) && wind >= 50) hazards.push('high_wind');
  if (Number.isFinite(visibility) && visibility < 2000) hazards.push('poor_visibility');

  const severity = hazards.includes('thunderstorm') || hazards.includes('poor_visibility')
    ? 'high'
    : hazards.length
      ? 'medium'
      : 'low';

  return {
    weatherCode: Number.isFinite(code) ? code : null,
    conditions: WMO[code] || 'unknown',
    temperatureC: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null,
    humidityPct: Number.isFinite(Number(current.relative_humidity_2m)) ? Number(current.relative_humidity_2m) : null,
    precipitationMm: Number.isFinite(precipitation) ? precipitation : null,
    windSpeedKmh: Number.isFinite(wind) ? wind : null,
    visibilityM: Number.isFinite(visibility) ? visibility : null,
    hazards,
    severity,
  };
}

async function getCurrentWeather({ latitude, longitude, requestId } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { observations: [], health: { ...health, status: 'UNAVAILABLE' }, error: 'invalid_coordinates' };
  }

  const key = keyFor(lat, lng);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    health = { ...health, status: hit.observation.quality.freshnessClass, cacheHits: health.cacheHits + 1 };
    return { observations: [hit.observation], health: { ...health }, cache: { hit: true, ageMs: now - hit.cachedAt } };
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const p = (async () => {
    const receivedAt = new Date().toISOString();
    health = { ...health, requestCount: health.requestCount + 1, lastAttemptAt: receivedAt };
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}` +
        '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,visibility' +
        '&timezone=UTC&forecast_days=1';

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'X-Request-ID': String(requestId || '') },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) {
        const cls = res.status === 429 ? 'rate_limited' : 'http_error';
        throw Object.assign(new Error(`Open-Meteo HTTP ${res.status}`), { class: cls });
      }

      const data = await res.json();
      const current = data?.current || {};
      const observedAt = current.time ? new Date(current.time + (data.timezone_abbreviation === 'GMT' ? 'Z' : '')).toISOString() : receivedAt;
      const weather = classifyCurrent(current);
      const qualityClass = weather.hazards.length ? 'DELAYED' : 'LIVE';

      const observation = {
        id: `open-meteo:weather:${key}`,
        entityType: 'weather',
        source: 'open-meteo',
        sourceReference: key,
        latitude: lat,
        longitude: lng,
        observedAt,
        receivedAt,
        status: weather.severity,
        attributes: {
          ...weather,
          timezone: data.timezone || 'UTC',
        },
        provenance: {
          sourceName: 'Open-Meteo',
          sourceUrl: 'https://open-meteo.com/',
          observationType: 'current_weather',
          sourceReference: key,
        },
        coverage: {
          complete: false,
          bounded: true,
          queryScope: `point:${lat.toFixed(3)},${lng.toFixed(3)}`,
        },
        quality: {
          state: weather.hazards.length ? 'degraded' : 'good',
          freshnessClass: qualityClass,
          reason: weather.hazards.length ? 'weather observation contains operationally relevant hazards' : undefined,
        },
      };

      cache.set(key, { observation, cachedAt: now, expiresAt: now + CACHE_TTL_MS });
      trimCache();
      health = {
        ...health,
        status: qualityClass,
        lastSuccessAt: receivedAt,
        lastErrorClass: null,
        lastErrorMessage: null,
      };

      return {
        observations: [observation],
        health: { ...health },
        cache: { hit: false },
      };
    } catch (err) {
      const cls = err?.class || (err?.name === 'TimeoutError' ? 'timeout' : 'unknown');
      health = {
        ...health,
        status: 'UNAVAILABLE',
        lastErrorClass: cls,
        lastErrorMessage: String(err?.message || err),
      };

      const stale = cache.get(key);
      if (stale) {
        return {
          observations: [{ ...stale.observation, quality: { ...stale.observation.quality, state: 'stale', freshnessClass: 'STALE', reason: 'provider failed; serving cached observation' } }],
          health: { ...health, status: 'STALE' },
          cache: { hit: true, ageMs: now - stale.cachedAt },
          warning: 'provider_failed_using_stale_cache',
        };
      }

      return {
        observations: [],
        health: { ...health },
        error: 'provider_unavailable',
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

function getProviderHealth() {
  return { ...health };
}

module.exports = { getCurrentWeather, getProviderHealth };
