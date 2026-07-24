'use strict';

/**
 * Forward geocoding for the corridor planner: turn a typed place name
 * ("Nairobi CBD", "Mombasa Rd depot") into candidate coordinates, so an
 * operator can plan a 4D corridor without hand-entering lat/lng.
 *
 * Backed by Mapbox Geocoding, using the SAME backend token as the matcher and
 * route planner — the browser never needs a Mapbox key. Best-effort: no token,
 * a bad query, or an unreachable API all return an empty result rather than
 * throwing. The network call is injectable for tests.
 */
async function geocode(query, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const token = opts.mapboxToken;
  const q = (query || '').trim();
  if (!token || !fetchImpl || !q) return { results: [], provider: null };

  const limit = Math.min(10, Math.max(1, opts.limit || 5));
  const params = new URLSearchParams({ limit: String(limit), access_token: token });
  if (opts.proximity && Number.isFinite(opts.proximity.lat) && Number.isFinite(opts.proximity.lng)) {
    params.set('proximity', `${opts.proximity.lng},${opts.proximity.lat}`); // bias toward here
  }
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`;

  try {
    const resp = await fetchImpl(url, { headers: { 'User-Agent': 'Sonalit-Guardian' } });
    if (!resp.ok) return { results: [], provider: null };
    const json = await resp.json();
    const feats = Array.isArray(json.features) ? json.features : [];
    const results = feats
      .filter(f => Array.isArray(f.center) && f.center.length === 2)
      .map(f => ({
        name: f.place_name || f.text || q,
        lat: Number(f.center[1]),
        lng: Number(f.center[0]),
      }))
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return { results, provider: 'mapbox' };
  } catch {
    return { results: [], provider: null };
  }
}

module.exports = { geocode };
