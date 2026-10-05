'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { getCameras, getNearestCameras } = require('../services/spatial/cctvGateway');
const { getCameraById, getCctvCountries, getCountryBbox } = require('../services/spatial/cctv/cctvCatalog');
const { getFrame, getMedia, openEyeWhepOffer, openEyeWhepDelete } = require('../services/spatial/cctv/cctvMediaProxy');
const { Readable } = require('node:stream');

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


router.get('/countries', asyncHandler(async (_req,res) => {
  res.json({
    data:getCctvCountries().map(country => ({ code:country.code, name:country.name })),
    meta:{ generated_at:new Date().toISOString(), source:'Natural Earth country bounding boxes; used only to scope the public camera search' }
  });
}));

router.post('/:id/live', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const camera = await getCameraById(id);
  if (!camera) return res.status(404).json({ error:'Camera not found' });
  const media = camera.media || {};
  if (media.feedKind !== 'live_video' || media.liveVideo !== true || !String(id).startsWith('openeye:')) {
    return res.status(409).json({ error:'Camera does not expose an OpenEye live-video capability', code:'live_video_unavailable' });
  }
  const streamId = String(id).slice('openeye:'.length);
  const sdp = typeof req.body === 'string'
    ? req.body
    : (Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (typeof req.body?.sdp === 'string'
        ? req.body.sdp
        : (typeof req.rawBody === 'string' ? req.rawBody : '')));
  const session = await openEyeWhepOffer(streamId, sdp);
  if (session.status === 402) {
    if (session.paymentRequired) res.setHeader('PAYMENT-REQUIRED', session.paymentRequired);
    if (session.wwwAuthenticate) res.setHeader('WWW-Authenticate', session.wwwAuthenticate);
    return res.status(402).json({ error:'Live video requires provider payment', code:'live_video_payment_required' });
  }
  if (!session.ok) {
    return res.status(session.status >= 400 ? session.status : 502).json({ error:'OpenEye live-video negotiation failed', code:'live_video_negotiation_failed' });
  }
  res.status(session.status || 201);
  res.setHeader('Content-Type','application/sdp');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Expose-Headers','Location, X-Sonalit-WHEP-Session, PAYMENT-REQUIRED, WWW-Authenticate');
  if (session.location) {
    res.setHeader('Location', session.location);
    res.setHeader('X-Sonalit-WHEP-Session', session.location);
  }
  return res.send(session.answer);
}));

router.delete('/:id/live', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const camera = await getCameraById(id);
  if (!camera) return res.status(404).json({ error:'Camera not found' });
  const location = typeof req.body?.location === 'string' ? req.body.location : '';
  if (!location) return res.status(400).json({ error:'WHEP session location is required', code:'live_session_location_required' });
  const result = await openEyeWhepDelete(location);
  return res.status(result.ok ? 204 : result.status >= 400 ? result.status : 502).end();
}));

router.get('/cameras', asyncHandler(async (req,res) => {
  const requestedCountry = String(req.query.country || '').trim().toUpperCase() || null;
  const bbox = String(req.query.bbox || '').split(',').map(Number);
  const safeBbox = bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null;
  const countryBbox = requestedCountry ? getCountryBbox(requestedCountry) : null;
  if (requestedCountry && !countryBbox) return res.status(400).json({ error:'Unsupported CCTV country code' });
  const scopedBbox = safeBbox || countryBbox;
  const center = parseTarget(req);
  const result = await getCameras({
    orgId:req.user.org_id,
    bbox:scopedBbox,
    center,
    radiusM:numberOrNull(req.query.radiusM) || 25000,
    countryCode:String(req.query.country || '').trim().toUpperCase() || null,
    liveOnly:String(req.query.liveOnly || '').toLowerCase() === 'true' || String(req.query.liveOnly || '') === '1',
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
    radiusM:numberOrNull(req.query.radiusM) || 25000,
    requireVisible:String(req.query.requireVisible || '').toLowerCase() === 'true'
  });
  res.json({ data:result, meta:{ generated_at:new Date().toISOString() } });
}));

router.get('/:id/media', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const camera = await getCameraById(id);
  if (!camera) return res.status(404).json({ error:'Camera not found' });
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const media = await getMedia(camera, { range });
  if (media.response.body) {
    res.status(media.status || media.response.status);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', media.acceptRanges || 'bytes');
    res.setHeader('X-Sonalit-Source', camera.provenance?.sourceName || camera.source || 'cctv');
    if (media.contentLength) res.setHeader('Content-Length', media.contentLength);
    if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
    if (media.etag) res.setHeader('ETag', media.etag);
    if (media.lastModified) res.setHeader('Last-Modified', media.lastModified);
    return Readable.fromWeb(media.response.body).pipe(res);
  }
  return res.status(502).json({ error:'CCTV stream body unavailable' });
}));

router.get('/:id/frame', asyncHandler(async (req,res) => {
  const id = String(req.params.id);
  const camera = await getCameraById(id);
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
  const camera = await getCameraById(id);
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
