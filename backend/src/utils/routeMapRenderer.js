const sharp = require('sharp');
const logger = require('./logger');

const TILE_SIZE = 256;
const TILE_SERVER = 'https://tile.openstreetmap.org';
// OSM's tile usage policy requires a real identifying User-Agent and
// attribution on any rendered output — see attributionSvg() below.
const USER_AGENT = 'SonalitGuardianCFO/1.0 (convoy report map)';

// Minimal gazetteer covering common convoy-corridor towns across East/
// Southern Africa. Deliberately not backed by a live geocoding service
// (rate limits, usage-policy approval, another network dependency to fail
// silently) — any stop name not listed here is simply left off the plotted
// map and still shown in the stop list underneath it.
const GAZETTEER = {
  'kolwezi': [-10.7167, 25.4667],
  'likasi': [-10.9814, 26.7333],
  'lubumbashi': [-11.6609, 27.4794],
  'kasumbalesa': [-12.5167, 27.7833],
  'ndola': [-12.9587, 28.6366],
  'kitwe': [-12.8024, 28.2132],
  'serenje': [-13.2333, 30.2333],
  'nakonde': [-9.3333, 32.7500],
  'mbeya': [-8.9094, 33.4608],
  'mpemba': [-9.4728, 33.4658],
  'makambako': [-8.8500, 34.8167],
  'iringa': [-7.7667, 35.7000],
  'mikumi': [-7.4167, 37.0000],
  'morogoro': [-6.8278, 37.6591],
  'dar es salaam': [-6.7924, 39.2083],
  'nairobi': [-1.2921, 36.8219],
  'mombasa': [-4.0435, 39.6682],
  'kampala': [0.3476, 32.5825],
  'lusaka': [-15.3875, 28.3228],
  'harare': [-17.8292, 31.0522],
  'gaborone': [-24.6282, 25.9231],
  'dodoma': [-6.1630, 35.7516],
  'arusha': [-3.3869, 36.6830],
  'kigali': [-1.9441, 30.0619],
  'bujumbura': [-3.3822, 29.3644],
  'lilongwe': [-13.9626, 33.7741],
  'blantyre': [-15.7861, 35.0058],
  'juba': [4.8517, 31.5825],
  'addis ababa': [8.9806, 38.7578],
};

function geocode(name) {
  return GAZETTEER[(name || '').trim().toLowerCase()] || null;
}

function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function pickZoom(minLat, maxLat, minLng, maxLng, targetW, targetH) {
  for (let z = 12; z >= 2; z--) {
    const tl = lonLatToTile(minLng, maxLat, z);
    const br = lonLatToTile(maxLng, minLat, z);
    const wPx = (br.x - tl.x) * TILE_SIZE;
    const hPx = (br.y - tl.y) * TILE_SIZE;
    if (wPx <= targetW * 0.92 && hPx <= targetH * 0.92) return z;
  }
  return 2;
}

