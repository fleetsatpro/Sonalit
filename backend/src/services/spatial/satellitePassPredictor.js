'use strict';

const satellite = require('satellite.js');

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_HORIZON_DEG = 10;
const DEFAULT_MAX_PASSES = 10;
const DEFAULT_STEP_SECONDS = 60;
const MAX_WINDOW_HOURS = 72;
const MAX_PASSES = 20;
const MAX_OBJECTS = 25;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validateObserver(latitude, longitude) {
  const lat = finite(latitude);
  const lng = finite(longitude);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const error = new Error('Invalid observer coordinates');
    error.statusCode = 400;
    throw error;
  }
  return {
    latitude: lat,
    longitude: lng,
    geodetic: {
      latitude: satellite.degreesToRadians(lat),
      longitude: satellite.degreesToRadians(lng),
      height: 0
    }
  };
}

function parseStart(value) {
  if (value == null || value === '') return new Date();
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    const error = new Error('Invalid from timestamp');
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeOptions(options = {}) {
  const windowHours = finite(options.windowHours) ?? DEFAULT_WINDOW_HOURS;
  const horizonDeg = finite(options.horizonDeg) ?? DEFAULT_HORIZON_DEG;
  const maxPasses = Math.trunc(finite(options.maxPasses) ?? DEFAULT_MAX_PASSES);

  if (windowHours <= 0 || windowHours > MAX_WINDOW_HOURS) {
    const error = new Error('windowHours must be > 0 and <= 72');
    error.statusCode = 400;
    throw error;
  }
  if (horizonDeg < -10 || horizonDeg >= 90) {
    const error = new Error('horizonDeg must be >= -10 and < 90');
    error.statusCode = 400;
    throw error;
  }
  if (maxPasses < 1 || maxPasses > MAX_PASSES) {
    const error = new Error('maxPasses must be between 1 and 20');
    error.statusCode = 400;
    throw error;
  }

  return {
    ...options,
    windowHours,
    horizonDeg,
    maxPasses,
    stepSeconds: clamp(Math.trunc(finite(options.stepSeconds) ?? DEFAULT_STEP_SECONDS), 15, 300),
    start: parseStart(options.from)
  };
}

function makeSatrec(record) {
  const line1 = record?.tle?.line1;
  const line2 = record?.tle?.line2;
  if (!line1 || !line2) return null;
  try {
    const satrec = satellite.twoline2satrec(line1, line2);
    return satrec?.error && satrec.error !== 0 ? null : satrec;
  } catch (_) {
    return null;
  }
}

function lookAngles(satrec, time, observer) {
  try {
    const state = satellite.propagate(satrec, time);
    if (!state?.position) return null;
    const gmst = satellite.gstime(time);
    const positionEcf = satellite.eciToEcf(state.position, gmst);
    const look = satellite.ecfToLookAngles(observer.geodetic, positionEcf);
    const elevationDeg = satellite.radiansToDegrees(look.elevation);
    const azimuthDeg = (satellite.radiansToDegrees(look.azimuth) + 360) % 360;
    const rangeKm = Number(look.rangeSat);
    if (![elevationDeg, azimuthDeg, rangeKm].every(Number.isFinite)) return null;
    return { elevationDeg, azimuthDeg, rangeKm };
  } catch (_) {
    return null;
  }
}

function refineCrossing(satrec, observer, horizonDeg, left, right, targetAbove) {
  let lo = left;
  let hi = right;
  for (let i = 0; i < 18; i += 1) {
    const midMs = lo.getTime() + (hi.getTime() - lo.getTime()) / 2;
    const mid = new Date(midMs);
    const sample = lookAngles(satrec, mid, observer);
    if (!sample) break;
    const above = sample.elevationDeg >= horizonDeg;
    if (above === targetAbove) hi = mid;
    else lo = mid;
  }
  return new Date((lo.getTime() + hi.getTime()) / 2);
}

function scanSatellite(record, observer, options) {
  const satrec = makeSatrec(record);
  if (!satrec) return [];

  const start = options.start;
  const end = new Date(start.getTime() + options.windowHours * 3600000);
  const stepMs = options.stepSeconds * 1000;

  let previousTime = new Date(start.getTime() - stepMs);
  let previous = lookAngles(satrec, previousTime, observer);
  let previousAbove = Boolean(previous && previous.elevationDeg >= options.horizonDeg);
  let active = previousAbove;
  let aos = active ? null : null;
  let max = previous || null;
  let maxAt = active ? previousTime : null;
  const passes = [];

  for (let timeMs = start.getTime(); timeMs <= end.getTime(); timeMs += stepMs) {
    const currentTime = new Date(Math.min(timeMs, end.getTime()));
    const current = lookAngles(satrec, currentTime, observer);

    if (!current) {
      previousTime = currentTime;
      previous = null;
      previousAbove = false;
      if (active) {
        active = false;
        aos = null;
        max = null;
        maxAt = null;
      }
      continue;
    }

    const currentAbove = current.elevationDeg >= options.horizonDeg;

    if (!previousAbove && currentAbove) {
      aos = refineCrossing(satrec, observer, options.horizonDeg, previousTime, currentTime, true);
      active = true;
      max = current;
      maxAt = currentTime;
    } else if (active && current.elevationDeg > (max?.elevationDeg ?? -Infinity)) {
      max = current;
      maxAt = currentTime;
    }

    if (previousAbove && !currentAbove) {
      const los = refineCrossing(satrec, observer, options.horizonDeg, previousTime, currentTime, false);
      if (active) {
        const visibleStart = aos || start;
        if (los.getTime() >= start.getTime() && visibleStart.getTime() <= end.getTime()) {
          passes.push({
            aosAt: aos ? aos.toISOString() : null,
            losAt: los.toISOString(),
            maxElevationDeg: Number((max?.elevationDeg ?? current.elevationDeg).toFixed(3)),
            maxElevationAt: maxAt ? maxAt.toISOString() : null,
            azimuthAtMaxDeg: max ? Number(max.azimuthDeg.toFixed(3)) : null,
            rangeAtMaxKm: max ? Number(max.rangeKm.toFixed(3)) : null,
            durationSec: Math.max(0, Math.round((los.getTime() - visibleStart.getTime()) / 1000)),
          });
        }
      }
      active = false;
      aos = null;
      max = null;
      maxAt = null;
    }

    previousTime = currentTime;
    previous = current;
    previousAbove = currentAbove;

    if (currentTime.getTime() >= end.getTime()) break;
  }

  if (active && max) {
    const visibleStart = aos || start;
    if (visibleStart.getTime() <= end.getTime()) {
      passes.push({
        aosAt: aos ? aos.toISOString() : null,
        losAt: null,
        maxElevationDeg: Number(max.elevationDeg.toFixed(3)),
        maxElevationAt: maxAt ? maxAt.toISOString() : null,
        azimuthAtMaxDeg: Number(max.azimuthDeg.toFixed(3)),
        rangeAtMaxKm: Number(max.rangeKm.toFixed(3)),
        durationSec: Math.max(0, Math.round((end.getTime() - visibleStart.getTime()) / 1000)),
      });
    }
  }

  return passes;
}

function annotatePass(record, pass, observer, options) {
  return {
    id: 'sat-pass:' + record.noradCatalogId + ':' + pass.aosAt + ':' + pass.losAt,
    satelliteId: record.id,
    name: record.name,
    noradId: record.noradCatalogId,
    group: record.group,
    observer: {
      latitude: observer.latitude,
      longitude: observer.longitude,
      horizonDeg: options.horizonDeg
    },
    aosAt: pass.aosAt,
    losAt: pass.losAt,
    maxElevationDeg: pass.maxElevationDeg,
    maxElevationAt: pass.maxElevationAt,
    azimuthAtMaxDeg: pass.azimuthAtMaxDeg,
    rangeAtMaxKm: pass.rangeAtMaxKm,
    durationSec: pass.durationSec,
    positionSource: 'sgp4_modelled',
    telemetryLive: false,
    imagingClaim: false,
    taskingClaim: false,
    uncertainty: [
      'AOS/LOS and look angles are geometric results from SGP4/TLE propagation and an Earth-fixed observer position.',
      'This prediction does not establish live satellite telemetry, imaging capability, sensor modality, collection activity, operator control, or tasking rights.'
    ]
  };
}

function predictPassesForRecords(records, options = {}) {
  const normalized = normalizeOptions(options);
  const observer = validateObserver(options.lat, options.lng);
  const selected = (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .slice(0, MAX_OBJECTS);

  const passes = [];
  for (const record of selected) {
    const satPasses = scanSatellite(record, observer, normalized);
    for (const pass of satPasses) {
      passes.push(annotatePass(record, pass, observer, normalized));
    }
  }

  passes.sort((a, b) => {
    const at = Date.parse(a.aosAt || a.maxElevationAt || normalized.start.toISOString());
    const bt = Date.parse(b.aosAt || b.maxElevationAt || normalized.start.toISOString());
    return at - bt;
  });

  return {
    passes: passes.slice(0, normalized.maxPasses),
    observer: {
      latitude: observer.latitude,
      longitude: observer.longitude,
      horizonDeg: normalized.horizonDeg
    },
    window: {
      from: normalized.start.toISOString(),
      to: new Date(normalized.start.getTime() + normalized.windowHours * 3600000).toISOString(),
      hours: normalized.windowHours
    },
    scannedObjects: selected.length,
    maxObjects: MAX_OBJECTS,
    bounds: {
      maxWindowHours: MAX_WINDOW_HOURS,
      maxPasses: MAX_PASSES,
      maxObjects: MAX_OBJECTS
    },
    semantics: {
      positionSource: 'sgp4_modelled',
      telemetryLive: false,
      imagingClaim: false,
      taskingClaim: false,
      uncertainty: 'Geometric AOS/LOS only — not tasking or imaging.'
    }
  };
}

async function predictPasses({ providerManager, options = {} } = {}) {
  if (!providerManager || typeof providerManager.query !== 'function') {
    throw new TypeError('Spatial provider manager is required');
  }
  const normalized = normalizeOptions(options);
  const catalogResult = await providerManager.query('celestrak', {
    orgId: options.orgId,
    requestId: options.requestId,
    signal: options.signal,
    group: options.group,
    mode: 'catalog'
  });
  const catalog = Array.isArray(catalogResult?.catalog) ? catalogResult.catalog : [];
  const filtered = options.noradId == null
    ? catalog
    : catalog.filter(item => Number(item.noradCatalogId) === Number(options.noradId));
  return {
    ...predictPassesForRecords(filtered, normalized),
    catalogCount: catalog.length,
    selectedCatalogCount: filtered.length,
    providerHealth: catalogResult?.health || null,
    warnings: catalogResult?.warnings || []
  };
}

module.exports = {
  DEFAULT_WINDOW_HOURS,
  DEFAULT_HORIZON_DEG,
  DEFAULT_MAX_PASSES,
  MAX_WINDOW_HOURS,
  MAX_PASSES,
  MAX_OBJECTS,
  predictPasses,
  predictPassesForRecords
};
