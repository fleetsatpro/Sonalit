/**
 * Spatial intelligence routes — world-signal gateway + world context.
 * Mounted at /api/v1/spatial
 *
 * Security:
 * - authenticate + attachOrgDb required
 * - org_id always from req.user (never from body)
 * - OpenSky credentials server-side only
 * - bbox validated and capped
 * - no arbitrary upstream URL fetch
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const {
  getAircraftInBbox,
  getProviderHealth,
  validateBbox,
} = require('../services/spatial/openskyGateway');
const { buildWorldContext } = require('../services/spatial/worldContextService');

router.use(authenticate, attachOrgDb);

const MAX_BBOX_AREA_DEG2 = 25;
const MAX_RADIUS_M = 250_000;

function parseBbox(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  const area = (east - west) * (north - south);
  if (area > MAX_BBOX_AREA_DEG2) return null;
  return [west, south, east, north];
}

router.get(
  '/aircraft',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) {
      return res.status(403).json({ error: 'Organisation context required' });
    }
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) {
      return res.status(400).json({
        error:
          'Invalid or missing bbox. Use bbox=west,south,east,north with area ≤ 25 deg²',
      });
    }
    const result = await getAircraftInBbox({
      bbox,
      orgId,
      requestId: req.id || req.headers['x-request-id'],
    });
    res.json({
      data: result.observations,
      health: result.health,
      coverage: result.coverage,
      meta: {
        source: 'opensky',
        classification: 'external',
        org_id: orgId,
        generated_at: new Date().toISOString(),
      },
    });
  }),
);

router.get(
  '/provider-health',
  asyncHandler(async (req, res) => {
    if (!req.user?.org_id) {
      return res.status(403).json({ error: 'Organisation context required' });
    }
    res.json({ data: getProviderHealth() });
  }),
);

router.post(
  '/world-context',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) {
      return res.status(403).json({ error: 'Organisation context required' });
    }
    const body = req.body || {};
    let radiusM = Number(body.radiusM);
    if (!Number.isFinite(radiusM) || radiusM <= 0) radiusM = 25_000;
    radiusM = Math.min(radiusM, MAX_RADIUS_M);

    let bbox = null;
    if (body.bbox) {
      if (Array.isArray(body.bbox) && body.bbox.length === 4) {
        bbox = validateBbox(body.bbox);
        if (!bbox) {
          return res.status(400).json({
            error: 'Invalid bbox. Use [west,south,east,north] with valid coordinates and area ≤ 25 deg²',
          });
        }
      } else if (typeof body.bbox === 'string') {
        bbox = parseBbox(body.bbox);
      } else {
        return res.status(400).json({ error: 'Invalid bbox' });
      }
    }

    const center = body.center;
    if (
      center &&
      (typeof center.latitude !== 'number' ||
        typeof center.longitude !== 'number' ||
        !Number.isFinite(center.latitude) ||
        !Number.isFinite(center.longitude))
    ) {
      return res.status(400).json({ error: 'Invalid center coordinates' });
    }

    const layers = Array.isArray(body.layers)
      ? body.layers.filter((l) => typeof l === 'string').slice(0, 10)
      : ['aircraft'];

    const maxEntities = Math.min(
      Math.max(Number(body.maxEntitiesPerLayer) || 100, 1),
      250,
    );

    const ctx = await buildWorldContext({
      orgId,
      userId: req.user.id,
      db: req.db,
      subject: body.subject || null,
      center: center || null,
      radiusM,
      bbox,
      layers,
      maxEntitiesPerLayer: maxEntities,
      requestId: req.id || req.headers['x-request-id'],
    });

    res.json({ data: ctx });
  }),
);

module.exports = router;
