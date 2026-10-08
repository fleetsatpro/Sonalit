'use strict';

const net = require('node:net');

const { assertSafeUrl, allowedHostsFromEnv, isPrivateIp } = require('./cctvAllowlist');
const { loadInsecamCamera } = require('./insecamCatalog');
const { loadOpenCctvCameraFrame } = require('./cctvCatalog');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'application/octet-stream',
  'multipart/x-mixed-replace',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);

const HLS_PROXY_TTL_MS = 5 * 60 * 1000;
const hlsProxyHosts = new Map();

function isHlsMedia(contentType, sourceUrl) {
  const type = String(contentType || '').toLowerCase();
  return type === 'application/vnd.apple.mpegurl' ||
    type === 'application/x-mpegurl' ||
    type === 'audio/mpegurl' ||
    /\.m3u8(?:[?#].*)?$/i.test(String(sourceUrl || ''));
}

async function responseLooksLikeHlsPlaylist(response) {
  if (!response || typeof response.clone !== 'function') return false;
  try {
    const clone = response.clone();
    const reader = clone.body?.getReader?.();
    if (!reader) return false;
    const { value } = await reader.read();
    try { await reader.cancel(); } catch (_) {}
    if (!value) return false;
    const prefix = Buffer.from(value).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    return prefix.startsWith('#EXTM3U');
  } catch (_) {
    return false;
  }
}

function rewriteHlsPlaylist(playlist, baseUrl, proxyUrlForTarget, hosts) {
  const replaceAbsolute = (uri) => {
    try {
      const absolute = new URL(uri, baseUrl).toString();
      const hostname = new URL(absolute).hostname.toLowerCase();
      hosts.add(hostname);
      return proxyUrlForTarget(absolute);
    } catch (_) {
      return uri;
    }
  };
  return String(playlist || '').split(/\r?\n/).map(line => {
    if (!line) return line;
    const uriAttribute = line.replace(/URI="([^"]+)"/gi, (_match, uri) => `URI="${replaceAbsolute(uri)}"`);
    if (uriAttribute !== line) return uriAttribute;
    if (line.startsWith('#')) return line;
    return replaceAbsolute(line.trim());
  }).join('\n');
}

function syntheticFrame(camera, reason) {
  const name = String(camera?.name || camera?.id || 'camera').replace(/[<&>]/g, '');
  const note = String(reason || 'No public frame source configured').replace(/[<&>]/g, '');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">' +
    '<rect width="960" height="540" fill="#111"/><text x="40" y="250" fill="#fff" font-size="34" font-family="sans-serif">SONALIT CCTV — SYNTHETIC</text>' +
    '<text x="40" y="305" fill="#aaa" font-size="24" font-family="sans-serif">' + name + '</text>' +
    '<text x="40" y="350" fill="#f4b400" font-size="20" font-family="sans-serif">' + note + '</text></svg>';
  return { buffer:Buffer.from(svg), contentType:'image/svg+xml', synthetic:true };
}

async function fetchApproved(url, options = {}) {
  const allowed = Array.isArray(options.allowedHosts) && options.allowedHosts.length
    ? options.allowedHosts : allowedHostsFromEnv();
  let current = await assertSafeUrl(url, allowed);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 8000);
    let response;
    try {
      response = await fetch(current, {
        redirect:'manual',
        headers:{Accept:'image/avif,image/webp,image/png,image/jpeg'},
        signal:controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301,302,303,307,308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) throw Object.assign(new Error('CCTV redirect limit exceeded'), { failureClass:'http_error' });
      const location = response.headers.get('location');
      if (!location) throw Object.assign(new Error('CCTV redirect missing Location'), { failureClass:'http_error' });
      current = await assertSafeUrl(new URL(location, current).toString(), allowed);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('CCTV media request failed: ' + response.status), { failureClass: response.status === 429 ? 'rate_limited' : 'http_error' });
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(type)) {
      throw Object.assign(new Error('CCTV frame content-type is not an approved image type'), { failureClass:'invalid_data' });
    }
    const len = Number(response.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_BYTES) throw Object.assign(new Error('CCTV frame exceeds size limit'), { failureClass:'invalid_data' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw Object.assign(new Error('CCTV frame exceeds size limit'), { failureClass:'invalid_data' });
    return { buffer:Buffer.from(bytes), contentType:type, synthetic:false, sourceUrl:current.toString() };
  }
  throw Object.assign(new Error('CCTV media fetch failed'), { failureClass:'http_error' });
}

async function assertSafePublicImageUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); }
  catch (_) { throw Object.assign(new Error('Invalid public camera frame URL'), { failureClass:'invalid_data' }); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Public camera frame must use HTTP or HTTPS'), { failureClass:'invalid_data' });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('Public camera frame credentials are forbidden'), { failureClass:'invalid_data' });
  }
  const host = url.hostname.toLowerCase();
  if (isPrivateIp(host)) {
    throw Object.assign(new Error('Private public-camera target blocked'), { failureClass:'invalid_data' });
  }
  if (!net.isIP(host)) {
    const addresses = await require('node:dns').promises.lookup(host, { all:true, verbatim:true }).catch(() => []);
    if (!addresses.length) throw Object.assign(new Error('Public camera host could not be resolved'), { failureClass:'unavailable' });
    if (addresses.some(address => isPrivateIp(address.address))) {
      throw Object.assign(new Error('Public camera DNS resolves to private address'), { failureClass:'invalid_data' });
    }
  }
  return url;
}

