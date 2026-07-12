/**
 * Legacy compatibility shim for already-installed Guardian app builds.
 *
 * SyncWorker.kt originally called POST /api/v1/telemetry/batch with body
 * { device_id, fixes: [{lat, lon, speed_kmh, heading, accuracy_m, ts}] } —
 * a path and shape that never matched any real backend route (a 404 on
 * every sync), which is why field officers' devices never reported a
 * position. The Android client has been fixed to call the canonical
 * POST /api/v1/guardian/location/batch instead, but phones already running
 * an older build won't get that fix until they update. This route accepts
 * the old path/shape, normalizes it, and forwards into the same handler —
 * so already-deployed devices start reporting immediately rather than
 * waiting on every officer to reinstall the app.
 */
const router = require('express').Router();
const { deviceAuth, processLocationBatch } = require('./guardian');

router.post('/batch', deviceAuth, async (req, res, next) => {
  try {
    const fixes = Array.isArray(req.body.fixes) ? req.body.fixes : [];
    if (fixes.length === 0) {
      return res.status(400).json({ error: 'fixes must be a non-empty array' });
    }
    const points = fixes
      .filter((f) => f.lat != null && f.lon != null)
      .map((f) => ({
        lat: f.lat,
        lng: f.lon,
        altitude: null,
        heading: f.heading ?? null,
        speed: f.speed_kmh ?? null,
        accuracy: f.accuracy_m ?? null,
        timestamp: f.ts ? new Date(f.ts).toISOString() : null,
      }));
    if (points.length === 0) {
      return res.status(400).json({ error: 'No valid fixes (lat/lon required)' });
    }
    const result = await processLocationBatch(req.device.id, points);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
