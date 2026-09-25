'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { getCameras, getNearestCameras } = require('../services/spatial/cctvGateway');
const { getCameraCatalog } = require('../services/spatial/cctv/cctvCatalog');
const { getFrame } = require('../services/spatial/cctv/cctvMediaProxy');

router.use(authenticate, attachOrgDb);

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTarget(req) {
  const latitude = numberOrNull(req.query.lat);
  const longitude = numberOrNull(req.query.lng);
  if (latitude == null || longitude == null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

router.get('/cameras', asyncHandler(async (req,res) => {
  const bbox = String(req.query.bbox || '').split(',').map(Number);
  const safeBbox = bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null;
  const center = parseTarget(req);
  const result = await getCameras({
    orgId:req.user.org_id,
    bbox:safeBbox,
    center,
    radiusM:numberOrNull(req.query.radiusM) || 25000,
    maxRecords:Math.min(250, Math.max(1, numberOrNull(req.query.limit) || 100))
  });
  res.json({
    data:result.observations,
    health:result.health,
    coverage:result.coverage,
    warnings:result.warnings || [],
    meta:{ source:'cctv', generated_at:new Date().toISOString(), privacy_boundary:'no plate/person/face tracking' }
  });
}));

router.get('/nearest', asyncHandler(async (req,res) => {
  const target = parseTarget(req);
  if (!target) return res.status(400).json({ error:'lat and lng are required and must be valid coordinates' });
  const result = await getNearestCameras({
    ...target,
    limit:Math.min(20, Math.max(1, numberOrNull(req.query.limit) || 5)),
    requireVisible:String(req.query.requireVisible || '').toLowerCase() === 'true'
  });
  res.json({ data:result, meta:{ generated_at:new Date().toISOString() } });
}));

router.get('/:id/frame', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const cameras = await getCameraCatalog();
  const camera = cameras.find(item => String(item.id) === id);
  if (!camera) return res.status(404).json({ error:'Camera not found' });
  const frame = await getFrame(camera);
  res.setHeader('Content-Type', frame.contentType);
  res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=20');
  res.setHeader('X-Sonalit-CCTV-Synthetic', frame.synthetic ? 'true' : 'false');
  res.setHeader('X-Sonalit-Source', camera.provenance?.sourceName || camera.source || 'cctv');
  return res.end(frame.buffer);
}));

router.get('/:id', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const cameras = await getCameraCatalog();
  const camera = cameras.find(item => String(item.id) === id);
  if (!camera) return res.status(404).json({ error:'Camera not found' });
  res.json({
    data: camera,
    meta:{
      generated_at:new Date().toISOString(),
      viewshed_semantics:'Geometry indicates possible visibility only; it is not proof of visual acquisition.',
      privacy_boundary:'No plate/person/face tracking.'
    }
  });
}));

module.exports = router;
