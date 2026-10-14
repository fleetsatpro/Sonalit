'use strict';

const { XMLParser } = require('fast-xml-parser');

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const EARTHQUAKE_CACHE_TTL_MS = 60 * 1000;
const VOLCANO_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const VOLCANO_REPORT_TTL_MS = 30 * 60 * 1000;
const USGS_VOLCANO_ALERT_TTL_MS = 60 * 1000;
const NASA_EONET_TTL_MS = 2 * 60 * 1000;
const MAX_WEATHER_POINTS = 36;
const MAX_EARTHQUAKES = 300;

const sourceCache = new Map();
const sourceInflight = new Map();
const weatherCache = new Map();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

const WMO_CONDITIONS = {
  0: 'clear', 1: 'mainly_clear', 2: 'partly_cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime_fog', 51: 'light_drizzle', 53: 'drizzle', 55: 'heavy_drizzle',
  56: 'freezing_drizzle', 57: 'heavy_freezing_drizzle', 61: 'light_rain', 63: 'rain',
  65: 'heavy_rain', 66: 'freezing_rain', 67: 'heavy_freezing_rain',
  71: 'light_snow', 73: 'snow', 75: 'heavy_snow', 77: 'snow_grains',
  80: 'light_showers', 81: 'showers', 82: 'violent_showers',
  85: 'snow_showers', 86: 'heavy_snow_showers',
  95: 'thunderstorm', 96: 'thunderstorm_hail', 99: 'severe_thunderstorm_hail',
};

function isValidLatLon(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function normaliseName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchText(url, label, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/geo+json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      'User-Agent': 'Sonalit-World-Event-Simulation/1.0 (source-attributed operational visualization)',
    },
    signal: AbortSignal.timeout(timeoutMs || 9000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(label + ' HTTP ' + response.status), {
      source: label,
      statusCode: response.status,
    });
  }
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) {
    throw Object.assign(new Error(label + ' response exceeded the 8 MB safety bound'), {
      source: label,
      failureClass: 'response_too_large',
    });
  }
  return text;
}

async function fetchJson(url, label, timeoutMs) {
  const raw = await fetchText(url, label, timeoutMs);
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw Object.assign(new Error(label + ' returned invalid JSON'), {
      source: label,
      failureClass: 'invalid_json',
    });
  }
}

async function loadCachedSource(key, ttlMs, loader) {
  const now = Date.now();
  const cached = sourceCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { value: cached.value, receivedAt: cached.receivedAt, cache: 'HIT', stale: false };
  }
  if (sourceInflight.has(key)) return sourceInflight.get(key);

  const request = (async () => {
    try {
      const value = await loader();
      const receivedAt = new Date().toISOString();
      sourceCache.set(key, { value, receivedAt, expiresAt: Date.now() + ttlMs });
      return { value, receivedAt, cache: 'MISS', stale: false };
    } catch (error) {
      const previous = sourceCache.get(key);
      if (previous) {
        return {
          value: previous.value,
          receivedAt: previous.receivedAt,
          cache: 'STALE_FALLBACK',
          stale: true,
          error: String(error && error.message || error),
        };
      }
      throw error;
    } finally {
      sourceInflight.delete(key);
    }
  })();
  sourceInflight.set(key, request);
  return request;
}

function fallbackBounds(center, radiusM) {
  const radius = Math.max(1000, Math.min(250000, Number(radiusM) || 100000));
  const latDelta = radius / 111320;
  const cosine = Math.max(0.087, Math.abs(Math.cos(Number(center.latitude) * Math.PI / 180)));
  const lonDelta = Math.min(180, radius / (111320 * cosine));
  return [
    Math.max(-180, Number(center.longitude) - lonDelta),
    Math.max(-90, Number(center.latitude) - latDelta),
    Math.min(180, Number(center.longitude) + lonDelta),
    Math.min(90, Number(center.latitude) + latDelta),
  ];
}

function buildForecastGrid(bounds, center, radiusM, maxPoints) {
  let extent = Array.isArray(bounds) && bounds.length === 4 ? bounds.map(Number) : null;
  if (!extent || extent.some(value => !Number.isFinite(value))
    || extent[0] < -180 || extent[2] > 180 || extent[1] < -90 || extent[3] > 90
    || extent[0] >= extent[2] || extent[1] >= extent[3]) {
    extent = fallbackBounds(center, radiusM);
  }
  const west = extent[0];
  const south = extent[1];
  const east = extent[2];
  const north = extent[3];
  const desired = Math.max(4, Math.min(MAX_WEATHER_POINTS, Number(maxPoints) || MAX_WEATHER_POINTS));
  const latSpan = north - south;
  const lonSpan = east - west;
  const midLat = (south + north) / 2;
  const aspect = Math.max(0.2, lonSpan * Math.max(0.2, Math.cos(midLat * Math.PI / 180)) / Math.max(0.01, latSpan));
  let columns = Math.max(2, Math.min(6, Math.round(Math.sqrt(desired * aspect))));
  let rows = Math.max(2, Math.min(6, Math.floor(desired / columns)));
  while (columns * rows > desired && rows > 2) rows -= 1;
  while (columns * rows > desired && columns > 2) columns -= 1;

  const points = [];
  const seen = new Set();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const latitude = south + ((row + 0.5) / rows) * latSpan;
      const longitude = west + ((column + 0.5) / columns) * lonSpan;
      const key = latitude.toFixed(3) + ',' + longitude.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ latitude, longitude, key });
    }
  }
  return { points, bounds: extent, rows, columns };
}

