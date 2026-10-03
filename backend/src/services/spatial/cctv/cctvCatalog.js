'use strict';

const fs = require('node:fs/promises');

const SAMPLE_CAMERAS = [
  { id:'sample-ke-nbo-01', name:'Kenya corridor sample 01', corridor:'NBO-MSA', latitude:-1.286389, longitude:36.817223, headingDeg:110, horizontalFovDeg:80, maxRangeM:3000 },
  { id:'sample-ke-nbo-02', name:'Kenya corridor sample 02', corridor:'NBO-MSA', latitude:-1.292066, longitude:36.821946, headingDeg:275, horizontalFovDeg:90, maxRangeM:3000 },
  { id:'sample-ke-nbo-03', name:'Kenya corridor sample 03', corridor:'NBO-MSA', latitude:-1.301417, longitude:36.789109, headingDeg:35, horizontalFovDeg:75, maxRangeM:3500 },
  { id:'sample-ke-nbo-04', name:'Kenya corridor sample 04', corridor:'NBO-KGL', latitude:-1.267629, longitude:36.810769, headingDeg:195, horizontalFovDeg:85, maxRangeM:2500 },
  { id:'sample-ke-nbo-05', name:'Kenya corridor sample 05', corridor:'NBO-KGL', latitude:-1.251962, longitude:36.848725, headingDeg:320, horizontalFovDeg:85, maxRangeM:2500 },
].map((x) => ({
  id:x.id, entityType:'camera', source:'sonalit-cctv-sample', sourceReference:x.id,
  name:x.name, pose:{ latitude:x.latitude, longitude:x.longitude, altitudeM:null, headingDeg:x.headingDeg, pitchDeg:null, rollDeg:null, confidence:'estimated' },
  viewshed:{ horizontalFovDeg:x.horizontalFovDeg, verticalFovDeg:null, maxRangeM:x.maxRangeM, minRangeM:0 },
  media:{ kind:'synthetic', url:null, frameUrl:null, available:true, publicSource:false },
  health:{ status:'UNKNOWN', reason:'Development sample; no operational feed asserted.' },
  provenance:{
    sourceName:'Sonalit CCTV sample catalog',
    observationType:'development_sample',
    sourceReference:x.id,
    attribution:'Sonalit — sample geometry only'
  },
  privacy:{ plateTracking:false, personTracking:false, faceRecognition:false },
  attributes:{
    name:x.name, corridor:x.corridor, catalogClass:'sample',
    operational:false, poseStatus:'estimated', mediaStatus:'synthetic-only'
  }
}));

const OPENEYE_BASE_URL = 'https://api.openeye.cam/v1';
const OPENEYE_CACHE_TTL_MS = 45_000;
const OPENEYE_MAX_LIMIT = 250;

const providerHealth = {
  openeye: { enabled: true, status:'UNKNOWN', lastSuccessAt:null, lastAttemptAt:null, recordCount:0, total:null, free:null, error:null },
  file: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null },
  tfl: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null }
};
const openEyeCache = new Map();

function clearOpenEyeCache() {
  openEyeCache.clear();
}



function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function safeHttpsUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
}

function bboxFromCenter(center, radiusM) {
  if (!center) return null;
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  const radius = Math.max(1, Number(radiusM) || 25000);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const latDelta = radius / 111320;
  const cos = Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  const lonDelta = radius / (111320 * cos);
  return [
    Math.max(-180, longitude - lonDelta),
    Math.max(-90, latitude - latDelta),
    Math.min(180, longitude + lonDelta),
    Math.min(90, latitude + latDelta)
  ];
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [west, south, east, north] = numbers;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return [west, south, east, north];
}

function openEyeMedia(row) {
  const view = asRecord(row.view);
  const redistribution = asRecord(row.redistribution);
  const attribution = asRecord(redistribution.attribution);
  const render = String(view.render || 'none').toLowerCase();
  const previewAllowed = redistribution.preview_embed === true;
  const viewUrl = safeHttpsUrl(view.url || row.preview_url);
  const renderableImage = render === 'image' && previewAllowed && Boolean(viewUrl);
  const sourcePageUrl = safeHttpsUrl(
    render === 'link' ? view.url :
    row.public_url ?? row.url ?? ''
  );
  const publicViewer = sourcePageUrl || viewUrl;
  return {
    kind: renderableImage ? 'image' : 'synthetic',
    url: renderableImage ? viewUrl : null,
    frameUrl: renderableImage ? viewUrl : null,
    previewUrl: renderableImage ? viewUrl : null,
    sourcePageUrl,
    direct: renderableImage,
    publicSource: true,
    redistribution,
    attributionName: String(attribution.name || '').trim() || null,
    attributionUrl: String(attribution.url || '').trim() || null,
    refreshIntervalMs: Number.isFinite(Number(row.frame_interval_s))
      ? Math.max(15000, Number(row.frame_interval_s) * 1000)
      : 60000
  };
}

