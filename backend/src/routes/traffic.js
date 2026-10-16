// Live traffic overlay for GPS Live / Tactical Map: congestion (flow) tiles
// and incidents (accidents, closures, roadworks) from TomTom's Traffic API.
// Proxied through the backend rather than hitting TomTom directly from the
// browser so TOMTOM_API_KEY never reaches the client — same reasoning as
// every other keyed OSINT source in this app (see riskOsint.js).
//
// Coverage caveat: TomTom's traffic data is sparse-to-absent in several of
// the conflict corridors Risk Intel already tracks (confirmed via their own
// market-coverage docs: no flow/incident coverage in Somalia, Mali, Sudan,
// Ethiopia, Yemen, Iraq, Syria, Pakistan, Afghanistan as of this writing) —
// an empty overlay in those regions means "no data available", not "roads
// are clear". The frontend surfaces this rather than staying silent about it.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');
const { getTrafficIncidents, getProviderHealth } = require('../services/spatial/tomtomTrafficGateway');

const TOMTOM_BASE = 'https://api.tomtom.com';

function isConfigured() {
  return !!(process.env.TOMTOM_API_KEY && process.env.TOMTOM_API_KEY.length > 10);
}

router.use(authenticate);

router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// Raster flow tile proxy — MapLibre adds this as a plain `raster` source
// pointing at /traffic/tiles/flow/{z}/{x}/{y}.png. `relative0` colors purely
// by how much slower than free-flow a segment is (green→red), which reads
// consistently across regions unlike `absolute` (colored by raw speed,
// which conflates "slow" with "always a backroad").
router.get('/tiles/flow/:z/:x/:y.png', asyncHandler(async (req, res) => {
  if (!isConfigured()) return res.status(204).end();

  const { z, x, y } = req.params;
  const url = `${TOMTOM_BASE}/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?key=${process.env.TOMTOM_API_KEY}`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!upstream.ok) return res.status(upstream.status).end();

  res.set('Content-Type', 'image/png');
  // TomTom's own flow data refreshes roughly every minute — no point
  // re-fetching more often than that per tile.
  res.set('Cache-Control', 'public, max-age=60');
  res.send(Buffer.from(await upstream.arrayBuffer()));
}));

// Incidents (accidents, closures, roadworks) as a GeoJSON FeatureCollection
// for the caller's current map viewport. bbox is minLon,minLat,maxLon,maxLat
// (TomTom caps this at 10,000 km², which comfortably covers one screen's
// worth of map even at low zoom).
router.get('/incidents', asyncHandler(async (req, res) => {
  if (!isConfigured()) return res.json({ type: 'FeatureCollection', features: [], configured: false });

  const raw = req.query.bbox;
  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'bbox=minLon,minLat,maxLon,maxLat is required' });
  }
  const bbox = raw.split(',').map(Number);
  if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n)) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 25) {
    return res.status(400).json({ error: 'Invalid traffic bbox' });
  }

  let result;
  try {
    result = await getTrafficIncidents({ bbox, maxRecords: 250, signal: req.signal });
  } catch (error) {
    const failureClass = String(error?.failureClass || '');
    // Provider failures are operationally degraded states, not unexpected
    // application errors. Do not turn them into HTTP 500s, and never return a
    // successful empty FeatureCollection that could be read as "roads are clear".
    const unavailable = new Set([
      'circuit_open', 'rate_limited', 'timeout', 'unavailable',
      'auth_required', 'budget_exhausted', 'http_error', 'malformed', 'invalid_data',
    ]);
    if (!unavailable.has(failureClass)) throw error;

    const upstreamStatus = ['http_error', 'malformed', 'invalid_data'].includes(failureClass)
      ? 502
      : 503;
    const retryAfterSeconds = failureClass === 'circuit_open' ? 30
      : failureClass === 'rate_limited' || failureClass === 'budget_exhausted' ? 60
        : null;
    if (retryAfterSeconds != null) res.set('Retry-After', String(retryAfterSeconds));

    const providerHealth = typeof getProviderHealth === 'function' ? getProviderHealth() : {};
    return res.status(upstreamStatus).json({
      type: 'FeatureCollection',
      features: [],
      configured: true,
      coverage: {
        complete: false,
        queryScope: 'TomTom traffic incidents unavailable for the requested viewport',
      },
      health: {
        status: 'DEGRADED',
        providerStatus: providerHealth.status || 'UNAVAILABLE',
        circuitState: providerHealth.circuitState || 'UNKNOWN',
        lastSuccessAt: providerHealth.lastSuccessAt || null,
        lastAttemptAt: providerHealth.lastAttemptAt || null,
        failureClass,
      },
      error: {
        code: 'TRAFFIC_PROVIDER_UNAVAILABLE',
        reason: failureClass,
        message: 'Traffic incident data is unavailable. Road conditions are unknown, not confirmed clear.',
      },
    });
  }

  const features = (result.observations || []).map((observation) => ({
    type: 'Feature',
    id: observation.sourceReference || observation.id,
    geometry: observation.geometry || {
      type: 'Point',
      coordinates: [observation.longitude, observation.latitude],
    },
    properties: {
      id: observation.sourceReference || observation.id,
      iconCategory: observation.attributes?.category || 'unknown',
      magnitudeOfDelay: Number.isFinite(Number(observation.attributes?.magnitudeOfDelay))
        ? Number(observation.attributes.magnitudeOfDelay)
        : 0,
      delay: observation.attributes?.delaySeconds ?? 0,
      roadNumbers: observation.attributes?.roadNumbers || [],
      events: observation.attributes?.description
        ? [{ description: observation.attributes.description }]
        : [],
    },
  }));

  res.json({
    type: 'FeatureCollection',
    features,
    configured: true,
    coverage: result.coverage,
    health: result.health,
  });
}));;

module.exports = router;
