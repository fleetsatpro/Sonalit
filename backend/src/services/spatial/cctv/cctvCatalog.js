'use strict';

const fs = require('node:fs/promises');

function normalizeRecord(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const latitude = Number(raw.latitude ?? raw.lat);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const sourceId = raw.id ?? raw.cameraId;
  if (sourceId == null || String(sourceId).trim() === '') return null;
  const id = String(sourceId);
  const mediaUrl = raw.media?.url ?? raw.mediaUrl ?? raw.url ?? raw.videoUrl ?? raw.imageUrl ?? null;
  const heading = raw.pose?.headingDeg ?? raw.headingDeg;
  const fov = Number(raw.viewshed?.horizontalFovDeg ?? raw.horizontalFovDeg ?? 90);
  const range = Number(raw.viewshed?.maxRangeM ?? raw.maxRangeM ?? 5000);
  return {
    id, entityType:'camera', source:String(raw.source || 'file-catalog'), sourceReference:String(raw.sourceReference || id),
    name:String(raw.name || raw.commonName || id),
    pose:{
      latitude, longitude,
      altitudeM: raw.pose?.altitudeM == null ? null : Number(raw.pose.altitudeM),
      headingDeg: heading == null ? null : Number(heading),
      pitchDeg: raw.pose?.pitchDeg == null ? null : Number(raw.pose.pitchDeg),
      rollDeg: raw.pose?.rollDeg == null ? null : Number(raw.pose.rollDeg),
      confidence: raw.pose?.confidence === 'verified' ? 'verified' : raw.pose?.confidence === 'estimated' ? 'estimated' : 'unknown'
    },
    viewshed:{
      horizontalFovDeg:Number.isFinite(fov) ? Math.max(1, Math.min(180, fov)) : 90,
      verticalFovDeg:raw.viewshed?.verticalFovDeg == null ? null : Number(raw.viewshed.verticalFovDeg),
      maxRangeM:Number.isFinite(range) ? Math.max(1, Math.min(50000, range)) : 5000,
      minRangeM:Number(raw.viewshed?.minRangeM || 0)
    },
    media:{
      kind: ['image','video','mjpeg'].includes(String(raw.media?.kind || raw.mediaKind)) ? String(raw.media?.kind || raw.mediaKind) : (mediaUrl ? 'video' : 'none'),
      url:mediaUrl ? String(mediaUrl) : null,
      frameUrl:raw.media?.frameUrl ? String(raw.media.frameUrl) : null,
      available:Boolean(mediaUrl),
      publicSource:Boolean(raw.media?.publicSource ?? raw.publicSource ?? Boolean(mediaUrl))
    },
    health:{
      status:['LIVE','DEGRADED','STALE','UNAVAILABLE','UNKNOWN'].includes(String(raw.health?.status)) ? String(raw.health.status) : 'UNKNOWN',
      lastSuccessAt:raw.health?.lastSuccessAt || null,
      lastAttemptAt:raw.health?.lastAttemptAt || null,
      reason:raw.health?.reason || null
    },
    provenance:{
      sourceName:String(raw.provenance?.sourceName || raw.sourceName || raw.source || 'CCTV catalog'),
      sourceUrl:raw.provenance?.sourceUrl || null,
      license:raw.provenance?.license || null,
      attribution:raw.provenance?.attribution || null,
      observationType:raw.provenance?.observationType || 'public_camera',
      sourceReference:String(raw.provenance?.sourceReference || id)
    },
    privacy:{ plateTracking:false, personTracking:false, faceRecognition:false },
    attributes:{ ...(raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {}), name:String(raw.name || raw.commonName || id) }
  };
}

async function loadFileCatalog() {
  const location = String(process.env.CCTV_CATALOG_FILE || '').trim();
  if (!location) return [];
  try {
    const payload = JSON.parse(await fs.readFile(location, 'utf8'));
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.cameras) ? payload.cameras : [];
    return rows.map(normalizeRecord).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function extractTflMedia(properties) {
  const candidates = Array.isArray(properties) ? properties : [];
  const urls = candidates.map(p => ({ key:String(p?.key || '').toLowerCase(), value:String(p?.value || '') }))
    .filter(x => /^https?:\/\//i.test(x.value));
  const frame = urls.find(x => /image|jpeg|jpg|still|snapshot/.test(x.key));
  const video = urls.find(x => /video|stream|mp4|m3u8|clip/.test(x.key));
  return {
    kind:video ? 'video' : frame ? 'image' : 'none',
    url:(video || frame)?.value || null,
    frameUrl:frame?.value || null
  };
}

async function loadTflCatalog() {
  if (String(process.env.CCTV_ENABLE_TFL || '') !== '1') return [];
  const url = new URL('https://api.tfl.gov.uk/Place/Type/JamCam');
  if (process.env.TFL_APP_ID) url.searchParams.set('app_id', process.env.TFL_APP_ID);
  if (process.env.TFL_APP_KEY) url.searchParams.set('app_key', process.env.TFL_APP_KEY);
  const response = await fetch(url, { headers:{Accept:'application/json'} });
  if (!response.ok) throw Object.assign(new Error('TfL CCTV catalog request failed: ' + response.status), { failureClass: response.status === 429 ? 'rate_limited' : 'http_error' });
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Object.assign(new Error('TfL CCTV catalog response was not an array'), { failureClass:'malformed' });
  return rows.map((row, i) => {
    const media = extractTflMedia(row.additionalProperties);
    return normalizeRecord({
      id:'tfl-jamcam:' + String(row.id || row.commonName || i),
      name:row.commonName || row.id || 'TfL JamCam',
      latitude:row.lat, longitude:row.lon,
      source:'tfl-jamcam', sourceReference:String(row.id || i),
      headingDeg:null,
      viewshed:{horizontalFovDeg:90,maxRangeM:5000},
      media:{...media, publicSource:true},
      pose:{confidence:'unknown'},
      health:{status:'UNKNOWN',reason:'Catalog metadata loaded; feed health is not inferred from catalog response.'},
      provenance:{
        sourceName:'Transport for London Unified API',
        sourceUrl:'https://api.tfl.gov.uk/',
        attribution:'Transport for London',
        observationType:'public_traffic_camera',
        sourceReference:String(row.id || i)
      },
      attributes:{commonName:row.commonName || null, provider:'TfL', catalogClass:'live-catalog'}
    }, i);
  }).filter(Boolean);
}

async function getCameraCatalog() {
  const [fileRows, tflRows] = await Promise.all([loadFileCatalog(), loadTflCatalog().catch(() => [])]);
  const all = fileRows.concat(tflRows);
  const unique = new Map();
  for (const row of all) unique.set(String(row.id), row);
  return Array.from(unique.values());
}

module.exports = { normalizeRecord, loadFileCatalog, loadTflCatalog, getCameraCatalog };