async function loadOpenEyeCatalog(options = {}) {
  const enabled = String(process.env.CCTV_ENABLE_OPENEYE || '1') !== '0';
  providerHealth.openeye.enabled = enabled;
  if (!enabled) {
    providerHealth.openeye.status = 'DISABLED';
    return [];
  }

  const bbox = normalizeBbox(options.bbox) || bboxFromCenter(options.center, options.radiusM);
  const limit = Math.max(1, Math.min(OPENEYE_MAX_LIMIT, Number(options.maxRecords) || 100));
  const key = JSON.stringify({ bbox, center:options.center || null, radiusM:Number(options.radiusM) || null, limit });
  const cached = openEyeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const params = new URLSearchParams();
  if (options.center) {
    const lat = Number(options.center.latitude);
    const lon = Number(options.center.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      params.set('near', lat + ',' + lon);
      params.set('radius_km', String(Math.max(1, (Number(options.radiusM) || 25000) / 1000)));
    }
  } else if (bbox) {
    params.set('bbox', bbox.join(','));
  }
  params.set('embeddable', '1');
  params.set('is_free', '1');
  params.set('limit', String(limit));
  params.set('sort', 'fresh');

  const attempt = new Date().toISOString();
  providerHealth.openeye.lastAttemptAt = attempt;
  try {
    const response = await fetch(OPENEYE_BASE_URL + '/catalog?' + params.toString(), {
      headers:{ Accept:'application/json' }
    });
    if (!response.ok) {
      throw Object.assign(new Error('OpenEye catalog request failed: ' + response.status), {
        failureClass: response.status === 429 ? 'rate_limited' : 'http_error'
      });
    }
    const payload = await response.json();
    const rows = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.cameras)
        ? payload.cameras
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
    const eligibleRows = rows.filter(row => {
      const view = asRecord(row?.view);
      const redistribution = asRecord(row?.redistribution);
      const renderMode = String(view.render || '').toLowerCase();
      const previewAllowed = redistribution.preview_embed === true;
      const previewUrl = safeHttpsUrl(view.url || row?.preview_url);
      const publicViewerUrl = renderMode === 'link'
        ? safeHttpsUrl(view.url || row?.public_url || row?.url)
        : null;
      return (renderMode === 'image' && previewAllowed && Boolean(previewUrl)) ||
        (renderMode === 'link' && Boolean(publicViewerUrl));
    });
    const normalized = eligibleRows.map((row, index) => {
      const media = openEyeMedia(row);
      const live = row.live === true;
      const age = Number(row.last_frame_age_s);
      const category = String(row.category || 'other');
      return normalizeRecord({
        id:'openeye:' + String(row.id || row.handle || index),
        name:row.title || row.handle || row.id || ('OpenEye camera ' + index),
        latitude:row.lat,
        longitude:row.lon,
        source:'openeye-public',
        sourceReference:String(row.handle || row.id || index),
        headingDeg:row.heading,
        pose:{ confidence:'unknown' },
        viewshed:{ horizontalFovDeg:90, maxRangeM:5000 },
        media,
        health:{
          status:live ? 'LIVE' : (age > 86400 ? 'STALE' : 'UNKNOWN'),
          lastSuccessAt:row.frame_ts ? new Date(Number(row.frame_ts)).toISOString() : null,
          reason:live ? null : 'OpenEye directory reports no current frame.'
        },
        provenance:{
          sourceName:media.attributionName || 'OpenEye public camera directory',
          sourceUrl:media.attributionUrl || 'https://openeye.cam/',
          attribution:media.attributionName || 'OpenEye public camera directory',
          attributionUrl:media.attributionUrl || 'https://openeye.cam/',
          observationType:'public_camera_directory',
          license:null,
          sourceReference:String(row.handle || row.id || index)
        },
        attributes:{
          provider:'OpenEye',
          providerCameraId:row.id || null,
          handle:row.handle || null,
          category,
          live,
          lastFrameAgeS:Number.isFinite(age) ? age : null,
          frameIntervalS:Number.isFinite(Number(row.frame_interval_s)) ? Number(row.frame_interval_s) : null,
          frameTimestamp:row.frame_ts || null,
          previewState:row.preview_refresh?.status || null,
          viewRender:String(row.view?.render || 'none'),
          viewHosted:String(row.view?.hosted || 'unknown'),
          sourcePageUrl:media.sourcePageUrl,
          attributionName:media.attributionName,
          attributionUrl:media.attributionUrl,
          redistribution:media.redistribution,
          catalogClass:'public-live-directory'
        }
      }, index);
      if (!normalized) return null;
      return normalized;
    }).filter(Boolean);

    providerHealth.openeye = {
      ...providerHealth.openeye,
      enabled:true,
      status:'LIVE',
      lastSuccessAt:new Date().toISOString(),
      lastAttemptAt:attempt,
      recordCount:normalized.length,
      total:Number.isFinite(Number(payload.total)) ? Number(payload.total) : null,
      free:Number.isFinite(Number(payload.free)) ? Number(payload.free) : null,
      error:null
    };
    openEyeCache.set(key, { rows:normalized, expiresAt:Date.now() + OPENEYE_CACHE_TTL_MS });
    return normalized;
  } catch (error) {
    providerHealth.openeye = {
      ...providerHealth.openeye,
      status:'UNAVAILABLE',
      lastAttemptAt:attempt,
      error:String(error?.message || error)
    };
    return [];
  }
}

