const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const DEFAULT_ZOOM = 15;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAPBOX_STYLE = process.env.SECURITY_MAPBOX_STYLE || 'mapbox/dark-v11';
const TRAIL_MINUTES = Number(process.env.SECURITY_MAP_TRAIL_MINUTES) || 60;
const TRAIL_LIMIT = Number(process.env.SECURITY_MAP_TRAIL_LIMIT) || 120;

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

  // Pull only the device's recent, authoritative GPS history. This is deliberately
  // scoped by device_id and a bounded time window to avoid cross-tenant/cross-device leakage.
  if (event.device_id) {
    const trail = await query(`
      SELECT lat, lng, speed, bearing, timestamp
      FROM device_locations
      WHERE device_id=$1
        AND timestamp BETWEEN ($2::timestamptz - ($3::int * INTERVAL '1 minute')) AND $2::timestamptz
        AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY timestamp ASC
      LIMIT $4
    `, [event.device_id, event.created_at, TRAIL_MINUTES, TRAIL_LIMIT]);
    event.trail = trail.rows.map(row => ({
      lat: Number(row.lat), lng: Number(row.lng), speed: row.speed == null ? null : Number(row.speed),
      bearing: row.bearing == null ? null : Number(row.bearing), timestamp: row.timestamp,
    }));
  } else event.trail = [];

  // Ensure the panic coordinate is always the terminal point even when the GPS history
  // was delayed or the panic was generated independently of a location upload.
  const last = event.trail[event.trail.length - 1];
  if (!last || Math.abs(last.lat - Number(event.lat)) > 0.000001 || Math.abs(last.lng - Number(event.lng)) > 0.000001) {
    event.trail.push({ lat: Number(event.lat), lng: Number(event.lng), speed: null, bearing: last?.bearing ?? null, timestamp: event.created_at });
  }
  return event;
}

function mapUrlForPanic(panicId) {
  const base = String(process.env.SECURITY_MAP_BASE_URL || 'https://get.sonalit.com').replace(/\/$/, '');
  return `${base}/api/v1/webhooks/resend/security-map/${encodeURIComponent(panicId)}?token=${encodeURIComponent(createSecurityMapToken(panicId))}`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function encodePolyline(points) {
  let previousLat = 0; let previousLng = 0; let output = '';
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5); const lng = Math.round(point.lng * 1e5);
    for (const value of [lat - previousLat, lng - previousLng]) {
      let shifted = value < 0 ? ~(value << 1) : (value << 1);
      while (shifted >= 0x20) { output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63); shifted >>= 5; }
      output += String.fromCharCode(shifted + 63);
    }
    previousLat = lat; previousLng = lng;
  }
  return output;
}

function calculateViewport(event) {
  const points = (event.trail || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!points.length) return { centerLat: Number(event.lat), centerLng: Number(event.lng), zoom: Number(process.env.SECURITY_MAP_ZOOM) || DEFAULT_ZOOM };
  const lats = points.map(p => p.lat); const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2; const centerLng = (minLng + maxLng) / 2;
  const latSpan = Math.max(maxLat - minLat, 0.001); const lngSpan = Math.max(maxLng - minLng, 0.001);
  const span = Math.max(latSpan, lngSpan * Math.cos(centerLat * Math.PI / 180));
  let zoom = Math.log2(180 / span) - 0.7;
  if (points.length === 1) zoom = Number(process.env.SECURITY_MAP_ZOOM) || DEFAULT_ZOOM;
  zoom = Math.max(10, Math.min(17, Math.floor(zoom * 10) / 10));
  return { centerLat, centerLng, zoom };
}

