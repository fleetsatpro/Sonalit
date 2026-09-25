'use strict';

const { BoundedTtlCache, CircuitBreaker, clampInt, isValidBbox, runBudgeted } = require('./externalProviderUtils');

const BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const DEFAULT_GROUP = 'stations';
const ALLOWED_GROUPS = new Set([
  'stations',
  'weather',
  'starlink',
  'gps-ops',
  'galileo',
  'beidou',
  'glonass'
]);
const DEFAULT_MAX_RECORDS = 40;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new BoundedTtlCache(CATALOG_CACHE_TTL_MS, 32);
const circuit = new CircuitBreaker(
  clampInt(process.env.SPATIAL_CELESTRAK_FAILURE_THRESHOLD, 1, 100, 6),
  clampInt(process.env.SPATIAL_CELESTRAK_COOLDOWN_MS, 1_000, 600_000, 30_000)
);

let satelliteJs;
let attemptedSatelliteJs = false;

let health = {
  providerId: 'celestrak',
  status: 'UNKNOWN',
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastErrorClass: null,
  lastErrorMessage: null,
  recordCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  propagatorAvailable: false,
  group: DEFAULT_GROUP
};

function getSatelliteJs() {
  if (attemptedSatelliteJs) return satelliteJs;
  attemptedSatelliteJs = true;
  try {
    satelliteJs = require('satellite.js');
  } catch (_) {
    satelliteJs = null;
  }
  health.propagatorAvailable = Boolean(
    satelliteJs &&
    typeof satelliteJs.twoline2satrec === 'function' &&
    typeof satelliteJs.propagate === 'function' &&
    typeof satelliteJs.gstime === 'function' &&
    typeof satelliteJs.eciToGeodetic === 'function' &&
    typeof satelliteJs.degreesLat === 'function' &&
    typeof satelliteJs.degreesLong === 'function'
  );
  return satelliteJs;
}

function selectedGroup(value) {
  const group = String(value || process.env.SPATIAL_SATELLITE_GROUP || DEFAULT_GROUP).trim().toLowerCase();
  return ALLOWED_GROUPS.has(group) ? group : DEFAULT_GROUP;
}

function validNoradId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1000000 ? n : null;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function parseTleEpoch(line1) {
  const value = String(line1 || '');
  if (value.length < 32 || !value.startsWith('1 ')) return null;
  const year2 = Number(value.slice(18, 20));
  const dayOfYear = Number(value.slice(20, 32));
  if (!Number.isInteger(year2) || !Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear >= 367) return null;
  const year = year2 < 57 ? 2000 + year2 : 1900 + year2;
  const start = Date.UTC(year, 0, 1);
  const timestamp = start + (dayOfYear - 1) * 86400000;
  const result = new Date(timestamp);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}

function decimalEccentricity(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^\d{7}$/.test(raw)) return null;
  return finiteOrNull('0.' + raw);
}

function parseTleRecord(name, line1, line2) {
  const first = String(line1 || '').trimEnd();
  const second = String(line2 || '').trimEnd();
  if (!/^1 /.test(first) || !/^2 /.test(second)) return null;

  const noradCatalogId = validNoradId(first.slice(2, 7));
  if (!noradCatalogId) return null;

  const objectName = String(name || ('NORAD ' + noradCatalogId)).replace(/^0 /, '').trim();
  const epoch = parseTleEpoch(first);
  if (!objectName || !epoch) return null;

  return {
    OBJECT_NAME: objectName,
    NORAD_CAT_ID: noradCatalogId,
    EPOCH: epoch,
    TLE_LINE1: first,
    TLE_LINE2: second,
    INCLINATION: finiteOrNull(second.slice(8, 16)),
    RA_OF_ASC_NODE: finiteOrNull(second.slice(17, 25)),
    ECCENTRICITY: decimalEccentricity(second.slice(26, 33)),
    ARG_OF_PERICENTER: finiteOrNull(second.slice(34, 42)),
    MEAN_ANOMALY: finiteOrNull(second.slice(43, 51)),
    MEAN_MOTION: finiteOrNull(second.slice(52, 63))
  };
}

function parseTleCatalog(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);

  const records = [];
  let pendingName = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^1 /.test(line) && /^2 /.test(lines[i + 1] || '')) {
      const record = parseTleRecord(pendingName, line, lines[i + 1]);
      pendingName = null;
      i += 1;
      if (record) records.push(record);
      continue;
    }

    if (!/^2 /.test(line)) {
      pendingName = line.replace(/^0 /, '').trim() || pendingName;
    }
  }

  return records;
}

