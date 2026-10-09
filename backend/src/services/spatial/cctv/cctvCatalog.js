'use strict';

const fs = require('node:fs/promises');
const COUNTRY_BOXES = require('./cctvCountries.json');
const { loadInsecamCatalog, loadInsecamCameraRecord, clearInsecamCache, getInsecamHealth } = require('./insecamCatalog');

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
const OPENCCTV_BASE_URL = 'https://opencctv.org';
const OPENCCTV_MARKERS_URL = OPENCCTV_BASE_URL + '/api/cameras/markers';
const OPENCCTV_BATCH_URL = OPENCCTV_BASE_URL + '/api/cameras/batch';
const OPENCCTV_LEGACY_URL = OPENCCTV_BASE_URL + '/api/cameras';
const OPENCCTV_CACHE_TTL_MS = 10 * 60_000;
const OPENCCTV_MAX_LIMIT = 250;
const OPENCCTV_BATCH_SIZE = 50;
const OPENCCTV_BATCH_CONCURRENCY = 3;
const OPENCCTV_MARKERS_MAX_BYTES = 12 * 1024 * 1024;
const CCTV_DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CALTRANS_CCTV_URL = 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query';
const CALTRANS_CACHE_TTL_MS = 60_000;
const CALTRANS_MAX_LIMIT = 250;
const CALTRANS_BBOX = [-124.48, 32.45, -114.13, 42.10];

const providerHealth = {
  openeye: { enabled: true, status:'UNKNOWN', lastSuccessAt:null, lastAttemptAt:null, recordCount:0, total:null, free:null, error:null },
  opencctv: { enabled:true, status:'UNKNOWN', lastSuccessAt:null, lastAttemptAt:null, recordCount:0, liveVideoCount:0, error:null },
  caltrans: { enabled:true, status:'UNKNOWN', lastAttemptAt:null, recordCount:0, liveVideoCount:0, error:null },
  insecam: { enabled:true, status:'UNKNOWN', lastAttemptAt:null, lastSuccessAt:null, recordCount:0, liveSnapshotCount:0, rejectedCount:0, error:null },
  file: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null },
  tfl: { enabled:false, status:'UNKNOWN', lastSuccessAt:null, recordCount:0, error:null }
};
const openEyeCache = new Map();
const openCctvCache = new Map();
const caltransCache = new Map();
const openCctvDetailCache = new Map();
const openCctvFrameSourceCache = new Map();
const caltransDetailCache = new Map();
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

function countryNameMatchesCode(value, code) {
  const raw = String(value || '').trim();
  const wanted = String(code || '').trim().toUpperCase();
  if (!raw || !wanted) return true;
  if (raw.toUpperCase() === wanted) return true;
  const canonical = String(COUNTRY_NAME_OVERRIDES[wanted] || COUNTRY_BOXES[wanted]?.[0] || '').trim();
  return canonical ? raw.toLowerCase() === canonical.toLowerCase() : true;
}


function clearOpenEyeCache() {
  openEyeCache.clear();
  openCctvCache.clear();
  caltransCache.clear();
  openCctvDetailCache.clear();
  openCctvFrameSourceCache.clear();
  caltransDetailCache.clear();
  clearInsecamCache();
}



function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function safeHttpUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function safeHttpsUrl(value) {
  const candidate = safeHttpUrl(value);
  if (!candidate) return null;
  try { return new URL(candidate).protocol === 'https:' ? candidate : null; }
  catch (_) { return null; }
}

