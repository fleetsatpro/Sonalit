// Nominatim (OpenStreetMap) forward geocoding — turns a free-text place name
// pulled out of OSINT text (e.g. "Ma'rib, Yemen") into coordinates + country,
// so a matching risk zone can be found by distance or a new one created,
// instead of relying on a hardcoded channel/keyword-to-zone mapping.
//
// No API key needed, but usage policy requires a real User-Agent and caps
// requests at 1/sec: https://operations.osmfoundation.org/policies/nominatim/
// Results are cached in-memory for the life of the process since the same
// place name recurs constantly across messages and sweeps.
const logger = require('./logger');

const cache = new Map();
let lastRequestAt = 0;

async function geocodePlace(placeName) {
  if (!placeName || typeof placeName !== 'string') return null;
  const key = placeName.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const waitMs = 1100 - (Date.now() - lastRequestAt);
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  lastRequestAt = Date.now();

  let result = null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=jsonv2&limit=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SonalitRiskIntel/1.0 (+https://sonalit.com)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const results = await res.json();
    const hit = Array.isArray(results) ? results[0] : null;
    if (hit && Number.isFinite(parseFloat(hit.lat)) && Number.isFinite(parseFloat(hit.lon))) {
      result = {
        lat: parseFloat(hit.lat),
        lng: parseFloat(hit.lon),
        country: hit.address?.country || null,
        displayName: hit.display_name || placeName,
      };
    }
  } catch (e) {
    logger.warn(`Risk Intel OSINT: geocode failed for "${placeName}": ${e.message}`);
  }

  cache.set(key, result);
  return result;
}

module.exports = { geocodePlace };
