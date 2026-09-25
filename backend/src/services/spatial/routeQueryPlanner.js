
'use strict';

/**
 * Bounded route-aware spatial query planner.
 *
 * Route geometry is densified before partitioning so a single very long source
 * segment can never force an oversized AOI. Long routes are represented by
 * multiple bounded AOIs; if the configured AOI budget cannot cover the entire
 * route, planned coverage is explicitly reduced instead of silently reverting
 * to a centre-only query.
 */

const EARTH_R_M = 6371000;

const DEFAULTS = Object.freeze({
  maxAoiAreaDeg2: 20,
  maxAois: 8,
  maxSamples: 16,
  maxSegmentKm: 25,
  maxAoiRouteKm: 300,
  mergeOverlapRatio: 0.55,
  paddingM: 10000,
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function wrapLongitude(value) {
  let lng = Number(value);
  while (lng < -180) lng += 360;
  while (lng > 180) lng -= 360;
  return lng;
}

function point(v) {
  if (Array.isArray(v) && v.length >= 2) {
    return { lat: Number(v[1]), lng: wrapLongitude(v[0]) };
  }
  return {
    lat: Number(v?.lat ?? v?.latitude),
    lng: wrapLongitude(v?.lng ?? v?.longitude ?? v?.lon),
  };
}

function normalizeRoute(route) {
  return (Array.isArray(route) ? route : [])
    .map(point)
    .filter(p =>
      Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
      p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180
    );
}

function unwrapLongitudes(route) {
  if (!route.length) return [];
  const out = [{ ...route[0], unwrappedLng: route[0].lng }];
  for (let i = 1; i < route.length; i++) {
    let lng = route[i].lng;
    const previous = out[i - 1].unwrappedLng;
    while (lng - previous > 180) lng -= 360;
    while (lng - previous < -180) lng += 360;
    out.push({ ...route[i], unwrappedLng: lng });
  }
  return out;
}

function haversineKm(a, b) {
  const lat1 = Number(a.lat) * Math.PI / 180;
  const lat2 = Number(b.lat) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (Number(b.lng) - Number(a.lng)) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

function routeLengthKm(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += haversineKm(route[i - 1], route[i]);
  }
  return total;
}

function densifyRoute(routeInput, maxSegmentKm = DEFAULTS.maxSegmentKm) {
  const route = normalizeRoute(routeInput);
  if (route.length < 2) return route.map(p => ({ ...p }));

  const unwrapped = unwrapLongitudes(route);
  const out = [{ lat: unwrapped[0].lat, lng: wrapLongitude(unwrapped[0].lng), unwrappedLng: unwrapped[0].unwrappedLng }];
  const maxKm = Math.max(1, Number(maxSegmentKm) || DEFAULTS.maxSegmentKm);

  for (let i = 1; i < unwrapped.length; i++) {
    const a = unwrapped[i - 1];
    const b = unwrapped[i];
    const distance = haversineKm(
      { lat: a.lat, lng: a.unwrappedLng },
      { lat: b.lat, lng: b.unwrappedLng }
    );
    const steps = Math.max(1, Math.ceil(distance / maxKm));

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const unwrappedLng = a.unwrappedLng + (b.unwrappedLng - a.unwrappedLng) * t;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: wrapLongitude(unwrappedLng),
        unwrappedLng,
      });
    }
  }

  return out;
}

function cumulativeKm(route) {
  const out = [0];
  for (let i = 1; i < route.length; i++) out.push(out[i - 1] + haversineKm(route[i - 1], route[i]));
  return out;
}

function curvatureScore(route) {
  if (route.length < 3) return 0;
  let turns = 0;
  for (let i = 1; i < route.length - 1; i++) {
    const a = route[i - 1], b = route[i], c = route[i + 1];
    const ab = Math.atan2(b.lng - a.lng, b.lat - a.lat);
    const bc = Math.atan2(c.lng - b.lng, c.lat - b.lat);
    let delta = Math.abs((bc - ab) * 180 / Math.PI);
    while (delta > 180) delta -= 360;
    if (Math.abs(delta) >= 30) turns++;
  }
  return turns / Math.max(1, route.length - 2);
}

