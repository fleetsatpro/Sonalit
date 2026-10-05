'use strict';

const fs = require('node:fs/promises');
const COUNTRY_BOXES = require('./cctvCountries.json');

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
const OPENEYE_MAP_PATH = '/catalog/map';

const providerHealth = {
  openeye: { enabled: true, status:'UNKNOWN', lastSuccessAt:null, lastAttemptAt:null, recordCount:0, total:null, free:null, error:null },
  file: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null },
  tfl: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null }
};
const openEyeCache = new Map();
const COUNTRY_NAME_OVERRIDES = {
  CI:"Côte d'Ivoire",
  CD:'Democratic Republic of the Congo',
  CG:'Republic of the Congo',
  CZ:'Czechia',
  MK:'North Macedonia',
  SZ:'Eswatini',
  TL:'Timor-Leste'
};

function getCctvCountries() {
  return Object.entries(COUNTRY_BOXES)
    .map(([code, value]) => ({
      code,
      name:COUNTRY_NAME_OVERRIDES[code] || value[0],
      bbox:value[1]
    }))
    .sort((a,b) => a.name.localeCompare(b.name));
}

function getCountryBbox(code) {
  const wanted = String(code || '').trim().toUpperCase();
  const row = COUNTRY_BOXES[wanted];
  return row && Array.isArray(row[1]) ? row[1].slice() : null;
}


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

function intersectBboxes(a, b) {
  const left = normalizeBbox(a);
  const right = normalizeBbox(b);
  if (!left || !right) return null;
  const west = Math.max(left[0], right[0]);
  const south = Math.max(left[1], right[1]);
  const east = Math.min(left[2], right[2]);
  const north = Math.min(left[3], right[3]);
  return west < east && south < north ? [west, south, east, north] : null;
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [west, south, east, north] = numbers;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return [west, south, east, north];
}

