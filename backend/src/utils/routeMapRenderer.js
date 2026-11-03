const sharp = require('sharp');
const logger = require('./logger');
const { geocodePlace } = require('./geocode');

const TILE_SIZE = 256;
const TILE_SERVER = 'https://tile.openstreetmap.org';
// OSM's tile usage policy requires a real identifying User-Agent and
// attribution on any rendered output — callers print "(c) OpenStreetMap
// contributors" under every map produced here.
const USER_AGENT = 'SonalitGuardianCFO/1.0 (convoy report map)';

// Report maps are rendered for print (see the px-per-point factor the PDF
// generator passes in), so they pull real tiles at street-level zoom rather
// than upscaling a coarse mosaic. These caps keep that honest about OSM's
// "no bulk downloading" policy: a bounded tile budget per map, a small
// concurrency window instead of firing every tile at once, and an
// in-process cache so regenerating a report for the same corridor re-uses
// tiles instead of re-fetching them.
const MAX_ZOOM = 18;
const TILE_BUDGET = 96;
const TILE_CONCURRENCY = 6;
const TILE_CACHE_MAX = 600;
const tileCache = new Map();

// Fast local lookup for the most common convoy-corridor towns across East/
// Southern Africa — checked first so the routine case never pays for a
// network round trip. Anything not listed here falls through to real
// automatic geocoding (Nominatim, via geocode.js) instead of silently
// being dropped, so a town like "Malaba" that simply isn't in this short
// list still resolves to real coordinates.
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

// Resolves a place name to [lat, lng] automatically: the local gazetteer
// first (instant, no network), then real geocoding (Nominatim) for anything
// else. Never throws — geocodePlace() already swallows its own network
// errors and returns null, so a geocoding outage degrades to "unresolved"
// rather than breaking report generation.
async function geocode(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  if (GAZETTEER[key]) return GAZETTEER[key];
  const hit = await geocodePlace(name);
  return hit ? [hit.lat, hit.lng] : null;
}

function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

// Deepest zoom whose window renders at least as wide as the output image —
// so the final map is downsampled from real tile detail rather than blown up
// from a coarse one — stepping back as needed to stay inside the tile budget.
function pickZoom(lngSpan, latSpan, targetW) {
  let best = 2;
  for (let z = 2; z <= MAX_ZOOM; z++) {
    const n = 2 ** z;
    const wPx = (lngSpan / 360) * n * TILE_SIZE;
    const hPx = (latSpan / 360) * n * TILE_SIZE;
    const tiles = (Math.ceil(wPx / TILE_SIZE) + 1) * (Math.ceil(hPx / TILE_SIZE) + 1);
    if (tiles > TILE_BUDGET) break;
    best = z;
    if (wPx >= targetW) break;
  }
  return best;
}

