'use strict';

const { assertSafeUrl, allowedHostsFromEnv } = require('./cctvAllowlist');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 2;

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

async function getFrame(camera, options = {}) {
  if (!camera) return syntheticFrame(null, 'Camera not found');
  const mediaUrl = camera.media?.frameUrl || (camera.media?.kind === 'image' ? camera.media?.url : null);
  if (!mediaUrl) return syntheticFrame(camera, camera.media?.publicSource ? 'Public camera frame unavailable' : 'No approved public frame source');
  try {
    return await fetchApproved(mediaUrl, options);
  } catch (error) {
    return syntheticFrame(camera, 'Approved source unavailable: ' + String(error?.failureClass || 'unknown'));
  }
}

module.exports = { MAX_BYTES, syntheticFrame, fetchApproved, getFrame };
