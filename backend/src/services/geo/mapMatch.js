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

async function matchChunkOsrm(base, pts, { radiusM = 30, fetchImpl }) {
  const coords = pts.map(p => `${p.lng},${p.lat}`).join(';');
  const radii = pts.map(() => radiusM).join(';');
  const url = `${base.replace(/\/$/, '')}/match/v1/driving/${coords}` +
    `?geometries=geojson&overview=false&tidy=false&gaps=ignore&radiuses=${radii}`;
  const resp = await fetchImpl(url, { headers: { 'User-Agent': 'Sonalit-Guardian' } });
  if (!resp.ok) throw new Error(`OSRM HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.code && json.code !== 'Ok' && json.code !== 'NoMatch') throw new Error(`OSRM ${json.code}`);
  return applyOsrmTracepoints(json, pts.length);
}

/**
 * Snap a trail to roads. Returns { points, snapped }. On any failure returns the
 * (downsampled) input unchanged with snapped:false.
 * @param {Array<{lat,lng,speed?,heading?,ts:string}>} points
 */
async function snapToRoads(points, opts = {}) {
  const base = opts.osrmUrl;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const thinned = downsample(points, opts.downsample);
  if (!base || !fetchImpl || thinned.length < 2) return { points: thinned, snapped: false };

  try {
    const batches = chunk(thinned, opts.chunkSize || 90);
    const snappedCoords = [];
    for (const b of batches) {
      const res = await matchChunkOsrm(base, b, { radiusM: opts.radiusM ?? 30, fetchImpl });
      for (let i = 0; i < b.length; i++) snappedCoords.push(res[i]);
    }
    let hits = 0;
    const merged = thinned.map((p, i) => {
      const s = snappedCoords[i];
      if (s) { hits++; return { ...p, lat: s.lat, lng: s.lng }; }
      return p; // keep raw where unmatched
    });
    // If almost nothing matched, the trail probably isn't on a road network we
    // know (rural track) — don't pretend; return raw.
    if (hits < Math.max(2, thinned.length * 0.3)) return { points: thinned, snapped: false };
    return { points: merged, snapped: true };
  } catch {
    return { points: thinned, snapped: false };
  }
}

module.exports = { snapToRoads, downsample, chunk, applyOsrmTracepoints, haversineM };
