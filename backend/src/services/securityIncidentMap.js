const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TRAIL_MINUTES = Number(process.env.SECURITY_MAP_TRAIL_MINUTES) || 60;
const TRAIL_LIMIT = Number(process.env.SECURITY_MAP_TRAIL_LIMIT) || 120;
const MAPBOX_TIMEOUT_MS = Number(process.env.SECURITY_MAPBOX_TIMEOUT_MS) || 15000;
const MAPBOX_STYLE = process.env.SECURITY_MAPBOX_STYLE || 'mapbox/streets-v12';

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
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, clampLat(lat)] : null;
}
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
  try { return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Sonalit-SecurityMap/1.0' } }); }
  finally { clearTimeout(timer); }
}
function styleParts(style) {
  const raw = String(style || MAPBOX_STYLE).replace(/^mapbox:\/\/styles\//, '').replace(/^\//, '');
  const parts = raw.split('/').filter(Boolean);
  return parts.length === 2 ? parts : ['mapbox', 'streets-v12'];
}
function simplify(points, max = 80) {
  if (points.length <= max) return points;
  const out = [], step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
function bbox(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = Math.max(maxX - minX, 0.003), dy = Math.max(maxY - minY, 0.003);
  minX -= dx * 0.35; maxX += dx * 0.35; minY -= dy * 0.35; maxY += dy * 0.35;
  return [minX, minY, maxX, maxY];
}
function encodeOverlay(points, incident) {
  const features = [];
  if (points.length >= 2) features.push({ type: 'Feature', properties: { stroke: '#00e5ff', 'stroke-width': 7, 'stroke-opacity': 0.9 }, geometry: { type: 'LineString', coordinates: points } });
  features.push({ type: 'Feature', properties: { 'marker-color': '#ff1f3d', 'marker-size': 'large', 'marker-symbol': '!' }, geometry: { type: 'Point', coordinates: incident } });
  return encodeURIComponent(JSON.stringify({ type: 'FeatureCollection', features }));
}
async function renderWithMapbox({ incident, trail }) {
  const token = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('MAPBOX_TOKEN is not configured');
  const [username, styleId] = styleParts(MAPBOX_STYLE);
  const points = simplify([...trail, incident].filter(Boolean));
  const overlay = encodeOverlay(points, incident);
  const [minLon, minLat, maxLon, maxLat] = bbox(points);
  // Mapbox Static Images accepts bbox as [minLon,minLat,maxLon,maxLat].
  const viewport = `[${minLon},${minLat},${maxLon},${maxLat}]`;
  const url = `https://api.mapbox.com/styles/v1/${encodeURIComponent(username)}/${encodeURIComponent(styleId)}/static/geojson(${overlay})/${encodeURIComponent(viewport)}/${MAP_WIDTH}x${MAP_HEIGHT}@2x.png?access_token=${encodeURIComponent(token)}&logo=true`;
  const response = await fetchWithTimeout(url);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('image/')) {
    const body = await response.text().catch(() => '');
    throw new Error(`Mapbox static map failed: ${response.status} ${body.slice(0, 300)}`);
  }
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length < 10000) throw new Error('Mapbox returned an implausibly small image');
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
  const incident = [Number(panic.longitude), clampLat(panic.latitude)];
  if (!Number.isFinite(incident[0]) || !Number.isFinite(incident[1])) throw new Error('Incident has no valid coordinates');
  try { return await renderWithMapbox({ incident, trail: trail.length ? trail : [incident] }); }
  catch (error) {
    console.error(`Security incident map render failed panic=${panicId}: ${error.message}`);
    throw error;
  }
}
module.exports = { createSecurityMapToken, verifySecurityMapToken, getIncidentContext, renderSecurityMap };
