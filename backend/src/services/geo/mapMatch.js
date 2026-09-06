'use strict';

/**
 * Map-matching (snap-to-roads) for a device's GPS trail.
 *
 * Raw phone GPS drifts 10–30 m, so a plotted trace ghosts through buildings and
 * cuts corners. This snaps each fix onto the real road network using an OSRM
 * `/match` server, KEEPING each point's original timestamp (OSRM's tracepoints
 * align 1:1 with the input) so the drive-replay's timing is preserved — only the
 * coordinates move onto the road.
 *
 * Everything is best-effort: any failure (server down, unmatched point) falls
 * back to the raw coordinate, so a bad match can never break the trail. The
 * network call is injectable for tests.
 */

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Thin a dense trail before matching: drop points closer than `minGapM` metres
 * AND `minGapMs` apart from the last kept one, then, if still over `maxPoints`,
 * stride uniformly. Always keeps the first and last. Preserves ts/speed/heading.
 */
function downsample(points, { minGapM = 20, minGapMs = 5000, maxPoints = 250 } = {}) {
  if (points.length <= 2) return points.slice();
  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], last = kept[kept.length - 1];
    const farM = haversineM(last.lat, last.lng, p.lat, p.lng) >= minGapM;
    const farT = Math.abs(new Date(p.ts).getTime() - new Date(last.ts).getTime()) >= minGapMs;
    if (farM || farT) kept.push(p);
  }
  kept.push(points[points.length - 1]);
  if (kept.length <= maxPoints) return kept;
  const stride = kept.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(kept[Math.floor(i * stride)]);
  out[out.length - 1] = kept[kept.length - 1];
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function speedKmh(a, b) {
  const dt = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 1000;
  if (dt <= 0) return Infinity;
  return (haversineM(a.lat, a.lng, b.lat, b.lng) / dt) * 3.6;
}

/**
 * Drop teleport spikes: a single fix that's impossibly fast to reach AND to
 * leave, while its neighbours are consistent with each other, is GPS noise —
 * one bad point drawing a long straight line across the map. Genuine fast
 * travel (both the point and its neighbours move) is kept.
 */
function rejectSpikes(points, { maxKmh = 180 } = {}) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1], cur = points[i], next = points[i + 1];
    if (speedKmh(prev, cur) > maxKmh && speedKmh(cur, next) > maxKmh && speedKmh(prev, next) <= maxKmh) {
      continue; // lone spike — skip it
    }
    out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Robust centre of a cluster: the component-wise median. GPS multipath throws
 * a few fixes hundreds of metres out — a mean would be dragged toward them, the
 * median shrugs them off and lands on where the device actually is.
 */
function medianCenter(pts) {
  return { lat: median(pts.map(p => p.lat)), lng: median(pts.map(p => p.lng)) };
}

// A fix belongs to a stationary run when the device reports it's barely moving,
// or (speed unknown) it's still within `radiusM` of the run's anchor. Keying on
// the reported speed is what catches VIOLENT jitter — a parked phone reports
// 0 km/h even while its plotted position flails hundreds of metres.
function isStopped(p, anchor, stoppedKmh, radiusM) {
  if (anchor && haversineM(anchor.lat, anchor.lng, p.lat, p.lng) <= radiusM) return true;
  if (p.speed != null && p.speed >= 0) return p.speed < stoppedKmh;
  return !anchor;
}

/**
 * Collapse stationary jitter. When a device sits still its GPS can spray fixes
 * far and wide, exploding the trail into a star. This groups consecutive fixes
 * the device reports as stopped (speed under `stoppedKmh`) and, for a real dwell
 * (≥`minRun` fixes over ≥`minRunMs`), pins the whole run to its MEDIAN centre —
 * emitted twice, at the run's first and last timestamps, so the marker sits
 * perfectly still (speed 0) instead of spraying. Moving stretches pass through.
 */
function collapseStationary(points, { stoppedKmh = 3, radiusM = 40, minRun = 3, minRunMs = 15000 } = {}) {
  if (points.length <= 2) return points.slice();
  const out = [];
  let i = 0;
  while (i < points.length) {
    if (!isStopped(points[i], null, stoppedKmh, radiusM)) { out.push(points[i]); i++; continue; }
    let j = i;
    const anchor = points[i];
    while (j + 1 < points.length && isStopped(points[j + 1], anchor, stoppedKmh, radiusM)) j++;
    const run = points.slice(i, j + 1);
    const spanMs = new Date(points[j].ts).getTime() - new Date(points[i].ts).getTime();
    if (run.length >= minRun && spanMs >= minRunMs) {
      const c = medianCenter(run);
      out.push({ ...points[i], lat: c.lat, lng: c.lng, speed: 0 });
      out.push({ ...points[j], lat: c.lat, lng: c.lng, speed: 0 });
    } else {
      for (const p of run) out.push(p);
    }
    i = j + 1;
  }
  return out;
}

/**
 * Pre-clean a raw GPS trail so it's fit to plot/match: kill teleport spikes,
 * then fold stationary jitter into single anchored dwells.
 */
function cleanTrail(points, opts = {}) {
  return collapseStationary(rejectSpikes(points, opts.spikes), opts.stationary);
}

/**
 * Map an OSRM /match response back onto the input points: tracepoints[i] holds
 * the snapped [lng,lat] for input i (or null when OSRM couldn't place it).
 * Returns an array of {lat,lng}|null aligned to the chunk's inputs.
 */
