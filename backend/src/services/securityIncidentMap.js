const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const DEFAULT_ZOOM = 15;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAPBOX_STYLE = process.env.SECURITY_MAPBOX_STYLE || 'mapbox/dark-v11';

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
  const expected = sign(encoded);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.id === String(panicId) && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}

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
      Object.assign(event, {
        convoy_id: convoy.id, convoy_name: convoy.name, convoy_region: convoy.region,
        convoy_status: convoy.status, route_origin: convoy.route_origin, route_destination: convoy.route_destination,
      });
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
  return `${base}/api/v1/webhooks/resend/security-map/${encodeURIComponent(panicId)}?token=${encodeURIComponent(createSecurityMapToken(panicId))}`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function fetchMapbox(lat, lng, zoom, event) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;
  const markerColor = 'ef4444';
  const lon = Number(lng).toFixed(6); const latitude = Number(lat).toFixed(6);
  const overlay = `pin-l-alert+${markerColor}(${lon},${latitude})`;
  const encodedStyle = encodeURIComponent(MAPBOX_STYLE);
  const url = `https://api.mapbox.com/styles/v1/${encodedStyle}/static/${overlay}/${lon},${latitude},${zoom},0,0/${MAP_WIDTH}x${MAP_HEIGHT}@2x.png?access_token=${encodeURIComponent(token)}&logo=false&attribution=true`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Sonalit-SecurityMap/2.0' } });
  if (!response.ok) throw new Error(`Mapbox static map request failed: ${response.status}`);
  const map = Buffer.from(await response.arrayBuffer());
  const label = escapeXml(String(event.vehicle_display || 'INCIDENT').slice(0, 32));
  const region = escapeXml(String(event.region || 'Unknown').slice(0, 42));
  const timestamp = escapeXml(new Date(event.created_at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));
  const coords = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  const overlaySvg = Buffer.from(`
    <svg width="${MAP_WIDTH * 2}" height="${MAP_HEIGHT * 2}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity="0.94"/><stop offset="1" stop-color="#020617" stop-opacity="0"/></linearGradient>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="7" flood-opacity="0.55"/></filter>
      </defs>
      <rect width="2400" height="260" fill="url(#top)"/>
      <rect x="48" y="42" width="860" height="132" rx="22" fill="#020617" fill-opacity="0.88" stroke="#334155" stroke-opacity="0.7"/>
      <text x="96" y="98" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" letter-spacing="4" fill="#f87171">SONALIT · SECURITY OPERATIONS</text>
      <text x="96" y="146" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="800" fill="#ffffff">CRITICAL INCIDENT · ${label}</text>
      <rect x="48" y="${1440 - 110}" width="2304" height="62" rx="15" fill="#020617" fill-opacity="0.9" stroke="#334155" stroke-opacity="0.7"/>
      <text x="80" y="${1440 - 72}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#f8fafc">INCIDENT LOCATION · ${escapeXml(coords)}</text>
      <text x="2320" y="${1440 - 72}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#cbd5e1">${region} · ${timestamp}</text>
      <text x="80" y="1388" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#cbd5e1">Vehicle / Device: ${label}</text>
      <text x="2320" y="1388" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="#94a3b8">© Mapbox · © OpenStreetMap</text>
    </svg>`);
  return sharp(map).composite([{ input: overlaySvg, left: 0, top: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

function lonToX(lon, zoom) { return ((lon + 180) / 360) * (2 ** zoom) * 256; }
function latToY(lat, zoom) {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * (2 ** zoom) * 256;
}
function clampLat(lat) { return Math.max(-85.05112878, Math.min(85.05112878, lat)); }
async function fetchTile(z, x, y) {
  const n = 2 ** z; const wrappedX = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Buffer.alloc(0);
  const response = await fetch(`https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`, { headers: { 'User-Agent': 'Sonalit-SecurityMap/2.0 (+https://sonalit.com)' } });
  if (!response.ok) throw new Error(`OSM tile request failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderOsmFallback(event) {
  const lat = clampLat(Number(event.lat)); const lng = Number(event.lng); const zoom = Number(process.env.SECURITY_MAP_ZOOM) || DEFAULT_ZOOM;
  const centerX = lonToX(lng, zoom); const centerY = latToY(lat, zoom);
  const cols = Math.ceil(MAP_WIDTH / 256) + 4; const rows = Math.ceil(MAP_HEIGHT / 256) + 4;
  const startX = Math.floor(centerX / 256) - Math.floor(cols / 2); const startY = Math.floor(centerY / 256) - Math.floor(rows / 2);
  const mosaicWidth = cols * 256; const mosaicHeight = rows * 256;
  const relX = centerX - startX * 256; const relY = centerY - startY * 256;
  const extractLeft = Math.max(0, Math.min(mosaicWidth - MAP_WIDTH, Math.floor(relX - MAP_WIDTH / 2)));
  const extractTop = Math.max(0, Math.min(mosaicHeight - MAP_HEIGHT, Math.floor(relY - MAP_HEIGHT / 2)));
  const requests = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) requests.push({ row, col, promise: fetchTile(zoom, startX + col, startY + row) });
  const tiles = await Promise.all(requests.map(r => r.promise));
  const composites = requests.map((r, i) => tiles[i].length ? { input: tiles[i], left: r.col * 256, top: r.row * 256 } : null).filter(Boolean);
  const markerX = Math.round(relX - extractLeft); const markerY = Math.round(relY - extractTop);
  const label = escapeXml(String(event.vehicle_display || 'INCIDENT').slice(0, 32));
  const region = escapeXml(String(event.region || 'Unknown').slice(0, 42));
  const timestamp = escapeXml(new Date(event.created_at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));
  const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const overlay = Buffer.from(`<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07111f" stop-opacity="0.92"/><stop offset="1" stop-color="#07111f" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="140" fill="url(#top)"/><rect x="24" y="22" width="560" height="74" rx="12" fill="#07111f" fill-opacity="0.9"/><text x="48" y="52" font-family="Arial" font-size="13" font-weight="700" letter-spacing="2" fill="#f87171">SONALIT · SECURITY OPERATIONS</text><text x="48" y="80" font-family="Arial" font-size="20" font-weight="700" fill="#fff">CRITICAL INCIDENT · ${label}</text><circle cx="${markerX}" cy="${markerY}" r="24" fill="#ef4444" fill-opacity=".2"/><circle cx="${markerX}" cy="${markerY}" r="13" fill="#ef4444" stroke="#fff" stroke-width="4"/><circle cx="${markerX}" cy="${markerY}" r="4" fill="#fff"/><rect x="24" y="666" width="1152" height="30" rx="8" fill="#07111f" fill-opacity=".9"/><text x="40" y="686" font-family="Arial" font-size="11" fill="#e2e8f0">INCIDENT LOCATION · ${escapeXml(coords)}</text><text x="1160" y="686" text-anchor="end" font-family="Arial" font-size="10" fill="#cbd5e1">${region} · ${timestamp} · © OpenStreetMap</text></svg>`);
  return sharp({ create: { width: mosaicWidth, height: mosaicHeight, channels: 4, background: '#dbeafe' } })
    .composite(composites).extract({ left: extractLeft, top: extractTop, width: MAP_WIDTH, height: MAP_HEIGHT })
    .composite([{ input: overlay, left: 0, top: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

async function renderSecurityMap(panicId) {
  const event = await resolveIncidentMapContext(panicId);
  if (!event) return null;
  const lat = clampLat(Number(event.lat)); const lng = Number(event.lng);
  try {
    const mapbox = await fetchMapbox(lat, lng, Number(process.env.SECURITY_MAP_ZOOM) || DEFAULT_ZOOM, event);
    if (mapbox) return mapbox;
  } catch (error) {
    // Mapbox is preferred for deterministic HD rendering; OSM remains a safe fallback.
    console.warn(`Security map Mapbox render failed: event=${panicId} error=${error.message}`);
  }
  return renderOsmFallback(event);
}

module.exports = { createSecurityMapToken, verifySecurityMapToken, resolveIncidentMapContext, mapUrlForPanic, renderSecurityMap };
