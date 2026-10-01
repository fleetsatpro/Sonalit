'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIp(value) {
  const raw = String(value || '').split('%')[0].toLowerCase();
  if (net.isIP(raw) === 4) {
    const [a,b] = raw.split('.').map(Number);
    const c = Number(raw.split('.')[2]);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && b >= 18 && b <= 19) ||
      (a === 192 && b === 0 && c >= 0) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 198 && b === 51 && c === 100) ||
      (a >= 224);
  }
  if (net.isIP(raw) === 6) {
    const normalized = raw;
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('2001:db8') || normalized.startsWith('2001:0db8') ||
        normalized.startsWith('fc') || normalized.startsWith('fd') ||
        normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
        normalized.startsWith('fea') || normalized.startsWith('feb') ||
        normalized.startsWith('ff')) return true;

    // Block IPv4-mapped IPv6 loopback/private/multicast addresses in both
    // dotted-decimal and hexadecimal tail forms.
    const mapped = normalized.match(/^::ffff:(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (net.isIP(tail) === 4) return isPrivateIp(tail);
      if (/^[0-9a-f]{1,8}$/.test(tail)) {
        const n = Number.parseInt(tail, 16);
        const v4 = [
          (n >>> 24) & 255,
          (n >>> 16) & 255,
          (n >>> 8) & 255,
          n & 255
        ].join('.');
        return isPrivateIp(v4);
      }
    }

    // IPv4-mapped form can also be rendered as ::ffff:0:xxxx.
    if (normalized.startsWith('::ffff:')) {
      const parts = normalized.split(':').filter(Boolean);
      if (parts.length === 3 && /^[0-9a-f]{1,4}$/.test(parts[1]) && /^[0-9a-f]{1,4}$/.test(parts[2])) {
        const n = (Number.parseInt(parts[1],16) << 16) | Number.parseInt(parts[2],16);
        return isPrivateIp([
          (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255
        ].join('.'));
      }
    }
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
    // Literal IPs must be explicitly allowlisted. Otherwise an IP can bypass
    // the hostname allowlist even when the destination is public.
    if (!allowedHosts.some(rule => hostMatches(host, rule))) {
      throw Object.assign(new Error('CCTV media IP is not explicitly allowlisted'), { failureClass: 'invalid_data' });
    }
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