function openCctvRequestHeaders() {
  return {
    Accept:'application/json',
    Referer:'https://opencctv.org/',
    'User-Agent':'Sonalit-CCTV/1.0 (+https://sonalit.com)'
  };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 20_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal:controller.signal,
      headers:{ ...openCctvRequestHeaders(), ...(options.headers || {}) }
    });
    if (!response.ok) throw Object.assign(new Error('OpenCCTV request failed: ' + response.status), {
      failureClass:response.status === 429 ? 'rate_limited' : 'http_error',
      status:response.status
    });
    const bytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(bytes) && bytes > OPENCCTV_MARKERS_MAX_BYTES) {
      throw Object.assign(new Error('OpenCCTV response exceeds size limit'), { failureClass:'invalid_data' });
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function sampleOpenCctvIds(ids, cap) {
  if (!Array.isArray(ids)) return [];
  const wanted = Math.max(1, Math.min(OPENCCTV_MAX_LIMIT, Number(cap) || 100));
  if (ids.length <= wanted) return ids.slice();
  const stride = ids.length / wanted;
  const out = [];
  for (let i = 0; out.length < wanted && Math.floor(i) < ids.length; i += stride) {
    out.push(ids[Math.floor(i)]);
  }
  return out;
}

async function fetchOpenCctvMarkers() {
  const payload = await fetchJsonWithTimeout(OPENCCTV_MARKERS_URL, { timeoutMs:30_000 });
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  const lats = Array.isArray(payload?.lats) ? payload.lats : [];
  const lngs = Array.isArray(payload?.lngs) ? payload.lngs : [];
  if (!ids.length || lats.length !== ids.length || lngs.length !== ids.length) {
    throw Object.assign(new Error('OpenCCTV markers payload is malformed'), { failureClass:'malformed' });
  }
  return { ids, lats, lngs };
}

async function fetchOpenCctvBatch(ids) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id)).filter(Boolean))].slice(0, OPENCCTV_BATCH_SIZE);
  if (!uniqueIds.length) return [];
  const payload = await fetchJsonWithTimeout(OPENCCTV_BATCH_URL, {
    method:'POST',
    timeoutMs:20_000,
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ ids:uniqueIds })
  });
  return Array.isArray(payload) ? payload.filter(Boolean) :
    Array.isArray(payload?.items) ? payload.items.filter(Boolean) :
    Array.isArray(payload?.cameras) ? payload.cameras.filter(Boolean) : [];
}