async function fetchPublicSnapshot(rawUrl, options = {}) {
  let current = await assertSafePublicImageUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 10_000);
    let response;
    try {
      response = await fetch(current, {
        redirect:'manual',
        headers:{
          Accept:'image/avif,image/webp,image/png,image/jpeg',
          Referer:'https://www.insecam.org/',
          'User-Agent':'Sonalit-CCTV/1.0 (+https://sonalit.com)'
        },
        signal:controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301,302,303,307,308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) throw Object.assign(new Error('Public camera redirect limit exceeded'), { failureClass:'http_error' });
      const location = response.headers.get('location');
      if (!location) throw Object.assign(new Error('Public camera redirect missing Location'), { failureClass:'http_error' });
      current = await assertSafePublicImageUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('Public camera frame request failed: ' + response.status), { failureClass:response.status === 429 ? 'rate_limited' : 'http_error' });
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(type)) {
      throw Object.assign(new Error('Public camera frame content-type is not an approved image type'), { failureClass:'invalid_data' });
    }
    const len = Number(response.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_BYTES) throw Object.assign(new Error('Public camera frame exceeds size limit'), { failureClass:'invalid_data' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw Object.assign(new Error('Public camera frame exceeds size limit'), { failureClass:'invalid_data' });
    return { buffer:Buffer.from(bytes), contentType:type, synthetic:false, sourceUrl:null };
  }
  throw Object.assign(new Error('Public camera frame fetch failed'), { failureClass:'http_error' });
}

async function getFrame(camera, options = {}) {
  if (!camera) return syntheticFrame(null, 'Camera not found');

  const provider = String(camera.media?.provider || '').toLowerCase();
  const cameraId = String(camera.id || '');

  if (provider === 'insecam' && camera.media?.providerFrameAvailable === true && cameraId.startsWith('insecam:')) {
    try {
      const sourceUrl = await loadInsecamCamera(cameraId.slice('insecam:'.length));
      if (!sourceUrl) return syntheticFrame(camera, 'Insecam current frame source unavailable');
      return await fetchPublicSnapshot(sourceUrl, options);
    } catch (error) {
      return syntheticFrame(camera, 'Insecam frame unavailable: ' + String(error?.failureClass || 'unknown'));
    }
  }

  if (provider === 'opencctv' && camera.media?.providerFrameAvailable === true && cameraId.startsWith('opencctv:')) {
    try {
      const sourceUrl = await loadOpenCctvCameraFrame(cameraId.slice('opencctv:'.length));
      if (!sourceUrl) return syntheticFrame(camera, 'OpenCCTV current frame source unavailable');
      return await fetchPublicSnapshot(sourceUrl, options);
    } catch (error) {
      return syntheticFrame(camera, 'OpenCCTV frame unavailable: ' + String(error?.failureClass || 'unknown'));
    }
  }

  const mediaUrl = camera.media?.frameUrl || (camera.media?.kind === 'image' ? camera.media?.url : null);
  if (!mediaUrl) return syntheticFrame(camera, camera.media?.publicSource ? 'Public camera frame unavailable' : 'No approved public frame source');
  try {
    return await fetchApproved(mediaUrl, options);
  } catch (error) {
    return syntheticFrame(camera, 'Approved source unavailable: ' + String(error?.failureClass || 'unknown'));
  }
}

