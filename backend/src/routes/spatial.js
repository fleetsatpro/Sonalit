/**
 * Spatial intelligence routes — authenticated, organisation-scoped world context.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { getAircraftInBbox, validateBbox } = require('../services/spatial/openskyGateway');
const {
  buildWorldContext,
  getSpatialProviderHealth,
  bboxFromCenterRadius,
} = require('../services/spatial/worldContextService');
const { publish } = require('../realtime/centrifugo');

router.use(authenticate, attachOrgDb);

const MAX_BBOX_AREA_DEG2 = 25;
const MAX_RADIUS_M = 250_000;
const MAX_RESULT = 250;
const SUBJECT_KINDS = new Set(['convoy','vehicle','location','route','corridor','incident','checkpoint','port','none']);

function parseBbox(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  const west = parts[0];
  const south = parts[1];
  const east = parts[2];
  const north = parts[3];
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  if ((east - west) * (north - south) > MAX_BBOX_AREA_DEG2) return null;
  return [west, south, east, north];
}

function parseSubject(raw) {
  if (!raw) return { kind: 'none', id: 'context' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  const id = raw.id == null ? null : String(raw.id);
  if (!kind || !SUBJECT_KINDS.has(kind)) return null;
  if (kind !== 'none' && !id) return null;
  return { kind, id: id || 'context', label: raw.label ? String(raw.label) : undefined };
}

function parseLayers(raw, fallback) {
  if (!Array.isArray(raw)) return fallback;
  return raw.filter(l => typeof l === 'string').slice(0, 10);
}

function parseCenter(raw) {
  if (!raw) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function boundedRadius(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 25_000;
  return Math.min(value, MAX_RADIUS_M);
}

router.get(
  '/aircraft',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

    const bbox = parseBbox(req.query.bbox);
    if (!bbox) {
      return res.status(400).json({
        error: 'Invalid or missing bbox. Use bbox=west,south,east,north with area <= 25 deg2',
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
        generated_at: new Date().toISOString(),
      },
    });
  }),
);

router.get(
  '/provider-health',
  asyncHandler(async (req, res) => {
    if (!req.user?.org_id) return res.status(403).json({ error: 'Organisation context required' });
    res.json({ data: await getSpatialProviderHealth() });
  }),
);

async function worldContextHandler(req, res, persistEvents) {
  const orgId = req.user?.org_id;
  if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

  const subject = parseSubject(req.query.subject);
  if (!subject) return res.status(400).json({ error: 'Invalid subject' });

  const center = req.body?.center ? parseCenter(req.body.center) : parseCenter({
    latitude: req.query.lat,
    longitude: req.query.lng,
  });
  if ((req.body?.center || req.query.lat != null || req.query.lng != null) && !center) {
    return res.status(400).json({ error: 'Invalid center coordinates' });
  }

  let bbox = null;
  const rawBbox = req.body?.bbox ?? req.query.bbox;
  if (rawBbox) {
    bbox = Array.isArray(rawBbox) ? validateBbox(rawBbox) : parseBbox(String(rawBbox));
    if (!bbox) return res.status(400).json({ error: 'Invalid bbox' });
  }

  const layers = req.body?.layers
    ? parseLayers(req.body.layers, ['aircraft','weather','security','infrastructure','incidents','alerts'])
    : parseLayers(req.query.layers ? String(req.query.layers).split(',') : null, ['aircraft','weather','security','infrastructure','incidents','alerts']);

  const maxEntities = Math.min(
    MAX_RESULT,
    Math.max(1, Number(req.body?.maxEntitiesPerLayer ?? req.query.maxEntitiesPerLayer) || 100),
  );

  const context = await buildWorldContext({
    orgId,
    userId: req.user.id,
    db: req.db,
    subject,
    center,
    radiusM: boundedRadius(req.body?.radiusM ?? req.query.radiusM),
    bbox,
    layers,
    maxEntitiesPerLayer: maxEntities,
    requestId: req.id || req.headers['x-request-id'],
    persistEvents,
    publish,
  });

  res.json({ data: context });
}

router.get(
  '/world-context',
  asyncHandler(async (req, res) => worldContextHandler(req, res, false)),
);

router.post(
  '/world-context',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const subject = parseSubject(body.subject);
    if (!subject) return res.status(400).json({ error: 'Invalid subject' });

    const orgId = req.user?.org_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

    const center = body.center ? parseCenter(body.center) : null;
    if (body.center && !center) return res.status(400).json({ error: 'Invalid center coordinates' });

    let bbox = null;
    if (body.bbox != null) {
      bbox = Array.isArray(body.bbox) ? validateBbox(body.bbox) : parseBbox(String(body.bbox));
      if (!bbox) return res.status(400).json({ error: 'Invalid bbox' });
    }

    const ctx = await buildWorldContext({
      orgId,
      userId: req.user.id,
      db: req.db,
      subject,
      center,
      radiusM: boundedRadius(body.radiusM),
      bbox,
      layers: parseLayers(body.layers, ['aircraft','weather','security','infrastructure','incidents','alerts']),
      maxEntitiesPerLayer: Math.min(MAX_RESULT, Math.max(1, Number(body.maxEntitiesPerLayer) || 100)),
      requestId: req.id || req.headers['x-request-id'],
      persistEvents: Boolean(body.persistEvents),
      publish,
    });

    res.json({ data: ctx });
  }),
);

router.get(
  '/world-context/convoy/:id',
  asyncHandler(async (req, res) => {
    req.query.subject = JSON.stringify({ kind: 'convoy', id: req.params.id });
    const parsed = JSON.parse(req.query.subject);
    req.query.subject = parsed;
    return worldContextHandler(req, res, true);
  }),
);

router.get(
  '/world-context/vehicle/:id',
  asyncHandler(async (req, res) => {
    req.query.subject = { kind: 'vehicle', id: req.params.id };
    return worldContextHandler(req, res, true);
  }),
);

router.get(
  '/world-events',
  asyncHandler(async (req, res) => {
    const orgId = req.user?.org_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });

    const limit = Math.min(MAX_RESULT, Math.max(1, Number(req.query.limit) || 100));
    const params = [orgId];
    const where = ['se.org_id = $1'];

    if (req.query.convoy_id) {
      params.push(String(req.query.convoy_id));
      where.push('se.convoy_id = $' + params.length);
    }
    if (req.query.event_type) {
      params.push(String(req.query.event_type));
      where.push('se.event_type = $' + params.length);
    }
    if (req.query.status) {
      params.push(String(req.query.status));
      where.push('se.status = $' + params.length);
    }

    params.push(limit);
    const result = await req.db(
      'SELECT se.id,se.event_key,se.event_type,se.subject_type,se.subject_id,se.convoy_id,se.previous_state,se.new_state,se.observed_at,se.detected_at,se.severity,se.confidence,se.operational_confidence,se.related_entities,se.evidence,se.source_references,se.uncertainty,se.rule_version,se.status FROM spatial_events se WHERE ' +
      where.join(' AND ') +
      ' ORDER BY se.detected_at DESC LIMIT $' + params.length,
      params,
    );

    res.json({
      data: result.rows,
      meta: { organisation_scoped: true, generated_at: new Date().toISOString() },
    });
  }),
);

module.exports = router;
