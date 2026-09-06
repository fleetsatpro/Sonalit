const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const TILE_SIZE = 256;
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const DEFAULT_ZOOM = 15;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  return process.env.SECURITY_MAP_SIGNING_SECRET || process.env.JWT_SECRET || 'development-only-security-map-secret';
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function createSecurityMapToken(panicId, ttlSeconds = TOKEN_TTL_SECONDS) {
  const payload = JSON.stringify({ id: String(panicId), exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const encoded = base64url(payload);
  return `${encoded}.${sign(encoded)}`;
}
function verifySecurityMapToken(token, panicId) {
  if (!token || typeof token !== 'string') return false;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = sign(encoded); const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.id === String(panicId) && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
function lonToX(lon, zoom) { return ((lon + 180) / 360) * (2 ** zoom) * TILE_SIZE; }
function latToY(lat, zoom) { const sin = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * (2 ** zoom) * TILE_SIZE; }
function clampLat(lat) { return Math.max(-85.05112878, Math.min(85.05112878, lat)); }

async function resolveIncidentMapContext(panicId) {
  const result = await query(`
    SELECT p.id, p.org_id AS panic_org_id, p.device_id, p.lat, p.lng, p.message, p.created_at,
      d.name AS device_name, d.org_id AS device_org_id, d.client_id AS device_client_id,
      d.assignment_type, d.assignment_id, d.convoy_code,
      v.id AS vehicle_id, v.registration AS vehicle_registration, v.client_id AS vehicle_client_id,
      v.org_id AS vehicle_org_id, v.region AS vehicle_region, v.assigned_convoy_id,
      c.id AS convoy_id, c.name AS convoy_name, c.region AS convoy_region, c.status AS convoy_status,
      c.route_origin, c.route_destination
    FROM panic_events p
    LEFT JOIN guardian_devices d ON d.id=p.device_id AND d.deleted_at IS NULL
    LEFT JOIN vehicles v ON v.id=d.assignment_id
      AND lower(COALESCE(d.assignment_type,'')) IN ('vehicle','fleet_vehicle')
      AND v.deleted_at IS NULL
    LEFT JOIN convoys c ON c.id=v.assigned_convoy_id AND c.deleted_at IS NULL
    WHERE p.id=$1 LIMIT 1
  `, [panicId]);
  if (!result.rows.length || result.rows[0].lat == null || result.rows[0].lng == null) return null;
  const event = result.rows[0];
  if (!event.convoy_id && event.vehicle_id) {
    const assignment = await query(`
      SELECT c.id, c.name, c.region, c.status, c.route_origin, c.route_destination
      FROM convoy_assignments ca JOIN convoys c ON c.id=ca.convoy_id
      WHERE ca.vehicle_id=$1 AND c.deleted_at IS NULL AND c.status IN ('active','planned')
      ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT 1
    `, [event.vehicle_id]);
    if (assignment.rows.length) {
      const convoy = assignment.rows[0];
      event.convoy_id = convoy.id; event.convoy_name = convoy.name; event.convoy_region = convoy.region;
      event.convoy_status = convoy.status; event.route_origin = convoy.route_origin; event.route_destination = convoy.route_destination;
    }
  }
  event.client_id = event.device_client_id || event.vehicle_client_id || null;
  event.org_id = event.panic_org_id || event.device_org_id || event.vehicle_org_id;
  event.vehicle_display = event.vehicle_registration || event.device_name || event.device_id;
  event.region = event.convoy_region || event.vehicle_region || 'Unknown';
  return event;
}
function mapUrlForPanic(panicId) {
  const base = String(process.env.SECURITY_MAP_BASE_URL || 'https://get.sonalit.com').replace(/\/$/, '');
  const token = createSecurityMapToken(panicId);
  return `${base}/api/v1/webhooks/resend/security-map/${encodeURIComponent(panicId)}?token=${encodeURIComponent(token)}`;
}

async function fetchTile(z, x, y) {
  const n = 2 ** z; const wrappedX = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Buffer.alloc(0);
  const url = `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Sonalit-SecurityMap/1.0 (+https://sonalit.com)' } });
  if (!response.ok) throw new Error(`OSM tile request failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderSecurityMap(panicId) {
  const event = await resolveIncidentMapContext(panicId); if (!event) return null;
  const lat = clampLat(Number(event.lat)); const lng = Number(event.lng);
  const zoom = Number(process.env.SECURITY_MAP_ZOOM) || DEFAULT_ZOOM;
  const centerX = lonToX(lng, zoom); const centerY = latToY(lat, zoom);
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE) + 2; const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE) + 2;
  const startX = Math.floor(centerX / TILE_SIZE) - Math.floor(cols / 2); const startY = Math.floor(centerY / TILE_SIZE) - Math.floor(rows / 2);
  const cropOriginX = startX * TILE_SIZE; const cropOriginY = startY * TILE_SIZE;
  const composites = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    const tile = await fetchTile(zoom, startX + col, startY + row);
    if (tile.length) composites.push({ input: tile, left: col * TILE_SIZE, top: row * TILE_SIZE });
  }
  const markerX = Math.round(centerX - cropOriginX); const markerY = Math.round(centerY - cropOriginY);
  const label = String(event.vehicle_display || 'INCIDENT').slice(0, 32);
  const region = String(event.region || 'Unknown').slice(0, 42);
  const timestamp = new Date(event.created_at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const overlay = Buffer.from(`
    <svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07111f" stop-opacity="0.92"/><stop offset="1" stop-color="#07111f" stop-opacity="0"/></linearGradient><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.45"/></filter></defs>
      <rect width="${MAP_WIDTH}" height="140" fill="url(#top)"/>
      <rect x="24" y="22" width="430" height="74" rx="12" fill="#07111f" fill-opacity="0.88"/>
      <text x="48" y="52" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2" fill="#f87171">SONALIT · SECURITY OPERATIONS</text>
      <text x="48" y="80" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#ffffff">CRITICAL INCIDENT · ${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
      <circle cx="${markerX}" cy="${markerY}" r="24" fill="#ef4444" fill-opacity="0.20"/><circle cx="${markerX}" cy="${markerY}" r="13" fill="#ef4444" stroke="#ffffff" stroke-width="4" filter="url(#shadow)"/><circle cx="${markerX}" cy="${markerY}" r="4" fill="#ffffff"/>
      <line x1="${markerX}" y1="${markerY + 22}" x2="${markerX}" y2="${markerY + 74}" stroke="#ffffff" stroke-opacity="0.9" stroke-width="2"/>
      <rect x="${Math.max(18, markerX - 120)}" y="${Math.min(MAP_HEIGHT - 88, markerY + 76)}" width="240" height="58" rx="10" fill="#07111f" fill-opacity="0.94"/>
      <text x="${markerX}" y="${Math.min(MAP_HEIGHT - 58, markerY + 101)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="#ffffff">${region.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
      <text x="${markerX}" y="${Math.min(MAP_HEIGHT - 39, markerY + 120)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#cbd5e1">${timestamp}</text>
      <rect x="24" y="${MAP_HEIGHT - 54}" width="${MAP_WIDTH - 48}" height="30" rx="8" fill="#07111f" fill-opacity="0.86"/>
      <text x="40" y="${MAP_HEIGHT - 34}" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#e2e8f0">INCIDENT LOCATION · ${lat.toFixed(6)}, ${lng.toFixed(6)}</text>
      <text x="${MAP_WIDTH - 40}" y="${MAP_HEIGHT - 34}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="10" fill="#cbd5e1">© OpenStreetMap contributors</text>
    </svg>`);
  return sharp({ create: { width: MAP_WIDTH, height: MAP_HEIGHT, channels: 4, background: '#dbeafe' } })
    .composite(composites)
    .extract({ left: Math.max(0, Math.floor((centerX - cropOriginX) - MAP_WIDTH / 2)), top: Math.max(0, Math.floor((centerY - cropOriginY) - MAP_HEIGHT / 2)), width: MAP_WIDTH, height: MAP_HEIGHT })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 8 }).toBuffer();
}

module.exports = { createSecurityMapToken, verifySecurityMapToken, resolveIncidentMapContext, mapUrlForPanic, renderSecurityMap };
