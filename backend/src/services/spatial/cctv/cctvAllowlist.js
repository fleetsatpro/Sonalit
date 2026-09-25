'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIp(value) {
  if (net.isIP(value) === 4) {
    const [a,b] = value.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a >= 224);
  }
  if (net.isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') ||
      normalized.startsWith('feb');
  }
  return false;
}

function hostMatches(host, allowed) {
  const value = String(host || '').toLowerCase().replace(/\.$/, '');
  const rule = String(allowed || '').toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return value === rule || value.endsWith('.' + rule);
}

async function assertSafeUrl(rawUrl, allowedHosts) {
  let url;
  try { url = new URL(String(rawUrl)); } catch (_) { throw Object.assign(new Error('Invalid media URL'), { failureClass: 'invalid_data' }); }
  if (url.protocol !== 'https:') throw Object.assign(new Error('CCTV media must use HTTPS'), { failureClass: 'invalid_data' });
  if (url.username || url.password) throw Object.assign(new Error('Embedded media credentials are forbidden'), { failureClass: 'invalid_data' });
  const host = url.hostname.toLowerCase();
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error('Private IP media target blocked'), { failureClass: 'invalid_data' });
  } else {
    if (!allowedHosts.some(rule => hostMatches(host, rule))) {
      throw Object.assign(new Error('CCTV media host is not allowlisted'), { failureClass: 'invalid_data' });
    }
    const addresses = await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length) throw Object.assign(new Error('CCTV media host could not be resolved'), { failureClass: 'unavailable' });
    if (addresses.some(a => isPrivateIp(a.address))) {
      throw Object.assign(new Error('CCTV media DNS resolves to private address'), { failureClass: 'invalid_data' });
    }
  }
  return url;
}

function allowedHostsFromEnv() {
  return String(process.env.CCTV_ALLOWED_HOSTS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

module.exports = { isPrivateIp, hostMatches, assertSafeUrl, allowedHostsFromEnv };