function normalizeRecord(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const latitude = Number(raw.latitude ?? raw.lat);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const id = String(raw.id ?? raw.cameraId ?? ('catalog-camera-' + index));
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
      kind: ['image','video','mjpeg','synthetic'].includes(String(raw.media?.kind || raw.mediaKind)) ? String(raw.media?.kind || raw.mediaKind) : (mediaUrl ? 'video' : 'synthetic'),
      url:mediaUrl ? String(mediaUrl) : null,
      frameUrl:raw.media?.frameUrl ? String(raw.media.frameUrl) : null,
      previewUrl:raw.media?.previewUrl ? String(raw.media.previewUrl) : null,
      sourcePageUrl:raw.media?.sourcePageUrl ? String(raw.media.sourcePageUrl) : null,
      direct:Boolean(raw.media?.direct),
      available:Boolean(mediaUrl) || String(raw.media?.kind) === 'synthetic',
      publicSource:Boolean(raw.media?.publicSource ?? raw.publicSource ?? Boolean(mediaUrl)),
      refreshIntervalMs:Number.isFinite(Number(raw.media?.refreshIntervalMs)) ? Number(raw.media.refreshIntervalMs) : null,
      redistribution:raw.media?.redistribution ?? null,
      attributionName:raw.media?.attributionName ?? null,
      attributionUrl:raw.media?.attributionUrl ?? null
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
      attributionUrl:raw.provenance?.attributionUrl || null,
      observationType:raw.provenance?.observationType || 'public_camera',
      sourceReference:String(raw.provenance?.sourceReference || id)
    },
    privacy:{ plateTracking:false, personTracking:false, faceRecognition:false },
    attributes:{ ...(raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {}), name:String(raw.name || raw.commonName || id) }
  };
}

async function loadFileCatalog() {
  const location = String(process.env.CCTV_CATALOG_FILE || '').trim();
  providerHealth.file.enabled = Boolean(location);
  if (!location) {
    providerHealth.file.status = 'DISABLED';
    return [];
  }
  try {
    const payload = JSON.parse(await fs.readFile(location, 'utf8'));
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.cameras) ? payload.cameras : [];
    const normalized = rows.map(normalizeRecord).filter(Boolean);
    providerHealth.file = { ...providerHealth.file, enabled:true, status:'LIVE', lastSuccessAt:new Date().toISOString(), recordCount:normalized.length, error:null };
    return normalized;
  } catch (error) {
    providerHealth.file = { ...providerHealth.file, status:'UNAVAILABLE', error:String(error?.message || error) };
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
    kind:video ? 'video' : frame ? 'image' : 'synthetic',
    url:(video || frame)?.value || null,
    frameUrl:frame?.value || null
  };
}