async function fetchTile(z, x, y) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xx = ((x % n) + n) % n;
  const key = `${z}/${xx}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  let buf = null;
  try {
    const res = await fetch(`${TILE_SERVER}/${z}/${xx}/${y}.png`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) buf = Buffer.from(await res.arrayBuffer());
  } catch {
    buf = null;
  }
  // Only successful fetches are cached — a transient failure must not stick
  // a permanent hole in every future map of the same area.
  if (buf) {
    if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
    tileCache.set(key, buf);
  }
  return buf;
}

// Bounded-concurrency tile fetch: a small pool rather than one request per
// tile fired simultaneously, per OSM's usage policy.
async function fetchTiles(zoom, jobs) {
  const out = new Array(jobs.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await fetchTile(zoom, jobs[i].tx, jobs[i].ty);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(TILE_CONCURRENCY, jobs.length) }, worker),
  );
  return out;
}

// Core tile-map renderer shared by every map style below.
//
// `boundsPoints` set the area shown. `drawOverlay(project, { unit, F })`
// returns the SVG markup composited over the tile mosaic, where
// project(lat, lng) -> { x, y } in mosaic pixels, `unit` converts a desired
// *output* pixel width into mosaic pixels, and `F` scales the old 860px-wide
// reference design up to the current render size so line weights stay
// visually consistent at any resolution. `labelPoints` are reprojected into
// final-image coordinates and returned so the caller can draw text with its
// own PDF fonts — labels are deliberately NOT baked into the raster here:
// librsvg needs a system font to rasterize <text>, and a minimal container
// image may not have one installed (confirmed in production, where labels
// came out as tofu boxes while the font-free circle markers rendered fine).
//
// The crop is squared off to the output aspect ratio, so the returned image
// fills its box exactly instead of being letterboxed inside it (which is
// what previously made a full-width map render as a small block floating in
// grey bands).
//
// Returns null on any failure so callers can fall back to a vector
// schematic — a map render never breaks report generation.
async function renderTileMap({
  boundsPoints, labelPoints = [], drawOverlay, width, height, minContextKm = 0,
}) {
  if (!boundsPoints || boundsPoints.length < 2) return null;
  try {
    const lats = boundsPoints.map((p) => p.lat), lngs = boundsPoints.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2, midLng = (minLng + maxLng) / 2;

    // Window shown: the points' extent plus breathing room, never narrower
    // than minContextKm — a tightly clustered track (a convoy that only ever
    // pinged from one spot) still gets recognisable surroundings instead of a
    // featureless close-up.
    const cosLat = Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
    let lngSpan = Math.max((maxLng - minLng) * 1.3, minContextKm / (111.32 * cosLat));
    let latSpan = Math.max((maxLat - minLat) * 1.3, 0.0008);

    // Shape the window to the output's aspect ratio *before* fetching, by
    // expanding whichever dimension is deficient (never shrinking below what
    // the points need). Without this the fetch covers ground the crop then
    // throws away — on a wide map box that wasted most of the tile budget and
    // forced the result to be upscaled; matching the aspect up front spends
    // the same budget on depth instead, so the render comes out sharp.
    // In Web Mercator a span's pixel width is proportional to lngSpan and its
    // pixel height to latSpan / cos(lat), hence the cosLat term.
    const aspect = width / height;
    if ((lngSpan * cosLat) / latSpan < aspect) lngSpan = (aspect * latSpan) / cosLat;
    else latSpan = (lngSpan * cosLat) / aspect;

    const zoom = pickZoom(lngSpan, latSpan, width);
    const tl = lonLatToTile(midLng - lngSpan / 2, midLat + latSpan / 2, zoom);
    const br = lonLatToTile(midLng + lngSpan / 2, midLat - latSpan / 2, zoom);
    const tileX0 = Math.floor(tl.x), tileY0 = Math.floor(tl.y);
    const tileX1 = Math.floor(br.x), tileY1 = Math.floor(br.y);
    const cols = tileX1 - tileX0 + 1, rowsN = tileY1 - tileY0 + 1;
    if (cols < 1 || rowsN < 1 || cols * rowsN > TILE_BUDGET) {
      logger.warn(`[routeMap] tile mosaic out of budget (${cols}x${rowsN} at z${zoom}) — skipping real map`);
      return null;
    }

    const jobs = [];
    for (let ty = tileY0; ty <= tileY1; ty++) {
      for (let tx = tileX0; tx <= tileX1; tx++) jobs.push({ tx, ty });
    }
    const tiles = await fetchTiles(zoom, jobs);

    const mosaicW = cols * TILE_SIZE, mosaicH = rowsN * TILE_SIZE;
    const composites = [];
    tiles.forEach((buf, i) => {
      if (!buf) return;
      composites.push({
        input: buf,
        left: (jobs[i].tx - tileX0) * TILE_SIZE,
        top: (jobs[i].ty - tileY0) * TILE_SIZE,
      });
    });
    if (composites.length < jobs.length * 0.6) {
      logger.warn(`[routeMap] only ${composites.length}/${jobs.length} tiles fetched — skipping real map`);
      return null;
    }

    const project = (lat, lng) => {
      const p = lonLatToTile(lng, lat, zoom);
      return { x: (p.x - tileX0) * TILE_SIZE, y: (p.y - tileY0) * TILE_SIZE };
    };

    // Crop rectangle: the intended window, never tighter than the points'
    // own extent, squared off to the output aspect and clamped to the mosaic.
    const projected = boundsPoints.map((p) => project(p.lat, p.lng));
    const pMinX = Math.min(...projected.map((p) => p.x)), pMaxX = Math.max(...projected.map((p) => p.x));
    const pMinY = Math.min(...projected.map((p) => p.y)), pMaxY = Math.max(...projected.map((p) => p.y));
    const winTL = project(midLat + latSpan / 2, midLng - lngSpan / 2);
    const winBR = project(midLat - latSpan / 2, midLng + lngSpan / 2);
    let cropW = Math.max(winBR.x - winTL.x, pMaxX - pMinX + 32);
    let cropH = Math.max(winBR.y - winTL.y, pMaxY - pMinY + 32);
    if (cropW / cropH < aspect) cropW = cropH * aspect; else cropH = cropW / aspect;
    if (cropW > mosaicW) { cropW = mosaicW; cropH = cropW / aspect; }
    if (cropH > mosaicH) { cropH = mosaicH; cropW = cropH * aspect; }
    const cx = (pMinX + pMaxX) / 2, cy = (pMinY + pMaxY) / 2;
    const cw = Math.max(1, Math.round(cropW)), ch = Math.max(1, Math.round(cropH));
    const cropX = Math.round(Math.max(0, Math.min(cx - cw / 2, mosaicW - cw)));
    const cropY = Math.round(Math.max(0, Math.min(cy - ch / 2, mosaicH - ch)));

    // Overlay geometry is authored in output pixels and converted to mosaic
    // pixels here, so route lines and markers keep the same visual weight
    // whatever zoom/resolution this particular map ended up at.
    const unit = cw / width;
    const F = width / 860;
    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mosaicW}" height="${mosaicH}">${drawOverlay(project, { unit, F })}</svg>`;

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
    // fit: 'fill' is exact here precisely because the crop was squared off to
    // the output aspect above — no letterboxing, no distortion, and a single
    // near-uniform scale for reprojecting label positions.
    //
    // Sharpness: the zoom picked above means `cw` is normally >= the output
    // width, so this is a supersampled downscale (lanczos3) rather than an
    // upscale. Light sharpening recovers the micro-contrast a downscale costs
    // — but only when downscaling; sharpening an upscaled image just adds
    // halos. Encoded lossless (PNG) so tile lettering and hairline roads stay
    // exactly as rendered, falling back to near-lossless 4:4:4 JPEG only if
    // the lossless copy would bloat the report.
    let pipeline = sharp(merged)
      .extract({ left: cropX, top: cropY, width: cw, height: ch })
      .resize({ width, height, fit: 'fill', kernel: 'lanczos3' });
    if (cw > width) pipeline = pipeline.sharpen({ sigma: 0.6 });
    let out = await pipeline.clone().png({ compressionLevel: 9, effort: 8 }).toBuffer();
    if (out.length > 2_800_000) {
      out = await pipeline.clone().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    }

    const scaleX = width / cw, scaleY = height / ch;
    const finalPoints = labelPoints.map((p) => {
      const q = project(p.lat, p.lng);
      return { ...p, x: (q.x - cropX) * scaleX, y: (q.y - cropY) * scaleY };
    });

    return { buffer: out, width, height, points: finalPoints, zoom };
  } catch (err) {
    logger.warn(`[routeMap] render failed: ${err.message}`);
    return null;
  }
}