async function openEyeWhepOffer(streamId, sdp) {
  const id = String(streamId || '').trim();
  if (!id) throw Object.assign(new Error('OpenEye live stream id is required'), { failureClass:'invalid_data', statusCode:400 });
  const body = typeof sdp === 'string' ? sdp : '';
  if (!body.trim()) throw Object.assign(new Error('WHEP SDP offer is required'), { failureClass:'invalid_data', statusCode:400 });

  const headers = {
    Accept:'application/sdp',
    'Content-Type':'application/sdp'
  };
  const key = String(process.env.OPENEYE_KEY || '').trim();
  if (key) headers.Authorization = 'Bearer ' + key;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch('https://api.openeye.cam/v1/streams/' + encodeURIComponent(id) + '/whep/offer', {
      method:'POST',
      headers,
      body,
      signal:controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const answer = await response.text();
  const rawLocation = response.headers.get('location') || null;
  let location = null;
  if (rawLocation) {
    try {
      const resolved = new URL(rawLocation, 'https://api.openeye.cam');
      if (resolved.protocol === 'https:' && resolved.hostname === 'api.openeye.cam') {
        location = resolved.toString();
      }
    } catch (_) {
      location = null;
    }
  }
  return {
    response,
    status:response.status,
    ok:response.ok,
    answer,
    location,
    paymentRequired:response.headers.get('payment-required') || null,
    wwwAuthenticate:response.headers.get('www-authenticate') || null
  };
}

async function openEyeWhepDelete(sessionUrl) {
  const candidate = String(sessionUrl || '').trim();
  if (!candidate) throw Object.assign(new Error('WHEP session URL is required'), { failureClass:'invalid_data', statusCode:400 });
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.openeye.cam' || !/^\/v1\/streams\/[^/]+\/whep\/(?:session\/)?[^/]+$/i.test(parsed.pathname)) {
    throw Object.assign(new Error('Invalid OpenEye WHEP session URL'), { failureClass:'invalid_data', statusCode:400 });
  }
  const headers = { Accept:'*/*' };
  const key = String(process.env.OPENEYE_KEY || '').trim();
  if (key) headers.Authorization = 'Bearer ' + key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    response = await fetch(parsed.toString(), { method:'DELETE', headers, signal:controller.signal });
  } finally {
    clearTimeout(timer);
  }
  return { ok:response.ok || response.status === 404, status:response.status };
}

async function fetchApprovedMedia(url, options = {}) {
  const allowed = Array.isArray(options.allowedHosts) && options.allowedHosts.length
    ? options.allowedHosts : allowedHostsFromEnv();
  let current = await assertSafeUrl(url, allowed);
  const requestHeaders = {
    Accept:'video/mp4,video/webm,multipart/x-mixed-replace,application/vnd.apple.mpegurl,application/x-mpegurl,*/*;q=0.1'
  };
  if (options.range) requestHeaders.Range = String(options.range);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 10000);
    let response;
    try {
      response = await fetch(current, {
        redirect:'manual',
        headers:requestHeaders,
        signal:controller.signal
      });
    } catch (error) {
      throw Object.assign(error, { failureClass:'unavailable' });
    } finally {
      clearTimeout(timeout);
    }
    if ([301,302,303,307,308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) throw Object.assign(new Error('CCTV media redirect limit exceeded'), { failureClass:'http_error' });
      const location = response.headers.get('location');
      if (!location) throw Object.assign(new Error('CCTV media redirect missing Location'), { failureClass:'http_error' });
      current = await assertSafeUrl(new URL(location, current).toString(), allowed);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('CCTV media request failed: ' + response.status), { failureClass: response.status === 429 ? 'rate_limited' : 'http_error' });
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!VIDEO_TYPES.has(type) && !type.startsWith('video/') && !['application/vnd.apple.mpegurl','application/x-mpegurl','audio/mpegurl'].includes(type)) {
      throw Object.assign(new Error('CCTV media content-type is not an approved stream type'), { failureClass:'invalid_data' });
    }
    return {
      response,
      contentType:type,
      sourceUrl:current.toString(),
      status:response.status,
      contentRange:response.headers.get('content-range'),
      contentLength:response.headers.get('content-length'),
      acceptRanges:response.headers.get('accept-ranges'),
      etag:response.headers.get('etag'),
      lastModified:response.headers.get('last-modified')
    };
  }
  throw Object.assign(new Error('CCTV media fetch failed'), { failureClass:'http_error' });
}

