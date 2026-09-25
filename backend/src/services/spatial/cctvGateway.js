'use strict';

const { getCameraCatalog } = require('./cctv/cctvCatalog');
const { normaliseCamera, pointInViewshed, rankNearest, buildViewshedPolygon } = require('./cctv/spatialCameraGeometry');

let health = {
  providerId:'cctv', status:'UNKNOWN', lastSuccessAt:null, lastAttemptAt:null,
  lastErrorClass:null, lastErrorMessage:null, recordCount:0, acceptedCount:0, rejectedCount:0
};

function inBbox(camera, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return true;
  const [west,south,east,north] = bbox.map(Number);
  const lon = Number(camera.pose.longitude), lat = Number(camera.pose.latitude);
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

function inRadius(camera, center, radiusM) {
  if (!center) return true;
  const { haversineM } = require('./cctv/spatialCameraGeometry');
  return haversineM(camera.pose, center) <= Number(radiusM || 25000);
}

async function getCameras(options = {}) {
  const now = new Date().toISOString();
  health.lastAttemptAt = now;
  try {
    const raw = await getCameraCatalog();
    const normalized = raw.map(normaliseCamera).filter(Boolean);
    const cameras = normalized
      .filter(c => inBbox(c, options.bbox))
      .filter(c => inRadius(c, options.center, options.radiusM))
      .map(c => ({
        ...c,
        geometry:{ type:'Polygon', coordinates:[buildViewshedPolygon(c)] }
      }))
      .slice(0, Math.max(1, Math.min(250, Number(options.maxRecords) || 100)));
    health = {
      ...health, status:cameras.length ? 'PARTIAL' : 'UNKNOWN',
      lastSuccessAt:now, lastAttemptAt:now, lastErrorClass:null, lastErrorMessage:null,
      recordCount:raw.length, acceptedCount:cameras.length, rejectedCount:Math.max(0, raw.length-normalized.length)
    };
    return {
      observations:cameras.map(c => ({
        id:c.id, entityType:'camera', source:c.source, sourceReference:c.sourceReference,
        latitude:c.pose.latitude, longitude:c.pose.longitude, altitudeM:c.pose.altitudeM ?? null,
        observedAt:c.health.lastSuccessAt || null, receivedAt:now,
        observationConfidence:c.pose.confidence === 'verified' ? 0.95 : c.pose.confidence === 'estimated' ? 0.7 : 0.35,
        interpretationConfidence:null, operationalConfidence:c.media.available && c.pose.confidence === 'verified' ? 0.8 : 0.5,
        confidence:c.pose.confidence === 'verified' ? 0.95 : c.pose.confidence === 'estimated' ? 0.7 : 0.35,
        geometry:c.geometry, status:c.health.status,
        attributes:{
          name:c.name, pose:c.pose, viewshed:c.viewshed, media:c.media, health:c.health,
          privacy:c.privacy, camera:c
        },
        provenance:c.provenance,
        coverage:{complete:false,bounded:true,queryScope:'public CCTV camera catalog; camera pose is not evidence of active observation'},
        quality:{
          state:c.health.status === 'LIVE' ? 'good' : c.health.status === 'DEGRADED' ? 'degraded' : c.health.status === 'STALE' ? 'stale' : 'unknown',
          freshnessClass:'UNKNOWN',
          reason:c.pose.confidence === 'estimated' ? 'Camera pose is estimated; target visibility is geometry-only.' : 'Camera health and pose are separate from visual content.'
        }
      })),
      health:{...health},
      coverage:{complete:false,bounded:true,queryScope:options.bbox ? 'bbox' : 'catalog'}
    };
  } catch (error) {
    health = {...health,status:'UNAVAILABLE',lastErrorClass:String(error?.failureClass || 'unknown'),lastErrorMessage:String(error?.message || error)};
    return { observations:[], health:{...health}, coverage:{complete:false,bounded:true,queryScope:'cctv-catalog'}, warnings:['cctv_catalog_unavailable'] };
  }
}

async function getNearestCameras(options = {}) {
  const catalog = await getCameraCatalog();
  const target = { latitude:Number(options.latitude), longitude:Number(options.longitude) };
  const ranked = rankNearest(catalog.map(normaliseCamera).filter(Boolean), target, options.limit || 5, options.requireVisible === true);
  return ranked.map(x => ({
    camera:x.camera,
    visible:x.relation.visible,
    reason:x.relation.reason,
    distanceM:x.relation.distanceM,
    bearingDeg:x.relation.bearingDeg,
    angularOffsetDeg:x.relation.angularOffsetDeg ?? null
  }));
}

function getProviderHealth() { return { cctv:{...health} }; }

module.exports = { getCameras, getNearestCameras, getProviderHealth, pointInViewshed };