function svgMarker(p, { r, fill, stroke, haloR }) {
  const cx = p.x.toFixed(1), cy = p.y.toFixed(1);
  return `<circle cx="${cx}" cy="${cy}" r="${haloR.toFixed(1)}" fill="#ffffff" opacity="0.95"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${(r * 0.34).toFixed(1)}"` : ''}/>`;
}

// points: [{ lat, lng, label }] in path order — the detailed view of an
// actual logged track (straight segments between fixes, not road-snapped;
// road snapping would need a routing engine, a separate and much larger
// integration).
async function renderRouteMapImage(points, { width = 2576, height = 850 } = {}) {
  if (points.length < 2) return null;
  return renderTileMap({
    boundsPoints: points,
    labelPoints: points.map((p, i) => ({ ...p, endpoint: i === 0 || i === points.length - 1 })),
    minContextKm: 3,
    width,
    height,
    drawOverlay: (project, { unit, F }) => {
      const pts = points.map((p) => project(p.lat, p.lng));
      const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const line = `<path d="${pathD}" fill="none" stroke="#1d4ed8" stroke-width="${(5 * F * unit).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
      const markers = pts.map((p, i) => {
        const isEnd = i === 0 || i === pts.length - 1;
        return svgMarker(p, {
          r: (isEnd ? 7 : 4.5) * F * unit,
          haloR: (isEnd ? 10.5 : 7) * F * unit,
          fill: isEnd ? '#d97706' : '#ffffff',
          stroke: '#78350f',
        });
      }).join('');
      return line + markers;
    },
  });
}