async function fetchTile(z, x, y) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xx = ((x % n) + n) % n;
  try {
    const res = await fetch(`${TILE_SERVER}/${z}/${xx}/${y}.png`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// points: [{ lat, lng, label }] in path order. Returns { buffer, width,
// height, points } where buffer is a JPEG with a real terrain/political map
// background (OSM raster tiles) and the route drawn as a straight-segment
// path between points (not road-snapped — that would need a routing
// engine, a separate and much larger integration) with pin markers; points
// gives each input point's pixel position within that buffer so the caller
// can draw its own text labels on top. Labels are deliberately NOT baked
// into the raster here: librsvg needs a system font to rasterize <text>,
// and a minimal container image may not have one installed — confirmed in
// production, where labels came out as tofu boxes while the (font-free)
// circle markers rendered fine. Returns null on any failure so callers can
// fall back to the vector schematic — a map render never breaks report
// generation.
async function renderRouteMapImage(points, { width = 860, height = 380 } = {}) {
  if (points.length < 2) return null;
  try {
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latPad = Math.max((maxLat - minLat) * 0.18, 0.08);
    const lngPad = Math.max((maxLng - minLng) * 0.18, 0.08);

    const zoom = pickZoom(minLat - latPad, maxLat + latPad, minLng - lngPad, maxLng + lngPad, width, height);
    const tl = lonLatToTile(minLng - lngPad, maxLat + latPad, zoom);
    const br = lonLatToTile(maxLng + lngPad, minLat - latPad, zoom);
    const tileX0 = Math.floor(tl.x), tileY0 = Math.floor(tl.y);
    const tileX1 = Math.floor(br.x), tileY1 = Math.floor(br.y);
    const cols = tileX1 - tileX0 + 1, rowsN = tileY1 - tileY0 + 1;
    if (cols * rowsN > 80 || cols < 1 || rowsN < 1) {
      logger.warn(`[routeMap] tile mosaic too large (${cols}x${rowsN}) — skipping real map`);
      return null;
    }

    const tileJobs = [];
    for (let ty = tileY0; ty <= tileY1; ty++) {
      for (let tx = tileX0; tx <= tileX1; tx++) tileJobs.push({ tx, ty, promise: fetchTile(zoom, tx, ty) });
    }
    await Promise.all(tileJobs.map((t) => t.promise));

    const mosaicW = cols * TILE_SIZE, mosaicH = rowsN * TILE_SIZE;
    const composites = [];
    for (const t of tileJobs) {
      const buf = await t.promise;
      if (buf) composites.push({ input: buf, left: (t.tx - tileX0) * TILE_SIZE, top: (t.ty - tileY0) * TILE_SIZE });
    }
    if (composites.length < tileJobs.length * 0.6) {
      logger.warn(`[routeMap] only ${composites.length}/${tileJobs.length} tiles fetched — skipping real map`);
      return null;
    }

    const project = (lat, lng) => {
      const p = lonLatToTile(lng, lat, zoom);
      return { x: (p.x - tileX0) * TILE_SIZE, y: (p.y - tileY0) * TILE_SIZE };
    };
    const pts = points.map((p) => ({ ...project(p.lat, p.lng), label: p.label }));
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const markers = pts.map((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      const r = isEnd ? 7 : 4.5;
      const fill = isEnd ? '#d97706' : '#ffffff';
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="#78350f" stroke-width="2"/>`;
    }).join('');
    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mosaicW}" height="${mosaicH}">
      <path d="${pathD}" fill="none" stroke="#1d4ed8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.88"/>
      ${markers}
    </svg>`;

    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const cropPad = 44;
    const cropX = Math.max(0, Math.floor(minX - cropPad));
    const cropY = Math.max(0, Math.floor(minY - cropPad));
    const cropW = Math.min(mosaicW - cropX, Math.ceil(maxX - minX + cropPad * 2));
    const cropH = Math.min(mosaicH - cropY, Math.ceil(maxY - minY + cropPad * 2));

    // Chaining .extract()/.resize() directly onto a .composite() pipeline in
    // this sharp version throws a spurious "Image to composite must have
    // same dimensions or smaller" error even though every composited input
    // is provably within bounds (confirmed by isolating each step) — merging
    // the composite to a buffer first, then starting a fresh pipeline for
    // the crop/resize, sidesteps it.
    const merged = await sharp({ create: { width: mosaicW, height: mosaicH, channels: 3, background: '#e5e7eb' } })
      .composite([...composites, { input: Buffer.from(overlaySvg), left: 0, top: 0 }])
      .png()
      .toBuffer();
    // fit: 'contain' (not 'cover') keeps a single uniform scale + centering
    // offset from crop-space to final-image-space, so point positions can be
    // reprojected deterministically for the caller's text labels; 'cover'
    // would additionally crop unpredictably depending on aspect ratio.
    const out = await sharp(merged)
      .extract({ left: cropX, top: cropY, width: Math.max(1, cropW), height: Math.max(1, cropH) })
      .resize({ width, height, fit: 'contain', background: '#e5e7eb' })
      .jpeg({ quality: 82 })
      .toBuffer();

    const scale = Math.min(width / cropW, height / cropH);
    const offX = (width - cropW * scale) / 2;
    const offY = (height - cropH * scale) / 2;
    const finalPoints = pts.map((p, i) => ({
      x: offX + (p.x - cropX) * scale,
      y: offY + (p.y - cropY) * scale,
      label: p.label,
      endpoint: i === 0 || i === pts.length - 1,
    }));

    return { buffer: out, width, height, points: finalPoints };
  } catch (err) {
    logger.warn(`[routeMap] render failed: ${err.message}`);
    return null;
  }
}

module.exports = { geocode, renderRouteMapImage, GAZETTEER, lonLatToTile, pickZoom };
