'use strict';

const { assertSafeUrl, allowedHostsFromEnv } = require('./cctvAllowlist');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 2;

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

async function getFrame(camera, options = {}) {
  if (!camera) throw Object.assign(new Error('Camera not found'), { failureClass:'not_found' });
  const mediaUrl = camera.media?.frameUrl || (camera.media?.kind === 'image' ? camera.media?.url : null);
  if (!mediaUrl) throw Object.assign(new Error('No approved camera frame source is configured'), { failureClass:'media_unavailable' });
  return fetchApproved(mediaUrl, options);
}

module.exports = { MAX_BYTES, fetchApproved, getFrame };