async function getMedia(camera, options = {}) {
  if (!camera) throw Object.assign(new Error('Camera not found'), { failureClass:'not_found' });
  const mediaUrl = String(camera.media?.url || '');
  const kind = String(camera.media?.kind || '').toLowerCase();
  if (!mediaUrl || !['video','mjpeg'].includes(kind)) {
    throw Object.assign(new Error('Camera does not expose an approved streaming source'), { failureClass:'unavailable' });
  }

  let origin;
  try {
    origin = new URL(mediaUrl);
  } catch (_) {
    throw Object.assign(new Error('Camera streaming URL is invalid'), { failureClass:'invalid_data' });
  }

  const envHosts = allowedHostsFromEnv();
  const stateKey = String(camera.id || mediaUrl);
  const cached = hlsProxyHosts.get(stateKey);
  const knownHosts = new Set(
    cached && cached.expiresAt > Date.now()
      ? cached.hosts
      : [...envHosts, origin.hostname.toLowerCase()]
  );

  let requestUrl = mediaUrl;
  if (options.target) {
    let target;
    try { target = new URL(String(options.target)); } catch (_) {
      throw Object.assign(new Error('Invalid HLS proxy target'), { failureClass:'invalid_data' });
    }
    const targetHost = target.hostname.toLowerCase();
    if (!knownHosts.has(targetHost) && !envHosts.some(rule => targetHost === String(rule).toLowerCase().replace(/^\\*\\./,'' ) || targetHost.endsWith('.' + String(rule).toLowerCase().replace(/^\\*\\./,'')))) {
      throw Object.assign(new Error('HLS target host was not advertised by the approved stream'), { failureClass:'invalid_data' });
    }
    requestUrl = target.toString();
  }

  const fetched = await fetchApprovedMedia(requestUrl, {
    ...options,
    allowedHosts:[...knownHosts]
  });

  let hlsPlaylist = isHlsMedia(fetched.contentType, fetched.sourceUrl);
  // Some public operators serve HLS manifests as generic octet-stream/text
  // and omit ".m3u8" from the URL. Sniff only the first response chunk so a
  // valid live manifest is not misclassified as progressive video.
  if (!hlsPlaylist && /^(?:application\/octet-stream|text\/plain)$/i.test(fetched.contentType)) {
    hlsPlaylist = await responseLooksLikeHlsPlaylist(fetched.response);
  }
  if (!hlsPlaylist) return fetched;

  const playlist = await fetched.response.text();
  if (Buffer.byteLength(playlist, 'utf8') > 2 * 1024 * 1024) {
    throw Object.assign(new Error('HLS playlist exceeds size limit'), { failureClass:'invalid_data' });
  }

  const hosts = new Set(knownHosts);
  const proxyUrlForTarget = (absoluteUrl) => '/api/v1/cctv/' +
    encodeURIComponent(String(camera.id)) + '/media?target=' + encodeURIComponent(absoluteUrl);
  const rewrittenPlaylist = rewriteHlsPlaylist(playlist, fetched.sourceUrl, proxyUrlForTarget, hosts);
  hlsProxyHosts.set(stateKey, { hosts, expiresAt:Date.now() + HLS_PROXY_TTL_MS });

  return {
    ...fetched,
    isHlsPlaylist:true,
    playlist:rewrittenPlaylist,
    contentType:'application/vnd.apple.mpegurl'
  };
}

module.exports = { openEyeWhepOffer, openEyeWhepDelete, MAX_BYTES, syntheticFrame, fetchApproved, getFrame, fetchApprovedMedia, getMedia, isHlsMedia, assertSafePublicImageUrl, fetchPublicSnapshot };