function tleFromRecord(record) {
  const line1 = String(record?.TLE_LINE1 || record?.tle_line1 || record?.LINE1 || record?.line1 || '').trim();
  const line2 = String(record?.TLE_LINE2 || record?.tle_line2 || record?.LINE2 || record?.line2 || '').trim();
  return line1 && line2 ? { line1, line2 } : null;
}

function normaliseRecord(record, group) {
  if (!record || typeof record !== 'object') return null;
  const tle = tleFromRecord(record);
  const noradCatalogId = validNoradId(
    record.NORAD_CAT_ID ??
    record.noradCatId ??
    record.norad_id ??
    (tle ? tle.line1.slice(2, 7) : null)
  );
  const name = String(record.OBJECT_NAME ?? record.object_name ?? record.name ?? '').trim();
  const epoch = iso(record.EPOCH ?? record.epoch) || parseTleEpoch(tle?.line1);
  if (!noradCatalogId || !name || !epoch || !tle) return null;

  return {
    id: 'celestrak:' + noradCatalogId,
    entityType: 'satellite',
    source: 'celestrak',
    sourceReference: String(noradCatalogId),
    name,
    noradCatalogId,
    objectId: record.OBJECT_ID == null ? null : String(record.OBJECT_ID),
    group,
    tle,
    orbit: {
      epoch,
      meanMotionRevPerDay: finiteOrNull(record.MEAN_MOTION ?? record.meanMotion),
      eccentricity: finiteOrNull(record.ECCENTRICITY ?? record.eccentricity),
      inclinationDeg: finiteOrNull(record.INCLINATION ?? record.inclination),
      raanDeg: finiteOrNull(record.RA_OF_ASC_NODE ?? record.raan),
      argumentOfPerigeeDeg: finiteOrNull(record.ARG_OF_PERICENTER ?? record.argumentOfPerigee),
      meanAnomalyDeg: finiteOrNull(record.MEAN_ANOMALY ?? record.meanAnomaly),
      bstar: finiteOrNull(record.BSTAR ?? record.bstar)
    },
    propagatorAvailable: true,
    imagingClaim: false,
    taskingClaim: false,
    nonImagingSemantics: true,
    uncertainty: [
      'CelesTrak GP/TLE catalog presence does not establish imaging capability, tasking rights, sensor modality or live collection.',
      'The orbital position is modelled from GP/TLE elements and is not independently observed satellite telemetry.'
    ],
    provenance: {
      sourceName: 'CelesTrak',
      sourceUrl: BASE_URL,
      attribution: 'CelesTrak GP/NORAD catalog',
      observationType: 'satellite_orbital_catalog',
      sourceReference: String(noradCatalogId)
    }
  };
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const upstream = init.signal;
  let timedOut = false;

  const onAbort = () => controller.abort(upstream?.reason || new Error('cancelled'));
  if (upstream) {
    if (upstream.aborted) onAbort();
    else upstream.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('provider timeout'));
  }, timeoutMs);

  try {
    const response = await fetch(url, Object.assign({}, init, { signal: controller.signal }));
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('CelesTrak HTTP ' + response.status);
      error.failureClass = response.status === 429
        ? 'rate_limited'
        : (response.status === 401 || response.status === 403 ? 'auth_required' : 'http_error');
      error.httpStatus = response.status;
      throw error;
    }
    return text;
  } catch (error) {
    if (timedOut) {
      error = Object.assign(error || new Error('Provider timeout'), { failureClass: 'timeout' });
    } else if (error?.name === 'AbortError') {
      error = Object.assign(error, { failureClass: 'cancelled' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (upstream) upstream.removeEventListener('abort', onAbort);
  }
}

async function fetchCatalog(group, options = {}) {
  const key = 'group=' + group;
  const now = Date.now();
  const cached = cache.get(key, now);
  if (cached) {
    return {
      records: cached.value,
      cacheHit: true,
      cacheAgeMs: Math.max(0, now - cached.createdAt)
    };
  }

  return runBudgeted(
    { canRequest: t => circuit.canRequest(t), begin: () => {}, end: () => {} },
    circuit,
    async () => {
      const url = BASE_URL + '?GROUP=' + encodeURIComponent(group) + '&FORMAT=tle';
      const text = await fetchTextWithTimeout(url, {
        headers: { accept: 'text/plain' },
        signal: options.signal
      }, clampInt(process.env.SPATIAL_CELESTRAK_TIMEOUT_MS, 10_000, 1_000, 30_000, 10_000));

      const records = parseTleCatalog(text);
      if (!records.length) {
        const error = new Error('CelesTrak returned no parseable TLE records');
        error.failureClass = 'malformed';
        throw error;
      }

      cache.set(key, records, now);
      return { records, cacheHit: false, cacheAgeMs: 0 };
    }
  ).catch(error => {
    const stale = cache.getStale(key);
    if (stale) {
      return {
        records: stale.value,
        cacheHit: true,
        staleFallback: true,
        cacheAgeMs: Math.max(0, Date.now() - stale.createdAt),
        error
      };
    }
    throw error;
  });
}

function inBbox(lat, lng, bbox) {
  if (!isValidBbox(bbox)) return true;
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function inRadius(lat, lng, center, radiusM) {
  if (!center) return true;
  const a = Number(lat) * Math.PI / 180;
  const b = Number(center.latitude) * Math.PI / 180;
  const dLat = a - b;
  const dLng = (Number(lng) - Number(center.longitude)) * Math.PI / 180;
  const hav = Math.sin(dLat / 2) ** 2 +
    Math.cos(a) * Math.cos(b) * Math.sin(dLng / 2) ** 2;
  const distanceM = 6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(Math.max(0, 1 - hav)));
  return distanceM <= Number(radiusM || 100000);
}

function propagateSatellite(record, at = new Date()) {
  const lib = getSatelliteJs();
  if (!lib || !record?.tle?.line1 || !record?.tle?.line2) return null;
  try {
    const satrec = lib.twoline2satrec(record.tle.line1, record.tle.line2);
    if (satrec?.error && satrec.error !== 0) return null;

    const positionAndVelocity = lib.propagate(satrec, new Date(at));
    if (!positionAndVelocity?.position || !Number.isFinite(positionAndVelocity.position.x)) return null;

    const gmst = lib.gstime(new Date(at));
    const geodetic = lib.eciToGeodetic(positionAndVelocity.position, gmst);
    const latitude = lib.degreesLat(geodetic.latitude);
    const longitude = lib.degreesLong(geodetic.longitude);
    const altitudeM = Number(geodetic.height) * 1000;
    if (![latitude, longitude, altitudeM].every(Number.isFinite)) return null;

    const velocity = positionAndVelocity.velocity;
    const speedMps = velocity &&
      [velocity.x, velocity.y, velocity.z].every(Number.isFinite)
      ? Math.hypot(velocity.x, velocity.y, velocity.z) * 1000
      : null;

    let headingDeg = null;
    const futureAt = new Date(new Date(at).getTime() + 30_000);
    const future = lib.propagate(satrec, futureAt);
    if (future?.position && Number.isFinite(future.position.x)) {
      const futureGeo = lib.eciToGeodetic(future.position, lib.gstime(futureAt));
      const lat2 = lib.degreesLat(futureGeo.latitude);
      const lon2 = lib.degreesLong(futureGeo.longitude);
      if ([lat2, lon2].every(Number.isFinite)) {
        const phi1 = latitude * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dl = (lon2 - longitude) * Math.PI / 180;
        const y = Math.sin(dl) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) -
          Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
        headingDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      }
    }

    return { latitude, longitude, altitudeM, speedMps, headingDeg };
  } catch (_) {
    return null;
  }
}

function toObservation(record, position, generatedAt) {
  return {
    id: record.id,
    entityType: 'satellite',
    source: 'celestrak',
    sourceReference: record.sourceReference,
    latitude: position.latitude,
    longitude: position.longitude,
    altitudeM: position.altitudeM,
    observedAt: null,
    receivedAt: generatedAt,
    freshnessMs: undefined,
    observationConfidence: 0.98,
    interpretationConfidence: 0.9,
    operationalConfidence: 0.35,
    confidence: 0.9,
    headingDeg: position.headingDeg,
    speedMps: position.speedMps,
    positionSource: 'modelled',
    telemetryLive: false,
    status: 'propagated',
    attributes: {
      id: record.id,
      name: record.name,
      noradCatalogId: record.noradCatalogId,
      objectId: record.objectId,
      group: record.group,
      tle: record.tle,
      orbit: record.orbit,
      positionMode: 'SGP4_PROPAGATED',
      positionSource: 'modelled',
      telemetryLive: false,
      propagatorAvailable: true,
      imagingClaim: false,
      taskingClaim: false,
      nonImagingSemantics: true
    },
    provenance: record.provenance,
    coverage: {
      complete: true,
      bounded: true,
      queryScope: 'CelesTrak TLE group ' + record.group + ' propagated to requested time'
    },
    quality: {
      state: 'degraded',
      freshnessClass: 'MODELLED',
      reason: 'Position is SGP4-propagated from CelesTrak GP/TLE orbital elements; it is not a live positional fix or imaging observation.'
    },
    uncertainty: record.uncertainty
  };
}

async function getSatellites(options = {}) {
  const now = new Date().toISOString();
  const group = selectedGroup(options.group);
  const maxRecords = clampInt(options.maxRecords ?? DEFAULT_MAX_RECORDS, 1, 200, DEFAULT_MAX_RECORDS);
  const bbox = options.bbox;

  if (bbox != null && !isValidBbox(bbox)) {
    const error = new Error('Invalid satellite bbox');
    error.failureClass = 'invalid_data';
    health = { ...health, status: 'UNAVAILABLE', lastAttemptAt: now, lastErrorClass: error.failureClass, lastErrorMessage: error.message, group };
    throw error;
  }

  health = { ...health, lastAttemptAt: now, group, propagatorAvailable: Boolean(getSatelliteJs()) };

  try {
    const result = await fetchCatalog(group, options);
    const records = result.records.map(row => normaliseRecord(row, group)).filter(Boolean);
    const propagatorAvailable = Boolean(getSatelliteJs());

    health = {
      ...health,
      status: records.length && propagatorAvailable ? 'LIVE' : (records.length ? 'PARTIAL' : 'UNAVAILABLE'),
      lastSuccessAt: result.error ? health.lastSuccessAt : now,
      lastAttemptAt: now,
      lastErrorClass: result.error ? String(result.error.failureClass || 'unknown') : null,
      lastErrorMessage: result.error ? String(result.error.message || result.error) : null,
      recordCount: records.length,
      acceptedCount: 0,
      rejectedCount: 0,
      propagatorAvailable
    };

    if (!propagatorAvailable) {
      return {
        observations: [],
        health: { ...health },
        coverage: {
          complete: false,
          bounded: Boolean(bbox || options.center),
          queryScope: 'CelesTrak TLE catalog; positions withheld because SGP4 propagator is unavailable',
          catalogCount: records.length,
          propagatedCount: 0,
          omittedCount: records.length
        },
        warnings: ['satellite_propagator_unavailable'],
        catalog: records.slice(0, maxRecords)
      };
    }

    const generatedAt = new Date(options.at || now).toISOString();
    const observations = [];
    let rejected = 0;

    for (const record of records) {
      const position = propagateSatellite(record, generatedAt);
      if (!position) {
        rejected += 1;
        continue;
      }
      if (!inBbox(position.latitude, position.longitude, bbox)) continue;
      if (!inRadius(position.latitude, position.longitude, options.center, options.radiusM)) continue;

      observations.push(toObservation(record, position, generatedAt));
      if (observations.length >= maxRecords) break;
    }

    const boundedComplete = rejected === 0 && records.length <= maxRecords;
    health = {
      ...health,
      status: observations.length && rejected === 0 ? 'LIVE' : (records.length ? 'PARTIAL' : 'UNAVAILABLE'),
      lastSuccessAt: result.error ? health.lastSuccessAt : now,
      acceptedCount: observations.length,
      rejectedCount: rejected,
      propagatorAvailable
    };

    return {
      observations,
      health: { ...health },
      coverage: {
        complete: boundedComplete,
        bounded: Boolean(bbox || options.center),
        queryScope: 'CelesTrak TLE group ' + group + ' propagated to requested time',
        catalogCount: records.length,
        propagatedCount: observations.length,
        omittedCount: Math.max(0, records.length - observations.length - rejected)
      },
      warnings: [
        ...(result.error ? ['satellite_catalog_stale_fallback'] : []),
        ...(boundedComplete ? [] : ['satellite_partial_propagation'])
      ]
    };
  } catch (error) {
    health = {
      ...health,
      status: 'UNAVAILABLE',
      lastAttemptAt: now,
      lastErrorClass: String(error?.failureClass || 'unknown'),
      lastErrorMessage: String(error?.message || error),
      propagatorAvailable: Boolean(getSatelliteJs())
    };
    throw error;
  }
}

function getProviderHealth() {
  return { ...health };
}

module.exports = {
  ALLOWED_GROUPS,
  selectedGroup,
  parseTleEpoch,
  parseTleRecord,
  parseTleCatalog,
  normaliseRecord,
  propagateSatellite,
  getSatellites,
  getProviderHealth
};
