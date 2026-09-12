const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TRAIL_MINUTES = Number(process.env.SECURITY_MAP_TRAIL_MINUTES) || 60;
const TRAIL_LIMIT = Number(process.env.SECURITY_MAP_TRAIL_LIMIT) || 120;
const MAPBOX_TIMEOUT_MS = Number(process.env.SECURITY_MAPBOX_TIMEOUT_MS) || 15000;
// Use a known-good public Mapbox style by default. A malformed custom style must
// never silently turn the incident image into a blank canvas.
const MAPBOX_STYLE = process.env.SECURITY_MAPBOX_STYLE || 'mapbox/light-v11';

function secret() { return process.env.SECURITY_MAP_SIGNING_SECRET || process.env.JWT_SECRET || 'development-only-security-map-secret'; }
function base64url(v) { return Buffer.from(v).toString('base64url'); }
function sign(v) { return crypto.createHmac('sha256', secret()).update(v).digest('base64url'); }
function createSecurityMapToken(panicId, ttlSeconds = TOKEN_TTL_SECONDS) {
  const payload = `${panicId}.${Date.now() + ttlSeconds * 1000}`;
  return `${base64url(payload)}.${sign(payload)}`;
}
function verifySecurityMapToken(token, panicId) {
  if (!token || !panicId) return false;
  const [encoded, signature] = String(token).split('.');
  if (!encoded || !signature) return false;
  let payload;
  try { payload = Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return false; }
  const [id, expiry] = payload.split('.');
  if (id !== String(panicId) || Number(expiry) < Date.now()) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function clampLat(lat) { return Math.max(-85.0511, Math.min(85.0511, Number(lat))); }
function normalizePoint(row) {
  const lat = Number(row.latitude), lon = Number(row.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [Number(lon.toFixed(6)), Number(clampLat(lat).toFixed(6))] : null;
}
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
  try { return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Sonalit-SecurityMap/2.0' } }); }
  finally { clearTimeout(timer); }
}
function styleParts(style) {
  const raw = String(style || MAPBOX_STYLE)
    .replace(/^mapbox:\/\/styles\//, '')
    .replace(/^https?:\/\/api\.mapbox\.com\/styles\/v1\//, '')
    .replace(/^\//, '');
  const parts = raw.split('/').filter(Boolean);
  return parts.length === 2 ? parts : ['mapbox', 'light-v11'];
}
function simplify(points, max = 36) {
  if (points.length <= max) return points;
  const out = [], step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
function overlayGeoJson(points, incident) {
  const features = [];
  if (points.length >= 2) features.push({
    type: 'Feature',
    properties: { stroke: '#00B8D9', 'stroke-width': 6, 'stroke-opacity': 0.9 },
    geometry: { type: 'LineString', coordinates: points }
  });
  features.push({
    type: 'Feature',
    properties: { 'marker-color': '#FF173D', 'marker-size': 'large', 'marker-symbol': 'circle' },
    geometry: { type: 'Point', coordinates: incident }
  });
  return encodeURIComponent(JSON.stringify({ type: 'FeatureCollection', features }));
}
function calculateViewport(incident, trail) {
  const points = [...trail, incident].filter(Boolean);
  const lons = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const lonSpan = Math.max(maxLon - minLon, 0.0025);
  const latSpan = Math.max(maxLat - minLat, 0.0025);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  // Conservative zoom calculation for a 1200x720 map. Never zoom so far out
  // that a local incident becomes an indistinguishable dot.
  const zoomLon = Math.log2(360 * 0.78 / lonSpan);
  const zoomLat = Math.log2(170 * 0.78 / latSpan);
  const zoom = Math.max(10, Math.min(17, Math.floor(Math.min(zoomLon, zoomLat))));
  return { lon: centerLon, lat: centerLat, zoom };
}
async function renderWithMapbox({ incident, trail }) {
  const token = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_TOKEN is not configured');
  const [username, styleId] = styleParts(MAPBOX_STYLE);
  const points = simplify([...trail, incident].filter(Boolean));
  const overlay = overlayGeoJson(points, incident);
  const viewport = calculateViewport(incident, points);

  // Deliberately use a fixed lon/lat/zoom viewport rather than `auto`. This
  // isolates the basemap request from overlay/auto-fit failures. Mapbox then
  // renders the real basemap first and applies the GeoJSON overlay in the same
  // request. No @2x is used because the API's 1280px dimension limit is a hard
  // constraint; 1200x720 is already high definition for email.
  const location = `${viewport.lon.toFixed(6)},${viewport.lat.toFixed(6)},${viewport.zoom}`;
  const url = `https://api.mapbox.com/styles/v1/${encodeURIComponent(username)}/${encodeURIComponent(styleId)}/static/geojson(${overlay})/${location}/${MAP_WIDTH}x${MAP_HEIGHT}.png?access_token=${encodeURIComponent(token)}`;
  if (url.length > 8000) throw new Error(`Mapbox static request too long (${url.length} chars)`);

  const response = await fetchWithTimeout(url);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('image/')) {
    const body = await response.text().catch(() => '');
    throw new Error(`Mapbox static map failed: ${response.status} ${body.slice(0, 500)}`);
  }
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length < 10000) throw new Error(`Mapbox returned an implausibly small image (${image.length} bytes)`);
  return sharp(image).png().toBuffer();
}
async function getIncidentContext(panicId) {
  const panic = await query(`SELECT p.id, p.device_id, p.latitude, p.longitude, p.created_at, p.message,
      d.name AS device_name, d.client_id, v.plate AS vehicle_plate
    FROM panic_alerts p LEFT JOIN devices d ON d.id=p.device_id LEFT JOIN vehicles v ON v.id=d.vehicle_id
    WHERE p.id=$1 LIMIT 1`, [panicId]);
  if (!panic.rows[0]) throw new Error('Panic incident not found');
  const p = panic.rows[0];
  const trail = await query(`SELECT latitude, longitude, heading, recorded_at FROM device_locations
    WHERE device_id=$1 AND recorded_at BETWEEN $2 AND $3 AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY recorded_at ASC LIMIT $4`, [p.device_id, new Date(new Date(p.created_at).getTime() - TRAIL_MINUTES * 60000), new Date(p.created_at), TRAIL_LIMIT]);
  return { panic: p, trail: trail.rows.map(normalizePoint).filter(Boolean) };
}
async function renderSecurityMap(panicId) {
  const { panic, trail } = await getIncidentContext(panicId);
  const incident = [Number(Number(panic.longitude).toFixed(6)), Number(clampLat(panic.latitude).toFixed(6))];
  if (!Number.isFinite(incident[0]) || !Number.isFinite(incident[1])) throw new Error('Incident has no valid coordinates');
  try { return await renderWithMapbox({ incident, trail: trail.length ? trail : [incident] }); }
  catch (error) {
    console.error(`Security incident map render failed panic=${panicId}: ${error.message}`);
    throw error;
  }
}
module.exports = { createSecurityMapToken, verifySecurityMapToken, getIncidentContext, renderSecurityMap };