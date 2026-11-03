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
const { getTrafficIncidents } = require('../services/spatial/tomtomTrafficGateway');

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

  const result = await getTrafficIncidents({ bbox, maxRecords: 250, signal: req.signal });
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
