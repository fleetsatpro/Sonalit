'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { spatialProviderManager } = require('../services/spatial/providerManager');
const { predictPasses } = require('../services/spatial/satellitePassPredictor');

router.use(authenticate, attachOrgDb);

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some(v => !Number.isFinite(v))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  if ((east - west) * (north - south) > 25) return null;
  return [west, south, east, north];
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

    const bbox = req.query.bbox == null ? undefined : parseBbox(req.query.bbox);
    if (req.query.bbox != null && !bbox) return res.status(400).json({ error: 'Invalid bbox' });

    const centerLat = numberOrNull(req.query.lat);
    const centerLng = numberOrNull(req.query.lng);
    const center = centerLat == null && centerLng == null
      ? undefined
      : (centerLat != null && centerLng != null && centerLat >= -90 && centerLat <= 90 && centerLng >= -180 && centerLng <= 180
        ? { latitude: centerLat, longitude: centerLng }
        : null);
    if ((req.query.lat != null || req.query.lng != null) && !center) {
      return res.status(400).json({ error: 'Invalid center coordinates' });
    }

    const maxRecords = boundedInt(req.query.maxRecords, 40, 1, 40);
    const result = await spatialProviderManager.query('celestrak', {
      orgId,
      requestId: req.id || req.headers['x-request-id'],
      signal: req.signal,
      group: req.query.group,
      bbox,
      center,
      radiusM: numberOrNull(req.query.radiusM),
      maxRecords,
      at: req.query.at
    });

    res.json({
      data: result.observations || [],
      catalog: result.catalog || [],
      health: result.health || null,
      coverage: result.coverage || null,
      warnings: result.warnings || [],
      meta: {
        source: 'celestrak',
        positionSource: 'sgp4_modelled',
        telemetryLive: false,
        imagingClaim: false,
        taskingClaim: false,
        generated_at: new Date().toISOString()
      }
    });
  })
);

router.get(
  '/passes',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

    const lat = numberOrNull(req.query.lat);
    const lng = numberOrNull(req.query.lng);
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lat and lng are required valid observer coordinates' });
    }

    const result = await predictPasses({
      providerManager: spatialProviderManager,
      options: {
        orgId,
        requestId: req.id || req.headers['x-request-id'],
        signal: req.signal,
        lat,
        lng,
        noradId: req.query.noradId == null ? undefined : boundedInt(req.query.noradId, null, 1, 999999),
        group: req.query.group,
        windowHours: req.query.windowHours == null ? undefined : numberOrNull(req.query.windowHours),
        horizonDeg: req.query.horizonDeg == null ? undefined : numberOrNull(req.query.horizonDeg),
        maxPasses: req.query.maxPasses == null ? undefined : boundedInt(req.query.maxPasses, null, 1, 20),
        from: req.query.from
      }
    });

    res.json({
      data: result.passes,
      meta: {
        observer: result.observer,
        window: result.window,
        scannedObjects: result.scannedObjects,
        maxObjects: result.maxObjects,
        catalogCount: result.catalogCount,
        selectedCatalogCount: result.selectedCatalogCount,
        bounds: result.bounds,
        semantics: result.semantics,
        providerHealth: result.providerHealth,
        warnings: result.warnings
      }
    });
  })
);

module.exports = router;