function adaptiveSamplePoints(routeInput, maxSamples = DEFAULTS.maxSamples) {
  const route = densifyRoute(routeInput);
  if (route.length < 2) {
    return route.slice(0, 1).map(p => ({ latitude: p.lat, longitude: p.lng }));
  }

  const lengthKm = routeLengthKm(route);
  const curvature = curvatureScore(route);
  const cap = clampInt(maxSamples, 3, 32, DEFAULTS.maxSamples);
  const target = Math.max(3, Math.min(
    cap,
    Math.ceil(lengthKm / 60) + Math.ceil(curvature * 4)
  ));

  const seen = new Set();
  const points = [];
  for (let i = 0; i < target; i++) {
    const index = Math.round((route.length - 1) * i / Math.max(1, target - 1));
    const p = route[index];
    const key = String(p.lat.toFixed(5)) + ',' + String(p.lng.toFixed(5));
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ latitude: p.lat, longitude: p.lng });
  }
  return points;
}

function bboxAreaDeg2(bbox) {
  if (!bbox) return Infinity;
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function bboxForPoints(points, paddingM) {
  if (!points.length) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, Number(p.lat));
    maxLat = Math.max(maxLat, Number(p.lat));
    minLng = Math.min(minLng, Number(p.unwrappedLng ?? p.lng));
    maxLng = Math.max(maxLng, Number(p.unwrappedLng ?? p.lng));
  }

  const centerLat = (minLat + maxLat) / 2;
  const dLat = paddingM / EARTH_R_M * 180 / Math.PI;
  const cos = Math.max(0.05, Math.abs(Math.cos(centerLat * Math.PI / 180)));
  const dLng = paddingM / (EARTH_R_M * cos) * 180 / Math.PI;

  return [
    minLng - dLng,
    Math.max(-90, minLat - dLat),
    maxLng + dLng,
    Math.min(90, maxLat + dLat),
  ];
}

function splitWrappedBbox(bbox) {
  if (!bbox) return [];

  let west = Number(bbox[0]);
  const east = Number(bbox[2]);
  const south = Number(bbox[1]);
  const north = Number(bbox[3]);
  const width = east - west;

  if (!Number.isFinite(width) || width <= 0) return [];
  if (width >= 360) return [];

  while (west < -180) west += 360;
  while (west > 180) west -= 360;

  const wrappedEast = west + width;
  if (wrappedEast <= 180) {
    return [[west, south, wrappedEast, north]];
  }

  return [
    [west, south, 180, north],
    [-180, south, wrappedEast - 360, north],
  ].filter(x => x[0] < x[2]);
}

function overlapRatio(a, b) {
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);
  if (east <= west || north <= south) return 0;
  const intersection = (east - west) * (north - south);
  return intersection / Math.max(1e-9, Math.min(bboxAreaDeg2(a), bboxAreaDeg2(b)));
}

