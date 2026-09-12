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

  const bbox = req.query.bbox;
  if (typeof bbox !== 'string' || bbox.split(',').length !== 4) {
    return res.status(400).json({ error: 'bbox=minLon,minLat,maxLon,maxLat is required' });
  }

  const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,delay,roadNumbers,events{description,code,iconCategory}}}}';
  const url = `${TOMTOM_BASE}/traffic/services/5/incidentDetails?key=${process.env.TOMTOM_API_KEY}`
    + `&bbox=${encodeURIComponent(bbox)}&fields=${encodeURIComponent(fields)}&language=en-US`;

  const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!upstream.ok) {
    logger.warn(`Traffic incidents: TomTom HTTP ${upstream.status}`);
    return res.json({ type: 'FeatureCollection', features: [], configured: true });
  }
  const data = await upstream.json();
  const features = Array.isArray(data.incidents) ? data.incidents : [];
  res.json({ type: 'FeatureCollection', features, configured: true });
}));

module.exports = router;
