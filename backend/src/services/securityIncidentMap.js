const crypto = require('crypto');
const sharp = require('sharp');
const { query } = require('../config/database');

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 720;
const DEFAULT_ZOOM = 15;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAPBOX_STYLE = process.env.SECURITY_MAPBOX_STYLE || 'mapbox/streets-v12';
const TRAIL_MINUTES = Number(process.env.SECURITY_MAP_TRAIL_MINUTES) || 60;
const TRAIL_LIMIT = Number(process.env.SECURITY_MAP_TRAIL_LIMIT) || 120;
const MAPBOX_TIMEOUT_MS = Number(process.env.SECURITY_MAPBOX_TIMEOUT_MS) || 12000;

function secret() {
  return process.env.SECURITY_MAP_SIGNING_SECRET || process.env.JWT_SECRET || 'development-only-security-map-secret';
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }

function createSecurityMapToken(panicId, ttlSeconds = TOKEN_TTL_SECONDS) {
  const encoded = base64url(JSON.stringify({ id: String(panicId), exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
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
    if (assignment.rows.length) Object.assign(event, {
      convoy_id: assignment.rows[0].id, convoy_name: assignment.rows[0].name,
      convoy_region: assignment.rows[0].region, convoy_status: assignment.rows[0].status,
      route_origin: assignment.rows[0].route_origin, route_destination: assignment.rows[0].route_destination,
    });
  }

  event.client_id = event.device_client_id || event.vehicle_client_id || null;
  event.org_id = event.panic_org_id || event.device_org_id || event.vehicle_org_id;
  event.vehicle_display = event.vehicle_registration || event.device_name || event.device_id;
  event.region = event.convoy_region || event.vehicle_region || 'Unknown';

  if (event.device_id) {
    const trail = await query(`
      SELECT lat, lng, speed, heading AS bearing, timestamp
      FROM device_locations
      WHERE device_id=$1
        AND timestamp BETWEEN ($2::timestamptz - ($3::int * INTERVAL '1 minute')) AND $2::timestamptz
        AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY timestamp ASC LIMIT $4
    `, [event.device_id, event.created_at, TRAIL_MINUTES, TRAIL_LIMIT]);
    event.trail = trail.rows.map(row => ({
      lat: Number(row.lat), lng: Number(row.lng),
      speed: row.speed == null ? null : Number(row.speed),
      bearing: row.bearing == null ? null : Number(row.bearing), timestamp: row.timestamp,
    }));
  } else event.trail = [];

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
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function clampLat(lat) { return Math.max(-85.05112878, Math.min(85.05112878, lat)); }
function roundCoord(value) { return Math.round(Number(value) * 100000) / 100000; }

function sampleTrail(points, maxPoints = 55) {
  if (points.length <= maxPoints) return points;
  const output = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (maxPoints - 1));
    output.push(points[index]);
  }
  return output;
}

function calculateBounds(event) {
  const points = sampleTrail((event.trail || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
  const all = points.length ? points : [{ lat: Number(event.lat), lng: Number(event.lng) }];
  const lats = all.map(p => clampLat(Number(p.lat)));
  const lngs = all.map(p => Number(p.lng));
  let minLat = Math.min(...lats); let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs); let maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, 0.002);
  const lngSpan = Math.max(maxLng - minLng, 0.002);
  const latPad = Math.max(latSpan * 0.18, 0.001);
  const lngPad = Math.max(lngSpan * 0.18, 0.001);
  minLat = clampLat(minLat - latPad); maxLat = clampLat(maxLat + latPad);
  minLng = Math.max(-180, minLng - lngPad); maxLng = Math.min(180, maxLng + lngPad);
  return { minLng, minLat, maxLng, maxLat };
}

function parseMapboxStyle() {
  const parts = String(MAPBOX_STYLE).split('/').filter(Boolean);
  return { username: parts[0] || 'mapbox', styleId: parts.slice(1).join('/') || 'streets-v12' };
}

function assertImageResponse(response, provider) {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`${provider} returned non-image content-type=${type || 'missing'}`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MAPBOX_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function buildMapboxGeoJson(event) {
  const points = sampleTrail((event.trail || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
  const coordinates = points.map(p => [roundCoord(p.lng), roundCoord(clampLat(p.lat))]);
  const features = [];
  if (coordinates.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { stroke: '#00d9ff', 'stroke-width': 5, 'stroke-opacity': 0.95 },
      geometry: { type: 'LineString', coordinates },
    });
  }
  features.push({
    type: 'Feature',
    properties: { 'marker-color': '#ef4444', 'marker-size': 'large', 'marker-symbol': 'alert' },
    geometry: { type: 'Point', coordinates: [roundCoord(event.lng), roundCoord(clampLat(event.lat))] },
  });
  return { type: 'FeatureCollection', features };
}

async function renderMapboxStatic(event) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;

  const { username, styleId } = parseMapboxStyle();
  const bounds = calculateBounds(event);
  const geojson = encodeURIComponent(JSON.stringify(buildMapboxGeoJson(event)));
  const overlay = `geojson(${geojson})`;
  const bbox = `[${bounds.minLng.toFixed(5)},${bounds.minLat.toFixed(5)},${bounds.maxLng.toFixed(5)},${bounds.maxLat.toFixed(5)}]`;
  const url = `https://api.mapbox.com/styles/v1/${encodeURIComponent(username)}/${encodeURIComponent(styleId)}/static/${overlay}/${bbox}/${MAP_WIDTH}x${MAP_HEIGHT}.png?padding=90,30,90,30&attribution=true&logo=true&access_token=${encodeURIComponent(token)}`;

  if (url.length > 8100) {
    throw new Error(`Mapbox static URL too long: ${url.length}`);
  }

  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Sonalit-SecurityMap/6.0' } });
  if (!response.ok) throw new Error(`Mapbox static request failed: ${response.status}`);
  assertImageResponse(response, 'Mapbox');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length < 1000) throw new Error(`Mapbox static image unexpectedly small: ${body.length} bytes`);

  const header = Buffer.from(`<svg width="${MAP_WIDTH}" height="142" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity=".96"/><stop offset="1" stop-color="#020617" stop-opacity="0"/></linearGradient></defs><rect width="${MAP_WIDTH}" height="142" fill="url(#g)"/><rect x="24" y="20" width="760" height="96" rx="14" fill="#020617" fill-opacity=".92" stroke="#475569" stroke-opacity=".8"/><text x="48" y="52" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="2.5" fill="#f87171">SONALIT · SECURITY OPERATIONS</text><text x="48" y="88" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="800" fill="#fff">CRITICAL INCIDENT · ${escapeXml(String(event.vehicle_display || 'INCIDENT').slice(0, 34))}</text></svg>`);
  const footer = Buffer.from(`<svg width="${MAP_WIDTH}" height="64" xmlns="http://www.w3.org/2000/svg"><rect x="24" y="8" width="${MAP_WIDTH - 48}" height="48" rx="10" fill="#020617" fill-opacity=".90" stroke="#475569" stroke-opacity=".75"/><text x="42" y="38" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="700" fill="#f8fafc">${escapeXml(String(event.region || 'Unknown'))} · ${escapeXml(String(event.convoy_name || event.convoy_code || 'No convoy'))} · ${escapeXml(new Date(event.created_at).toISOString().replace('T',' ').replace(/\.\d{3}Z$/, ' UTC'))}</text><text x="${MAP_WIDTH - 42}" y="38" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#cbd5e1">GPS trail ${(event.trail || []).length} fixes · Mapbox</text></svg>`);

  return sharp(body).png().composite([
    { input: header, left: 0, top: 0 },
    { input: footer, left: 0, top: MAP_HEIGHT - 64 },
  ]).png({ compressionLevel: 8 }).toBuffer();
}