function mergeBbox(a, b) {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function buildAoiCandidates(route, options) {
  const dense = densifyRoute(route, options.maxSegmentKm);
  if (dense.length < 2) return [];

  const candidates = [];
  let chunk = [dense[0]];

  function emit(points) {
    if (points.length < 2) return;
    const chunkLengthKm = routeLengthKm(points);
    const boxes = splitWrappedBbox(bboxForPoints(points, options.paddingM));
    if (!boxes.length) return;

    const weightPerBox = chunkLengthKm / boxes.length;
    for (let i = 0; i < boxes.length; i++) {
      const bbox = boxes[i];
      if (bboxAreaDeg2(bbox) > options.maxAoiAreaDeg2) {
        return false;
      }
      candidates.push({
        fromIndex: points[0]._denseIndex,
        toIndex: points[points.length - 1]._denseIndex,
        routeLengthKm: chunkLengthKm,
        coverageWeightKm: weightPerBox,
        bbox,
      });
    }
    return true;
  }

  for (let i = 1; i < dense.length; i++) {
    dense[i]._denseIndex = i;
    const candidate = chunk.concat(dense[i]);
    const candidateLengthKm = routeLengthKm(candidate);
    const boxes = splitWrappedBbox(bboxForPoints(candidate, options.paddingM));
    const safe = boxes.length > 0 &&
      candidateLengthKm <= options.maxAoiRouteKm &&
      boxes.every(b => bboxAreaDeg2(b) <= options.maxAoiAreaDeg2);

    if (safe) {
      chunk = candidate;
      continue;
    }

    const emitted = emit(chunk);
    if (chunk.length < 2 || emitted === false) {
      // Densification should normally make this impossible. Keep a single
      // segment only if it is provider-safe; otherwise mark it uncovered.
    }

    chunk = [chunk[chunk.length - 1], dense[i]];
    chunk[0]._denseIndex = Math.max(0, i - 1);
  }

  emit(chunk);

  // Remove accidental duplicate AOIs from overlapping boundaries while
  // preserving coverage weights.
  const dedup = new Map();
  for (const candidate of candidates) {
    const key = candidate.bbox.map(v => Number(v).toFixed(6)).join(',');
    const existing = dedup.get(key);
    if (existing) {
      existing.coverageWeightKm += candidate.coverageWeightKm;
      existing.routeLengthKm = Math.max(existing.routeLengthKm, candidate.routeLengthKm);
    } else {
      dedup.set(key, { ...candidate });
    }
  }

  return Array.from(dedup.values());
}

function mergeSafe(candidates, options) {
  const out = [];

  for (const candidate of candidates) {
    let merged = false;
    for (let i = 0; i < out.length; i++) {
      if (overlapRatio(out[i].bbox, candidate.bbox) < options.mergeOverlapRatio) continue;

      const union = mergeBbox(out[i].bbox, candidate.bbox);
      if (bboxAreaDeg2(union) > options.maxAoiAreaDeg2) continue;

      out[i] = {
        ...out[i],
        bbox: union,
        fromIndex: Math.min(out[i].fromIndex, candidate.fromIndex),
        toIndex: Math.max(out[i].toIndex, candidate.toIndex),
        routeLengthKm: Math.max(out[i].routeLengthKm, candidate.routeLengthKm),
        coverageWeightKm: out[i].coverageWeightKm + candidate.coverageWeightKm,
      };
      merged = true;
      break;
    }
    if (!merged) out.push({ ...candidate });
  }

  return out;
}

function selectBoundedCoverage(candidates, maxAois) {
  if (candidates.length <= maxAois) return candidates;

  // Evenly distribute retained AOIs along the route so the cap does not
  // permanently bias intelligence toward the route origin or destination.
  const selected = [];
  const seen = new Set();
  for (let i = 0; i < maxAois; i++) {
    const index = Math.round((candidates.length - 1) * i / Math.max(1, maxAois - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    selected.push(candidates[index]);
  }
  return selected;
}

function planRouteQueries(routeInput, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  opts.maxAois = clampInt(opts.maxAois, 1, 8, DEFAULTS.maxAois);
  opts.maxSamples = clampInt(opts.maxSamples, 3, 32, DEFAULTS.maxSamples);
  opts.maxSegmentKm = Math.max(5, Math.min(100, Number(opts.maxSegmentKm) || DEFAULTS.maxSegmentKm));
  opts.maxAoiRouteKm = Math.max(50, Math.min(500, Number(opts.maxAoiRouteKm) || DEFAULTS.maxAoiRouteKm));
  opts.maxAoiAreaDeg2 = Math.max(1, Math.min(25, Number(opts.maxAoiAreaDeg2) || DEFAULTS.maxAoiAreaDeg2));
  opts.paddingM = Math.max(1000, Math.min(25000, Number(opts.paddingM) || DEFAULTS.paddingM));

  const route = normalizeRoute(routeInput);
  const totalKm = routeLengthKm(route);

  if (route.length < 2 || totalKm <= 0) {
    return {
      mode: 'center_only',
      reason: 'no_route_geometry',
      aois: [],
      samplePoints: adaptiveSamplePoints(route, opts.maxSamples),
      maxAois: opts.maxAois,
      coverageRatio: 0,
      routeLengthKm: totalKm,
      routeLengthCoveredM: 0,
      segmentsPlanned: 0,
    };
  }

  const rawCrossing = route.some((p, i) =>
    i > 0 && Math.abs(p.lng - route[i - 1].lng) > 180
  );

  let candidates = buildAoiCandidates(route, opts);
  candidates = mergeSafe(candidates, opts);

  // Last safety pass: never return an AOI above the configured hard limit.
  candidates = candidates.filter(candidate =>
    bboxAreaDeg2(candidate.bbox) <= opts.maxAoiAreaDeg2
  );

  const preCapWeight = candidates.reduce((sum, c) => sum + Number(c.coverageWeightKm || 0), 0);
  const selected = selectBoundedCoverage(candidates, opts.maxAois);
  const coveredKm = Math.min(totalKm, selected.reduce(
    (sum, c) => sum + Number(c.coverageWeightKm || 0), 0
  ));

  return {
    mode: selected.length > 1 ? 'multi_aoi' : selected.length === 1 ? 'single_aoi' : 'center_only',
    reason: rawCrossing
      ? 'bounded_route_partition_antimeridian_safe'
      : selected.length < candidates.length
        ? 'bounded_route_budget_capped'
        : 'bounded_route_partition',
    aois: selected.map((candidate, index) => ({
      id: 'route-aoi-' + (index + 1),
      bbox: candidate.bbox,
      fromIndex: candidate.fromIndex,
      toIndex: candidate.toIndex,
      routeLengthKm: Number(candidate.routeLengthKm || 0),
      coverageWeightKm: Number(candidate.coverageWeightKm || 0),
    })),
    samplePoints: adaptiveSamplePoints(route, opts.maxSamples),
    maxAois: opts.maxAois,
    coverageRatio: totalKm > 0 ? Math.min(1, Math.max(0, coveredKm / totalKm)) : 0,
    fullRouteCandidateCoverageRatio: totalKm > 0 ? Math.min(1, Math.max(0, preCapWeight / totalKm)) : 0,
    routeLengthKm: totalKm,
    routeLengthCoveredM: Math.round(coveredKm * 1000),
    segmentsPlanned: candidates.length,
  };
}

async function queryAcrossAois(manager, provider, plan, baseArgs = {}, options = {}) {
  if (!plan || !Array.isArray(plan.aois) || !plan.aois.length) {
    return {
      observations: [],
      health: { status: 'UNAVAILABLE' },
      coverage: {
        complete: false,
        routeCoverageRatio: 0,
        routeLengthCoveredM: 0,
        aoisPlanned: 0,
        aoisSucceeded: 0,
        aoisFailed: 0,
        queryScope: 'no route AOIs',
      },
    };
  }

  const concurrency = clampInt(options.concurrency, 1, 6, 3);
  const maxRecords = clampInt(baseArgs.maxRecords, 1, 250, 250);
  const perAoiMax = Math.max(1, Math.ceil(maxRecords / plan.aois.length));
  const results = new Array(plan.aois.length);
  let cursor = 0;

  async function worker() {
    while (cursor < plan.aois.length) {
      const index = cursor++;
      const aoi = plan.aois[index];
      try {
        results[index] = {
          status: 'fulfilled',
          value: await manager.query(provider, {
            ...baseArgs,
            bbox: aoi.bbox,
            maxRecords: Math.min(maxRecords, perAoiMax),
          }),
          coverageWeightKm: Number(aoi.coverageWeightKm || 0),
        };
      } catch (error) {
        results[index] = {
          status: 'rejected',
          reason: error,
          coverageWeightKm: Number(aoi.coverageWeightKm || 0),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.aois.length) }, worker)
  );

  const observationsByAoi = [];
  const statuses = [];
  let succeeded = 0;
  let failed = 0;
  let providerIncomplete = false;
  let succeededWeightKm = 0;

  for (const result of results) {
    if (!result || result.status !== 'fulfilled') {
      failed++;
      observationsByAoi.push([]);
      continue;
    }

    succeeded++;
    succeededWeightKm += result.coverageWeightKm;
    statuses.push(String(result.value?.health?.status || 'UNKNOWN').toUpperCase());
    if (result.value?.coverage?.complete !== true) providerIncomplete = true;

    const aoiSeen = new Set();
    const bucket = [];
    for (const observation of (result.value?.observations || []).slice(0, perAoiMax)) {
      if (!observation?.id || aoiSeen.has(observation.id)) continue;
      aoiSeen.add(observation.id);
      bucket.push(observation);
    }
    observationsByAoi.push(bucket);
  }

  // Apply the global output cap after dedupe, but distribute the retained
  // observations across the route instead of taking the first AOIs first.
  const maxOutput = Math.max(1, maxRecords);
  const observations = [];
  const globalSeen = new Set();
  if (maxOutput < observationsByAoi.length) {
    for (let slot = 0; slot < maxOutput; slot++) {
      const preferredIndex = Math.round(
        slot * (observationsByAoi.length - 1) / Math.max(1, maxOutput - 1)
      );
      for (const index of [preferredIndex, ...Array.from({ length: observationsByAoi.length }, (_, i) => i)]) {
        const candidate = observationsByAoi[index] || [];
        const observation = candidate.find(item => item?.id && !globalSeen.has(item.id));
        if (!observation) continue;
        globalSeen.add(observation.id);
        observations.push(observation);
        break;
      }
    }
  } else {
    let madeProgress = true;
    while (observations.length < maxOutput && madeProgress) {
      madeProgress = false;
      for (const bucket of observationsByAoi) {
        if (observations.length >= maxOutput) break;
        const observation = bucket.find(item => item?.id && !globalSeen.has(item.id));
        if (!observation) continue;
        globalSeen.add(observation.id);
        observations.push(observation);
        madeProgress = true;
      }
    }
  }

  const status = statuses.includes('LIVE') ? 'LIVE'
    : statuses.includes('DELAYED') ? 'DELAYED'
    : statuses.includes('PARTIAL') ? 'PARTIAL'
    : statuses.includes('STALE') ? 'STALE'
    : failed ? 'UNAVAILABLE'
    : 'UNKNOWN';

  const totalRouteKm = Number(plan.routeLengthKm || 0);
  const queryCoverageRatio = totalRouteKm > 0
    ? Math.min(1, succeededWeightKm / totalRouteKm)
    : 0;
  const plannedRouteCoverageRatio = Math.min(1, Math.max(0, Number(plan.coverageRatio ?? 0)));
  const plannedCoverageComplete = plannedRouteCoverageRatio >= 0.999999;
  const queryComplete = failed === 0 && !providerIncomplete && succeeded === plan.aois.length;
  const complete = queryComplete && plannedCoverageComplete;

  return {
    observations,
    health: {
      status,
      recordCount: observations.length,
      acceptedCount: observations.length,
      rejectedCount: 0,
    },
    coverage: {
      complete,
      queryComplete,
      plannedCoverageComplete,
      routeCoverageRatio: queryCoverageRatio,
      plannedRouteCoverageRatio,
      routeLengthCoveredM: Math.round(succeededWeightKm * 1000),
      aoisPlanned: plan.aois.length,
      aoisSucceeded: succeeded,
      aoisFailed: failed,
      queryScope: 'bounded route AOIs',
    },
    warnings: [
      ...(failed || providerIncomplete ? ['route_aoi_partial_coverage'] : []),
      ...(!plannedCoverageComplete ? ['route_plan_budget_limited'] : [])
    ],
  };
}

module.exports = {
  DEFAULTS,
  normalizeRoute,
  densifyRoute,
  routeLengthKm,
  adaptiveSamplePoints,
  planRouteQueries,
  queryAcrossAois,
  bboxAreaDeg2,
  splitWrappedBbox,
};