function toIsoUtc(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  // Forecast hour strings are timezone-less UTC; RSS feeds often use RFC-822
  // timestamps ending in GMT. Do not append a second zone marker to those.
  const hasZone = /(?:[zZ]|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasZone ? raw : raw + 'Z');
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function weatherStepFromHourly(hourly, index) {
  const code = numberOrNull(hourly && hourly.weather_code && hourly.weather_code[index]);
  const time = toIsoUtc(hourly && hourly.time && hourly.time[index]);
  if (code == null || !time) return null;
  const precipitation = numberOrNull(hourly.precipitation && hourly.precipitation[index]) || 0;
  const rain = numberOrNull(hourly.rain && hourly.rain[index]) || 0;
  const showers = numberOrNull(hourly.showers && hourly.showers[index]) || 0;
  const snowfall = numberOrNull(hourly.snowfall && hourly.snowfall[index]) || 0;
  const windSpeed = numberOrNull(hourly.wind_speed_10m && hourly.wind_speed_10m[index]);
  const windDirection = numberOrNull(hourly.wind_direction_10m && hourly.wind_direction_10m[index]);
  const temperature = numberOrNull(hourly.temperature_2m && hourly.temperature_2m[index]);
  const cloudCover = numberOrNull(hourly.cloud_cover && hourly.cloud_cover[index]);
  const conditions = WMO_CONDITIONS[code] || 'unknown';
  const intensity = Math.max(precipitation, rain, showers);
  const severity = code >= 95 ? 'THUNDERSTORM'
    : intensity >= 7.5 ? 'HEAVY_PRECIPITATION'
      : intensity >= 2.5 ? 'MODERATE_PRECIPITATION'
        : intensity > 0 ? 'LIGHT_PRECIPITATION'
          : snowfall > 0 ? 'SNOW'
            : 'GENERAL';
  return {
    validAt: time,
    weatherCode: code,
    conditions,
    severity,
    temperatureC: temperature,
    precipitationMm: precipitation,
    rainMm: rain,
    showersMm: showers,
    snowfallCm: snowfall,
    windSpeedKmh: windSpeed,
    windDirectionDeg: windDirection,
    cloudCoverPct: cloudCover,
  };
}

function makeWeatherSimulationEntity(requested, row, receivedAt) {
  const hourly = row && row.hourly || {};
  const steps = asArray(hourly.time).map((_, index) => weatherStepFromHourly(hourly, index)).filter(Boolean).slice(0, 7);
  if (!steps.length) return null;
  const latitude = numberOrNull(row.latitude);
  const longitude = numberOrNull(row.longitude);
  if (!isValidLatLon(latitude, longitude)) return null;
  const key = latitude.toFixed(3) + ',' + longitude.toFixed(3);
  const first = steps[0];
  return {
    id: 'open-meteo:forecast-grid:' + key,
    entityType: 'weather',
    source: 'open-meteo',
    sourceReference: key,
    latitude,
    longitude,
    observedAt: null,
    receivedAt,
    status: 'MODELLED_FORECAST',
    observationConfidence: 0.72,
    operationalConfidence: null,
    attributes: Object.assign({}, first, {
      name: 'Weather forecast',
      modelGridPoint: true,
      simulationMode: 'hourly_forecast',
      simulationSemantics: 'numerical_weather_forecast_not_live_radar',
      forecastSteps: steps,
      forecastStepCount: steps.length,
      forecastHorizonHours: Math.max(0, steps.length - 1),
      gridCellDistanceM: Math.round(haversineMeters(requested.latitude, requested.longitude, latitude, longitude)),
      requestedLatitude: requested.latitude,
      requestedLongitude: requested.longitude,
      timezone: row.timezone || 'UTC',
      modelGenerationTimeMs: numberOrNull(row.generationtime_ms),
      modelReceivedAt: receivedAt,
      initialValidAt: first.validAt,
    }),
    provenance: {
      sourceName: 'Open-Meteo Forecast API',
      sourceUrl: 'https://open-meteo.com/en/docs',
      observationType: 'hourly_numerical_weather_forecast_grid_point',
      sourceReference: key,
      providerReceivedAt: receivedAt,
    },
    quality: {
      state: 'modelled',
      freshnessClass: 'MODELLED',
      reason: 'Hourly numerical weather forecast. This is not a live radar return or an on-ground sensor observation.',
    },
    coverage: {
      complete: false,
      bounded: true,
      queryScope: 'weather-forecast-grid-point:' + key,
      footprintSemantics: 'sampled_model_grid_points_not_radar_or_precipitation_footprints',
    },
  };
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const p1 = toRad(aLat);
  const p2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

async function loadWeatherForecast(bounds, center, radiusM, signal) {
  const plan = buildForecastGrid(bounds, center, radiusM, MAX_WEATHER_POINTS);
  const now = Date.now();
  const requested = [];
  const outputByKey = new Map();
  for (const point of plan.points) {
    const cached = weatherCache.get(point.key);
    if (cached && cached.expiresAt > now) {
      outputByKey.set(point.key, cached.entity);
    } else {
      requested.push(point);
    }
  }

  if (requested.length) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude='
      + encodeURIComponent(requested.map(point => point.latitude).join(','))
      + '&longitude=' + encodeURIComponent(requested.map(point => point.longitude).join(','))
      + '&hourly=temperature_2m,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover'
      + '&forecast_hours=7&timezone=UTC';
    const timeout = AbortSignal.timeout(9000);
    const requestSignal = signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Request-ID': 'gev-live-simulation-weather' },
      signal: requestSignal,
    });
    if (!response.ok) throw new Error('Open-Meteo forecast HTTP ' + response.status);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    const receivedAt = new Date().toISOString();
    rows.forEach((row, index) => {
      const point = requested[index];
      if (!point || !row) return;
      const entity = makeWeatherSimulationEntity(point, row, receivedAt);
      if (!entity) return;
      const key = entity.latitude.toFixed(3) + ',' + entity.longitude.toFixed(3);
      weatherCache.set(point.key, { entity, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
      outputByKey.set(point.key, entity);
      if (!outputByKey.has(key)) outputByKey.set(key, entity);
    });
    while (weatherCache.size > 256) weatherCache.delete(weatherCache.keys().next().value);
  }

  const entities = Array.from(new Map(Array.from(outputByKey.values()).map(entity => [entity.id, entity])).values());
  const stepCount = entities.reduce((minimum, entity) => Math.min(minimum, Number(entity.attributes.forecastStepCount) || 0), 7);
  return {
    entities: entities.slice(0, MAX_WEATHER_POINTS),
    health: {
      source: 'open-meteo',
      status: entities.length === plan.points.length ? 'MODELLED' : entities.length ? 'PARTIAL' : 'UNAVAILABLE',
      requestedSamples: plan.points.length,
      successfulSamples: entities.length,
      failedSamples: Math.max(0, plan.points.length - entities.length),
      forecastStepCount: stepCount,
      horizonHours: Math.max(0, stepCount - 1),
      bounds: plan.bounds,
      grid: { rows: plan.rows, columns: plan.columns },
    },
  };
}

function earthquakeEntity(feature, generatedAt) {
  const properties = feature && feature.properties || {};
  const geometry = feature && feature.geometry;
  const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const longitude = numberOrNull(coordinates[0]);
  const latitude = numberOrNull(coordinates[1]);
  const depthKm = numberOrNull(coordinates[2]);
  const magnitude = numberOrNull(properties.mag);
  const originAt = numberOrNull(properties.time);
  const updatedAt = numberOrNull(properties.updated);
  if (!isValidLatLon(latitude, longitude) || magnitude == null || originAt == null) return null;
  const ageMs = Math.max(0, Date.now() - originAt);
  const freshnessClass = ageMs <= 15 * 60 * 1000 ? 'LIVE' : ageMs <= 24 * 60 * 60 * 1000 ? 'DELAYED' : 'STALE';
  return {
    id: 'usgs:earthquake:' + String(feature.id || properties.code || originAt),
    entityType: 'earthquake',
    source: 'USGS ComCat',
    sourceReference: String(feature.id || properties.code || ''),
    latitude,
    longitude,
    observedAt: new Date(originAt).toISOString(),
    receivedAt: generatedAt,
    updatedAt: updatedAt == null ? null : new Date(updatedAt).toISOString(),
    accuracyM: null,
    observationConfidence: null,
    status: properties.alert ? String(properties.alert).toUpperCase() : 'CATALOG_EVENT',
    attributes: {
      name: 'Earthquake',
      title: String(properties.title || properties.place || 'Earthquake'),
      place: String(properties.place || 'Location unavailable'),
      magnitude,
      magnitudeType: String(properties.magType || 'unknown'),
      depthKm,
      significance: numberOrNull(properties.sig),
      feltReports: numberOrNull(properties.felt),
      tsunami: Number(properties.tsunami) === 1,
      eventStatus: String(properties.status || 'unknown'),
      eventType: String(properties.type || 'earthquake'),
      detailUrl: String(properties.url || ''),
      detailApiUrl: String(properties.detail || ''),
      eventAgeMinutes: Math.round(ageMs / 60000),
      feedUpdatedAt: generatedAt,
      visualizationSemantics: 'epicentre_and_symbolic_pulse_not_shakemap_or_predicted_damage',
    },
    provenance: {
      sourceName: 'USGS Earthquake Hazards Program — ComCat',
      sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      observationType: 'earthquake_event_catalogue',
      productDetailUrl: String(properties.detail || ''),
      eventUpdatedAt: updatedAt == null ? null : new Date(updatedAt).toISOString(),
    },
    quality: {
      state: freshnessClass === 'LIVE' ? 'good' : freshnessClass === 'DELAYED' ? 'degraded' : 'stale',
      freshnessClass,
      reason: 'Catalogued earthquake origin time. This marker does not indicate a measured shaking footprint.',
    },
  };
}

async function loadEarthquakes() {
  const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
  const feed = await fetchJson(url, 'USGS ComCat', 8000);
  const generatedAt = feed && feed.metadata && Number.isFinite(Number(feed.metadata.generated))
    ? new Date(Number(feed.metadata.generated)).toISOString()
    : new Date().toISOString();
  const features = asArray(feed && feed.features).map(feature => earthquakeEntity(feature, generatedAt)).filter(Boolean);
  features.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return {
    entities: features.slice(0, MAX_EARTHQUAKES),
    generatedAt,
    sourceUrl: url,
    feedTitle: String(feed && feed.metadata && feed.metadata.title || 'M2.5+ earthquakes in the past day'),
  };
}

async function loadVolcanoCatalog() {
  const url = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW%3ASmithsonian_VOTW_Holocene_Volcanoes&outputFormat=json&count=1500';
  const payload = await fetchJson(url, 'Smithsonian GVP volcano catalogue', 10000);
  const features = asArray(payload && payload.features);
  if (!features.length) throw new Error('Smithsonian GVP catalogue returned no features');
  const catalog = [];
  for (const feature of features) {
    const properties = feature && feature.properties || {};
    const geometry = feature && feature.geometry;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const latitude = numberOrNull(properties.Latitude ?? properties.latitude ?? coordinates[1]);
    const longitude = numberOrNull(properties.Longitude ?? properties.longitude ?? coordinates[0]);
    const number = properties.Volcano_Number ?? properties.volcano_number ?? properties.VOLCANO_NUMBER;
    const name = properties.Volcano_Name ?? properties.volcano_name ?? properties.VOLCANO_NAME;
    if (!isValidLatLon(latitude, longitude) || !name) continue;
    catalog.push({
      volcanoNumber: number == null ? null : String(number),
      name: String(name),
      country: String(properties.Country ?? properties.country ?? ''),
      region: String(properties.Region ?? properties.region ?? ''),
      latitude,
      longitude,
      elevationM: numberOrNull(properties.Elevation ?? properties.elevation),
      lastEruptionYear: numberOrNull(properties.Last_Eruption_Year ?? properties.last_eruption_year),
    });
  }
  if (!catalog.length) throw new Error('Smithsonian GVP catalogue has no usable volcano coordinates');
  return { volcanoes: catalog, receivedAt: new Date().toISOString(), sourceUrl: url };
}

function linkValue(link) {
  if (typeof link === 'string') return link;
  if (link && typeof link === 'object') return String(link['#text'] || link['@_href'] || link.href || '');
  return '';
}

function parseVolcanoReportItems(xml) {
  const parsed = xmlParser.parse(xml);
  const channel = parsed && parsed.rss && parsed.rss.channel;
  const items = channel ? asArray(channel.item) : asArray(parsed && parsed.feed && parsed.feed.entry);
  const feedDate = toIsoUtc(channel && channel.lastBuildDate || parsed && parsed.feed && parsed.feed.updated);
  return {
    feedDate,
    items: items.map(item => {
      const title = String(item && item.title || '').trim();
      const firstPart = title.split('|')[0].trim();
      const volcanoName = firstPart.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const description = String(item && (item.description || item.summary || item.content) || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const reportTypeText = title + ' ' + description.slice(0, 600);
      const reportType = /unrest/i.test(title) ? 'UNREST_REPORTED'
        : /eruptive activity/i.test(title) ? 'ERUPTIVE_ACTIVITY_REPORTED'
          : /other observations?/i.test(title) ? 'OBSERVATION_REPORTED' : 'ACTIVITY_REPORTED';
      const rawDate = item && (item.pubDate || item.updated || item.published);
      const itemLink = linkValue(item && item.link);
      const query = itemLink.match(/[?&](?:vn|volcanoNumber)=([0-9]+)/i);
      return {
        title,
        volcanoName,
        normalisedName: normaliseName(volcanoName),
        volcanoNumber: query ? query[1] : null,
        description: description.slice(0, 4000),
        reportType,
        reportedAt: toIsoUtc(rawDate) || feedDate,
        url: itemLink,
        guid: String(item && item.guid || ''),
        source: 'Smithsonian / USGS Weekly Volcanic Activity Report',
      };
    }).filter(item => item.volcanoName),
  };
}

async function loadVolcanoActivity() {
  const url = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';
  const xml = await fetchText(url, 'Smithsonian / USGS Weekly Volcanic Activity Report', 9000);
  return Object.assign(parseVolcanoReportItems(xml), {
    receivedAt: new Date().toISOString(),
    sourceUrl: url,
  });
}

function matchVolcanoReport(report, catalog) {
  if (report.volcanoNumber) {
    const idMatch = catalog.find(item => item.volcanoNumber === report.volcanoNumber);
    if (idMatch) return idMatch;
  }
  const name = report.normalisedName;
  if (!name) return null;
  const exact = catalog.find(item => normaliseName(item.name) === name);
  if (exact) return exact;
  // Profile pages can include a sub-feature name while the report uses the parent volcano name.
  const candidates = catalog.filter(item => {
    const candidate = normaliseName(item.name);
    return candidate.startsWith(name + ' ') || name.startsWith(candidate + ' ');
  });
  return candidates.sort((a, b) => Math.abs(normaliseName(a.name).length - name.length) - Math.abs(normaliseName(b.name).length - name.length))[0] || null;
}

function volcanoEntity(report, volcano, receivedAt, stale) {
  const reportDate = report.reportedAt;
  const ageMs = reportDate ? Math.max(0, Date.now() - Date.parse(reportDate)) : Number.POSITIVE_INFINITY;
  const freshnessClass = stale || ageMs > 7 * 24 * 60 * 60 * 1000 ? 'STALE' : 'DELAYED';
  return {
    id: 'gvp:volcanic-activity:' + (volcano.volcanoNumber || normaliseName(volcano.name).replace(/\s/g, '-')) + ':' + (reportDate || 'unknown'),
    entityType: 'volcano',
    source: 'Smithsonian GVP / USGS WVAR',
    sourceReference: volcano.volcanoNumber || volcano.name,
    latitude: volcano.latitude,
    longitude: volcano.longitude,
    observedAt: reportDate || null,
    receivedAt,
    status: report.reportType,
    attributes: {
      name: volcano.name,
      title: volcano.name + ' — ' + report.reportType.replaceAll('_', ' ').toLowerCase(),
      country: volcano.country,
      region: volcano.region,
      elevationM: volcano.elevationM,
      lastEruptionYear: volcano.lastEruptionYear,
      volcanoNumber: volcano.volcanoNumber,
      reportType: report.reportType,
      reportTitle: report.title,
      reportText: report.description,
      reportUrl: report.url || 'https://volcano.si.edu/reports_weekly.cfm',
      reportDate: reportDate,
      catalogueUpdatedAt: null,
      reportingCadence: 'weekly',
      visualizationSemantics: 'reported_volcanic_activity_beacon_not_live_vent_video_or_measured_ash_plume',
    },
    provenance: {
      sourceName: 'Smithsonian Global Volcanism Program / USGS Volcano Hazards Program',
      sourceUrl: report.url || 'https://volcano.si.edu/reports_weekly.cfm',
      catalogueUrl: 'https://volcano.si.edu/database/webservices.cfm',
      observationType: 'weekly_volcanic_activity_report',
      reportDate: reportDate,
      sourceReceivedAt: receivedAt,
    },
    quality: {
      state: freshnessClass === 'STALE' ? 'stale' : 'degraded',
      freshnessClass,
      reason: 'This is a weekly activity report, not a real-time volcano-monitoring feed. Check the linked observatory report for current status.',
    },
  };
}

async function loadUsgsElevatedVolcanoes() {
  const url = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes';
  const payload = await fetchJson(url, 'USGS elevated volcano alerts', 9000);
  const alerts = asArray(payload).filter(alert => alert && (alert.vnum || alert.volcano_name));
  return { alerts, receivedAt: new Date().toISOString(), sourceUrl: url };
}

function usgsElevatedVolcanoEntity(alert, volcano, receivedAt, stale) {
  const number = String(alert.vnum ?? volcano.volcanoNumber ?? '');
  const alertLevel = String(alert.alert_level ?? 'UNKNOWN').toUpperCase();
  const colorCode = String(alert.color_code ?? 'UNKNOWN').toUpperCase();
  const noticeDate = toIsoUtc(alert.sent_utc) || (Number.isFinite(Number(alert.sent_unixtime)) ? new Date(Number(alert.sent_unixtime) * 1000).toISOString() : null);
  const currentAlert = {
    alertLevel,
    colorCode,
    noticeType: String(alert.notice_type_cd ?? ''),
    noticeIdentifier: String(alert.notice_identifier ?? ''),
    noticeIssuedAt: noticeDate,
    noticeUrl: String(alert.notice_url ?? 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes'),
    noticeDataUrl: String(alert.notice_data ?? ''),
    observatory: String(alert.obs_fullname ?? ''),
    sourceStatus: stale ? 'STALE_CACHE_FALLBACK' : 'CURRENT_ELEVATED_STATUS_FEED',
    sourceReceivedAt: receivedAt,
  };
  return {
    id: 'usgs:volcano-alert:' + (number || normaliseName(volcano.name).replace(/\s/g, '-')),
    entityType: 'volcano',
    source: 'USGS Volcano Hazards Program',
    sourceReference: number || volcano.name,
    latitude: volcano.latitude,
    longitude: volcano.longitude,
    observedAt: noticeDate,
    receivedAt,
    status: 'USGS_ELEVATED_ALERT_' + alertLevel,
    attributes: {
      name: volcano.name,
      title: volcano.name + ' — USGS ' + alertLevel + ' / ' + colorCode,
      country: volcano.country,
      region: volcano.region,
      elevationM: volcano.elevationM,
      volcanoNumber: number || volcano.volcanoNumber,
      reportType: 'USGS_ELEVATED_ALERT',
      reportingCadence: 'elevated_status_feed',
      usgsCurrentAlert: currentAlert,
      reportUrl: currentAlert.noticeUrl,
      visualizationSemantics: 'current_usgs_elevated_alert_beacon_not_an_ash_plume_or_eruption_footprint',
    },
    provenance: {
      sourceName: 'USGS Volcano Hazards Program — Elevated Volcano Alerts',
      sourceUrl: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
      observationType: 'current_elevated_volcano_alert',
      sourceReceivedAt: receivedAt,
      noticeIssuedAt: noticeDate,
      noticeUrl: currentAlert.noticeUrl,
      observatory: currentAlert.observatory,
    },
    quality: {
      state: stale ? 'stale' : 'good',
      freshnessClass: stale ? 'STALE' : 'LIVE',
      reason: stale
        ? 'The USGS elevated-alert feed could not be refreshed; this alert is from a previously cached feed.'
        : 'Currently listed as an elevated volcano status by USGS. The notice timestamp is the issue time, not a sensor sample time.',
    },
  };
}

async function loadVolcanoEvents() {
  const [catalogResult, reportResult, alertResult] = await Promise.allSettled([
    loadCachedSource('gvp-volcano-catalog', VOLCANO_CATALOG_TTL_MS, loadVolcanoCatalog),
    loadCachedSource('gvp-weekly-activity', VOLCANO_REPORT_TTL_MS, loadVolcanoActivity),
    loadCachedSource('usgs-elevated-volcano-alerts', USGS_VOLCANO_ALERT_TTL_MS, loadUsgsElevatedVolcanoes),
  ]);
  const warnings = [];
  let catalog = [];
  let reportData = { items: [], feedDate: null };
  let alerts = [];
  let catalogStale = false;
  let reportStale = false;
  let alertStale = false;

  if (catalogResult.status === 'fulfilled') {
    catalog = catalogResult.value.value.volcanoes || [];
    catalogStale = catalogResult.value.stale;
  } else {
    warnings.push('volcano_catalog_unavailable: ' + String(catalogResult.reason && catalogResult.reason.message || catalogResult.reason));
  }
  if (reportResult.status === 'fulfilled') {
    reportData = reportResult.value.value;
    reportStale = reportResult.value.stale;
  } else {
    warnings.push('volcano_activity_report_unavailable: ' + String(reportResult.reason && reportResult.reason.message || reportResult.reason));
  }
  if (alertResult.status === 'fulfilled') {
    alerts = alertResult.value.value.alerts || [];
    alertStale = alertResult.value.stale;
  } else {
    warnings.push('usgs_current_volcano_alerts_unavailable: ' + String(alertResult.reason && alertResult.reason.message || alertResult.reason));
  }

  const now = new Date().toISOString();
  const entities = [];
  let unmatchedReports = 0;
  for (const report of reportData.items || []) {
    const volcano = matchVolcanoReport(report, catalog);
    if (!volcano) {
      unmatchedReports += 1;
      continue;
    }
    entities.push(volcanoEntity(report, volcano, now, catalogStale || reportStale));
  }

  let matchedElevatedAlerts = 0;
  let unmatchedElevatedAlerts = 0;
  for (const alert of alerts) {
    const volcanoNumber = String(alert.vnum ?? '');
    const volcano = catalog.find(item => volcanoNumber && String(item.volcanoNumber) === volcanoNumber)
      || matchVolcanoReport({ normalisedName: normaliseName(alert.volcano_name) }, catalog);
    if (!volcano) {
      unmatchedElevatedAlerts += 1;
      continue;
    }
    matchedElevatedAlerts += 1;
    const alertEntity = usgsElevatedVolcanoEntity(alert, volcano, now, alertStale || catalogStale);
    const existing = entities.find(entity => String(entity.attributes?.volcanoNumber ?? '') === String(volcano.volcanoNumber ?? ''));
    if (existing) {
      existing.attributes = Object.assign({}, existing.attributes, {
        usgsCurrentAlert: alertEntity.attributes.usgsCurrentAlert,
        usgsAlertTitle: alertEntity.attributes.title,
      });
      existing.provenance = Object.assign({}, existing.provenance, {
        elevatedAlertSource: alertEntity.provenance.sourceUrl,
        elevatedAlertNoticeUrl: alertEntity.attributes.usgsCurrentAlert.noticeUrl,
        elevatedAlertReceivedAt: now,
      });
      existing.source = 'Smithsonian GVP / USGS WVAR + USGS elevated alert';
    } else {
      entities.push(alertEntity);
    }
  }

  return {
    entities,
    health: {
      source: 'smithsonian-gvp-usgs-wvar+usgs-elevated-alerts',
      status: warnings.length ? entities.length ? 'PARTIAL' : 'UNAVAILABLE' : !alertStale && matchedElevatedAlerts > 0 ? 'LIVE' : 'DELAYED',
      catalogueCount: catalog.length,
      reportCount: (reportData.items || []).length,
      matchedReportCount: (reportData.items || []).length - unmatchedReports,
      unmatchedReportCount: unmatchedReports,
      reportFeedDate: reportData.feedDate || null,
      reportCacheStale: reportStale,
      catalogueCacheStale: catalogStale,
      elevatedAlertCount: alerts.length,
      matchedElevatedAlertCount: matchedElevatedAlerts,
      unmatchedElevatedAlertCount: unmatchedElevatedAlerts,
      elevatedAlertCacheStale: alertStale,
    },
    warnings,
    sources: {
      catalogue: 'https://volcano.si.edu/database/webservices.cfm',
      activity: 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml',
      usgsElevatedAlerts: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
    },
  };
}

function collectGeometryPositions(geometry, out = []) {
  if (!geometry || typeof geometry !== 'object') return out;
  if (Array.isArray(geometry.coordinates)) {
    collectCoordinatePairs(geometry.coordinates, out);
  }
  if (Array.isArray(geometry.geometries)) {
    for (const child of geometry.geometries) collectGeometryPositions(child, out);
  }
  return out;
}

function collectCoordinatePairs(value, out) {
  if (!Array.isArray(value)) return out;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    if (isValidLatLon(value[1], value[0])) out.push([value[0], value[1]]);
    return out;
  }
  for (const child of value) collectCoordinatePairs(child, out);
  return out;
}

function eventGeometryCentre(geometry) {
  const positions = collectGeometryPositions(geometry);
  if (!positions.length) return null;
  const latitude = positions.reduce((sum, position) => sum + position[1], 0) / positions.length;
  // Circular mean avoids putting a dateline-crossing source geometry in the wrong hemisphere.
  const sine = positions.reduce((sum, position) => sum + Math.sin(position[0] * Math.PI / 180), 0);
  const cosine = positions.reduce((sum, position) => sum + Math.cos(position[0] * Math.PI / 180), 0);
  const longitude = Math.atan2(sine, cosine) * 180 / Math.PI;
  return {
    latitude,
    longitude,
    sourceGeometryType: String(geometry && geometry.type || 'unknown'),
    sourceCoordinateCount: positions.length,
  };
}

function nasaEonetEntity(feature, receivedAt) {
  const properties = feature && feature.properties || {};
  const geometry = feature && feature.geometry;
  const centre = eventGeometryCentre(geometry);
  if (!centre || !isValidLatLon(centre.latitude, centre.longitude)) return null;
  const id = String(properties.id || feature.id || '');
  if (!id) return null;
  const categories = asArray(properties.categories).map(category => ({
    id: String(category && category.id || ''),
    title: String(category && category.title || category && category.id || 'Natural event'),
  }));
  const primaryCategory = categories[0] || { id: 'naturalEvent', title: 'Natural event' };
  const dateValues = Array.isArray(properties.geometryDates) ? properties.geometryDates : [];
  const dateValue = dateValues.length ? dateValues[dateValues.length - 1] : properties.date;
  const eventDate = toIsoUtc(dateValue);
  const ageMs = eventDate ? Math.max(0, Date.now() - Date.parse(eventDate)) : Number.POSITIVE_INFINITY;
  const freshnessClass = !eventDate ? 'UNKNOWN'
    : ageMs <= 6 * 60 * 60 * 1000 ? 'LIVE'
      : ageMs <= 3 * 24 * 60 * 60 * 1000 ? 'DELAYED' : 'STALE';
  const sources = asArray(properties.sources).map(item => ({
    id: String(item && item.id || ''),
    title: String(item && item.title || item && item.id || 'Source'),
    url: String(item && (item.url || item.source || item.link) || ''),
  })).filter(item => item.url);
  const eventLink = String(properties.link || feature.id && ('https://eonet.gsfc.nasa.gov/api/v3/events/' + feature.id) || 'https://eonet.gsfc.nasa.gov/');
  return {
    id: 'nasa-eonet:' + id,
    entityType: 'natural_event',
    source: 'NASA EONET',
    sourceReference: id,
    latitude: centre.latitude,
    longitude: centre.longitude,
    observedAt: eventDate,
    receivedAt,
    status: properties.closed ? 'CLOSED' : 'OPEN',
    attributes: {
      name: String(properties.title || primaryCategory.title || 'Natural event'),
      title: String(properties.title || primaryCategory.title || 'Natural event'),
      description: String(properties.description || ''),
      naturalCategory: primaryCategory.id,
      categoryId: primaryCategory.id,
      categoryTitle: primaryCategory.title,
      categories,
      eventId: id,
      eventOpen: properties.closed == null,
      closedAt: toIsoUtc(properties.closed),
      eventLink,
      sourceLinks: sources,
      magnitudeValue: numberOrNull(properties.magnitudeValue),
      magnitudeUnit: String(properties.magnitudeUnit || ''),
      magnitudeDescription: String(properties.magnitudeDescription || ''),
      eventDate,
      sourceGeometryType: centre.sourceGeometryType,
      sourceCoordinateCount: centre.sourceCoordinateCount,
      locationSemantics: centre.sourceGeometryType === 'Point' && centre.sourceCoordinateCount === 1
        ? 'source_point_location'
        : 'centroid_of_source_event_geometry_not_a_rendered_hazard_perimeter',
      visualizationSemantics: 'open_curated_natural_event_locator_not_a_live_sensor_video_or_measured_damage_footprint',
    },
    provenance: {
      sourceName: 'NASA Earth Observatory Natural Event Tracker (EONET)',
      sourceUrl: eventLink,
      feedUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200',
      observationType: 'open_curated_natural_event_metadata',
      sourceReceivedAt: receivedAt,
      eventDate,
      sourceLinks: sources,
    },
    quality: {
      state: freshnessClass === 'STALE' ? 'stale' : freshnessClass === 'UNKNOWN' ? 'unknown' : 'good',
      freshnessClass,
      reason: centre.sourceGeometryType === 'Point'
        ? 'NASA-curated event location; event date and source references are available in detail.'
        : 'Marker is the centre of source-provided event geometry. The source footprint is not drawn and this symbol does not claim to show the event boundary.',
    },
    coverage: {
      queryScope: 'nasa-eonet-open-global-events',
      sourceGeometryType: centre.sourceGeometryType,
      sourceCoordinateCount: centre.sourceCoordinateCount,
    },
  };
}

async function loadNasaEonetEvents() {
  const url = 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200';
  const feed = await fetchJson(url, 'NASA EONET open events', 10000);
  const receivedAt = new Date().toISOString();
  const features = asArray(feed && feed.features);
  const entities = features.map(feature => nasaEonetEntity(feature, receivedAt)).filter(Boolean);
  entities.sort((a, b) => (Date.parse(b.observedAt || '') || 0) - (Date.parse(a.observedAt || '') || 0));
  return {
    entities: entities.slice(0, 200),
    generatedAt: receivedAt,
    sourceUrl: url,
    returnedFeatures: features.length,
    acceptedEvents: entities.length,
  };
}

async function getLiveEventSimulation(input) {
  const options = input || {};
  const center = {
    latitude: numberOrNull(options.center && options.center.latitude) ?? 0,
    longitude: numberOrNull(options.center && options.center.longitude) ?? 0,
  };
  const bounds = Array.isArray(options.bounds) ? options.bounds : null;
  const radiusM = numberOrNull(options.radiusM) || 100000;
  const generatedAt = new Date().toISOString();
  const results = await Promise.allSettled([
    loadWeatherForecast(bounds, center, radiusM, options.signal),
    loadCachedSource('usgs-earthquakes-m2-5-day', EARTHQUAKE_CACHE_TTL_MS, loadEarthquakes),
    loadVolcanoEvents(),
    loadCachedSource('nasa-eonet-open-events', NASA_EONET_TTL_MS, loadNasaEonetEvents),
  ]);
  const weather = results[0].status === 'fulfilled' ? results[0].value : { entities: [], health: { source: 'open-meteo', status: 'UNAVAILABLE' }, error: String(results[0].reason && results[0].reason.message || results[0].reason) };
  const earthquakesResult = results[1];
  const earthquakes = earthquakesResult.status === 'fulfilled'
    ? earthquakesResult.value.value
    : { entities: [], feedTitle: 'USGS earthquake feed unavailable', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php' };
  const volcanoesResult = results[2];
  const volcanoes = volcanoesResult.status === 'fulfilled'
    ? volcanoesResult.value
    : { entities: [], health: { source: 'smithsonian-gvp-usgs-wvar', status: 'UNAVAILABLE' }, warnings: [String(volcanoesResult.reason && volcanoesResult.reason.message || volcanoesResult.reason)] };

  const eonetResult = results[3];
  const eonet = eonetResult.status === 'fulfilled'
    ? eonetResult.value.value
    : { entities: [], sourceUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200', returnedFeatures: 0 };

  const entities = [
    ...(weather.entities || []),
    ...(earthquakes.entities || []),
    ...(volcanoes.entities || []),
    ...(eonet.entities || []),
  ];
  const sourceStatuses = [
    weather.health && weather.health.status,
    earthquakesResult.status === 'fulfilled' ? (earthquakesResult.value.stale ? 'STALE' : 'LIVE') : 'UNAVAILABLE',
    volcanoes.health && volcanoes.health.status,
    eonetResult.status === 'fulfilled' ? (eonetResult.value.stale ? 'STALE_FALLBACK' : 'LIVE') : 'UNAVAILABLE',
  ];
  const successCount = sourceStatuses.filter(status => !['UNAVAILABLE', 'ERROR'].includes(String(status))).length;
  const overallStatus = successCount === sourceStatuses.length ? 'AVAILABLE' : successCount ? 'PARTIAL' : 'UNAVAILABLE';
  const warnings = [
    ...(weather.error ? ['weather_forecast_unavailable: ' + weather.error] : []),
    ...(earthquakesResult.status === 'rejected' ? ['earthquake_feed_unavailable: ' + String(earthquakesResult.reason && earthquakesResult.reason.message || earthquakesResult.reason)] : []),
    ...(volcanoes.warnings || []),
    ...(eonetResult.status === 'rejected' ? ['nasa_eonet_unavailable: ' + String(eonetResult.reason && eonetResult.reason.message || eonetResult.reason)] : []),
  ];

  return {
    data: entities,
    generatedAt,
    health: {
      status: overallStatus,
      weather: weather.health || { status: 'UNAVAILABLE' },
      earthquakes: {
        status: earthquakesResult.status === 'fulfilled' ? (earthquakesResult.value.stale ? 'STALE_FALLBACK' : 'LIVE') : 'UNAVAILABLE',
        recordCount: (earthquakes.entities || []).length,
        generatedAt: earthquakes.generatedAt || null,
        feedTitle: earthquakes.feedTitle || null,
        sourceUrl: earthquakes.sourceUrl || 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      },
      volcanoes: volcanoes.health || { status: 'UNAVAILABLE' },
      eonet: {
        status: eonetResult.status === 'fulfilled' ? (eonetResult.value.stale ? 'STALE_FALLBACK' : 'LIVE') : 'UNAVAILABLE',
        recordCount: (eonet.entities || []).length,
        returnedFeatures: eonet.returnedFeatures || 0,
        sourceUrl: eonet.sourceUrl || 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200',
      },
    },
    coverage: {
      weatherForecastPoints: (weather.entities || []).length,
      earthquakeEvents: (earthquakes.entities || []).length,
      volcanoActivityReports: (volcanoes.entities || []).length,
      earthquakesAreM25PlusPastDay: true,
      volcanoReportCadence: 'weekly',
      globalOpenNaturalEvents: (eonet.entities || []).length,
      naturalEventGeometrySemantics: 'source points plus centroid markers for source geometries; no unverified hazard boundary is drawn',
      forecastHours: weather.health && weather.health.horizonHours || 0,
      forecastSemantics: 'hourly_model_forecast_not_observed_weather_radar',
      earthquakePulseSemantics: 'symbolic_epicentre_pulse_not_ground_shaking_or_damage_footprint',
      volcanoSemantics: 'reported_activity_marker_not_live_eruption_video_or_measured_ash_plume',
    },
    sources: {
      weather: 'https://open-meteo.com/en/docs',
      earthquakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      volcanoes: 'https://volcano.si.edu/reports_weekly.cfm',
      volcanoCatalogue: 'https://volcano.si.edu/database/webservices.cfm',
      usgsVolcanoAlerts: 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes',
      eonet: 'https://eonet.gsfc.nasa.gov/docs/v3',
    },
    warnings,
  };
}

module.exports = {
  getLiveEventSimulation,
  __testables: {
    buildForecastGrid,
    normaliseName,
    weatherStepFromHourly,
    makeWeatherSimulationEntity,
    earthquakeEntity,
    parseVolcanoReportItems,
    nasaEonetEntity,
    eventGeometryCentre,
    matchVolcanoReport,
    volcanoEntity,
    usgsElevatedVolcanoEntity,
  },
};