function lonToX(lon, zoom) { return ((lon + 180) / 360) * (2 ** zoom) * 256; }
function latToY(lat, zoom) { const sin = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * (2 ** zoom) * 256; }

function tileXY(z, x, y) {
  const n = 2 ** z;
  return { x: ((x % n) + n) % n, y };
}

function tileRange(event, zoom) {
  const centerX = lonToX(event.centerLng, zoom); const centerY = latToY(clampLat(event.centerLat), zoom);
  const cols = Math.ceil(MAP_WIDTH / 256) + 2; const rows = Math.ceil(MAP_HEIGHT / 256) + 2;
  return { centerX, centerY, cols, rows, startX: Math.floor(centerX / 256) - Math.floor(cols / 2), startY: Math.floor(centerY / 256) - Math.floor(rows / 2) };
}

async function fetchTomTomTile(z, x, y) {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) return null;
  const tile = tileXY(z, x, y);
  if (tile.y < 0 || tile.y >= 2 ** z) return Buffer.alloc(0);
  const url = `https://api.tomtom.com/maps/orbis/display/raster/tile/${z}/${tile.x}/${tile.y}?apiVersion=2&style=street-light&tileSize=256&geopoliticalView=Unified&key=${encodeURIComponent(key)}`;
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Sonalit-SecurityMap/6.0' } }, 10000);
  if (!response.ok) throw new Error(`TomTom tile request failed: ${response.status}`);
  assertImageResponse(response, 'TomTom');
  return Buffer.from(await response.arrayBuffer());
}