const IMAGE_URL_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const VIDEO_URL_RE = /\.(?:m3u8|mp4|webm|mov|m4v|og[gv]|mjpg|mjpeg)(?:[?#].*)?$/i;

function classifyViewMediaType(view, url, render) {
  const candidate = String(url || '');
  const declared = String(view?.url_type || '').toLowerCase().trim();
  // Obvious file extensions win over metadata: a .jpg byte URL must never be
  // advertised or linked as live video just because upstream metadata is stale.
  if (IMAGE_URL_RE.test(candidate)) return 'image';
  if (VIDEO_URL_RE.test(candidate)) return 'video';
  if (declared.includes('mjpeg') || declared.includes('multipart')) return 'mjpeg';
  if (declared.includes('mpegurl') || declared === 'm3u8') return 'video';
  if (declared.includes('video')) return 'video';
  if (declared.includes('image') || /^(?:jpg|jpeg|png|webp|avif|gif)$/.test(declared)) return 'image';
  if (render === 'video') return 'video';
  if (render === 'image') return 'image';
  return 'unknown';
}

function isRenderableMediaType(kind) {
  return kind === 'image' || kind === 'video' || kind === 'mjpeg';
}

function buildPlatformEmbedUrl(url, view, hosted) {
  if (!url || String(view?.url_type || '').toLowerCase().trim() !== 'html') return null;
  if (hosted === 'youtube' || hosted === 'youtube.com') {
    try {
      const parsed = new URL(url);
      let videoId = parsed.searchParams.get('v') || '';
      if (!videoId && parsed.hostname === 'youtu.be') videoId = parsed.pathname.replace(/^\\//, '').split('/')[0] || '';
      if (!videoId && parsed.pathname.startsWith('/live/')) videoId = parsed.pathname.split('/').filter(Boolean)[1] || '';
      if (!videoId && parsed.pathname.startsWith('/embed/')) videoId = parsed.pathname.split('/').filter(Boolean)[1] || '';
      if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) + '?autoplay=1&mute=1&playsinline=1&rel=0';
    } catch (_) {}
  }
  if (hosted === 'twitch' || hosted === 'twitch.tv') {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const channel = parts[0] || '';
      if (/^[A-Za-z0-9_]{2,50}$/.test(channel)) {
        return 'https://player.twitch.tv/?channel=' + encodeURIComponent(channel) + '&parent=sonalit.com&parent=www.sonalit.com&muted=true';
      }
    } catch (_) {}
  }
  return null;
}

function openEyeMedia(row) {
  const view = asRecord(row.view);
  const redistribution = asRecord(row.redistribution);
  const attribution = asRecord(redistribution.attribution);
  const render = String(view.render || 'none').toLowerCase();
  const viewUrl = safeHttpsUrl(view.url || row.preview_url);
  const viewMediaType = classifyViewMediaType(view, view.url || row.preview_url, render);
  const feedKind = String(row.feed_kind || row.feedKind || '').toLowerCase().trim();
  const liveVideo = feedKind === 'live_video' && row.live === true;
  const previewAllowed = redistribution.preview_embed === true;
  const renderablePreview = previewAllowed && Boolean(viewUrl) && isRenderableMediaType(viewMediaType);
  const directoryPageUrl = safeHttpsUrl(row.public_url || '')
    || 'https://openeye.cam/cam/' + encodeURIComponent(String(row.id || ''));
  // A publisher page must be a page. Never promote an image/video byte URL to
  // "OPEN PUBLISHER", even when OpenEye has classified the row as source-only.
  const viewIsHtml = String(view.url_type || '').toLowerCase() === 'html';
  const sourcePageUrl = viewIsHtml
    ? (safeHttpsUrl(view.url) || directoryPageUrl)
    : directoryPageUrl;
  // Source-only media remains a direct browser handoff: Sonalit does not proxy
  // or rehost these bytes. The source URL is kept separate from the publisher page.
  const sourceMediaUrlCandidate = safeHttpsUrl(view.url);
  const sourceMediaUrl = !previewAllowed && isRenderableMediaType(viewMediaType)
    ? sourceMediaUrlCandidate
    : null;
  const sourceMediaType = sourceMediaUrl ? viewMediaType : null;
  const sourceMediaPlayable = Boolean(
    sourceMediaUrl &&
    (sourceMediaType === 'video' || sourceMediaType === 'mjpeg') &&
    (
      redistribution.frame_reuse === 'fetch-from-source' ||
      redistribution.preview_embed === true
    )
  );
  const hosted = String(view.hosted || '').toLowerCase().trim();
  const platformEmbedUrl = buildPlatformEmbedUrl(viewUrl, view, hosted);
  const kind = renderablePreview ? viewMediaType : (platformEmbedUrl ? 'video-platform' : 'synthetic');
  return {
    kind,
    url: renderablePreview ? viewUrl : null,
    frameUrl: renderablePreview && viewMediaType === 'image' ? viewUrl : null,
    previewUrl: renderablePreview && viewMediaType === 'image' ? viewUrl : null,
    sourcePageUrl,
    sourceMediaUrl,
    sourceMediaType,
    sourceMediaPlayable,
    sourceMediaHost:sourceMediaUrl ? String(view.hosted || 'source').toLowerCase() : null,
    platformEmbedUrl,
    feedKind,
    liveVideo,
    direct: renderablePreview,
    publicSource:true,
    redistribution,
    attributionName:String(attribution.name || '').trim() || null,
    attributionUrl:String(attribution.url || '').trim() || null,
    refreshIntervalMs:Number.isFinite(Number(row.frame_interval_s))
      ? Math.max(15000, Number(row.frame_interval_s) * 1000)
      : 60000
  };
}

async function loadOpenEyeMapFallback(options = {}) {
  const requestedBbox = normalizeBbox(options.bbox);
  const countryBbox = getCountryBbox(options.countryCode);
  const bbox = countryBbox
    ? (requestedBbox ? intersectBboxes(requestedBbox, countryBbox) : countryBbox)
    : (requestedBbox || bboxFromCenter(options.center, options.radiusM));
  if (!bbox) return [];
  const limit = Math.max(1, Math.min(OPENEYE_MAX_LIMIT, Number(options.maxRecords) || 100));
  const params = new URLSearchParams({ bbox:bbox.join(','), limit:String(limit), zoom:'12' });
  try {
    const fetchMap = async (zoom) => {
      const request = new URLSearchParams(params);
      request.set('zoom', String(zoom));
      const response = await fetch(OPENEYE_BASE_URL + OPENEYE_MAP_PATH + '?' + request.toString(), {
        headers:{ Accept:'application/json' }
      });
      if (!response.ok) return null;
      return response.json();
    };
    let payload = await fetchMap(12);
    if (payload?.mode === 'clusters') payload = await fetchMap(14);
    if (!payload) return [];
    const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.cameras) ? payload.cameras : [];
    return rows.map((row, index) => {
      const id = String(row?.id || row?.handle || 'map-' + index);
      const latitude = Number(row?.lat), longitude = Number(row?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return normalizeRecord({ id:'openeye:' + id, name:row?.title || row?.handle || id, latitude, longitude,
        source:'openeye-public', sourceReference:String(row?.handle || row?.id || index), pose:{ confidence:'unknown' }, viewshed:{ horizontalFovDeg:90, maxRangeM:5000 },
        media:{ kind:'synthetic', url:null, frameUrl:null, previewUrl:null, sourcePageUrl:'https://openeye.cam/cam/' + encodeURIComponent(id), direct:false, publicSource:true, feedKind:null, liveVideo:false },
        health:{ status:'UNKNOWN', reason:'OpenEye map index record; detailed camera health is resolved when opened.' },
        provenance:{ sourceName:'OpenEye public camera directory', sourceUrl:'https://openeye.cam/', attribution:'OpenEye public camera directory', attributionUrl:'https://openeye.cam/', observationType:'public_camera_directory', sourceReference:String(row?.handle || row?.id || index) },
        attributes:{ provider:'OpenEye', providerCameraId:row?.id || null, handle:row?.handle || null, category:row?.category || 'other', catalogClass:'public-camera-map-index', sourcePageUrl:'https://openeye.cam/cam/' + encodeURIComponent(id) }
      }, index);
    }).filter(Boolean);
  } catch (_) { return []; }
}

async function loadOpenEyeCatalog(options = {}) {
  const enabled = String(process.env.CCTV_ENABLE_OPENEYE || '1') !== '0';
  providerHealth.openeye.enabled = enabled;
  if (!enabled) {
    providerHealth.openeye.status = 'DISABLED';
    return [];
  }

  const requestedBbox = normalizeBbox(options.bbox);
  const countryBbox = getCountryBbox(options.countryCode);
  const bbox = countryBbox
    ? (requestedBbox ? intersectBboxes(requestedBbox, countryBbox) : countryBbox)
    : (requestedBbox || bboxFromCenter(options.center, options.radiusM));
  if (countryBbox && requestedBbox && !bbox) return [];
  const limit = Math.max(1, Math.min(OPENEYE_MAX_LIMIT, Number(options.maxRecords) || 100));
  const key = JSON.stringify({ bbox, countryCode:String(options.countryCode || '').toUpperCase() || null, center:options.center || null, radiusM:Number(options.radiusM) || null, limit });
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
  // Do not request embeddable-only rows: source-only public observations
  // are still legitimate camera pins, with their media handoff kept separate.
  params.set('is_free', '1');
  params.set('embeddable', '1');
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
    // A camera observation and a camera image are separate capabilities.
    // OpenEye documents source-only cameras as valid map/catalog records even
    // when the imagery cannot be embedded. Keep free public camera geometry in
    // the observation layer; media redistribution is enforced by openEyeMedia().
    const eligibleRows = rows.filter(row => {
      const latitude = Number(row?.lat);
      const longitude = Number(row?.lon);
      return Boolean(row?.id) &&
        row?.is_free !== false &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 &&
        longitude >= -180 && longitude <= 180;
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
    const resolved = normalized.length ? normalized : await loadOpenEyeMapFallback(options);
    providerHealth.openeye.recordCount = resolved.length;
    providerHealth.openeye.free = Number.isFinite(Number(payload.free)) ? Number(payload.free) : resolved.length;
    openEyeCache.set(key, { rows:resolved, expiresAt:Date.now() + OPENEYE_CACHE_TTL_MS });
    return resolved;
  } catch (error) {
    const fallbackRows = await loadOpenEyeMapFallback(options);
    providerHealth.openeye = {
      ...providerHealth.openeye,
      status:fallbackRows.length ? 'DEGRADED' : 'UNAVAILABLE',
      lastAttemptAt:attempt,
      recordCount:fallbackRows.length,
      free:fallbackRows.length,
      error:String(error?.message || error)
    };
    if (fallbackRows.length) {
      openEyeCache.set(key, { rows:fallbackRows, expiresAt:Date.now() + OPENEYE_CACHE_TTL_MS });
    }
    return fallbackRows;
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
      kind: ['image','video','mjpeg','video-platform','synthetic'].includes(String(raw.media?.kind || raw.mediaKind)) ? String(raw.media?.kind || raw.mediaKind) : (mediaUrl ? 'video' : 'synthetic'),
      url:mediaUrl ? String(mediaUrl) : null,
      frameUrl:raw.media?.frameUrl ? String(raw.media.frameUrl) : null,
      previewUrl:raw.media?.previewUrl ? String(raw.media.previewUrl) : null,
      sourcePageUrl:raw.media?.sourcePageUrl ? String(raw.media.sourcePageUrl) : null,
      sourceMediaUrl:raw.media?.sourceMediaUrl ? String(raw.media.sourceMediaUrl) : null,
      sourceMediaType:raw.media?.sourceMediaType ? String(raw.media.sourceMediaType) : null,
      sourceMediaPlayable:Boolean(raw.media?.sourceMediaPlayable),
      feedKind:raw.media?.feedKind ? String(raw.media.feedKind) : null,
      liveVideo:Boolean(raw.media?.liveVideo),
      platformEmbedUrl:raw.media?.platformEmbedUrl ? String(raw.media.platformEmbedUrl) : null,
      sourceMediaHost:raw.media?.sourceMediaHost ? String(raw.media.sourceMediaHost) : null,
      direct:Boolean(raw.media?.direct),
      available:Boolean(mediaUrl) || ['synthetic','video-platform'].includes(String(raw.media?.kind || raw.mediaKind)),
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

module.exports = { SAMPLE_CAMERAS, normalizeRecord, classifyViewMediaType, openEyeMedia, loadFileCatalog, loadTflCatalog, loadOpenEyeCatalog, loadOpenEyeCamera, getCameraById, getCameraCatalog, getCameraCatalogHealth, getCctvCountries, getCountryBbox, clearOpenEyeCache };
