'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { isPrivateIp } = require('../services/spatial/cctv/cctvAllowlist');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function researchError(message, failureClass = 'invalid_data') {
  const error = new Error(message);
  error.failureClass = failureClass;
  return error;
}

function isNonPublicIpv4(address) {
  const octets = String(address || '').split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const value = octets.reduce((result, octet) => result * 256 + octet, 0) >>> 0;
  const blocked = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
    ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return blocked.some(([network, prefix]) => {
    const base = network.split('.').map(Number).reduce((result, octet) => result * 256 + octet, 0) >>> 0;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return ((value & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function isPublicResearchAddress(value) {
  const address = String(value || '').split('%')[0].toLowerCase();
  const family = net.isIP(address);
  if (!family || isPrivateIp(address)) return false;
  if (family === 4) return !isNonPublicIpv4(address);
  if (family === 6) {
    // Only global-unicast IPv6 is accepted; mapped IPv4 and transition ranges
    // are rejected so they cannot disguise private IPv4 destinations.
    if (!/^[23][0-9a-f]{3}:/.test(address)) return false;
    if (/^2001:(?:0000|0{0,3}db8|0{0,3}0010):/i.test(address)) return false;
    if (/^2002:/i.test(address)) return false;
    return true;
  }
  return false;
}

function parsePublicResearchUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); }
  catch (_) { throw researchError('Invalid external research URL'); }
  if (url.protocol !== 'https:') throw researchError('External research source must use HTTPS');
  if (url.username || url.password) throw researchError('External research URL credentials are forbidden');
  if (url.port && url.port !== '443') throw researchError('External research source port is not permitted');
  const hostname = String(url.hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || /\.(?:localhost|local|internal|lan|home\.arpa)$/.test(hostname)) {
    throw researchError('Local or internal research targets are forbidden');
  }
  if (net.isIP(hostname) && !isPublicResearchAddress(hostname)) {
    throw researchError('Private or reserved research target blocked');
  }
  url.hash = '';
  return { url, hostname };
}

async function resolvePublicAddresses(hostname) {
  let rows;
  try {
    rows = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (_) {
    throw researchError('External research host could not be resolved', 'unavailable');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw researchError('External research host has no resolved address', 'unavailable');
  }
  const addresses = rows.map(row => ({ address: String(row.address || ''), family: Number(row.family || net.isIP(row.address)) }));
  if (addresses.some(row => !isPublicResearchAddress(row.address))) {
    throw researchError('External research host resolves to a private or reserved address');
  }
  return addresses;
}

function headerValue(headers, name) {
  if (headers && typeof headers.get === 'function') {
    const result = headers.get(name);
    return result == null ? null : String(result);
  }
  if (!headers || typeof headers !== 'object') return null;
  const value = headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  return value == null ? null : String(value);
}

function requestPublicOnce(url, addresses, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimer);
      if (error) reject(error);
      else resolve(result);
    };
    const absoluteTimer = setTimeout(() => {
      if (request) request.destroy(researchError('External research request timed out', 'unavailable'));
      else finish(researchError('External research request timed out', 'unavailable'));
    }, timeoutMs);
    const pinnedLookup = (_hostname, options, callback) => {
      const family = Number(options && options.family || 0);
      const candidates = family ? addresses.filter(row => row.family === family) : addresses;
      if (!candidates.length) {
        callback(researchError('No validated public address matches the requested family', 'unavailable'));
      } else if (options && options.all) {
        callback(null, candidates.map(row => ({ address: row.address, family: row.family })));
      } else {
        callback(null, candidates[0].address, candidates[0].family);
      }
    };

    try {
      request = https.request(url, {
        method: 'GET',
        agent: false,
        lookup: pinnedLookup,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/json;q=0.8,*/*;q=0.1',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Sonalit-Intelligence-Research/1.0',
        },
      }, response => {
        const status = Number(response.statusCode || 0);
        const headers = response.headers || {};
        if (REDIRECT_STATUS.has(status)) {
          response.on('error', () => {});
          finish(null, { status, headers, body: Buffer.alloc(0) });
          response.destroy();
          return;
        }
        const encoding = String(headers['content-encoding'] || 'identity').trim().toLowerCase();
        if (encoding && encoding !== 'identity') {
          finish(researchError('Compressed external research responses are not accepted'));
          response.destroy();
          return;
        }
        const declaredLength = Number(headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          finish(researchError('External research response exceeds the byte limit'));
          response.destroy();
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxBytes) {
            finish(researchError('External research response exceeds the byte limit'));
            response.destroy();
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => finish(null, { status, headers, body: Buffer.concat(chunks, bytes) }));
        response.on('error', error => finish(researchError(
          'External research response could not be read: ' + String(error && error.code || 'stream_error'),
          'unavailable',
        )));
      });
      request.on('error', error => {
        const code = String(error && error.code || '').slice(0, 64);
        const message = String(error && error.message || '').replace(/https?:\/\/[^\s)]+/gi, '[url]').slice(0, 180);
        const failureClass = String(error && error.failureClass || 'unavailable');
        const detail = code
          ? 'External research request failed: ' + code
          : (message || 'External research request failed without a transport code');
        finish(researchError(detail, failureClass));
      });
      request.end();
    } catch (_) {
      finish(researchError('External research request could not be started', 'unavailable'));
    }
  });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(researchError('External research DNS lookup timed out', 'unavailable')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createPublicResearchFetcher({ resolveAddresses = resolvePublicAddresses, requestOnce = requestPublicOnce } = {}) {
  return async function safeFetchPublicResearch(rawUrl, options = {}) {
    const candidateTimeout = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(candidateTimeout)
      ? Math.max(500, Math.min(MAX_TIMEOUT_MS, Math.trunc(candidateTimeout)))
      : DEFAULT_TIMEOUT_MS;
    const candidateBytes = Number(options.maxBytes);
    const maxBytes = Number.isFinite(candidateBytes) && candidateBytes > 0
      ? Math.min(MAX_RESPONSE_BYTES, Math.trunc(candidateBytes))
      : MAX_RESPONSE_BYTES;
    const deadline = Date.now() + timeoutMs;
    let current = parsePublicResearchUrl(rawUrl).url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw researchError('External research request timed out', 'unavailable');
      const parsed = parsePublicResearchUrl(current.toString());
      let addresses;
      if (net.isIP(parsed.hostname)) {
        addresses = [{ address: parsed.hostname, family: net.isIP(parsed.hostname) }];
      } else {
        addresses = await withTimeout(resolveAddresses(parsed.hostname), remainingMs);
      }
      if (!Array.isArray(addresses) || addresses.length === 0 ||
          addresses.some(row => !isPublicResearchAddress(row && row.address))) {
        throw researchError('External research host resolves to a private or reserved address');
      }

      const requestRemainingMs = deadline - Date.now();
      if (requestRemainingMs <= 0) throw researchError('External research request timed out', 'unavailable');
      const response = await requestOnce(parsed.url, addresses, {
        timeoutMs: requestRemainingMs,
        maxBytes,
      });
      const status = Number(response && response.status || 0);
      const headers = response && response.headers || {};
      if (REDIRECT_STATUS.has(status)) {
        const location = headerValue(headers, 'location');
        if (!location) throw researchError('External research redirect has no Location header');
        if (hop >= MAX_REDIRECTS) throw researchError('External research redirect limit exceeded');
        let next;
        try { next = new URL(location, parsed.url); }
        catch (_) { throw researchError('External research redirect target is invalid'); }
        current = parsePublicResearchUrl(next.toString()).url;
        continue;
      }

      const bodyValue = response && response.body != null ? response.body : Buffer.alloc(0);
      const body = Buffer.isBuffer(bodyValue) ? bodyValue : Buffer.from(String(bodyValue));
      if (body.length > maxBytes) throw researchError('External research response exceeds the byte limit');
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => headerValue(headers, name) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        text: async () => body.toString('utf8'),
        json: async () => JSON.parse(body.toString('utf8')),
        url: parsed.url.toString(),
      };
    }
    throw researchError('External research redirect limit exceeded');
  };
}

const safeFetchPublicResearch = createPublicResearchFetcher();

module.exports = {
  MAX_RESPONSE_BYTES,
  createPublicResearchFetcher,
  isPublicResearchAddress,
  parsePublicResearchUrl,
  safeFetchPublicResearch,
};
