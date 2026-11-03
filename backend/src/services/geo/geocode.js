'use strict';

/**
 * Forward geocoding for the corridor planner: turn a typed place name
 * ("Nairobi CBD", "Mombasa Rd depot") into candidate coordinates, so an
 * operator can plan a 4D corridor without hand-entering lat/lng.
 *
 * Dual provider, the same shape as the route planner: Mapbox Geocoding first
 * when a token is configured (better ranking, proximity bias), then Nominatim
 * (OpenStreetMap) as the always-on fallback. Nominatim needs no key, so a
 * deployment with no Mapbox token still geocodes instead of silently returning
 * nothing — which previously left the planner insisting "check the backend
 * Mapbox token" on every search, and made auto-planning impossible to use out
 * of the box.
 *
 * Nominatim's usage policy requires an identifying User-Agent and tolerates
 * only light traffic; it is a fallback for occasional corridor planning, not a
 * bulk geocoder. Best-effort throughout: a bad query or an unreachable API
 * returns an empty result rather than throwing. The network call is injectable
 * for tests.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const UA = 'Sonalit-Guardian';

function clampLimit(v) {
  return Math.min(10, Math.max(1, v || 5));
}

async function fromMapbox(q, limit, opts, fetchImpl) {
  const params = new URLSearchParams({ limit: String(limit), access_token: opts.mapboxToken });
  if (opts.proximity && Number.isFinite(opts.proximity.lat) && Number.isFinite(opts.proximity.lng)) {
    params.set('proximity', `${opts.proximity.lng},${opts.proximity.lat}`); // bias toward here
  }
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`;

  const resp = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) return [];
  const json = await resp.json();
  const feats = Array.isArray(json.features) ? json.features : [];
  return feats
    .filter(f => Array.isArray(f.center) && f.center.length === 2)
    .map(f => ({ name: f.place_name || f.text || q, lat: Number(f.center[1]), lng: Number(f.center[0]) }));
}

async function fromNominatim(q, limit, opts, fetchImpl) {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: String(limit) });
  if (opts.proximity && Number.isFinite(opts.proximity.lat) && Number.isFinite(opts.proximity.lng)) {
    // Nominatim has no proximity parameter; a viewbox around the point is the
    // closest equivalent. It is left non-exclusive on purpose, so a good match
    // just outside the box is ranked lower rather than dropped.
    const { lat, lng } = opts.proximity;
    params.set('viewbox', `${lng - 3},${lat + 3},${lng + 3},${lat - 3}`);
  }

  const resp = await fetchImpl(`${NOMINATIM_URL}?${params}`, { headers: { 'User-Agent': UA } });
  if (!resp.ok) return [];
  const json = await resp.json();
  if (!Array.isArray(json)) return [];
  return json.map(r => ({
    name: r.display_name || r.name || q,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

/**
 * Resolve a place name to candidate coordinates.
 * @param {string} query
 * @param {{mapboxToken?:string, limit?:number, proximity?:{lat:number,lng:number}, fetchImpl?:Function}} opts
 * @returns {Promise<{results:Array<{name:string,lat:number,lng:number}>, provider:string|null}>}
 */
async function geocode(query, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const q = (query || '').trim();
  if (!fetchImpl || !q) return { results: [], provider: null };

  const limit = clampLimit(opts.limit);
  const providers = [];
  if (opts.mapboxToken) providers.push({ name: 'mapbox', run: fromMapbox });
  providers.push({ name: 'nominatim', run: fromNominatim });

  for (const prov of providers) {
    try {
      const found = await prov.run(q, limit, opts, fetchImpl);
      const results = found.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
      if (results.length) return { results, provider: prov.name };
    } catch { /* try the next provider */ }
  }
  return { results: [], provider: null };
}

module.exports = { geocode };
