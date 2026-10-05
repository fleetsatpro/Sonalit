'use strict';

const INSECAM_BASE_URL = 'https://www.insecam.org';
const INSECAM_CACHE_TTL_MS = 10 * 60 * 1000;
const INSECAM_MAX_CANDIDATES = 40;
const INSECAM_MAX_ROWS = 24;
const INSECAM_DETAIL_CONCURRENCY = 4;
const INSECAM_REQUEST_TIMEOUT_MS = 10_000;

const insecamCache = new Map();
const insecamFrameSources = new Map();
const insecamRecordCache = new Map();

const providerHealth = {
  enabled: true,
  status: 'UNKNOWN',
  lastAttemptAt: null,
  lastSuccessAt: null,
  recordCount: 0,
  liveSnapshotCount: 0,
  rejectedCount: 0,
  error: null,
};

const SENSITIVE_RE = /\b(?:bedroom|bathroom|bath|toilet|restroom|nursery|baby|child|children|kitchen|living\s+room|home|house|apartment|flat|private|school|classroom|hospital|clinic|ward|changing\s+room|locker|intimate|personal)\b/i;
const OUTDOOR_RE = /\b(?:traffic|road|street|city|parking|beach|coast|port|harbor|harbour|airport|highway|motorway|bridge|railway|rail|train|station|square|plaza|downtown|landscape|nature|earth|mountain|ski|marina|weather|public|town|avenue|boulevard|sea|river|lake|waterfront)\b/i;
const IMAGE_RE = /(?:\.(?:jpe?g|png|webp|avif|gif)(?:[?#].*)?$|(?:\?|&)COUNTER(?:=|%3D)|\/(?:snapshot|image|camera|webcapture|faststream|mjpg|mjpeg)(?:[/?]|$))/i;

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
}

function fetchText(url, referer) {
  return fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Sonalit-CCTV/1.0 (+https://sonalit.com)',
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(INSECAM_REQUEST_TIMEOUT_MS),
  }).then(async response => {
    if (!response.ok) {
      throw Object.assign(new Error('Insecam request failed: ' + response.status), {
        failureClass: response.status === 429 ? 'rate_limited' : 'http_error',
      });
    }
    return response.text();
  });
}

function safeExternalUrl(raw, baseUrl = INSECAM_BASE_URL) {
  try {
    const url = new URL(String(raw || ''), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'insecam.org' || host.endsWith('.insecam.org')) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function extractViewIds(html) {
  const ids = [];
  const seen = new Set();
  const re = /(?:href|data-href)\s*=\s*["'](?:https?:\/\/(?:www\.)?insecam\.org)?\/en\/view\/(\d+)\/?(?:["'#?])/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const id = String(match[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= INSECAM_MAX_CANDIDATES) break;
  }
  return ids;
}

function extractAttributeUrls(html) {
  const urls = [];
  const re = /(?:src|data-src|data-image|data-url|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(String(html || '')))) urls.push(decodeHtml(match[1]));
  const absolute = String(html || '').match(/https?:\/\/[^"'\s<>\\]+/gi) || [];
  urls.push(...absolute.map(decodeHtml));
  return urls;
}

function scoreMediaUrl(raw) {
  const url = safeExternalUrl(raw);
  if (!url) return null;
  const parsed = new URL(url);
  const haystack = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
  if (!IMAGE_RE.test(haystack)) return null;
  if (/google|doubleclick|yadro|facebook|adsense|criteo|analytics/i.test(parsed.hostname)) return null;
  let score = 0;
  if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#].*)?$/i.test(url)) score += 50;
  if (/(?:snapshot|image|camera|webcapture|faststream|mjpg|mjpeg)/i.test(haystack)) score += 30;
  if (/COUNTER/i.test(parsed.search)) score += 20;
  if (netIsLiteralPublicIp(parsed.hostname)) score += 10;
  return { url, score };
}

function netIsLiteralPublicIp(host) {
  const octets = String(host || '').split('.');
  if (octets.length !== 4 || !octets.every(part => /^\d+$/.test(part))) return false;
  const numbers = octets.map(Number);
  if (numbers.some(n => n < 0 || n > 255)) return false;
  const [a, b] = numbers;
  return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    a >= 224);
}

function extractFrameUrl(html) {
  const candidates = extractAttributeUrls(html)
    .map(scoreMediaUrl)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url || null;
}

function extractField(text, label) {
  const re = new RegExp(label + ':\\s*([^]+?)(?=\\s+(?:Country code|Region|City|Latitude|Longitude|ZIP|Timezone|Manufacturer|Tags|Detailed description|Location):|$)', 'i');
  return (text.match(re)?.[1] || '').trim();
}

function extractCoordinates(text) {
  const lat = Number((text.match(/Latitude:\s*(-?\d+(?:\.\d+)?)/i) || [])[1]);
  const lon = Number((text.match(/Longitude:\s*(-?\d+(?:\.\d+)?)/i) || [])[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

function isAllowedSubject(city, tags, title) {
  const combined = (city + ' ' + tags + ' ' + title).trim();
  if (SENSITIVE_RE.test(combined)) return false;
  return !tags || OUTDOOR_RE.test(tags) || OUTDOOR_RE.test(title) || Boolean(city);
}

function extractTitle(text, city) {
  const heading = text.match(/Live camera\s+(?:in|at)\s+(.{2,120}?)(?:\s+Camera stream|\s+Tags|\s+Detailed description|$)/i);
  return (heading?.[1] || city || 'Insecam public camera').trim().replace(/\s+/g, ' ');
}

async function loadInsecamDetail(id, expectedCountry) {
  const cacheKey = String(id);
  const cached = insecamRecordCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.record;

  const pageUrl = INSECAM_BASE_URL + '/en/view/' + encodeURIComponent(id) + '/';
  const html = await fetchText(pageUrl, INSECAM_BASE_URL + '/en/');
  const text = stripTags(html);
  const city = extractField(text, 'City');
  const countryCode = extractField(text, 'Country code').toUpperCase();
  const region = extractField(text, 'Region');
  const manufacturer = extractField(text, 'Manufacturer');
  const tags = extractField(text, 'Tags');
  const coords = extractCoordinates(text);
  if (!coords || !countryCode) return null;
  if (expectedCountry && countryCode !== String(expectedCountry).toUpperCase()) return null;
  if (!isAllowedSubject(city, tags, text.slice(0, 700))) return null;

  const frameUrl = extractFrameUrl(html);
  if (!frameUrl) return null;

  const record = {
    id: 'insecam:' + id,
    entityType: 'camera',
    source: 'insecam-public',
    sourceReference: id,
    name: extractTitle(text, city),
    pose: { latitude: coords.latitude, longitude: coords.longitude, altitudeM: null, headingDeg: null, pitchDeg: null, rollDeg: null, confidence: 'estimated' },
    viewshed: { horizontalFovDeg: 90, verticalFovDeg: null, maxRangeM: 5000, minRangeM: 0 },
    media: {
      kind: 'image',
      url: null,
      frameUrl: null,
      previewUrl: null,
      sourcePageUrl: pageUrl,
      sourceMediaUrl: null,
      sourceMediaType: 'image',
      sourceMediaPlayable: false,
      feedKind: 'live_snapshot',
      liveVideo: false,
      direct: false,
      available: true,
      publicSource: true,
      provider: 'insecam',
      providerFrameAvailable: true,
      providerRefreshIntervalMs: 60_000,
      refreshIntervalMs: 60_000,
      redistribution: { directory: 'Insecam', sourceOnly: true, no_rehosting_of_raw_source: true },
      attributionName: 'Insecam',
      attributionUrl: 'https://www.insecam.org/',
    },
    health: {
      status: 'LIVE',
      lastSuccessAt: new Date().toISOString(),
      reason: 'Insecam directory page is online and exposes a current public image source; Sonalit fetches only the current image through its bounded frame gateway.',
    },
    provenance: {
      sourceName: 'Insecam public camera directory',
      sourceUrl: pageUrl,
      attribution: 'Insecam public camera directory',
      attributionUrl: 'https://www.insecam.org/',
      observationType: 'public_camera_directory',
      license: null,
      sourceReference: id,
    },
    privacy: { plateTracking: false, personTracking: false, faceRecognition: false },
    attributes: {
      provider: 'Insecam',
      providerCameraId: id,
      countryCode,
      city: city || null,
      region: region || null,
      manufacturer: manufacturer || null,
      tags: tags || null,
      cameraLocationPrecision: 'approximate-city-level',
      catalogClass: 'public-live-snapshot',
      mediaVerification: 'directory-page-discovered-frame-endpoint',
      providerFrameAvailable: true,
      providerRefreshIntervalMs: 60_000,
    },
  };

  insecamFrameSources.set(record.id, { url: frameUrl, expiresAt: Date.now() + INSECAM_CACHE_TTL_MS });
  insecamRecordCache.set(cacheKey, { record, expiresAt: Date.now() + INSECAM_CACHE_TTL_MS });
  return record;
}

async function mapWithConcurrency(values, worker, limit) {
  const out = [];
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      try {
        const row = await worker(values[index]);
        if (row) out.push(row);
      } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return out;
}

async function loadIndexPage(countryCode) {
  const path = countryCode
    ? '/en/bycountry/' + encodeURIComponent(String(countryCode).toLowerCase()) + '/'
    : '/en/bynew/';
  return fetchText(INSECAM_BASE_URL + path, INSECAM_BASE_URL + '/en/');
}

async function loadInsecamCatalog(options = {}) {
  const explicit = process.env.CCTV_ENABLE_INSECAM;
  const enabled = explicit != null
    ? String(explicit).trim() !== '0'
    : process.env.NODE_ENV !== 'test';
  providerHealth.enabled = enabled;
  if (!enabled) {
    providerHealth.status = 'DISABLED';
    return [];
  }

  const country = String(options.countryCode || '').trim().toUpperCase() || null;
  const cacheKey = JSON.stringify({ country, page: 1 });
  const cached = insecamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  const attempt = new Date().toISOString();
  providerHealth.lastAttemptAt = attempt;
  try {
    const html = await loadIndexPage(country);
    const candidateIds = extractViewIds(html).slice(0, INSECAM_MAX_CANDIDATES);
    const rows = await mapWithConcurrency(candidateIds, id => loadInsecamDetail(id, country), INSECAM_DETAIL_CONCURRENCY);
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const resolved = rows.slice(0, INSECAM_MAX_ROWS);

    providerHealth.status = resolved.length ? 'LIVE' : 'EMPTY';
    providerHealth.lastSuccessAt = new Date().toISOString();
    providerHealth.lastAttemptAt = attempt;
    providerHealth.recordCount = resolved.length;
    providerHealth.liveSnapshotCount = resolved.length;
    providerHealth.rejectedCount = Math.max(0, candidateIds.length - resolved.length);
    providerHealth.error = null;

    insecamCache.set(cacheKey, { rows: resolved, expiresAt: Date.now() + INSECAM_CACHE_TTL_MS });
    return resolved;
  } catch (error) {
    providerHealth.status = 'UNAVAILABLE';
    providerHealth.lastAttemptAt = attempt;
    providerHealth.error = String(error?.message || error);
    return [];
  }
}

async function loadInsecamCamera(id, expectedCountry) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  const source = insecamFrameSources.get('insecam:' + wanted);
  if (source && source.expiresAt > Date.now()) return source.url;
  const record = await loadInsecamDetail(wanted, expectedCountry || null);
  return record ? insecamFrameSources.get(record.id)?.url || null : null;
}

async function loadInsecamCameraRecord(id, expectedCountry) {
  return loadInsecamDetail(String(id || '').trim(), expectedCountry || null);
}

function clearInsecamCache() {
  insecamCache.clear();
  insecamFrameSources.clear();
  insecamRecordCache.clear();
}

function getInsecamHealth() {
  return { ...providerHealth };
}

module.exports = {
  loadInsecamCatalog,
  loadInsecamCamera,
  loadInsecamCameraRecord,
  clearInsecamCache,
  getInsecamHealth,
};