function applyOsrmTracepoints(json, n) {
  const tps = json && Array.isArray(json.tracepoints) ? json.tracepoints : null;
  if (!tps) return new Array(n).fill(null);
  return Array.from({ length: n }, (_, i) => {
    const tp = tps[i];
    if (tp && Array.isArray(tp.location) && tp.location.length === 2) {
      return { lng: Number(tp.location[0]), lat: Number(tp.location[1]) };
    }
    return null;
  });
}

/**
 * Build a map-matching URL for a provider. Mapbox's Map Matching API is
 * OSRM-derived, so both speak the same `/match` tracepoints response (aligned
 * 1:1 with inputs) — only the host, path and auth differ. `tidy=false` on both
 * so points are never dropped/reordered and the 1:1 alignment (and our
 * timestamps) survives.
 */
function buildMatchUrl(prov, pts, radiusM) {
  const coords = pts.map(p => `${p.lng},${p.lat}`).join(';');
  const radii = pts.map(() => radiusM).join(';');
  if (prov.name === 'mapbox') {
    return 'https://api.mapbox.com/matching/v5/mapbox/driving/' + coords +
      `?geometries=geojson&overview=false&tidy=false&radiuses=${radii}` +
      `&access_token=${encodeURIComponent(prov.token)}`;
  }
  return `${prov.base.replace(/\/$/, '')}/match/v1/driving/${coords}` +
    `?geometries=geojson&overview=false&tidy=false&gaps=ignore&radiuses=${radii}`;
}

// Best matching confidence in a /match response (both providers report it). No
// matchings array → no signal, so don't penalise (return 1).
function matchConfidence(json) {
  const ms = json && Array.isArray(json.matchings) ? json.matchings : null;
  if (!ms || ms.length === 0) return 1;
  return Math.max(...ms.map(m => (typeof m.confidence === 'number' ? m.confidence : 1)));
}

/**
 * Snap one chunk, trying each provider in order (Mapbox first for quality, OSRM
 * as the always-on fallback) until one returns a confident match. Returns
 * { coords, provider, confidence }: coords is [lng,lat]|null per input (all-null
 * if every provider fails), provider is the winner's name (or null), confidence
 * is that provider's best matching confidence.
 */
async function matchChunk(providers, pts, { radiusM = 30, minConfidence = 0.2, fetchImpl }) {
  for (const prov of providers) {
    try {
      const resp = await fetchImpl(buildMatchUrl(prov, pts, radiusM), {
        headers: { 'User-Agent': 'Sonalit-Guardian' },
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json.code && json.code !== 'Ok' && json.code !== 'NoMatch') continue;
      const confidence = matchConfidence(json);
      if (confidence < minConfidence) continue;
      const coords = applyOsrmTracepoints(json, pts.length);
      if (coords.some(Boolean)) return { coords, provider: prov.name, confidence };
    } catch { /* try the next provider */ }
  }
  return { coords: new Array(pts.length).fill(null), provider: null, confidence: 0 };
}

/**
 * Snap a trail to roads using Mapbox and/or OSRM. Returns
 * { points, snapped, provider, confidence }. Providers are tried per-chunk in
 * order (Mapbox first, OSRM fallback); on any failure returns the
 * cleaned+downsampled input with snapped:false and provider:null.
 * @param {Array<{lat,lng,speed?,heading?,ts:string}>} points
 * @param {{osrmUrl?:string, mapboxToken?:string, fetchImpl?:Function}} opts
 */
async function snapToRoads(points, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const providers = [];
  if (opts.mapboxToken) providers.push({ name: 'mapbox', token: opts.mapboxToken });
  if (opts.osrmUrl) providers.push({ name: 'osrm', base: opts.osrmUrl });

  // Clean first (spikes + stationary jitter), THEN thin. This runs even when no
  // matcher is available, so the raw fallback is already de-sprayed.
  const cleaned = cleanTrail(points, opts.clean);
  const thinned = downsample(cleaned, opts.downsample);
  const unsnapped = { points: thinned, snapped: false, provider: null, confidence: 0 };
  if (!fetchImpl || providers.length === 0 || thinned.length < 2) return unsnapped;

  try {
    const batches = chunk(thinned, opts.chunkSize || 90);
    const snappedCoords = [];
    const winners = {};        // provider name → chunks won
    let confSum = 0, confN = 0;
    for (const b of batches) {
      const res = await matchChunk(providers, b, {
        radiusM: opts.radiusM ?? 30, minConfidence: opts.minConfidence ?? 0.2, fetchImpl,
      });
      for (let i = 0; i < b.length; i++) snappedCoords.push(res.coords[i]);
      if (res.provider) { winners[res.provider] = (winners[res.provider] || 0) + 1; confSum += res.confidence; confN++; }
    }
    let hits = 0;
    const merged = thinned.map((p, i) => {
      const s = snappedCoords[i];
      if (s) { hits++; return { ...p, lat: s.lat, lng: s.lng }; }
      return p; // keep raw where unmatched
    });
    // If almost nothing matched, the trail probably isn't on a road network we
    // know (rural track) — don't pretend; return raw.
    if (hits < Math.max(2, thinned.length * 0.3)) return unsnapped;
    // Report the provider that snapped the most chunks and the mean confidence.
    const provider = Object.keys(winners).sort((a, b) => winners[b] - winners[a])[0] || null;
    const confidence = confN ? confSum / confN : 0;
    return { points: merged, snapped: true, provider, confidence };
  } catch {
    return unsnapped;
  }
}

module.exports = {
  snapToRoads, downsample, chunk, applyOsrmTracepoints, haversineM,
  rejectSpikes, collapseStationary, cleanTrail, speedKmh,
  buildMatchUrl, matchConfidence, medianCenter,
};