// Cover-page corridor map: the whole declared journey on a real basemap,
// with the leg already covered drawn solid and the leg still to run dashed,
// so "how far along is this convoy" reads at a glance against the full trip.
// The legs are straight lines between real coordinates, not road-routed —
// the caller labels them as such.
async function renderCorridorMapImage(
  { origin, destination, current, arrived = false, track = [] },
  { width = 1586, height = 880 } = {},
) {
  if (!origin || !destination) return null;
  const bounds = [origin, destination];
  if (current) bounds.push(current);
  for (const p of track) {
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) bounds.push(p);
  }
  return renderTileMap({
    boundsPoints: bounds,
    labelPoints: [
      { lat: origin.lat, lng: origin.lng, label: origin.label, kind: 'origin' },
      ...(current && !arrived
        ? [{ lat: current.lat, lng: current.lng, label: current.label, kind: 'current' }]
        : []),
      { lat: destination.lat, lng: destination.lng, label: destination.label, kind: 'destination' },
    ],
    minContextKm: 6,
    width,
    height,
    drawOverlay: (project, { unit, F }) => {
      const o = project(origin.lat, origin.lng);
      const d = project(destination.lat, destination.lng);
      const c = current ? project(current.lat, current.lng) : null;
      const w = (px) => (px * F * unit).toFixed(1);
      const seg = (a, b, opts) =>
        `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${opts.stroke}" stroke-width="${w(opts.width)}" stroke-linecap="round"${opts.dash ? ` stroke-dasharray="${w(opts.dash[0])} ${w(opts.dash[1])}"` : ''} opacity="${opts.opacity}"/>`;

      const parts = [];
      if (!c || arrived) {
        // No confirmed position, or the whole corridor is covered.
        parts.push(seg(o, d, {
          stroke: arrived ? '#1d4ed8' : '#64748b',
          width: 6,
          dash: arrived ? null : [11, 9],
          opacity: arrived ? 0.92 : 0.8,
        }));
      } else {
        // Remaining leg first, so the covered leg draws over it.
        parts.push(seg(c, d, { stroke: '#64748b', width: 5.5, dash: [11, 9], opacity: 0.8 }));
        parts.push(seg(o, c, { stroke: '#1d4ed8', width: 6.5, opacity: 0.92 }));
      }

      // The real logged track, when it spans enough ground to be visible at
      // this scale — drawn over the straight covered leg so the actual
      // movement is distinguishable from the corridor approximation.
      const tPts = track.map((p) => project(p.lat, p.lng));
      if (tPts.length >= 2) {
        const spanPx = Math.max(
          Math.max(...tPts.map((p) => p.x)) - Math.min(...tPts.map((p) => p.x)),
          Math.max(...tPts.map((p) => p.y)) - Math.min(...tPts.map((p) => p.y)),
        );
        if (spanPx > 12 * F * unit) {
          const dTrack = tPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
          parts.push(`<path d="${dTrack}" fill="none" stroke="#0f766e" stroke-width="${w(3.5)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`);
        }
      }

      parts.push(svgMarker(o, { r: 7 * F * unit, haloR: 10.5 * F * unit, fill: '#0f1b2d' }));
      parts.push(svgMarker(d, {
        r: 7 * F * unit,
        haloR: 10.5 * F * unit,
        fill: arrived ? '#15803d' : '#ffffff',
        stroke: arrived ? null : '#0f1b2d',
      }));
      if (c && !arrived) {
        parts.push(svgMarker(c, { r: 8.5 * F * unit, haloR: 12.5 * F * unit, fill: '#d97706' }));
      }
      return parts.join('');
    },
  });
}

module.exports = {
  geocode, renderRouteMapImage, renderCorridorMapImage, renderTileMap,
  GAZETTEER, lonLatToTile, pickZoom,
};
