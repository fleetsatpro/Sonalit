'use strict';
const { XMLParser } = require('fast-xml-parser');

const FEED_URL = 'https://meteo.go.ke/api/cap/rss.xml';
const CACHE_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
let cache = null;
let cacheReceivedAt = null;
let cacheFetchedAt = 0;
let inflight = null;

function child(node, localName) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const wanted = String(localName).toLowerCase();
  const key = Object.keys(node).find(name => name.replace(/^@_/, '').split(':').pop().toLowerCase() === wanted);
  return key ? node[key] : null;
}
function text(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'string' || typeof value === 'number') {
    const result = String(value).trim();
    return result || null;
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '#text')) return text(value['#text']);
    if (Object.prototype.hasOwnProperty.call(value, '#cdata')) return text(value['#cdata']);
  }
  return null;
}
function childText(node, name) { return text(child(node, name)); }
function isoDate(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function safeKmdUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['meteo.go.ke', 'www.meteo.go.ke'].includes(url.hostname.toLowerCase())) return null;
    if (url.port && url.port !== '443') return null;
    return url.toString();
  } catch (_) { return null; }
}
function parsePolygon(value) {
  const points = String(value || '').trim().split(/\s+/).filter(Boolean).map(pair => {
    const parts = pair.split(',').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    const [lat, lon] = parts;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return [lon, lat];
  });
  if (points.length < 3 || points.some(point => !point)) return null;
  const first = points[0], last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return new Set(points.slice(0, -1).map(point => point.join(','))).size >= 3 ? points : null;
}
function normalizeAlert(alertNode, item, nowMs) {
  const info = child(alertNode, 'info');
  const status = childText(alertNode, 'status');
  const messageType = childText(alertNode, 'msgType');
  const scope = childText(alertNode, 'scope');
  const statusLower = String(status || '').toLowerCase();
  const typeLower = String(messageType || '').toLowerCase();
  const scopeLower = String(scope || '').toLowerCase();
  const sentAt = isoDate(childText(alertNode, 'sent') || childText(item, 'pubDate'));
  const effectiveAt = isoDate(childText(info, 'effective'));
  const expiresAt = isoDate(childText(info, 'expires'));
  if (status && statusLower !== 'actual') return null;
  if (scope && scopeLower !== 'public') return null;
  if (['cancel', 'test', 'exercise', 'draft', 'ack', 'error'].includes(typeLower)) return null;
  if (expiresAt && Date.parse(expiresAt) <= nowMs) return null;
  const headline = childText(info, 'headline') || childText(info, 'event') || childText(item, 'title');
  const description = childText(info, 'description') || childText(item, 'description');
  const verifiedCap = Boolean(statusLower === 'actual' && scopeLower === 'public' && ['alert', 'update'].includes(typeLower));
  const effectiveMs = effectiveAt ? Date.parse(effectiveAt) : null;
  const activeState = verifiedCap ? (effectiveMs != null && effectiveMs > nowMs ? 'UPCOMING' : 'ACTIVE') : 'DETAILS_UNVERIFIED';
  const rawAreas = child(info, 'area');
  const areas = (Array.isArray(rawAreas) ? rawAreas : rawAreas ? [rawAreas] : []).map(area => {
    const rawPolygons = child(area, 'polygon');
    const polygons = (Array.isArray(rawPolygons) ? rawPolygons : rawPolygons ? [rawPolygons] : []).map(text).map(parsePolygon).filter(Boolean);
    return { description: childText(area, 'areaDesc'), polygons };
  }).filter(area => area.description || area.polygons.length);
  const url = safeKmdUrl(childText(info, 'web') || childText(item, 'link'));
  const id = childText(alertNode, 'identifier') || url || [headline || 'official warning', sentAt || 'undated'].join('|');
  if (!headline && !url) return null;
  return {
    id, title: headline || 'Kenya Meteorological Department warning feed entry', description,
    event: childText(info, 'event'), urgency: childText(info, 'urgency'),
    severity: childText(info, 'severity'), certainty: childText(info, 'certainty'),
    status, messageType, scope, sentAt, effectiveAt, expiresAt,
    activeState, verifiedCap,
    senderName: childText(alertNode, 'senderName') || childText(alertNode, 'sender'),
    areas, url, source: 'Kenya Meteorological Department',
  };
}
function parseFeed(xml, receivedAt = new Date().toISOString(), nowMs = Date.now()) {
  const parsed = parser.parse(String(xml || ''));
  const root = child(parsed, 'rss') || parsed;
  const channel = child(root, 'channel');
  const valueItems = channel ? child(channel, 'item') : null;
  const items = Array.isArray(valueItems) ? valueItems : valueItems ? [valueItems] : [];
  const rootAlert = child(parsed, 'alert') || (childText(parsed, 'identifier') && childText(parsed, 'status') ? parsed : null);
  if (!channel && !rootAlert && !child(parsed, 'rdf')) {
    throw Object.assign(new Error('Kenya CAP feed did not contain a recognised RSS/CAP document'), {
      source: 'Kenya Meteorological Department CAP feed', failureClass: 'invalid_feed',
    });
  }
  const notices = [];
  const seen = new Set();
  for (const item of (rootAlert ? [rootAlert] : items)) {
    const alertNode = child(item, 'alert') || (childText(item, 'identifier') && childText(item, 'status') ? item : null);
    const record = normalizeAlert(alertNode, alertNode ? null : item, nowMs);
    if (!record || seen.has(record.id)) continue;
    record.url = record.url || safeKmdUrl(childText(item, 'link'));
    notices.push(record);
    seen.add(record.id);
  }
  notices.sort((a, b) => (Date.parse(b.sentAt || '') || 0) - (Date.parse(a.sentAt || '') || 0));
  return {
    source: 'Kenya Meteorological Department CAP feed', sourceUrl: FEED_URL,
    scope: 'Kenya national meteorological warning feed; this is not global alert coverage',
    receivedAt, status: 'AVAILABLE', recordCount: notices.length,
    activeCount: notices.filter(item => item.verifiedCap && item.activeState === 'ACTIVE').length,
    scheduledCount: notices.filter(item => item.activeState === 'UPCOMING').length,
    alerts: notices.slice(0, 100),
    semantics: 'Only messages marked Actual + Public + Alert/Update count as verified active CAP warnings. Missing fields remain unknown.',
  };
}
async function fetchFeed() {
  const response = await fetch(FEED_URL, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5', 'User-Agent': 'Sonalit-Weather-Warnings/1.0 (official-source-attributed)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('KMD CAP feed HTTP ' + response.status);
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('KMD CAP feed exceeded the 2 MB response bound');
  return parseFeed(body, new Date().toISOString(), Date.now());
}
async function getOfficialWeatherWarnings() {
  if (cache && Date.now() - cacheFetchedAt < CACHE_TTL_MS) return { ...cache, status: 'AVAILABLE', cacheReceivedAt: cacheReceivedAt || cache.receivedAt };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await fetchFeed();
      cache = value;
      cacheFetchedAt = Date.now();
      cacheReceivedAt = value.receivedAt;
      return { ...value, status: 'AVAILABLE', cacheReceivedAt };
    } catch (error) {
      if (cache) return { ...cache, status: 'STALE_FALLBACK', cacheReceivedAt, error: String(error && error.message || error) };
      return {
        source: 'Kenya Meteorological Department CAP feed', sourceUrl: FEED_URL,
        scope: 'Kenya national meteorological warning feed; this is not global alert coverage',
        receivedAt: null, status: 'UNAVAILABLE', recordCount: 0, activeCount: 0, scheduledCount: 0,
        alerts: [], semantics: 'No current feed payload could be verified; an unavailable feed must not be interpreted as no hazard.',
        error: String(error && error.message || error),
      };
    } finally { inflight = null; }
  })();
  return inflight;
}
module.exports = { getOfficialWeatherWarnings, __testables: { parseFeed, parsePolygon, safeKmdUrl } };