async function stitchTomTom(event, zoom) {
  const range = tileRange(event, zoom);
  const jobs = [];
  for (let row = 0; row < range.rows; row += 1) for (let col = 0; col < range.cols; col += 1) {
    jobs.push({ row, col, promise: fetchTomTomTile(zoom, range.startX + col, range.startY + row) });
  }
  const settled = await Promise.allSettled(jobs.map(j => j.promise));
  const composites = settled.flatMap((r, i) => r.status === 'fulfilled' && r.value?.length ? [{ input: r.value, left: jobs[i].col * 256, top: jobs[i].row * 256 }] : []);
  if (!composites.length) throw new Error('TomTom returned no usable tiles');
  const extractLeft = Math.max(0, Math.min(range.cols * 256 - MAP_WIDTH, Math.floor(range.centerX - range.startX * 256 - MAP_WIDTH / 2)));
  const extractTop = Math.max(0, Math.min(range.rows * 256 - MAP_HEIGHT, Math.floor(range.centerY - range.startY * 256 - MAP_HEIGHT / 2)));
  const markerX = Math.round(range.centerX - range.startX * 256 - extractLeft);
  const markerY = Math.round(range.centerY - range.startY * 256 - extractTop);
  const points = sampleTrail((event.trail || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
  const trail = points.length >= 2 ? Buffer.from(`<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><polyline points="${points.map(p => `${Math.round(lonToX(p.lng, zoom)-extractLeft)},${Math.round(latToY(clampLat(p.lat), zoom)-extractTop)}`).join(' ')}" fill="none" stroke="#00d9ff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${markerX}" cy="${markerY}" r="17" fill="#ef4444" stroke="#fff" stroke-width="4"/></svg>`) : Buffer.from(`<svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><circle cx="${markerX}" cy="${markerY}" r="17" fill="#ef4444" stroke="#fff" stroke-width="4"/></svg>`);
  const header = Buffer.from(`<svg width="${MAP_WIDTH}" height="142" xmlns="http://www.w3.org/2000/svg"><rect width="${MAP_WIDTH}" height="142" fill="#020617" fill-opacity=".92"/><text x="48" y="52" font-family="Arial" font-size="13" font-weight="700" letter-spacing="2.5" fill="#f87171">SONALIT · SECURITY OPERATIONS</text><text x="48" y="88" font-family="Arial" font-size="25" font-weight="800" fill="#fff">CRITICAL INCIDENT · ${escapeXml(String(event.vehicle_display || 'INCIDENT').slice(0,34))}</text></svg>`);
  return sharp({ create: { width: range.cols * 256, height: range.rows * 256, channels: 4, background: '#e5e7eb' } }).composite(composites).extract({ left: extractLeft, top: extractTop, width: MAP_WIDTH, height: MAP_HEIGHT }).composite([{ input: trail, left: 0, top: 0 }, { input: header, left: 0, top: 0 }]).png({ compressionLevel: 8 }).toBuffer();
}

async function renderSecurityMap(panicId) {
  const event = await resolveIncidentMapContext(panicId);
  if (!event) return null;

  try {
    const image = await renderMapboxStatic(event);
    if (image) return image;
  } catch (error) {
    console.warn(`Security map provider failed: provider=Mapbox event=${panicId} error=${error.message}`);
  }

  try {
    const viewport = calculateViewport(event);
    event.centerLat = viewport.centerLat; event.centerLng = viewport.centerLng;
    const image = await stitchTomTom(event, viewport.zoom);
    if (image) return image;
  } catch (error) {
    console.error(`Security map fallback failed: provider=TomTom event=${panicId} error=${error.message}`);
  }

  // Never manufacture a fake basemap. A red dot on an empty canvas is misleading.
  // If every provider fails, the route returns 502 and the failure is visible in logs.
  return null;
}

module.exports = {
  createSecurityMapToken,
  verifySecurityMapToken,
  mapUrlForPanic,
  renderSecurityMap,
};
