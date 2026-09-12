'use strict';

/**
 * Route planning for the 4D geofence corridor.
 *
 * A corridor needs a centre-line: the road the convoy is actually meant to
 * drive. When the operator only gives an origin and a destination (no waypoints
 * in between), a straight line between them is useless — it cuts through
 * buildings, rivers and off-road, so every truck reads as "off corridor". This
 * asks a real routing engine for the driving route and returns its geometry as
 * ordered {lat,lng} waypoints that follow real roads.
 *
 * Dual provider, same as the map-matcher: Mapbox Directions first (quality),
 * OSRM /route as the always-on fallback — both return the route geometry in the
 * identical `routes[0].geometry.coordinates` ([lng,lat]) shape. Best-effort: if
 * neither is reachable it returns the input waypoints unchanged (routed:false)
 * so corridor creation never hard-fails. The network call is injectable.
 */

const R = 6371000;
const toRad = d => (d * Math.PI) / 180;

function haversineM(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Cap a dense polyline to at most `max` points, always keeping the first and
 * last and striding uniformly through the middle. A driving route from
 * overview=full can be thousands of points; the corridor only needs enough to
 * trace the road faithfully.
 */
function capPoints(route, max = 300) {
  if (route.length <= max) return route.slice();
  const stride = route.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(route[Math.floor(i * stride)]);
  out[out.length - 1] = route[route.length - 1];
  return out;
}

/**
 * Build a driving-directions URL. Mapbox Directions and OSRM /route return the
 * same GeoJSON geometry shape, so only host/path/auth differ.
 */
function buildRouteUrl(prov, waypoints, opts = {}) {
  const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
  // Both engines only offer alternatives for a plain origin→destination pair;
  // asking with vias in between is silently ignored, so don't bother.
  const alts = opts.alternatives && waypoints.length === 2 ? '&alternatives=true' : '';
  if (prov.name === 'mapbox') {
    return 'https://api.mapbox.com/directions/v5/mapbox/driving/' + coords +
      `?geometries=geojson&overview=full${alts}&access_token=${encodeURIComponent(prov.token)}`;
  }
  return `${prov.base.replace(/\/$/, '')}/route/v1/driving/${coords}` +
    '?geometries=geojson&overview=full' + alts;
}

function parseOne(r) {
  const coords = r && r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : null;
  if (!coords || coords.length < 2) return null;
  const route = coords
    .filter(c => Array.isArray(c) && c.length === 2)
    .map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
  if (route.length < 2) return null;
  return { route, distanceKm: (r.distance || 0) / 1000, durationMin: (r.duration || 0) / 60 };
}

function parseRoute(json) {
  const r = json && Array.isArray(json.routes) ? json.routes[0] : null;
  return parseOne(r);
}

/** Every route in the response, not just the engine's preferred one. */
function parseRoutes(json) {
  const rs = json && Array.isArray(json.routes) ? json.routes : [];
  return rs.map(parseOne).filter(Boolean);
}

/**
 * Plan a road route through the given waypoints (>=2: origin, [vias…],
 * destination). Returns { route, routed, provider, distance_km, duration_min }.
 * On any failure returns the input waypoints unchanged with routed:false.
 * @param {Array<{lat:number,lng:number}>} waypoints
 * @param {{osrmUrl?:string, mapboxToken?:string, maxPoints?:number, fetchImpl?:Function}} opts
 */
async function planRoute(waypoints, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const providers = [];
  if (opts.mapboxToken) providers.push({ name: 'mapbox', token: opts.mapboxToken });
  if (opts.osrmUrl) providers.push({ name: 'osrm', base: opts.osrmUrl });

  const fallback = { route: (waypoints || []).slice(), routed: false, provider: null, distance_km: null, duration_min: null };
  if (!fetchImpl || providers.length === 0 || !waypoints || waypoints.length < 2) return fallback;

  for (const prov of providers) {
    try {
      const resp = await fetchImpl(buildRouteUrl(prov, waypoints), { headers: { 'User-Agent': 'Sonalit-Guardian' } });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json.code && json.code !== 'Ok') continue;
      const parsed = parseRoute(json);
      if (!parsed) continue;
      return {
        route: capPoints(parsed.route, opts.maxPoints ?? 300),
        routed: true, provider: prov.name,
        distance_km: Math.round(parsed.distanceKm * 100) / 100,
        duration_min: Math.round(parsed.durationMin),
      };
    } catch { /* try the next provider */ }
  }
  return fallback;
}

/**
 * Ask for every road the engine is willing to offer between two points, so the
 * caller can choose on its own criteria (risk, not just speed) rather than
 * accepting whichever one the router happened to prefer.
 *
 * Returns [] when nothing is reachable — unlike planRoute there is no
 * straight-line fallback, because a caller comparing routes needs to know it
 * has nothing real to compare.
 *
 * @param {Array<{lat:number,lng:number}>} waypoints
 * @param {{osrmUrl?:string, mapboxToken?:string, maxPoints?:number, fetchImpl?:Function}} opts
 * @returns {Promise<Array<{route:Array, distance_km:number, duration_min:number, provider:string}>>}
 */
async function planRouteAlternatives(waypoints, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const providers = [];
  if (opts.mapboxToken) providers.push({ name: 'mapbox', token: opts.mapboxToken });
  if (opts.osrmUrl) providers.push({ name: 'osrm', base: opts.osrmUrl });
  if (!fetchImpl || providers.length === 0 || !waypoints || waypoints.length < 2) return [];

  for (const prov of providers) {
    try {
      const url = buildRouteUrl(prov, waypoints, { alternatives: true });
      const resp = await fetchImpl(url, { headers: { 'User-Agent': 'Sonalit-Guardian' } });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json.code && json.code !== 'Ok') continue;
      const parsed = parseRoutes(json);
      if (!parsed.length) continue;
      return parsed.map(p => ({
        route: capPoints(p.route, opts.maxPoints ?? 300),
        provider: prov.name,
        distance_km: Math.round(p.distanceKm * 100) / 100,
        duration_min: Math.round(p.durationMin),
      }));
    } catch { /* try the next provider */ }
  }
  return [];
}

module.exports = {
  planRoute, planRouteAlternatives, buildRouteUrl, parseRoute, parseRoutes, capPoints, haversineM,
};