function tacticalOverlaySvg(event, width = MAP_WIDTH, height = MAP_HEIGHT, marker = null) {
  const label = escapeXml(String(event.vehicle_display || 'INCIDENT').slice(0, 32));
  const region = escapeXml(String(event.region || 'Unknown').slice(0, 42));
  const coords = `${Number(event.lat).toFixed(6)}, ${Number(event.lng).toFixed(6)}`;
  const timestamp = escapeXml(new Date(event.created_at).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));
  const convoy = escapeXml(String(event.convoy_name || event.convoy_code || 'No convoy').slice(0, 42));
  const markerX = marker?.x ?? width / 2; const markerY = marker?.y ?? height / 2;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity="0.96"/><stop offset="1" stop-color="#020617" stop-opacity="0"/></linearGradient></defs>
    <rect width="${width}" height="150" fill="url(#top)"/>
    <rect x="24" y="22" width="690" height="92" rx="14" fill="#020617" fill-opacity="0.9" stroke="#334155" stroke-opacity="0.75"/>
    <text x="48" y="53" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#f87171">SONALIT · SECURITY OPERATIONS</text>
    <text x="48" y="87" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="800" fill="#ffffff">CRITICAL INCIDENT · ${label}</text>
    <g><circle cx="${markerX}" cy="${markerY}" r="30" fill="#ef4444" fill-opacity=".20"/><circle cx="${markerX}" cy="${markerY}" r="15" fill="#ef4444" stroke="#fff" stroke-width="4"/><circle cx="${markerX}" cy="${markerY}" r="5" fill="#fff"/></g>
    <rect x="24" y="${height - 70}" width="${width - 48}" height="46" rx="10" fill="#020617" fill-opacity="0.92" stroke="#334155" stroke-opacity="0.7"/>
    <text x="42" y="${height - 42}" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" fill="#f8fafc">INCIDENT · ${escapeXml(coords)}</text>
    <text x="${width - 42}" y="${height - 42}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#cbd5e1">${region} · ${convoy} · ${timestamp}</text>
    <text x="42" y="${height - 7}" font-family="Arial,Helvetica,sans-serif" font-size="10" fill="#94a3b8">GPS trail: ${(event.trail || []).length} fixes · © Mapbox · © OpenStreetMap</text>
  </svg>`);
}

async function fetchMapbox(event) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;
  const points = (event.trail || []).slice(-TRAIL_LIMIT);
  const viewport = calculateViewport(event);
  const lon = viewport.centerLng.toFixed(6); const lat = viewport.centerLat.toFixed(6);
  const incidentLon = Number(event.lng).toFixed(6); const incidentLat = Number(event.lat).toFixed(6);
  const overlays = [];
  if (points.length >= 2) {
    const polyline = encodePolyline(points);
    overlays.push(`path-7+38bdf8-0.95(${encodeURIComponent(polyline)})`);
  }
  overlays.push(`pin-l-alert+ef4444(${incidentLon},${incidentLat})`);
  const overlay = overlays.join(',');
  // IMPORTANT: Mapbox expects username/style_id as separate path segments.
  // Encoding the entire "mapbox/dark-v11" string produces a 404.
  const style = MAPBOX_STYLE.split('/').filter(Boolean);
  const username = style.shift() || 'mapbox';
  const styleId = style.join('/') || 'dark-v11';
  const url = `https://api.mapbox.com/styles/v1/${encodeURIComponent(username)}/${encodeURIComponent(styleId)}/static/${overlay}/auto/${MAP_WIDTH}x${MAP_HEIGHT}@2x.png?access_token=${encodeURIComponent(token)}&logo=false&attribution=true&padding=80`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Sonalit-SecurityMap/3.0' } });
  if (!response.ok) throw new Error(`Mapbox static map request failed: ${response.status}`);
  const map = Buffer.from(await response.arrayBuffer());
  return sharp(map).composite([{ input: tacticalOverlaySvg(event, MAP_WIDTH * 2, MAP_HEIGHT * 2) }]).png({ compressionLevel: 8 }).toBuffer();
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
  const response = await fetch(`https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`, { headers: { 'User-Agent': 'Sonalit-SecurityMap/3.0 (+https://sonalit.com)' } });
  if (!response.ok) throw new Error(`OSM tile request failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderOsmFallback(event) {
  const points = (event.trail || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const viewport = calculateViewport(event);
  const lat = clampLat(viewport.centerLat); const lng = viewport.centerLng; const zoom = Math.max(10, Math.min(17, Math.round(viewport.zoom)));
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
  const overlay = tacticalOverlaySvg(event, MAP_WIDTH, MAP_HEIGHT, { x: markerX, y: markerY });
  const trailOverlay = points.length >= 2 ? Buffer.from(`<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><polyline points="${points.map(p => `${Math.round(lonToX(p.lng, zoom)-extractLeft)},${Math.round(latToY(p.lat, zoom)-extractTop)}`).join(' ')}" fill="none" stroke="#38bdf8" stroke-width="6" stroke-opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`) : null;
  return sharp({ create: { width: mosaicWidth, height: mosaicHeight, channels: 4, background: '#dbeafe' } })
    .composite(composites).extract({ left: extractLeft, top: extractTop, width: MAP_WIDTH, height: MAP_HEIGHT })
    .composite(trailOverlay ? [{ input: trailOverlay, left: 0, top: 0 }, { input: overlay, left: 0, top: 0 }] : [{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 8 }).toBuffer();
}

async function renderSecurityMap(panicId) {
  const event = await resolveIncidentMapContext(panicId);
  if (!event) return null;
  try {
    const mapbox = await fetchMapbox(event);
    if (mapbox) return mapbox;
  } catch (error) {
    console.warn(`Security map Mapbox render failed: event=${panicId} error=${error.message}`);
  }
  try {
    return await renderOsmFallback(event);
  } catch (error) {
    console.error(`Security map OSM fallback failed: event=${panicId} error=${error.message}`);
    return null;
  }
}

module.exports = { createSecurityMapToken, verifySecurityMapToken, resolveIncidentMapContext, mapUrlForPanic, renderSecurityMap };