async function mapOpenCctvRecord(row, index = 0) {
  if (!row || row.active === 0 || !row.id) return null;
  const declared = String(row.feed_type || '').toLowerCase().trim();
  const candidateUrl = safeHttpUrl(row.feed_url || row.stream_url || row.video_url || '');
  const kind = openCctvFeedKind(declared, candidateUrl);
  const feedUrl = candidateUrl && kind === 'image' ? candidateUrl : (kind ? safeHttpsUrl(candidateUrl) : null);
  const latitude = Number(row.lat);
  const longitude = Number(row.lng ?? row.lon);
  if (!feedUrl || !kind || !['image','video','mjpeg'].includes(kind) ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const continuousLive = kind === 'video' || kind === 'mjpeg';
  const imageFeed = kind === 'image';
  const id = 'opencctv:' + String(row.id);
  const frameAge = Number(row.last_frame_age_s ?? row.frame_age_s ?? row.preview_age_s);
  const refreshInterval = Number(row.frame_interval_s ?? row.refresh_interval_s ?? row.refresh_seconds);
  const providerLive = row.live === true || row.is_live === true || row.active === 1 || row.active === true;
  const recentlyRefreshed = imageFeed && Number.isFinite(frameAge) &&
    Number.isFinite(refreshInterval) && frameAge >= 0 && frameAge <= Math.max(120, refreshInterval * 2.5);

  const camera = normalizeRecord({
    id,
    name:row.name || row.title || row.city || ('OpenCCTV camera ' + String(row.id)),
    latitude, longitude,
    source:'opencctv-public',
    sourceReference:String(row.id),
    headingDeg:null,
    pose:{ confidence:'unknown' },
    viewshed:{ horizontalFovDeg:90, maxRangeM:5000 },
    media:{
      kind,
      // Raw OpenCCTV image URLs stay server-side. The wall uses /:id/frame.
      url:continuousLive ? feedUrl : null,
      frameUrl:null,
      previewUrl:null,
      sourcePageUrl:'https://opencctv.org/cameras/' + String(row.countryCode || row.country || '').toLowerCase(),
      sourceMediaUrl:null,
      // Preserve the provider's actual stream protocol. OpenCCTV uses a
      // generic "video" media kind for both MP4 and HLS; the player needs the
      // protocol hint to select hls.js instead of treating an HLS manifest as
      // a progressive video file.
      sourceMediaType:declared === 'm3u8' || declared === 'hls'
        ? 'application/vnd.apple.mpegurl'
        : kind,
      sourceMediaPlayable:continuousLive,
      direct:continuousLive,
      available:true,
      publicSource:true,
      feedKind:continuousLive ? 'live_video' : 'live_snapshot',
      liveVideo:continuousLive && providerLive,
      provider:'OpenCCTV',
      providerFrameAvailable:imageFeed,
      providerRefreshIntervalMs:Number.isFinite(refreshInterval) && refreshInterval > 0 ? refreshInterval * 1000 : (imageFeed ? 60_000 : null),
      sourceMediaHost:continuousLive ? new URL(feedUrl).hostname : null,
      refreshIntervalMs:imageFeed ? (Number.isFinite(refreshInterval) && refreshInterval > 0 ? refreshInterval * 1000 : 60_000) : null,
      redistribution:{ provider:'OpenCCTV directory; original public operator source', sourceOnly:continuousLive ? false : true },
      attributionName:'OpenCCTV',
      attributionUrl:'https://opencctv.org/'
    },
    health:{
      status:continuousLive && providerLive ? 'LIVE' : (imageFeed && (providerLive || recentlyRefreshed) ? 'LIVE' : 'UNKNOWN'),
      lastSuccessAt:row.frame_ts ? new Date(Number(row.frame_ts)).toISOString() : null,
      reason:imageFeed
        ? 'OpenCCTV indexes this public image feed as live; the current frame is fetched server-side through Sonalit.'
        : (continuousLive ? 'OpenCCTV indexes this as a continuous public feed.' : null)
    },
    provenance:{
      sourceName:row.source ? 'OpenCCTV / ' + String(row.source) : 'OpenCCTV public camera directory',
      sourceUrl:'https://opencctv.org/',
      attribution:'OpenCCTV public camera directory; original public camera operator',
      attributionUrl:'https://opencctv.org/',
      observationType:'public_camera_directory',
      sourceReference:String(row.id)
    },
    attributes:{
      provider:'OpenCCTV', providerCameraId:String(row.id),
      feedType:String(row.feed_type || ''), operatorSource:row.source || null,
      city:row.city || null, country:row.country || null, live:providerLive,
      lastFrameAgeS:Number.isFinite(frameAge) ? frameAge : null,
      frameIntervalS:Number.isFinite(refreshInterval) ? refreshInterval : null,
      frameTimestamp:row.frame_ts || null,
      feedState:row.feed_state || null,
      duplicateOf:row.duplicate_of || null,
      ignored:row.ignored ?? null,
      cacheBusterBreaksUrl:Boolean(row.cache_buster_breaks_url),
      catalogClass:imageFeed ? 'public-live-snapshot' : 'official-live-directory',
      verification:imageFeed ? 'provider-liveness-indexed; frame fetched through Sonalit gateway' : 'provider-indexed public stream'
    }
  }, index);
  if (!camera) return null;
  if (imageFeed) openCctvFrameSourceCache.set(String(camera.id), { url:feedUrl, expiresAt:Date.now() + CCTV_DETAIL_CACHE_TTL_MS });
  openCctvDetailCache.set(String(camera.id), { camera, expiresAt:Date.now() + CCTV_DETAIL_CACHE_TTL_MS });
  return camera;
}

async function loadOpenCctvCameraFrame(cameraId) {
  const key = 'opencctv:' + String(cameraId || '').trim();
  if (!key || key === 'opencctv:') return null;
  const cached = openCctvFrameSourceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  try {
    const rows = await fetchOpenCctvBatch([String(cameraId)]);
    const camera = await Promise.all(rows.map((row, i) => mapOpenCctvRecord(row, i))).then(items => items.find(Boolean));
    return camera ? (openCctvFrameSourceCache.get(key)?.url || null) : null;
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
      if (!videoId && parsed.hostname === 'youtu.be') videoId = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
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
  const platformEmbedUrl = row.live === true ? buildPlatformEmbedUrl(viewUrl, view, hosted) : null;
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
    feedKind,
    liveVideo,
    platformEmbedUrl,
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
      provider:raw.media?.provider ? String(raw.media.provider) : null,
      providerFrameAvailable:Boolean(raw.media?.providerFrameAvailable),
      providerRefreshIntervalMs:Number.isFinite(Number(raw.media?.providerRefreshIntervalMs)) ? Number(raw.media.providerRefreshIntervalMs) : null,
      sourceMediaHost:raw.media?.sourceMediaHost ? String(raw.media.sourceMediaHost) : null,
      direct:Boolean(raw.media?.direct),
      available:Boolean(mediaUrl) || Boolean(raw.media?.available) || ['synthetic','video-platform'].includes(String(raw.media?.kind || raw.mediaKind)),
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


function providerEnabled(name, defaultEnabled = true) {
  const explicit = process.env['CCTV_ENABLE_' + name.toUpperCase()];
  if (explicit != null && String(explicit).trim() !== '') return String(explicit).trim() !== '0';
  return process.env.NODE_ENV === 'test' ? false : defaultEnabled;
}

function resolveCctvBbox(options = {}) {
  const requestedBbox = normalizeBbox(options.bbox);
  const countryBbox = getCountryBbox(options.countryCode);
  if (countryBbox) {
    return requestedBbox ? intersectBboxes(requestedBbox, countryBbox) : countryBbox;
  }
  return requestedBbox || bboxFromCenter(options.center, options.radiusM);
}

function openCctvFeedKind(feedType, feedUrl) {
  const declared = String(feedType || '').toLowerCase().trim();
  const url = String(feedUrl || '');
  if (declared === 'm3u8' || declared === 'hls' || /\.m3u8(?:[?#].*)?$/i.test(url)) return 'video';
  if (declared === 'mjpeg' || declared === 'mjpg' || /multipart|\.mjpeg?(?:[?#].*)?$/i.test(url)) return 'mjpeg';
  if (declared === 'image' || /(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return 'image';
  if (declared === 'mp4' || declared === 'video') return 'video';
  return null;
}

async function loadOpenCctvCatalog(options = {}) {
  const enabled = providerEnabled('opencctv');
  providerHealth.opencctv.enabled = enabled;
  if (!enabled) {
    providerHealth.opencctv.status = 'DISABLED';
    return [];
  }

  const bbox = resolveCctvBbox(options);
  if (!bbox) return [];
  const limit = Math.max(1, Math.min(OPENCCTV_MAX_LIMIT, Number(options.maxRecords) || 100));
  const key = JSON.stringify({ bbox, limit });
  const cached = openCctvCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const attempt = new Date().toISOString();
  providerHealth.opencctv.lastAttemptAt = attempt;
  const [west, south, east, north] = bbox;

  try {
    // Current OpenCCTV map API: a compact marker index plus bounded 50-id batch calls.
    // The legacy bbox surface remains only as a compatibility fallback.
    let records = [];
    let sourceMode = 'markers-batch';
    try {
      const markerIndex = await fetchOpenCctvMarkers();
      const idsInBbox = [];
      for (let i = 0; i < markerIndex.ids.length; i++) {
        const lat = Number(markerIndex.lats[i]);
        const lon = Number(markerIndex.lngs[i]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat < south || lat > north || lon < west || lon > east) continue;
        idsInBbox.push(markerIndex.ids[i]);
      }
      const wanted = sampleOpenCctvIds(idsInBbox, limit);
      const chunks = [];
      for (let i = 0; i < wanted.length; i += OPENCCTV_BATCH_SIZE) chunks.push(wanted.slice(i, i + OPENCCTV_BATCH_SIZE));
      let next = 0;
      const worker = async () => {
        const out = [];
        while (next < chunks.length) {
          const index = next++;
          try { out.push(...await fetchOpenCctvBatch(chunks[index])); } catch (_) { /* one batch failing must not erase the whole wall */ }
        }
        return out;
      };
      records = (await Promise.all(Array.from({ length:Math.min(OPENCCTV_BATCH_CONCURRENCY, Math.max(1, chunks.length)) }, worker))).flat();
      if (!records.length && wanted.length) throw Object.assign(new Error('OpenCCTV markers resolved no usable camera records'), { failureClass:'empty' });
    } catch (primaryError) {
      sourceMode = 'legacy-bbox-fallback';
      const params = new URLSearchParams({ bounds:[south, west, north, east].join(','), limit:String(limit) });
      const payload = await fetchJsonWithTimeout(OPENCCTV_LEGACY_URL + '?' + params.toString(), { timeoutMs:20_000 });
      records = Array.isArray(payload) ? payload
        : Array.isArray(payload?.items) ? payload.items
        : Array.isArray(payload?.cameras) ? payload.cameras
        : Array.isArray(payload?.data) ? payload.data : [];
      if (!records.length) throw primaryError;
    }

    const requestedCountry = String(options.countryCode || '').trim().toUpperCase() || null;
    const countryScopedRecords = requestedCountry
      ? records.filter(row => countryNameMatchesCode(row?.countryCode ?? row?.country, requestedCountry))
      : records;
    const normalized = (await Promise.all(countryScopedRecords.map((row, index) => mapOpenCctvRecord(row, index)))).filter(Boolean);
    const deduped = Array.from(new Map(normalized.map(row => [String(row.id), row])).values());
    const liveVideoCount = deduped.filter(camera => camera.media.liveVideo === true).length;
    const snapshotCount = deduped.filter(camera => camera.media.providerFrameAvailable === true).length;
    providerHealth.opencctv = {
      ...providerHealth.opencctv,
      enabled:true,
      status:deduped.length ? 'LIVE' : 'EMPTY',
      lastSuccessAt:new Date().toISOString(),
      lastAttemptAt:attempt,
      recordCount:deduped.length,
      liveVideoCount,
      liveSnapshotCount:snapshotCount,
      sourceMode,
      error:null
    };
    openCctvCache.set(key, { rows:deduped, expiresAt:Date.now() + OPENCCTV_CACHE_TTL_MS });
    return deduped;
  } catch (error) {
    providerHealth.opencctv = {
      ...providerHealth.opencctv,
      enabled:true,
      status:'UNAVAILABLE',
      lastAttemptAt:attempt,
      recordCount:0,
      liveVideoCount:0,
      liveSnapshotCount:0,
      error:String(error?.message || error)
    };
    return [];
  }
}
async function loadCaltransCatalog(options = {}) {
  const enabled = providerEnabled('caltrans');
  providerHealth.caltrans.enabled = enabled;
  if (!enabled) {
    providerHealth.caltrans.status = 'DISABLED';
    return [];
  }

  const requestedBbox = resolveCctvBbox(options);
  if (!requestedBbox) return [];
  const bbox = intersectBboxes(requestedBbox, CALTRANS_BBOX);
  if (!bbox) return [];

  const key = JSON.stringify({ bbox, limit:Number(options.maxRecords) || 100 });
  const cached = caltransCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const [west, south, east, north] = bbox;
  const url = new URL(CALTRANS_CCTV_URL);
  url.searchParams.set('where', "streamingVideoURL IS NOT NULL AND streamingVideoURL <> ''");
  url.searchParams.set('outFields', 'OBJECTID,index_,imageDescription,streamingVideoURL,currentImageURL,district,recordDate');
  url.searchParams.set('geometry', [west, south, east, north].join(','));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'json');
  url.searchParams.set('resultRecordCount', String(Math.max(1, Math.min(CALTRANS_MAX_LIMIT, Number(options.maxRecords) || 100))));
  const attempt = new Date().toISOString();
  providerHealth.caltrans.lastAttemptAt = attempt;

  try {
    const response = await fetch(url.toString(), { headers:{Accept:'application/json'} });
    if (!response.ok) throw Object.assign(new Error('Caltrans CCTV query failed: ' + response.status), {
      failureClass:response.status === 429 ? 'rate_limited' : 'http_error'
    });
    const payload = await response.json();
    if (payload?.error) throw Object.assign(new Error(String(payload.error.message || 'Caltrans CCTV API error')), { failureClass:'malformed' });
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const normalized = features.map((feature, index) => {
      const attrs = asRecord(feature?.attributes);
      const geometry = asRecord(feature?.geometry);
      const feedUrl = safeHttpsUrl(attrs.streamingVideoURL);
      const currentImageUrl = safeHttpsUrl(attrs.currentImageURL);
      const latitude = Number(geometry.y);
      const longitude = Number(geometry.x);
      if (!feedUrl || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const kind = openCctvFeedKind('', feedUrl) || 'video';
      return normalizeRecord({
        id:'caltrans:' + String(attrs.OBJECTID || attrs.index_ || index),
        name:String(attrs.imageDescription || 'Caltrans CCTV'),
        latitude, longitude,
        source:'caltrans-public',
        sourceReference:String(attrs.OBJECTID || attrs.index_ || index),
        pose:{ confidence:'verified' },
        viewshed:{ horizontalFovDeg:90, maxRangeM:5000 },
        media:{
          kind:kind === 'mjpeg' ? 'mjpeg' : 'video',
          url:feedUrl,
          frameUrl:currentImageUrl,
          previewUrl:currentImageUrl,
          sourcePageUrl:'https://cwwp2.dot.ca.gov/',
          sourceMediaUrl:feedUrl,
          sourceMediaType:kind,
          sourceMediaPlayable:true,
          direct:true,
          available:true,
          publicSource:true,
          feedKind:'live_video',
          liveVideo:true,
          sourceMediaHost:new URL(feedUrl).hostname,
          refreshIntervalMs:null,
          redistribution:{ provider:'Caltrans public CCTV data service', originalOperator:'California Department of Transportation' },
          attributionName:'Caltrans',
          attributionUrl:'https://dot.ca.gov/'
        },
        health:{
          status:'LIVE',
          lastSuccessAt:null,
          reason:'Official Caltrans CCTV layer exposes a streamingVideoURL; decoded playback is verified by the Sonalit client.'
        },
        provenance:{
          sourceName:'California Department of Transportation (Caltrans)',
          sourceUrl:'https://caltrans-gis.dot.ca.gov/',
          attribution:'California Department of Transportation (Caltrans)',
          attributionUrl:'https://dot.ca.gov/',
          observationType:'official_public_traffic_camera',
          sourceReference:String(attrs.OBJECTID || attrs.index_ || index)
        },
        attributes:{
          provider:'Caltrans',
          providerCameraId:attrs.OBJECTID || attrs.index_ || null,
          district:attrs.district ?? null,
          streamingVideoURL:feedUrl,
          currentImageURL:currentImageUrl,
          live:true,
          catalogClass:'official-live-video',
          verification:'official streamingVideoURL; browser playback required for decoded-frame confirmation'
        }
      }, index);
      return normalized;
    }).filter(Boolean);

    const liveVideoCount = normalized.filter(c => c.media.liveVideo === true).length;
    for (const camera of normalized) {
      caltransDetailCache.set(String(camera.id), { camera, expiresAt:Date.now() + CCTV_DETAIL_CACHE_TTL_MS });
    }
    providerHealth.caltrans = {
      ...providerHealth.caltrans, enabled:true, status:normalized.length ? 'LIVE' : 'EMPTY',
      lastSuccessAt:new Date().toISOString(), lastAttemptAt:attempt,
      recordCount:normalized.length, liveVideoCount, error:null
    };
    caltransCache.set(key, { rows:normalized, expiresAt:Date.now() + CCTV_DETAIL_CACHE_TTL_MS });
    return normalized;
  } catch (error) {
    providerHealth.caltrans = {
      ...providerHealth.caltrans, enabled:true, status:'UNAVAILABLE',
      lastAttemptAt:attempt, error:String(error?.message || error)
    };
    return [];
  }
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

  if (wanted.startsWith('opencctv:')) {
    const cached = openCctvDetailCache.get(wanted);
    if (cached && cached.expiresAt > Date.now()) return cached.camera;
    const rows = await fetchOpenCctvBatch([wanted.slice('opencctv:'.length)]);
    const camera = await Promise.all(rows.map((row, index) => mapOpenCctvRecord(row, index))).then(items => items.find(Boolean));
    return camera || null;
  }

  if (wanted.startsWith('caltrans:')) {
    const cached = caltransDetailCache.get(wanted);
    if (cached && cached.expiresAt > Date.now()) return cached.camera;
    const rows = await loadCaltransCatalog({ bbox:CALTRANS_BBOX, maxRecords:CALTRANS_MAX_LIMIT });
    return rows.find(row => String(row.id) === wanted) || null;
  }

  if (wanted.startsWith('insecam:')) {
    return loadInsecamCameraRecord(wanted.slice('insecam:'.length), null);
  }

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
  const [openEyeRows, openCctvRows, caltransRows, insecamRows, fileRows, tflRows] = await Promise.all([
    loadOpenEyeCatalog(options),
    loadOpenCctvCatalog(options),
    loadCaltransCatalog(options),
    loadInsecamCatalog(options),
    loadFileCatalog(),
    loadTflCatalog().catch(() => [])
  ]);
  const includeSamples = String(process.env.CCTV_INCLUDE_SAMPLES || '') === '1';
  const all = openEyeRows.concat(openCctvRows, caltransRows, insecamRows, fileRows, tflRows, includeSamples ? SAMPLE_CAMERAS : []);
  const unique = new Map();
  for (const row of all) unique.set(String(row.id), row);
  return Array.from(unique.values());
}

function getCameraCatalogHealth() {
  return {
    openeye:{...providerHealth.openeye},
    opencctv:{...providerHealth.opencctv},
    caltrans:{...providerHealth.caltrans},
    insecam:getInsecamHealth(),
    file:{...providerHealth.file},
    tfl:{...providerHealth.tfl},
  };
}

module.exports = { SAMPLE_CAMERAS, normalizeRecord, classifyViewMediaType, openEyeMedia, loadFileCatalog, loadTflCatalog, loadOpenEyeCatalog, loadOpenEyeCamera, loadOpenCctvCatalog, loadOpenCctvCameraFrame, loadCaltransCatalog, loadInsecamCatalog, getCameraById, getCameraCatalog, getCameraCatalogHealth, getCctvCountries, getCountryBbox, clearOpenEyeCache };