async function loadTflCatalog() {
  providerHealth.tfl.enabled = String(process.env.CCTV_ENABLE_TFL || '') === '1';
  if (!providerHealth.tfl.enabled) {
    providerHealth.tfl.status = 'DISABLED';
    return [];
  }
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

async function loadOpenEyeCamera(id) {
  const enabled = String(process.env.CCTV_ENABLE_OPENEYE || '1') !== '0';
  if (!enabled || !id) return null;
  try {
    const response = await fetch(OPENEYE_BASE_URL + '/catalog/' + encodeURIComponent(String(id)), {
      headers:{ Accept:'application/json' }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const row = payload?.item || payload?.data || payload;
    if (!row || typeof row !== 'object') return null;
    const media = openEyeMedia(row);
    if (!media.direct && !media.sourcePageUrl) return null;
    const live = row.live === true;
    const age = Number(row.last_frame_age_s);
    const normalized = normalizeRecord({
      id:'openeye:' + String(row.id || id),
      name:row.title || row.handle || row.id || id,
      latitude:row.lat,
      longitude:row.lon,
      source:'openeye-public',
      sourceReference:String(row.handle || row.id || id),
      headingDeg:row.heading,
      pose:{ confidence:'unknown' },
      viewshed:{ horizontalFovDeg:90, maxRangeM:5000 },
      media,
      health:{
        status:live ? 'LIVE' : (age > 86400 ? 'STALE' : 'UNKNOWN'),
        lastSuccessAt:row.frame_ts ? new Date(Number(row.frame_ts)).toISOString() : null,
        reason:live ? null : 'OpenEye directory reports no current frame.'
      },
      provenance:{
        sourceName:media.attributionName || 'OpenEye public camera directory',
        sourceUrl:media.attributionUrl || 'https://openeye.cam/',
        attribution:media.attributionName || 'OpenEye public camera directory',
        attributionUrl:media.attributionUrl || 'https://openeye.cam/',
        observationType:'public_camera_directory',
        license:null,
        sourceReference:String(row.handle || row.id || id)
      },
      attributes:{
        provider:'OpenEye',
        providerCameraId:row.id || id,
        handle:row.handle || null,
        category:row.category || 'other',
        live,
        lastFrameAgeS:Number.isFinite(age) ? age : null,
        frameIntervalS:Number.isFinite(Number(row.frame_interval_s)) ? Number(row.frame_interval_s) : null,
        frameTimestamp:row.frame_ts || null,
        previewState:row.preview_refresh?.status || null,
        viewRender:String(row.view?.render || 'none'),
        viewHosted:String(row.view?.hosted || 'unknown'),
        sourcePageUrl:media.sourcePageUrl,
        attributionName:media.attributionName,
        attributionUrl:media.attributionUrl,
        redistribution:media.redistribution,
        catalogClass:'public-live-directory'
      }
    }, 0);
    return normalized || null;
  } catch (_) {
    return null;
  }
}

async function getCameraById(id) {
  const wanted = String(id || '');
  if (!wanted) return null;
  const includeSamples = String(process.env.CCTV_INCLUDE_SAMPLES || '') === '1';
  const [openEyeRows, fileRows, tflRows] = await Promise.all([
    wanted.startsWith('openeye:') ? loadOpenEyeCamera(wanted.slice('openeye:'.length)) : Promise.resolve(null),
    loadFileCatalog(),
    loadTflCatalog().catch(() => [])
  ]);
  if (openEyeRows) return openEyeRows;
  const all = fileRows.concat(tflRows, includeSamples ? SAMPLE_CAMERAS : []);
  return all.find(row => String(row.id) === wanted) || null;
}

async function getCameraCatalog(options = {}) {
  const [openEyeRows, fileRows, tflRows] = await Promise.all([
    loadOpenEyeCatalog(options),
    loadFileCatalog(),
    loadTflCatalog().catch(() => [])
  ]);
  const includeSamples = String(process.env.CCTV_INCLUDE_SAMPLES || '') === '1';
  const all = openEyeRows.concat(fileRows, tflRows, includeSamples ? SAMPLE_CAMERAS : []);
  const unique = new Map();
  for (const row of all) unique.set(String(row.id), row);
  return Array.from(unique.values());
}

function getCameraCatalogHealth() {
  return {
    openeye:{...providerHealth.openeye},
    file:{...providerHealth.file},
    tfl:{...providerHealth.tfl},
  };
}

module.exports = { SAMPLE_CAMERAS, normalizeRecord, loadFileCatalog, loadTflCatalog, loadOpenEyeCatalog, loadOpenEyeCamera, getCameraById, getCameraCatalog, getCameraCatalogHealth, clearOpenEyeCache };
