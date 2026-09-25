'use strict';

const { BoundedTtlCache, CircuitBreaker, clampInt, fetchJsonWithTimeout, isValidBbox, bboxKey, runBudgeted } = require('./externalProviderUtils');

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
  clampInt(process.env.SPATIAL_CELESTRAK_FAILURE_THRESHOLD, 6, 1, 100, 6),
  clampInt(process.env.SPATIAL_CELESTRAK_COOLDOWN_MS, 30_000, 1_000, 600_000, 30_000)
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
    typeof satelliteJs.eciToGeodetic === 'function'
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

function tleFromRecord(record) {
  const line1 = String(record?.TLE_LINE1 || record?.tle_line1 || record?.LINE1 || record?.line1 || '').trim();
  const line2 = String(record?.TLE_LINE2 || record?.tle_line2 || record?.LINE2 || record?.line2 || '').trim();
  return line1 && line2 ? { line1, line2 } : null;
}

function normaliseRecord(record, group) {
  if (!record || typeof record !== 'object') return null;
  const noradCatalogId = validNoradId(record.NORAD_CAT_ID ?? record.noradCatId ?? record.norad_id);
  const name = String(record.OBJECT_NAME ?? record.object_name ?? record.name ?? '').trim();
  const epoch = iso(record.EPOCH ?? record.epoch);
  if (!noradCatalogId || !name || !epoch) return null;

  const tle = tleFromRecord(record);
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
    propagatorAvailable: false,
    imagingClaim: false,
    taskingClaim: false,
    nonImagingSemantics: true,
    uncertainty: [
      'CelesTrak GP/TLE catalog presence does not establish imaging capability, tasking rights, sensor modality or live collection.',
      'A propagated position is a modelled orbital position, not an independently observed ground fix.'
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
    { canRequest: t => circuit.canRequest(t) && true, begin: () => {}, end: () => {} },
    circuit,
    async () => {
      const url = BASE_URL + '?GROUP=' + encodeURIComponent(group) + '&FORMAT=json';
      const { data } = await fetchJsonWithTimeout(url, {
        headers: { accept: 'application/json' },
        signal: options.signal
      }, clampInt(process.env.SPATIAL_CELESTRAK_TIMEOUT_MS, 10_000, 1_000, 30_000, 10_000));
      if (!Array.isArray(data)) {
        const error = new Error('CelesTrak returned a non-array catalog');
        error.failureClass = 'malformed';
        throw error;
      }
      cache.set(key, data, now);
      return { records: data, cacheHit: false, cacheAgeMs: 0 };
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
    const positionAndVelocity = lib.propagate(satrec, new Date(at));
    if (!positionAndVelocity || !positionAndVelocity.position || !Number.isFinite(positionAndVelocity.position.x)) return null;
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
    const future = lib.propagate(satrec, new Date(new Date(at).getTime() + 30_000));
    if (future?.position && Number.isFinite(future.position.x)) {
      const futureGeo = lib.eciToGeodetic(future.position, lib.gstime(new Date(new Date(at).getTime() + 30_000)));
      const lat2 = lib.degreesLat(futureGeo.latitude);
      const lon2 = lib.degreesLong(futureGeo.longitude);
      if ([lat2, lon2].every(Number.isFinite)) {
        const phi1 = latitude * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dl = (lon2 - longitude) * Math.PI / 180;
        const y = Math.sin(dl) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
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
    observedAt: generatedAt,
    receivedAt: generatedAt,
    observationConfidence: 0.98,
    interpretationConfidence: 0.9,
    operationalConfidence: 0.35,
    confidence: 0.9,
    headingDeg: position.headingDeg,
    speedMps: position.speedMps,
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
      propagatorAvailable: true,
      imagingClaim: false,
      taskingClaim: false,
      nonImagingSemantics: true
    },
    provenance: record.provenance,
    coverage: {
      complete: true,
      bounded: true,
      queryScope: 'CelesTrak GP group ' + record.group + ' propagated to requested time'
    },
    quality: {
      state: 'degraded',
      freshnessClass: 'MODELLED',
      reason: 'Position is propagated from GP/TLE orbital elements; it is not a live positional fix or imaging observation.'
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

    if (result.error && records.length) {
      health = {
        ...health,
        status: propagatorAvailable ? 'PARTIAL' : 'PARTIAL',
        lastSuccessAt: health.lastSuccessAt || null,
        lastAttemptAt: now,
        lastErrorClass: String(result.error.failureClass || 'unknown'),
        lastErrorMessage: String(result.error.message || result.error),
        recordCount: records.length,
        acceptedCount: 0,
        rejectedCount: 0,
        propagatorAvailable
      };
    } else {
      health = {
        ...health,
        status: records.length ? 'PARTIAL' : 'UNAVAILABLE',
        lastSuccessAt: now,
        lastAttemptAt: now,
        lastErrorClass: null,
        lastErrorMessage: null,
        recordCount: records.length,
        acceptedCount: 0,
        rejectedCount: 0,
        propagatorAvailable
      };
    }

    if (!propagatorAvailable) {
      return {
        observations: [],
        health: { ...health },
        coverage: {
          complete: false,
          bounded: Boolean(bbox || options.center),
          queryScope: 'CelesTrak GP catalog; positions withheld because SGP4 propagator is unavailable',
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

    const boundedComplete = rejected === 0 && observations.length < maxRecords
      ? true
      : rejected === 0 && records.length <= maxRecords;
    health = {
      ...health,
      status: observations.length ? 'PARTIAL' : 'UNAVAILABLE',
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
        queryScope: 'CelesTrak GP group ' + group + ' propagated to requested time',
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
  normaliseRecord,
  propagateSatellite,
  getSatellites,
  getProviderHealth
};
