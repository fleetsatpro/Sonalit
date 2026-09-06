const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const logger = require('./logger');
const { geocode, renderRouteMapImage, renderCorridorMapImage } = require('./routeMapRenderer');
const { assessConvoy, haversineKm } = require('./convoyIntegrity');

// Light "chain-of-custody freight intelligence" theme — navy/gold accents on a
// white/cream ground, matching the reference Sonalit Convoy Report template.
const C = {
  navy: '#0f1b2d', navy2: '#16233a',
  ink: '#111827', sub: '#374151', muted: '#6b7280', light: '#9ca3af',
  hair: '#e5e7eb', hair2: '#d1d5db',
  paper: '#ffffff', cream: '#fbfaf7', dot: '#eceae3',
  gold: '#b8860b', goldBg: '#fdf6e3',
  amber: '#b45309', amberBg: '#fef3c7', amberBorder: '#fcd34d',
  green: '#15803d', greenBg: '#dcfce7', greenBorder: '#86efac',
  red: '#b91c1c', redBg: '#fee2e2', redBorder: '#fca5a5',
  stripe: '#f8fafc',
};

const PW = 595.28, PH = 841.89, M = 40, CW = PW - M * 2;
const BODY_BOTTOM = PH - 46;
const BODY_TOP_SLIM = 66;

// Maps are rendered at 5 raster pixels per PDF point — ~360 DPI once placed,
// so roads and tile lettering stay sharp in print — and at exactly their
// box's aspect ratio, so each one fills its box instead of being letterboxed
// into a small block inside grey bands. The px size and the draw rect must
// stay in step, hence both come from these constants.
const MAP_PX_PER_PT = 5;
const COVER_MAP_BOX = { w: CW * 0.62 - 2, h: 178 };
const TRACE_MAP_BOX = { w: CW, h: 176 };
const mapPx = (box) => ({
  width: Math.round(box.w * MAP_PX_PER_PT),
  height: Math.round(box.h * MAP_PX_PER_PT),
});

function t(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, { ...opts, lineBreak: false });
}

function makePdf(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: { top: M, bottom: 0, left: M, right: M },
      size: 'A4',
      autoFirstPage: false,
      // Needed so the cover page's "Full Report — N Pages" stamp can be
      // patched in after layout finishes and the true page count is known
      // (bufferedPageRange()/switchToPage() are no-ops on unbuffered pages).
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

function pill(doc, x, y, w, label, fg, bg, border) {
  doc.save().rect(x, y, w, 14).fillAndStroke(bg, border || bg).restore();
  doc.fill(fg).fontSize(6.5).font('Helvetica-Bold');
  t(doc, label, x, y + 4, { width: w, align: 'center' });
}

// Small bullet/status dot drawn as a vector shape rather than a "●"/"✓" text
// glyph — PDFKit's standard 14 fonts only cover WinAnsi (CP1252), which has
// no bullet, check mark, or arrow glyphs, so those render as garbage (e.g.
// "%Ï") instead of the intended symbol.
function dot(doc, x, y, r, color, hollow) {
  doc.save();
  if (hollow) doc.circle(x, y, r).lineWidth(0.9).stroke(color);
  else doc.circle(x, y, r).fill(color);
  doc.restore();
}

function chevronRight(doc, x, y, size, color) {
  doc.save().moveTo(x, y - size).lineTo(x + size, y).lineTo(x, y + size)
    .lineWidth(1.2).strokeColor(color).lineJoin('round').stroke().restore();
}

function arrowRight(doc, x1, y, x2, color) {
  doc.save().moveTo(x1, y).lineTo(x2 - 5, y).lineWidth(1).strokeColor(color).stroke().restore();
  doc.save().polygon([x2, y], [x2 - 6, y - 4], [x2 - 6, y + 4]).fill(color).restore();
}

function compassAndScale(doc, x, y, label) {
  doc.save().polygon([x, y - 10], [x - 4, y], [x + 4, y]).fill(C.ink).restore();
  doc.fill(C.ink).fontSize(6).font('Helvetica-Bold');
  t(doc, 'N', x - 3, y + 2, { width: 10 });
  if (label) {
    doc.save().moveTo(x - 40, y + 20).lineTo(x - 40, y + 26).lineWidth(1).strokeColor(C.sub).stroke().restore();
    doc.save().moveTo(x - 40, y + 23).lineTo(x, y + 23).lineWidth(1).strokeColor(C.sub).stroke().restore();
    doc.save().moveTo(x, y + 20).lineTo(x, y + 26).lineWidth(1).strokeColor(C.sub).stroke().restore();
    doc.fill(C.muted).fontSize(6).font('Helvetica');
    t(doc, label, x - 40, y + 28, { width: 90 });
  }
}

// A monochrome, QR-like deterministic pattern derived from the SHA-256
// fingerprint — visually evokes a scan target (finder squares + module
// grid) but is explicitly NOT a decodable barcode; the report says so next
// to it. Purely a tamper-evidence visual, same purpose as the old colored
// hash-grid glyph, restyled to match the reference template's look.
function drawQrGlyph(doc, x, y, size, hexDigest) {
  if (!hexDigest || hexDigest.length < 32) return;
  const gridN = 12;
  const cell = size / gridN;
  const bytes = [];
  for (let i = 0; i < hexDigest.length; i += 2) bytes.push(parseInt(hexDigest.slice(i, i + 2), 16));

  doc.save();
  doc.rect(x, y, size, size).fill(C.paper);
  const finder = (fx, fy) => {
    doc.rect(x + fx * cell, y + fy * cell, cell * 3, cell * 3).fill(C.navy);
    doc.rect(x + (fx + 0.6) * cell, y + (fy + 0.6) * cell, cell * 1.8, cell * 1.8).fill(C.paper);
    doc.rect(x + (fx + 1.05) * cell, y + (fy + 1.05) * cell, cell * 0.9, cell * 0.9).fill(C.navy);
  };
  finder(0, 0);
  finder(gridN - 3, 0);
  finder(0, gridN - 3);

  for (let row = 0; row < gridN; row++) {
    for (let col = 0; col < gridN; col++) {
      const inFinder = (row < 3 && col < 3) || (row < 3 && col >= gridN - 3) || (row >= gridN - 3 && col < 3);
      if (inFinder) continue;
      const idx = row * gridN + col;
      const b = bytes[idx % bytes.length];
      if (((b >> (idx % 8)) & 1) === 1) {
        doc.rect(x + col * cell, y + row * cell, cell, cell).fill(C.navy);
      }
    }
  }
  doc.save().rect(x, y, size, size).lineWidth(0.6).strokeColor(C.hair2).stroke().restore();
  doc.restore();
}

function haversineDiagKm(lats, lngs) {
  return haversineKm(Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs));
}

// ─── Subtle dot-grid texture behind the cover page ─────────────────────────
function drawDotGrid(doc) {
  doc.save();
  const step = 16;
  for (let x = 10; x < PW - 10; x += step) {
    for (let y = 10; y < PH - 10; y += step) {
      doc.circle(x, y, 0.5).fill(C.dot);
    }
  }
  doc.restore();
}

function requiredActionFor(f) {
  if (f.severity === 'critical') return 'Escalate immediately — do not close report until resolved';
  if (f.severity === 'warning') return 'Dispatcher review required before closure';
  return 'No action required — informational only';
}

// ─── Real, automatically-geocoded route progress ───────────────────────────
// Resolves the convoy's declared origin/destination to real coordinates
// (routeMapRenderer's geocode() — a small local gazetteer of common corridor
// towns first, then real automatic geocoding via Nominatim for anything
// else, e.g. "Malaba") and, from that, computes an honest measure of how far
// along that corridor the convoy's last known GPS position actually sits:
// the last fix's straight-line distance from the origin, as a fraction of
// the straight-line origin->destination distance, clamped to [0,1]. This is
// a real computed value from real coordinates — not a road-network routing
// percentage (no routing engine is wired in here), and never a guess based
// on convoy.status alone, which is what previously let a convoy marked
// "completed" show its destination as "arrived" even when the actual last
// GPS fix was hundreds of km short.
async function computeRouteProgress(convoy, waypoints) {
  // The raw last-known GPS fix is real regardless of whether the corridor's
  // endpoints can be geocoded — surfaced separately so callers can still show
  // an honest "last known position" even when pct can't be computed.
  const lastPoint = waypoints.length ? waypoints[waypoints.length - 1] : null;

  const origin = await geocode(convoy.route_origin);
  const dest = await geocode(convoy.route_destination);
  if (!origin || !dest) return { pct: null, declaredKm: null, origin, dest, lastPoint };

  const declaredKm = haversineKm(origin[0], origin[1], dest[0], dest[1]);
  if (declaredKm < 0.5 || !lastPoint) {
    return { pct: null, declaredKm: Math.round(declaredKm), origin, dest, lastPoint };
  }

  const distFromOrigin = haversineKm(origin[0], origin[1], lastPoint.lat, lastPoint.lng);
  const pct = Math.max(0, Math.min(1, distFromOrigin / declaredKm));
  return { pct, declaredKm: Math.round(declaredKm), origin, dest, lastPoint };
}

// ─── Data-integrity advisory: compares the live GPS track against a real,
// geocoded straight-line estimate of the declared corridor, and against the
// photo evidence's own GPS tags. Only fires when all three real signals line
// up (a genuinely short/clustered live track against a materially longer
// declared corridor, with photo evidence sitting elsewhere) — never invents
// a discrepancy, and stays silent for the common case where the track and
// corridor agree or there simply isn't enough live tracking data to compare.
// origin/dest are pre-resolved coordinates from computeRouteProgress(), so
// the same geocoding result is reused rather than re-fetched.
function computeCorridorAdvisory(convoy, route, waypoints, photos, origin, dest) {
  if (!route.hasTrack || waypoints.length < 2) return null;
  if (!origin || !dest) return null;

  const declaredKm = Math.round(haversineKm(origin[0], origin[1], dest[0], dest[1]));
  if (declaredKm < 50) return null;

  const lats = waypoints.map(w => w.lat), lngs = waypoints.map(w => w.lng);
  const clusterKm = haversineDiagKm(lats, lngs);
  if (clusterKm > 5) return null;
  if (route.distanceKm > declaredKm * 0.3) return null;

  const geotagged = (photos || []).filter(p => p.lat != null && p.lng != null);
  let evidenceSite = null;
  if (geotagged.length) {
    const avgLat = geotagged.reduce((s, p) => s + parseFloat(p.lat), 0) / geotagged.length;
    const avgLng = geotagged.reduce((s, p) => s + parseFloat(p.lng), 0) / geotagged.length;
    const centroidLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centroidLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    if (haversineKm(avgLat, avgLng, centroidLat, centroidLng) > 2) {
      evidenceSite = { lat: avgLat, lng: avgLng };
    }
  }

  const firstAt = new Date(waypoints[0].recorded_at), lastAt = new Date(waypoints[waypoints.length - 1].recorded_at);
  const windowMin = Math.max(0, Math.round((lastAt - firstAt) / 60000));
  return {
    declaredKm, loggedKm: route.distanceKm, clusterKm: Math.round(clusterKm * 10) / 10,
    evidenceSite, windowMin,
  };
}

// A small white label plate for a point on a rendered basemap — the point's
// name, optionally with its exact coordinates underneath. Kept inside the map
// rect so a marker near an edge doesn't push its label off the panel.
function mapPointLabel(doc, px, py, lines, area) {
  const lw = 100, lh = 6 + lines.length * 8;
  // Bias the plate away from the middle of the map, so a label for a marker
  // near a corner steps aside from the route line running through it instead
  // of sitting on top of it.
  const bias = (px < area.x + area.w / 2 ? -1 : 1) * lw * 0.28;
  const lx = Math.max(area.x + 2, Math.min(px - lw / 2 + bias, area.x + area.w - lw - 2));
  const below = py < area.y + area.h / 2;
  // Clamped into the map rect: a marker near the top edge must not push its
  // label out of the box and onto whatever sits above it.
  const ly = Math.max(area.y + 2, Math.min(below ? py + 9 : py - lh - 9, area.y + area.h - lh - 2));
  doc.save().fillOpacity(0.94).rect(lx, ly, lw, lh).fill(C.paper).restore();
  let cy = ly + 3;
  lines.forEach((ln) => {
    doc.fill(ln.mono ? C.muted : C.ink).fontSize(ln.mono ? 5.5 : 6).font(ln.mono ? 'Courier' : 'Helvetica-Bold');
    t(doc, ln.text, lx, cy, { width: lw, align: 'center' });
    cy += 8;
  });
}

// The cover panel's real corridor basemap: the rendered map filling the panel,
// with origin / current position / destination labelled on top in the report's
// own fonts, a coverage chip, and a legend distinguishing the covered leg from
// the one still to run.
function drawCorridorMapPanel(doc, meta, boxTop, boxH, leftW) {
  const mr = meta.corridorMap;
  const area = { x: M + 1, y: boxTop + 21, w: leftW - 2, h: COVER_MAP_BOX.h };
  doc.save();
  doc.rect(area.x, area.y, area.w, area.h).clip();
  try {
    doc.image(mr.buffer, area.x, area.y, { width: area.w, height: area.h });
  } catch {
    doc.fill(C.light).fontSize(7).font('Helvetica');
    t(doc, 'Map image unavailable', area.x, area.y + area.h / 2 - 4, { width: area.w, align: 'center' });
  }
  doc.restore();

  const scaleX = area.w / mr.width, scaleY = area.h / mr.height;
  mr.points.forEach((p) => {
    const px = area.x + p.x * scaleX, py = area.y + p.y * scaleY;
    if (px < area.x || px > area.x + area.w || py < area.y || py > area.y + area.h) return;
    const lines = [{ text: String(p.label || '').toUpperCase() }];
    if (p.kind === 'current') {
      lines[0] = { text: 'LAST CONFIRMED POSITION' };
      lines.push({ text: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, mono: true });
    }
    mapPointLabel(doc, px, py, lines, area);
  });

  // Coverage chip, top-left of the map
  const rp = meta.routeProgress;
  const chipText = rp?.pct == null
    ? 'NO LIVE POSITION'
    : rp.pct >= 0.97
      ? 'ARRIVED — 100% OF CORRIDOR'
      : `${Math.round(rp.pct * 100)}% OF CORRIDOR COVERED`;
  const chipW = doc.font('Helvetica-Bold').fontSize(6.5).widthOfString(chipText) + 14;
  doc.save().fillOpacity(0.94).rect(area.x + 6, area.y + 6, chipW, 15).fill(C.paper).restore();
  doc.fill(rp?.pct == null ? C.muted : rp.pct >= 0.97 ? C.green : C.navy).fontSize(6.5).font('Helvetica-Bold');
  t(doc, chipText, area.x + 6, area.y + 10, { width: chipW, align: 'center' });

  // Legend, bottom-left of the map
  const lgY = area.y + area.h - 13, lgX = area.x + 6;
  doc.save().fillOpacity(0.94).rect(lgX, lgY - 3, 148, 13).fill(C.paper).restore();
  doc.save().moveTo(lgX + 4, lgY + 3.5).lineTo(lgX + 18, lgY + 3.5).lineWidth(1.6).strokeColor('#1d4ed8').stroke().restore();
  doc.fill(C.sub).fontSize(5.5).font('Helvetica-Bold');
  t(doc, 'COVERED', lgX + 21, lgY + 1, { width: 40 });
  doc.save().dash(2.5, { space: 2 }).moveTo(lgX + 64, lgY + 3.5).lineTo(lgX + 78, lgY + 3.5)
    .lineWidth(1.6).strokeColor('#64748b').stroke().undash().restore();
  doc.fill(C.sub).fontSize(5.5).font('Helvetica-Bold');
  t(doc, 'REMAINING', lgX + 81, lgY + 1, { width: 50 });
}

// ─── Cover page (page 1) — fully custom, light theme, standalone ──────────
function drawCoverPage(ctx, meta) {
  const doc = ctx.doc;
  doc.rect(0, 0, PW, PH).fill(C.paper);
  drawDotGrid(doc);

  // Brand row
  doc.rect(M, 30, 34, 34).fill(C.navy);
  doc.fill(C.paper).fontSize(15).font('Helvetica-Bold');
  t(doc, 'S', M, 40, { width: 34, align: 'center' });
  doc.fill(C.ink).fontSize(19).font('Helvetica-Bold');
  t(doc, 'SONALIT', M + 44, 32, { width: 300 });
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, 'SONALIT CONVOY SYSTEM · CHAIN-OF-CUSTODY FREIGHT INTELLIGENCE', M + 44, 50, { width: 320 });

  pill(doc, PW - M - 200, 34, 200, 'CONFIDENTIAL — CLIENT USE ONLY', C.red, C.paper, C.red);

  let y = 96;
  doc.fill(C.gold).fontSize(8).font('Helvetica-Bold');
  t(doc, 'C O N V O Y   I N T E L L I G E N C E   R E P O R T', M, y, { width: CW });
  y += 20;
  doc.fill(C.ink).fontSize(30).font('Helvetica-Bold');
  t(doc, meta.convoyName, M, y, { width: CW });
  y += 36;
  doc.fill(C.ink).fontSize(22).font('Helvetica-Bold');
  t(doc, meta.origin, M, y, { width: 200 });
  chevronRight(doc, M + 202, y + 12, 7, C.ink);
  t(doc, meta.destination, M + 222, y, { width: CW - 222 });
  y += 40;

  doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
  t(doc, meta.origin.toUpperCase(), M, y, { width: 150 });
  doc.save().moveTo(M + 90, y + 5).lineTo(M + 220, y + 5).lineWidth(0.8).dash(2, { space: 2 }).strokeColor(C.hair2).stroke().undash().restore();
  chevronRight(doc, M + 226, y + 4, 5, C.muted);
  doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
  t(doc, meta.destination.toUpperCase(), M + 238, y, { width: 200 });
  y += 26;

  // Route overview + verdict stamp, side by side
  const boxTop = y, boxH = 220, leftW = CW * 0.62, gap = 12, rightW = CW - leftW - gap;
  doc.save().rect(M, boxTop, leftW, boxH).lineWidth(0.8).strokeColor(C.hair2).stroke().restore();
  doc.fill(C.sub).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'ROUTE OVERVIEW — CORRIDOR MAP', M + 12, boxTop + 10, { width: leftW - 24 });

  const rp = meta.routeProgress;
  const plotY = boxTop + 26, plotH = boxH - 26 - 26, lineY = plotY + plotH / 2;
  if (meta.corridorMap) {
    drawCorridorMapPanel(doc, meta, boxTop, boxH, leftW);
  } else if (rp && rp.pct != null) {
    // Basemap tiles were unavailable — fall back to a schematic progress
    // line so the same real percentage still reads, just without the map.
    // Real progress along the declared corridor: how far the last known GPS
    // fix sits between the (automatically geocoded) origin and destination —
    // not a guess from convoy.status, which is what previously let a convoy
    // marked "completed" show as "arrived" even when the real last fix was
    // hundreds of km short of the destination.
    const padX = 20, x1 = M + padX, x2 = M + leftW - padX;
    const curX = x1 + rp.pct * (x2 - x1);
    const arrived = rp.pct >= 0.97;

    doc.save().moveTo(x1, lineY).lineTo(x2, lineY).lineWidth(2).strokeColor(C.hair2).stroke().restore();
    doc.save().moveTo(x1, lineY).lineTo(curX, lineY).lineWidth(2).strokeColor(C.navy).stroke().restore();
    dot(doc, x1, lineY, 4, C.navy);
    dot(doc, x2, lineY, 4, arrived ? C.green : C.light, !arrived);
    dot(doc, curX, lineY, 5, C.amber);

    doc.fill(C.sub).fontSize(6).font('Helvetica-Bold');
    t(doc, meta.origin.toUpperCase(), x1 - 45, lineY + 10, { width: 90, align: 'center' });
    t(doc, meta.destination.toUpperCase(), x2 - 45, lineY + 10, { width: 90, align: 'center' });

    doc.fill(C.ink).fontSize(6).font('Helvetica-Bold');
    t(doc, arrived ? 'ARRIVED' : 'LAST PING', curX - 50, lineY - 26, { width: 100, align: 'center' });
    doc.fill(C.muted).fontSize(5.5).font('Courier');
    t(doc, `${rp.lastPoint.lat.toFixed(4)}, ${rp.lastPoint.lng.toFixed(4)}`, curX - 50, lineY - 17, { width: 100, align: 'center' });
    doc.fill(C.navy).fontSize(8).font('Helvetica-Bold');
    t(doc, `${Math.round(rp.pct * 100)}% of route`, curX - 50, lineY + 22, { width: 100, align: 'center' });
  } else if (rp && rp.lastPoint) {
    // Corridor endpoints couldn't be resolved automatically (geocoding
    // failure/timeout) — still show the real raw last-known position rather
    // than hiding it or guessing a percentage.
    doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
    t(doc, 'LAST KNOWN GPS POSITION', M + 12, lineY - 16, { width: leftW - 24, align: 'center' });
    doc.fill(C.muted).fontSize(7).font('Courier');
    t(doc, `${rp.lastPoint.lat.toFixed(4)}, ${rp.lastPoint.lng.toFixed(4)}`, M + 12, lineY - 4, { width: leftW - 24, align: 'center' });
    doc.fill(C.light).fontSize(5.5).font('Helvetica');
    t(doc, 'Declared corridor could not be resolved automatically — see Section ' + meta.routeSectionLetter, M + 12, lineY + 12, { width: leftW - 24, align: 'center' });
  } else {
    doc.fill(C.light).fontSize(8).font('Helvetica');
    t(doc, 'No live GPS track logged for this convoy.', M + 12, boxTop + boxH / 2 - 4, { width: leftW - 24, align: 'center' });
  }
  doc.save().moveTo(M, boxTop + boxH - 18).lineTo(M + leftW, boxTop + boxH - 18).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
  doc.fill(C.muted).fontSize(6).font('Helvetica');
  // OSM's tile usage policy requires visible attribution wherever its tiles
  // are rendered.
  t(
    doc,
    meta.corridorMap ? `${meta.trackCaption}  ·  (c) OpenStreetMap` : meta.trackCaption,
    M + 12, boxTop + boxH - 13, { width: leftW - 24 },
  );

  const stampX = M + leftW + gap, stampCx = stampX + rightW / 2, stampCy = boxTop + boxH / 2 - 8;
  doc.save().rect(stampX, boxTop, rightW, boxH).lineWidth(0.8).strokeColor(C.hair2).stroke().restore();
  const stampR = Math.min(rightW, boxH) / 2 - 20;
  doc.save().circle(stampCx, stampCy, stampR).lineWidth(2).strokeColor(meta.verdictColor).stroke().restore();
  doc.save().circle(stampCx, stampCy, stampR - 5).lineWidth(0.6).strokeColor(meta.verdictColor).stroke().restore();
  doc.fill(meta.verdictColor).fontSize(12).font('Helvetica-Bold');
  t(doc, meta.verdictLabel, stampCx - stampR + 8, stampCy - 14, { width: (stampR - 8) * 2, align: 'center' });
  doc.fontSize(18);
  t(doc, `${meta.integrityScore}`, stampCx - stampR + 8, stampCy + 2, { width: (stampR - 8) * 2, align: 'center' });
  doc.fill(C.muted).fontSize(6).font('Helvetica');
  t(doc, '/ 100', stampCx - stampR + 8, stampCy + 21, { width: (stampR - 8) * 2, align: 'center' });
  doc.fill(C.muted).fontSize(5.5).font('Helvetica-Bold');
  t(doc, 'SONALIT CONVOY SYSTEM', stampX + 8, boxTop + boxH - 24, { width: rightW - 16, align: 'center' });
  t(doc, 'CHAIN OF CUSTODY', stampX + 8, boxTop + boxH - 15, { width: rightW - 16, align: 'center' });
  y = boxTop + boxH + 16;

  // 3-cell metadata strip
  const metaCells = [
    { label: 'Commodity', value: meta.commodity },
    { label: 'Total Seals Verified', value: meta.sealsVerified },
    { label: 'Route Distance (Declared)', value: meta.declaredDistance },
  ];
  const cellW = CW / 3;
  doc.save().rect(M, y, CW, 44).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  metaCells.forEach((c, i) => {
    const cx = M + i * cellW;
    if (i > 0) doc.save().moveTo(cx, y).lineTo(cx, y + 44).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
    doc.fill(C.muted).fontSize(6).font('Helvetica-Bold');
    t(doc, c.label.toUpperCase(), cx + 10, y + 8, { width: cellW - 20 });
    doc.fill(c.value.italic ? C.light : C.ink).fontSize(9).font(c.value.italic ? 'Helvetica-Oblique' : 'Helvetica-Bold');
    t(doc, c.value.text, cx + 10, y + 22, { width: cellW - 20 });
  });
  y += 56;

  // Vehicles & Personnel table
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'VEHICLES & PERSONNEL', M, y, { width: CW });
  y += 12;
  const vCols = [M, M + 30, M + 155, M + 240, M + 340, M + 460];
  const vW = [30, 125, 85, 100, 120, 55];
  const vHeaders = ['UNIT', 'DRIVER', 'PLATE / REG', 'LICENSE NO.', 'SEALS (SOD -> EOD)', 'PHOTOS'];
  doc.rect(M, y, CW, 15).fill(C.stripe);
  doc.save().moveTo(M, y + 15).lineTo(M + CW, y + 15).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
  vHeaders.forEach((h, i) => { doc.fill(C.muted).fontSize(6).font('Helvetica-Bold'); t(doc, h, vCols[i] + 4, y + 4, { width: vW[i] }); });
  y += 17;
  meta.vehicleRows.forEach((r, i) => {
    if (i % 2 === 0) doc.rect(M, y, CW, 20).fill(C.cream);
    doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
    t(doc, `T${r.unit}`, vCols[0] + 4, y + 6, { width: vW[0] });
    doc.font('Helvetica');
    t(doc, r.driver, vCols[1] + 4, y + 6, { width: vW[1] });
    t(doc, r.plate, vCols[2] + 4, y + 6, { width: vW[2] });
    t(doc, r.license, vCols[3] + 4, y + 6, { width: vW[3] });
    doc.font('Courier').fontSize(7);
    t(doc, r.seals, vCols[4] + 4, y + 7, { width: vW[4] });
    doc.fill(r.photosOk ? C.green : C.amber).fontSize(8).font('Helvetica-Bold');
    t(doc, r.photos, vCols[5] + 4, y + 6, { width: vW[5] });
    y += 20;
  });
  y += 14;

  // Footer info grid (Report No / Date / Vehicles / Region)
  const infoCells = [
    { label: 'Report No.', value: meta.reportNo },
    { label: 'Report Date', value: meta.reportDate },
    { label: 'Vehicles', value: meta.vehicleCount },
    { label: 'Region', value: meta.region },
  ];
  const infoW = CW / 4;
  doc.save().moveTo(M, y).lineTo(M + CW, y).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  doc.save().moveTo(M, y + 40).lineTo(M + CW, y + 40).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  infoCells.forEach((c, i) => {
    const cx = M + i * infoW;
    doc.fill(C.muted).fontSize(6).font('Helvetica-Bold');
    t(doc, c.label.toUpperCase(), cx, y + 8, { width: infoW - 10 });
    doc.fill(C.ink).fontSize(10).font('Helvetica-Bold');
    t(doc, c.value, cx, y + 20, { width: infoW - 10 });
  });
  y += 56;

  // Report contents ToC
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'REPORT CONTENTS', M, y, { width: CW });
  y += 14;
  const perRow = 3, tocColW = CW / perRow;
  meta.sectionPlan.forEach((s, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const cx = M + col * tocColW, cy = y + row * 22;
    doc.rect(cx, cy, 15, 15).fill(C.navy);
    doc.fill(C.paper).fontSize(8).font('Helvetica-Bold');
    t(doc, s.letter, cx, cy + 4, { width: 15, align: 'center' });
    doc.fill(C.ink).fontSize(7.5).font('Helvetica');
    t(doc, s.label, cx + 20, cy + 4, { width: tocColW - 24 });
  });
  y += Math.ceil(meta.sectionPlan.length / perRow) * 22 + 12;

  // Bottom rule + prepared-for line
  const footY = PH - 60;
  doc.save().moveTo(M, footY).lineTo(M + CW, footY).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, `Prepared for `, M, footY + 10, { width: 90 });
  doc.fill(C.ink).font('Helvetica-Bold');
  t(doc, meta.clientLine, M + 55, footY + 10, { width: 220 });
  doc.fill(C.muted).font('Helvetica');
  t(doc, ` ·  Field Compliance Officer `, M + 55 + doc.widthOfString(meta.clientLine) + 4, footY + 10, { width: 160 });
  doc.fill(C.ink).font('Helvetica-Bold');
  t(doc, meta.leadCfo, M + 260, footY + 10, { width: 150 });
  doc.fill(C.muted).font('Helvetica');
  t(doc, `Generated ${meta.generatedAt}`, M, footY + 10, { width: CW, align: 'right' });
}

// ─── Big title header — first content page only (page 2) ──────────────────
function drawTitleHeader(ctx, meta) {
  const doc = ctx.doc;
  doc.rect(M, 14, 22, 22).fill(C.navy);
  doc.fill(C.paper).fontSize(10).font('Helvetica-Bold');
  t(doc, 'S', M, 20, { width: 22, align: 'center' });
  doc.fill(C.ink).fontSize(12).font('Helvetica-Bold');
  t(doc, 'SONALIT', M + 28, 15, { width: 260 });
  doc.fill(C.muted).fontSize(6.5).font('Helvetica');
  t(doc, 'SONALIT CONVOY SYSTEM · CHAIN-OF-CUSTODY FREIGHT INTELLIGENCE', M + 28, 29, { width: 320 });

  doc.fill(C.muted).fontSize(7).font('Courier-Bold');
  t(doc, `REPORT NO. ${meta.reportNo}`, PW - M - 220, 15, { width: 220, align: 'right' });
  pill(doc, PW - M - 200, 26, 200, 'CONFIDENTIAL — CLIENT USE ONLY', C.red, C.paper, C.red);

  doc.save().moveTo(M, 46).lineTo(M + CW, 46).lineWidth(1.4).strokeColor(C.navy).stroke().restore();

  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, `Convoy Intelligence Report · Generated ${meta.generatedAt}`, M, 52, { width: 320 });
  t(doc, `Full Report — ${meta.pageCount} Pages`, M, 52, { width: CW, align: 'right' });

  let y = 72;
  doc.fill(C.ink).fontSize(17).font('Helvetica-Bold');
  t(doc, `Convoy Intelligence Report — ${meta.convoyName}`, M, y, { width: CW });
  y += 22;
  doc.fill(C.sub).fontSize(8.5).font('Helvetica');
  t(doc, `Origin `, M, y, { width: 45 });
  doc.font('Helvetica-Bold'); t(doc, meta.origin, M + 32, y, { width: 100 });
  doc.font('Helvetica'); const x2 = M + 32 + doc.widthOfString(meta.origin) + 4;
  t(doc, `-> Destination `, x2, y, { width: 80 });
  doc.font('Helvetica-Bold'); t(doc, meta.destination, x2 + 78, y, { width: 100 });
  doc.font('Helvetica'); const x3 = x2 + 78 + doc.widthOfString(meta.destination) + 8;
  t(doc, `·  Report Date `, x3, y, { width: 75 });
  doc.font('Helvetica-Bold'); t(doc, meta.reportDate, x3 + 72, y, { width: 80 });
  doc.font('Helvetica'); const x4 = x3 + 72 + doc.widthOfString(meta.reportDate) + 8;
  t(doc, `·  Region `, x4, y, { width: 50 });
  doc.font('Helvetica-Bold'); t(doc, meta.region, x4 + 48, y, { width: 100 });
  y += 20;

  const cells = [
    { label: 'Convoy ID', value: meta.convoyName },
    { label: 'Client', value: meta.clientLine },
    { label: 'Status', value: meta.statusLabel, color: meta.statusColor },
    { label: 'Vehicles', value: meta.vehicleCount },
    { label: 'Lead CFO', value: meta.leadCfo },
  ];
  const cellW = CW / cells.length;
  doc.save().rect(M, y, CW, 34).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  cells.forEach((c, i) => {
    const cx = M + i * cellW;
    if (i > 0) doc.save().moveTo(cx, y).lineTo(cx, y + 34).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
    doc.fill(C.muted).fontSize(6).font('Helvetica-Bold');
    t(doc, c.label.toUpperCase(), cx + 8, y + 6, { width: cellW - 16 });
    doc.fill(c.color || C.ink).fontSize(9).font('Helvetica-Bold');
    t(doc, c.value, cx + 8, y + 18, { width: cellW - 16 });
  });
  ctx.doc.y = y + 46;
}

// ─── Slim running header + footer for pages 3+ ─────────────────────────────
function drawHeader(ctx) {
  const doc = ctx.doc;
  doc.rect(M, 12, 16, 16).fill(C.navy);
  doc.fill(C.paper).fontSize(7.5).font('Helvetica-Bold');
  t(doc, 'S', M, 16, { width: 16, align: 'center' });
  doc.fill(C.ink).fontSize(9).font('Helvetica-Bold');
  t(doc, 'SONALIT', M + 22, 13, { width: 200 });
  doc.fill(C.muted).fontSize(6.5).font('Helvetica');
  t(doc, ctx.subtitle || '', M + 22, 24, { width: 300 });
  doc.fill(C.muted).fontSize(6.5).font('Courier-Bold');
  t(doc, ctx.reportNo || '', M, 13, { width: CW, align: 'right' });
  doc.save().moveTo(M, 36).lineTo(M + CW, 36).lineWidth(0.8).strokeColor(C.navy).stroke().restore();
}

function drawFooter(ctx) {
  const doc = ctx.doc;
  const fy = PH - 30;
  doc.save().moveTo(M, fy).lineTo(M + CW, fy).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  doc.fill(C.muted).fontSize(6.5).font('Helvetica');
  t(doc, `${ctx.reportNo || ''} · Generated ${ctx.generatedAt}`, M, fy + 8, { width: 320 });
  t(doc, `Page ${ctx.pageNum}`, M, fy + 8, { width: CW, align: 'right' });
}

function newPage(ctx) {
  ctx.doc.addPage();
  ctx.pageNum++;
  drawHeader(ctx);
  drawFooter(ctx);
  ctx.doc.y = BODY_TOP_SLIM;
}

function ensureSpace(ctx, needed) {
  if (ctx.doc.y + needed > BODY_BOTTOM) newPage(ctx);
}

function sectionHead(ctx, letter, label, status) {
  ensureSpace(ctx, 30);
  const doc = ctx.doc;
  const y = doc.y + 6;
  doc.save().rect(M, y, 16, 16).fill(C.navy).restore();
  doc.fill(C.paper).fontSize(9).font('Helvetica-Bold');
  t(doc, letter, M, y + 4, { width: 16, align: 'center' });
  const textX = M + 22;
  doc.fill(C.ink).fontSize(9.5).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), textX, y + 4, { width: CW - 200 });
  if (status) {
    doc.fill(C.muted).fontSize(7).font('Helvetica');
    t(doc, status, M + CW - 160, y + 4, { width: 160, align: 'right' });
  }
  doc.save().moveTo(M, y + 20).lineTo(M + CW, y + 20).lineWidth(1.2).strokeColor(C.navy).stroke().restore();
  doc.y = y + 26;
}

// Slim plain-text sub-heading with a hairline rule — used for nested groups
// (SOD/EOD photo sessions, GPS trace box) that sit inside a lettered section
// without needing their own badge.
function subLabel(ctx, label, status) {
  ensureSpace(ctx, 20);
  const doc = ctx.doc, y = doc.y;
  doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), M, y, { width: CW - 160 });
  if (status) {
    doc.fill(C.muted).fontSize(6.5).font('Helvetica');
    t(doc, status, M + CW - 160, y + 1, { width: 160, align: 'right' });
  }
  doc.save().moveTo(M, y + 13).lineTo(M + CW, y + 13).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
  doc.y = y + 18;
}

function navyBanner(ctx, label, status) {
  ensureSpace(ctx, 26);
  const doc = ctx.doc, y = doc.y;
  doc.rect(M, y, CW, 18).fill(C.navy);
  doc.fill(C.paper).fontSize(7.5).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), M + 8, y + 5, { width: CW - 170 });
  if (status) {
    doc.fill('#c7ced9').fontSize(6.5).font('Helvetica');
    t(doc, status, M + CW - 160, y + 5.5, { width: 152, align: 'right' });
  }
  doc.y = y + 24;
}

function detailGrid(doc, items, cols = 2) {
  const cellW = CW / cols, rowH = 30;
  const rows = Math.ceil(items.length / cols);
  const top = doc.y;
  doc.save().rect(M, top, CW, rows * rowH).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  items.forEach((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * cellW, y = top + row * rowH;
    if (col > 0) doc.save().moveTo(x, y).lineTo(x, y + rowH).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
    if (row > 0) doc.save().moveTo(x, y).lineTo(x + cellW, y).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
    doc.fill(C.light).fontSize(6).font('Helvetica');
    t(doc, (item.label || '').toUpperCase(), x + 10, y + 5, { width: cellW - 20 });
    doc.fill(item.color || C.ink).fontSize(9.5).font('Helvetica-Bold');
    t(doc, item.value ?? '--', x + 10, y + 15, { width: cellW - 20 });
  });
  doc.y = top + rows * rowH + 8;
}

function progressBar(doc, received, required) {
  const pct = required > 0 ? Math.min(1, received / required) : 0, y = doc.y;
  doc.save().rect(M, y, CW, 10).lineWidth(0.5).fillAndStroke('#e5e7eb', C.hair).restore();
  if (pct > 0) doc.rect(M, y, CW * pct, 10).fill(pct >= 1 ? C.green : pct >= 0.5 ? C.amber : C.red);
  doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
  t(doc, `${received} / ${required}  (${Math.round(pct * 100)}%)`, M + 4, y + 2, { width: CW - 8 });
  doc.y = y + 18;
}

function tableHeader(doc, cols, widths, headers) {
  const y = doc.y;
  doc.rect(M, y, CW, 15).fill(C.stripe);
  doc.save().moveTo(M, y + 15).lineTo(M + CW, y + 15).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
  headers.forEach((h, i) => { doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold'); t(doc, h.toUpperCase(), cols[i] + 3, y + 4, { width: widths[i] }); });
  doc.y = y + 17;
}

// ─── Photo fetch / prefetch helpers (unchanged from prior implementation) ──

async function fetchImageBuffer(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  let raw;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      logger.warn(`[convoyPdf] photo fetch non-2xx (${res.status}): ${url}`);
      return null;
    }
    raw = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn(`[convoyPdf] photo fetch failed: ${url} -- ${err.message}`);
    return null;
  }
  try {
    return await sharp(raw, { failOn: 'none' })
      .rotate()
      .resize({ width: 640, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    logger.warn(`[convoyPdf] sharp processing failed, using raw bytes: ${url} -- ${err.message}`);
    return raw;
  }
}

async function prefetchPhotoBuffers(photos) {
  const map = new Map();
  await Promise.all(photos.map(async (p) => {
    const buf = await fetchImageBuffer(p.photo_url);
    if (buf) map.set(p.id, buf);
  }));
  return map;
}

async function prefetchHandoverBuffers(handovers) {
  const map = new Map();
  await Promise.all(handovers.map(async (h) => {
    if (/\.pdf(\?|$)/i.test(h.form_url || '')) return;
    const buf = await fetchImageBuffer(h.form_url);
    if (buf) map.set(h.id, buf);
  }));
  return map;
}

async function prefetchRouteMap(convoy, waypoints, namedWaypoints) {
  try {
    let points;
    if (waypoints.length > 0) {
      const maxPoints = 40;
      const step = Math.max(1, Math.floor(waypoints.length / maxPoints));
      points = waypoints
        .filter((_, i) => i % step === 0 || i === waypoints.length - 1)
        .map((w, i, arr) => ({
          lat: w.lat, lng: w.lng,
          label: i === 0 ? 'Start' : i === arr.length - 1 ? 'Last ping' : undefined,
        }));
    } else if (namedWaypoints.length > 0) {
      const trim = (s) => (s || '').trim().toLowerCase();
      const stops = [{ name: convoy.route_origin }, ...namedWaypoints, { name: convoy.route_destination }]
        .filter((s, i, arr) => i === 0 || trim(s.name) !== trim(arr[i - 1].name));
      const resolved = await Promise.all(stops.map((s) => geocode(s.name)));
      points = stops
        .map((s, i) => (resolved[i] ? { lat: resolved[i][0], lng: resolved[i][1], label: s.name } : null))
        .filter(Boolean);
    } else {
      return null;
    }
    if (points.length < 2) return null;
    return await renderRouteMapImage(points, mapPx(TRACE_MAP_BOX));
  } catch (err) {
    logger.warn(`[convoyPdf] route map prefetch failed: ${err.message}`);
    return null;
  }
}

// Cover-page corridor map — the whole declared journey on a real basemap with
// the covered leg highlighted. Deliberately separate from prefetchRouteMap
// (Section B's detailed view of the day's movement): this one is framed to the
// full origin -> destination corridor so "how far along" reads at a glance,
// where that view is framed to the track itself.
async function prefetchCorridorMap(convoy, progress, waypoints) {
  try {
    if (!progress?.origin || !progress?.dest) return null;
    const origin = {
      lat: progress.origin[0], lng: progress.origin[1],
      label: convoy.route_origin || 'Origin',
    };
    const destination = {
      lat: progress.dest[0], lng: progress.dest[1],
      label: convoy.route_destination || 'Destination',
    };
    const current = progress.lastPoint
      ? {
        lat: Number(progress.lastPoint.lat),
        lng: Number(progress.lastPoint.lng),
        label: 'Last confirmed position',
      }
      : null;
    const arrived = progress.pct != null && progress.pct >= 0.97;
    // Subsample so a full day of pings doesn't bloat the overlay SVG.
    const step = Math.max(1, Math.floor(waypoints.length / 60));
    const track = waypoints
      .filter((_, i) => i % step === 0 || i === waypoints.length - 1)
      .map((w) => ({ lat: Number(w.lat), lng: Number(w.lng) }));
    return await renderCorridorMapImage(
      { origin, destination, current, arrived, track },
      mapPx(COVER_MAP_BOX),
    );
  } catch (err) {
    logger.warn(`[convoyPdf] corridor map prefetch failed: ${err.message}`);
    return null;
  }
}

// ─── Section D: Photo status matrix (overview table before per-truck pages)

function photoMatrix(ctx, trucks) {
  const doc = ctx.doc;
  const labelW = 115;
  const cellW = 44, cellH = 18, gap = 2;
  const cols = ['FR', 'RR', 'SEALS'];
  const sessionW = cols.length * (cellW + gap);
  const rowH = cellH + 5;

  let y = doc.y;
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'TRUCK / DRIVER', M, y + 4, { width: labelW });

  let x = M + labelW;
  ['START OF DAY', 'END OF DAY'].forEach(s => {
    doc.rect(x, y, sessionW, 13).fill(C.navy);
    doc.fill(C.paper).fontSize(6.5).font('Helvetica-Bold');
    t(doc, s, x, y + 3, { width: sessionW, align: 'center' });
    x += sessionW + 8;
  });
  y += 15;

  x = M + labelW;
  [0, 1].forEach(() => {
    cols.forEach((cl, idx) => {
      doc.fill(C.light).fontSize(5.5).font('Helvetica');
      t(doc, cl, x + idx * (cellW + gap), y + 1, { width: cellW, align: 'center' });
    });
    x += sessionW + 8;
  });
  y += 10;

  trucks.forEach((truck, ti) => {
    if (y + rowH > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (ti % 2 === 0) doc.rect(M, y, CW, rowH).fill(C.cream);

    doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
    t(doc, `T${truck.position}`, M + 2, y + 3, { width: 18 });
    doc.fill(C.sub).fontSize(7).font('Helvetica');
    t(doc, truck.driver_name || '--', M + 20, y + 2, { width: labelW - 24 });
    doc.fill(C.light).fontSize(6);
    t(doc, truck.plate_number || '--', M + 20, y + 11, { width: labelW - 24 });

    x = M + labelW;
    ['sod', 'eod'].forEach(session => {
      const sd = truck[session] || { front: false, rear: false, sealHave: 0, sealTotal: 0 };
      const cells = [
        { ok: sd.front, txt: sd.front ? 'Y' : '--' },
        { ok: sd.rear, txt: sd.rear ? 'Y' : '--' },
        { ok: sd.sealHave >= sd.sealTotal && sd.sealTotal > 0, txt: `${sd.sealHave}/${sd.sealTotal}` },
      ];
      cells.forEach((c, idx) => {
        const sx = x + idx * (cellW + gap);
        doc.save().rect(sx, y + 1, cellW, cellH).lineWidth(0.4)
          .fillAndStroke(c.ok ? C.greenBg : C.redBg, c.ok ? C.greenBorder : C.redBorder).restore();
        doc.fill(c.ok ? C.green : C.red).fontSize(8).font('Helvetica-Bold');
        t(doc, c.txt, sx, y + 5, { width: cellW, align: 'center' });
      });
      x += sessionW + 8;
    });
    y += rowH;
  });
  doc.y = y + 4;
}

function mismatchTable(ctx, photos) {
  const mm = photos.filter(p => p.location_mismatch);
  if (!mm.length) return;
  ensureSpace(ctx, 35 + mm.length * 14);
  subLabel(ctx, `Location Mismatches (${mm.length})`);
  const doc = ctx.doc, cols = [M, M + 100, M + 200, M + 290, M + 390], colW = [96, 96, 86, 96, 80];
  tableHeader(doc, cols, colW, ['Truck', 'Photo Type', 'Session', 'Uploaded', 'Flag']);
  let y = doc.y;
  mm.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.amberBg);
    [String(p.convoy_truck_id).slice(-8), `${p.photo_type}${p.seal_position ? ' #' + p.seal_position : ''}`,
      (p.session || '').toUpperCase(), p.uploaded_at ? new Date(p.uploaded_at).toISOString().slice(0, 16).replace('T', ' ') : '--', 'GPS >2km',
    ].forEach((v, j) => { doc.fill(C.sub).fontSize(7).font('Helvetica'); t(doc, v, cols[j] + 3, y + 3, { width: colW[j] }); });
    y += 14;
  });
  doc.y = y + 4;
}

function drawNoPhotoText(doc, x, y, w, h) {
  doc.fill(C.light).fontSize(7.5).font('Helvetica');
  t(doc, 'NO PHOTO', x, y + h / 2 - 4, { width: w, align: 'center' });
}

function drawPhotoCard(doc, x, y, w, photoH, captionH, slot, match, photoBuffers) {
  doc.save().rect(x, y, w, photoH).lineWidth(0.6).fillAndStroke(C.stripe, C.hair).restore();

  const buf = match ? photoBuffers.get(match.id) : null;
  if (buf) {
    try {
      doc.save();
      doc.rect(x, y, w, photoH).clip();
      doc.image(buf, x, y, { fit: [w, photoH], align: 'center', valign: 'center' });
      doc.restore();
    } catch {
      drawNoPhotoText(doc, x, y, w, photoH);
    }
  } else {
    drawNoPhotoText(doc, x, y, w, photoH);
  }

  const present = !!match;
  const badgeText = present ? 'VERIFIED' : 'MISSING';
  const badgeW = 54, badgeH = 13;
  doc.save().rect(x + w - badgeW - 4, y + 4, badgeW, badgeH)
    .fillAndStroke(present ? C.greenBg : C.redBg, present ? C.greenBorder : C.redBorder).restore();
  doc.fill(present ? C.green : C.red).fontSize(6).font('Helvetica-Bold');
  t(doc, badgeText, x + w - badgeW - 4, y + 7, { width: badgeW, align: 'center' });

  let cy = y + photoH + 4;
  doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
  t(doc, slot.label, x, cy, { width: w });
  cy += 11;
  doc.fill(C.muted).fontSize(6).font('Helvetica');
  const uploaded = match?.uploaded_at
    ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
  t(doc, `${slot.session || ''}${slot.session ? ' · ' : ''}${uploaded}`, x, cy, { width: w });
  cy += 9;
  const gps = match?.lat != null && match?.lng != null
    ? `${parseFloat(match.lat).toFixed(4)}, ${parseFloat(match.lng).toFixed(4)}` : 'GPS --';
  doc.fill(match?.location_mismatch ? C.amber : C.light).fontSize(6);
  t(doc, gps, x, cy, { width: w });
}

// ─── Section D: per-truck photo & seal evidence, plus a real evidence
// summary strip (capture window / seal continuity / GPS correlation /
// exceptions) — every figure here is computed straight from the truck's own
// photo rows, never a fixed/demo value.
function truckDetail(ctx, truck, truckPhotos, sealCountPerTruck, photoBuffers, truckFindings) {
  newPage(ctx);
  const doc = ctx.doc;

  const displaySealCap = Math.min(sealCountPerTruck, 2);
  const sealCodesFor = (session) => Array.from(new Set(
    truckPhotos.filter(p => p.session === session && p.photo_type === 'seal').map(p => String(p.seal_position))
  )).sort();
  const sodSealCodesAll = sealCodesFor('sod');
  const eodSealCodesAll = sealCodesFor('eod');
  const sodSealCodes = sodSealCodesAll.slice(0, displaySealCap);
  const eodSealCodes = eodSealCodesAll.slice(0, displaySealCap);
  const expectedTotal = (2 + sealCountPerTruck) * 2;
  const receivedTotal = ['sod', 'eod'].reduce((sum, session) => {
    const sp = truckPhotos.filter(p => p.session === session);
    const frontRear = (sp.some(p => p.photo_type === 'front') ? 1 : 0)
      + (sp.some(p => p.photo_type === 'rear') ? 1 : 0);
    const sealCount = Math.min(
      new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size,
      sealCountPerTruck
    );
    return sum + frontRear + sealCount;
  }, 0);

  navyBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'}`, `${receivedTotal} / ${expectedTotal} PHOTOS`);

  detailGrid(doc, [
    { label: 'Plate / Reg', value: truck.plate_number || '--' },
    { label: 'License No', value: truck.driver_license_no || '--' },
    { label: 'Driver Phone', value: truck.driver_phone || '--' },
    {
      label: `Seal Codes (SOD -> EOD)`,
      value: (sodSealCodes.length || eodSealCodes.length)
        ? `${sodSealCodes.join(', ') || '--'}  ->  ${eodSealCodes.join(', ') || '--'}`
        : '--',
    },
  ], 4);

  const colGap = 16;
  const colW = (CW - colGap) / 2;
  const cols = [
    { x: M, label: 'START OF DAY (SOD)', session: 'sod' },
    { x: M + colW + colGap, label: 'END OF DAY (EOD)', session: 'eod' },
  ];

  const photoH = 130, captionH = 28, photoGap = 10;
  const heroPairH = (photoH + 6 + captionH) * 2 + photoGap;

  const sealCols = 2, sealGap = 8;
  const sealCardW = (colW - sealGap * (sealCols - 1)) / sealCols;
  const sealPhotoH = 66, sealCaptionH = 22;
  const sealRowStride = sealPhotoH + 6 + sealCaptionH + 10;
  const sealRows = Math.ceil(displaySealCap / sealCols);

  ensureSpace(ctx, 20 + heroPairH + 20);

  // Session sub-labels (SOD / EOD), each with its own capture-time caption
  const firstTimeFor = (session) => {
    const sp = truckPhotos.filter(p => p.session === session);
    const times = sp.map(p => p.uploaded_at).filter(Boolean).sort();
    return times.length ? new Date(times[0]).toISOString().slice(11, 16) : '--';
  };
  const labelY = doc.y;
  cols.forEach(col => {
    doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
    t(doc, `${col.label} — ${firstTimeFor(col.session)}`, col.x, labelY, { width: colW });
    doc.save().moveTo(col.x, labelY + 13).lineTo(col.x + colW, labelY + 13).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
  });
  doc.y = labelY + 18;

  const heroY = doc.y;
  cols.forEach(col => {
    const sp = truckPhotos.filter(p => p.session === col.session);
    const frontMatch = sp.find(p => p.photo_type === 'front');
    const rearMatch = sp.find(p => p.photo_type === 'rear');
    drawPhotoCard(doc, col.x, heroY, colW, photoH, captionH,
      { label: 'FRONT', session: col.session.toUpperCase() }, frontMatch, photoBuffers);
    const rearY = heroY + photoH + 6 + captionH + photoGap;
    drawPhotoCard(doc, col.x, rearY, colW, photoH, captionH,
      { label: 'REAR', session: col.session.toUpperCase() }, rearMatch, photoBuffers);
  });
  doc.y = heroY + heroPairH + 10;

  if (displaySealCap > 0) {
    const sealCodesByCol = { sod: sodSealCodes, eod: eodSealCodes };
    for (let row = 0; row < sealRows; row++) {
      const pageBefore = ctx.pageNum;
      ensureSpace(ctx, sealRowStride + 20);
      if (ctx.pageNum !== pageBefore) {
        navyBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'} (seals, continued)`);
      }
      const subY = doc.y;
      doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
      t(doc, 'SEAL VERIFICATION', M, subY, { width: CW });
      doc.y = subY + 14;
      const rowY = doc.y;
      cols.forEach(col => {
        const sp = truckPhotos.filter(p => p.session === col.session);
        const codes = sealCodesByCol[col.session];
        for (let sc = 0; sc < sealCols; sc++) {
          const idx = row * sealCols + sc;
          if (idx >= displaySealCap) break;
          const pos = codes[idx] || null;
          const slot = { label: pos ? pos : `SEAL ${idx + 1}`, session: null };
          const match = pos ? sp.find(p => p.photo_type === 'seal' && String(p.seal_position) === pos) : null;
          drawSealCard(doc, col.x + sc * (sealCardW + sealGap), rowY, sealCardW, sealPhotoH, sealCaptionH, slot, match, photoBuffers);
        }
      });
      doc.y = rowY + sealRowStride;
    }
  }

  // Evidence summary strip — capture window / seal continuity / GPS
  // correlation / exceptions, all computed from this truck's own rows.
  const allTimes = truckPhotos.map(p => p.uploaded_at).filter(Boolean).sort();
  const captureWindow = allTimes.length
    ? (() => {
        const first = new Date(allTimes[0]), last = new Date(allTimes[allTimes.length - 1]);
        const mins = Math.max(0, Math.round((last - first) / 60000));
        return `${first.toISOString().slice(11, 16)} – ${last.toISOString().slice(11, 16)} UTC (${mins} min)`;
      })()
    : '--';
  const matchedSeals = sodSealCodesAll.filter(c => eodSealCodesAll.includes(c)).length;
  const sealContinuity = sealCountPerTruck > 0
    ? `${matchedSeals}/${sealCountPerTruck} seals matched SOD -> EOD`
    : 'No seals configured';
  const anyMismatch = truckPhotos.some(p => p.location_mismatch);
  const gpsCorrelation = truckPhotos.length === 0 ? 'No geotagged evidence'
    : anyMismatch ? 'Location mismatch detected' : 'Matches evidence capture site';
  const exceptions = (truckFindings || []).length
    ? truckFindings.map(f => f.title).join('; ')
    : 'None — see Section A for convoy-level findings';

  ensureSpace(ctx, 50);
  const sy = doc.y;
  const scols = [
    { label: 'Capture Window', value: captureWindow },
    { label: 'Seal Continuity', value: sealContinuity, color: matchedSeals >= sealCountPerTruck && sealCountPerTruck > 0 ? C.green : C.amber },
    { label: 'GPS Correlation', value: gpsCorrelation, color: anyMismatch ? C.amber : C.green },
    { label: 'Vehicle Exceptions', value: exceptions, color: (truckFindings || []).length ? C.amber : C.muted },
  ];
  const scolW = CW / scols.length;
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, `EVIDENCE SUMMARY — TRUCK ${truck.position}`, M, sy, { width: CW });
  doc.y = sy + 12;
  const gy = doc.y;
  doc.save().rect(M, gy, CW, 34).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  scols.forEach((c, i) => {
    const cx = M + i * scolW;
    if (i > 0) doc.save().moveTo(cx, gy).lineTo(cx, gy + 34).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
    doc.fill(C.muted).fontSize(6).font('Helvetica-Bold');
    t(doc, c.label.toUpperCase(), cx + 8, gy + 5, { width: scolW - 16 });
    doc.fill(c.color || C.ink).fontSize(7).font('Helvetica-Bold');
    t(doc, c.value, cx + 8, gy + 16, { width: scolW - 16 });
  });
  doc.y = gy + 42;
}

function drawSealCard(doc, x, y, w, photoH, captionH, slot, match, photoBuffers) {
  doc.save().rect(x, y, w, photoH).lineWidth(0.6).fillAndStroke(C.stripe, C.hair).restore();
  const buf = match ? photoBuffers.get(match.id) : null;
  if (buf) {
    try {
      doc.save();
      doc.rect(x, y, w, photoH).clip();
      doc.image(buf, x, y, { fit: [w, photoH], align: 'center', valign: 'center' });
      doc.restore();
    } catch {
      drawNoPhotoText(doc, x, y, w, photoH);
    }
  } else {
    drawNoPhotoText(doc, x, y, w, photoH);
  }
  const present = !!match;
  const badgeW = 28, badgeH = 12;
  doc.save().rect(x + w - badgeW - 3, y + 3, badgeW, badgeH)
    .fillAndStroke(present ? C.greenBg : C.redBg, present ? C.greenBorder : C.redBorder).restore();
  doc.fill(present ? C.green : C.red).fontSize(5.5).font('Helvetica-Bold');
  t(doc, present ? 'OK' : '--', x + w - badgeW - 3, y + 6, { width: badgeW, align: 'center' });

  let cy = y + photoH + 4;
  doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
  t(doc, slot.label, x, cy, { width: w });
  cy += 10;
  const uploaded = match?.uploaded_at ? new Date(match.uploaded_at).toISOString().slice(11, 16) : '--';
  doc.fill(C.muted).fontSize(6).font('Helvetica');
  t(doc, uploaded, x, cy, { width: w });
}

// ─── Section B: corridor progress (single-row, named-waypoint line) ───────
// The origin/waypoint/destination dots are fixed reference points from the
// convoy's declared route. The "current position" marker is placed by real,
// computed pct (see computeRouteProgress — the last GPS fix's straight-line
// distance from the origin, as a fraction of the declared corridor length),
// never by trusting convoy.status alone: a convoy whose status field says
// "completed" no longer draws as "arrived" at the destination unless its
// actual last GPS fix is genuinely close to it.
function drawCorridorProgress(ctx, convoy, namedWaypoints, hasLiveTrack, progress) {
  const doc = ctx.doc;
  const trim = (s) => (s || '').trim().toLowerCase();
  const stops = [
    { name: convoy.route_origin || 'Origin' },
    ...namedWaypoints,
    { name: convoy.route_destination || 'Destination' },
  ].filter((s, i, arr) => i === 0 || trim(s.name) !== trim(arr[i - 1].name));

  const rowH = 92;
  ensureSpace(ctx, rowH + 34);
  const y = doc.y;

  const pct = progress?.pct;
  const arrived = pct != null && pct >= 0.97;
  const statusLabel = arrived
    ? 'Arrived — Last Position Confirmed'
    : pct != null
      ? `En Route — ${Math.round(pct * 100)}% of Corridor`
      : String(convoy.status).toLowerCase() === 'active'
        ? (hasLiveTrack ? 'En Route — Corridor Unresolved' : 'En Route — No Live Position')
        : (convoy.status || '').toUpperCase() || 'PLANNED';

  doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
  t(doc, `CONVOY PROGRESS — ${(convoy.route_origin || '?').toUpperCase()} -> ${(convoy.route_destination || '?').toUpperCase()} CORRIDOR`, M, y, { width: CW - 220 });
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, `Status: ${statusLabel}`, M + CW - 220, y + 1, { width: 220, align: 'right' });

  const lineY = y + 44, padX = 30;
  const usableW = CW - padX * 2;
  const positions = stops.map((s, i) => ({
    x: M + padX + (stops.length > 1 ? (usableW / (stops.length - 1)) * i : usableW / 2),
    name: s.name,
    isOrigin: i === 0,
    isDest: i === stops.length - 1,
  }));

  doc.save().moveTo(positions[0].x, lineY).lineTo(positions[positions.length - 1].x, lineY)
    .lineWidth(1.2).strokeColor(C.hair2).stroke().restore();
  if (pct != null) {
    const curX = positions[0].x + pct * (positions[positions.length - 1].x - positions[0].x);
    doc.save().moveTo(positions[0].x, lineY).lineTo(curX, lineY).lineWidth(1.2).strokeColor(C.navy).stroke().restore();
  }

  positions.forEach((p) => {
    if (p.isOrigin) dot(doc, p.x, lineY, 4, C.navy);
    else if (p.isDest) dot(doc, p.x, lineY, 4.5, arrived ? C.green : C.light, !arrived);
    else dot(doc, p.x, lineY, 3, C.light, true);
    doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
    t(doc, p.name.toUpperCase(), p.x - 45, lineY + 8, { width: 90, align: 'center' });
    if (p.isOrigin) { doc.fill(C.muted).fontSize(6).font('Helvetica'); t(doc, 'Origin', p.x - 45, lineY + 19, { width: 90, align: 'center' }); }
    if (p.isDest) { doc.fill(C.muted).fontSize(6).font('Helvetica'); t(doc, arrived ? 'Arrived' : 'Destination', p.x - 45, lineY + 19, { width: 90, align: 'center' }); }
  });

  // Real current-position marker — a distinct dot from the fixed origin/
  // destination reference points, placed and labeled from the actual last
  // GPS fix rather than assumed to coincide with either endpoint.
  if (pct != null && !arrived && progress.lastPoint) {
    const curX = positions[0].x + pct * (positions[positions.length - 1].x - positions[0].x);
    dot(doc, curX, lineY, 4.5, C.amber);
    doc.fill(C.ink).fontSize(6).font('Helvetica-Bold');
    t(doc, 'CURRENT POSITION', curX - 55, lineY - 28, { width: 110, align: 'center' });
    doc.fill(C.muted).fontSize(5.5).font('Courier');
    t(doc, `${progress.lastPoint.lat.toFixed(4)}, ${progress.lastPoint.lng.toFixed(4)}`, curX - 55, lineY - 19, { width: 110, align: 'center' });
  }

  const legendY = y + rowH - 6;
  dot(doc, M + 4, legendY, 3, C.navy); doc.fill(C.muted).fontSize(6).font('Helvetica'); t(doc, 'Origin', M + 12, legendY - 3, { width: 55 });
  dot(doc, M + 85, legendY, 3, C.amber); t(doc, 'Current position (from real GPS)', M + 93, legendY - 3, { width: 165 });
  dot(doc, M + 275, legendY, 3, C.green); t(doc, 'Arrived', M + 283, legendY - 3, { width: 55 });
  dot(doc, M + 345, legendY, 3, C.light, true); t(doc, 'Reference waypoint — not independently GPS-verified', M + 353, legendY - 3, { width: 240 });

  doc.y = y + rowH + 6;
}

function drawMapImageBox(doc, mapResult, boxH) {
  const y = doc.y;
  doc.save().rect(M, y, CW, boxH).lineWidth(0.6).stroke(C.hair).restore();
  try {
    // Drawn at the box's exact size rather than with `fit`: the raster is
    // rendered at this box's aspect ratio, so an explicit width/height fills
    // it edge to edge at full resolution. `fit` letterboxed it instead —
    // which is what made a full-width map render as a small centred block.
    doc.save();
    doc.rect(M, y, CW, boxH).clip();
    doc.image(mapResult.buffer, M, y, { width: CW, height: boxH });
    doc.restore();

    const scaleX = CW / mapResult.width, scaleY = boxH / mapResult.height;
    const area = { x: M, y, w: CW, h: boxH };
    mapResult.points.forEach((p) => {
      if (!p.label) return;
      const px = M + p.x * scaleX, py = y + p.y * scaleY;
      // Two-line label — the point's name plus its precise coordinates, so
      // the current-position pointer reads as an exact, verifiable fix
      // rather than a vague floating tag. Plate placement/clamping is shared
      // with the cover map so neither can spill outside its box.
      const lines = [{ text: p.label }];
      if (p.lat != null && p.lng != null) {
        lines.push({ text: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, mono: true });
      }
      mapPointLabel(doc, px, py, lines, area);
    });
  } catch {
    doc.fill(C.light).fontSize(7).font('Helvetica');
    t(doc, 'Map image unavailable', M, y + boxH / 2 - 4, { width: CW, align: 'center' });
  }
  doc.fill(C.light).fontSize(5.5).font('Helvetica');
  t(doc, '(c) OpenStreetMap contributors', M, y + boxH + 3, { width: CW });
  doc.y = y + boxH + 14;
}

// ─── Section B: real GPS-trace schematic + sample log table ───────────────
// `route` is the shared convoyIntegrity.assessConvoy() route analytics
// object — reused here rather than recomputed so this stat strip always
// agrees exactly with the overspeed/stop findings shown in Section A.
function gpsTraceSection(ctx, waypoints, route, advisory, mapImage) {
  const doc = ctx.doc;
  ensureSpace(ctx, 240);

  const peakSpeed = route.maxSpeedKmh;

  detailGrid(doc, [
    { label: 'Distance Logged', value: `${route.distanceKm} km` },
    { label: 'Drive Time', value: fmtDur(route.durationMin) },
    { label: 'Avg Speed', value: route.avgSpeedKmh != null ? `${route.avgSpeedKmh} km/h` : '--' },
    { label: 'Peak Speed', value: peakSpeed != null ? `${peakSpeed} km/h` : '--', color: route.overspeedCount > 0 ? C.red : C.ink },
    { label: 'Stops', value: String(route.stops) },
    { label: 'GPS Points', value: String(route.gpsPoints) },
  ], 6);

  if (mapImage) {
    drawMapImageBox(doc, mapImage, TRACE_MAP_BOX.h);
  } else {
    ensureSpace(ctx, 200);
    const boxY = doc.y, boxH = 190;
    doc.save().rect(M, boxY, CW, boxH).lineWidth(0.6).stroke(C.hair).restore();
    doc.fill(C.sub).fontSize(7).font('Helvetica-Bold');
    t(doc, "TODAY'S MOVEMENT — GPS TRACE", M + 10, boxY + 8, { width: 260 });

    const lats = waypoints.map(w => w.lat), lngs = waypoints.map(w => w.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    doc.fill(C.muted).fontSize(6).font('Helvetica');
    t(doc, `${minLat.toFixed(4)}° to ${maxLat.toFixed(4)}°, ${minLng.toFixed(4)}° to ${maxLng.toFixed(4)}°`, M + CW - 220, boxY + 9, { width: 210, align: 'right' });

    const plotY = boxY + 24, plotH = boxH - 24 - 30, padPx = 20;
    const extraLat = advisory?.evidenceSite ? [advisory.evidenceSite.lat] : [];
    const extraLng = advisory?.evidenceSite ? [advisory.evidenceSite.lng] : [];
    const allLat = [...lats, ...extraLat], allLng = [...lngs, ...extraLng];
    const pMinLat = Math.min(...allLat), pMaxLat = Math.max(...allLat);
    const pMinLng = Math.min(...allLng), pMaxLng = Math.max(...allLng);
    const latRange = Math.max(pMaxLat - pMinLat, 0.002);
    const lngRange = Math.max(pMaxLng - pMinLng, 0.002);
    const project = (lat, lng) => [
      M + padPx + ((lng - pMinLng) / lngRange) * (CW - padPx * 2),
      plotY + padPx + (1 - (lat - pMinLat) / latRange) * (plotH - padPx * 2),
    ];

    doc.save().lineWidth(1.4).strokeColor(C.navy);
    waypoints.forEach((w, i) => {
      const [px, py] = project(w.lat, w.lng);
      if (i === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
    });
    doc.stroke().restore();

    waypoints.forEach((w) => {
      const [px, py] = project(w.lat, w.lng);
      dot(doc, px, py, 1.6, C.navy);
    });
    const [sx, sy] = project(waypoints[0].lat, waypoints[0].lng);
    const [ex, ey] = project(waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng);
    dot(doc, sx, sy, 3.5, C.green);
    if (peakSpeed != null && route.overspeedCount > 0) {
      const w = waypoints.find(wp => wp.speed_kmh === peakSpeed);
      if (w) { const [px, py] = project(w.lat, w.lng); dot(doc, px, py, 3, C.red); }
    }
    dot(doc, ex, ey, 3.5, C.red);

    if (advisory?.evidenceSite) {
      const [vx, vy] = project(advisory.evidenceSite.lat, advisory.evidenceSite.lng);
      doc.save().dash(3, { space: 2 }).moveTo(ex, ey).lineTo(vx, vy).lineWidth(1).strokeColor(C.light).stroke().undash().restore();
      const labelW = 120, labelX = (ex + vx) / 2 - labelW / 2, labelY = (ey + vy) / 2 - 12;
      doc.save().rect(labelX, labelY, labelW, 10).fill(C.paper).restore();
      doc.fill(C.muted).fontSize(5.5).font('Helvetica-Oblique');
      t(doc, 'declared corridor — not GPS-logged', labelX, labelY, { width: labelW, align: 'center' });
      dot(doc, vx, vy, 3.5, C.green);
      doc.fill(C.ink).fontSize(5.5).font('Helvetica-Bold');
      t(doc, 'EVIDENCE CAPTURE SITE', vx - 55, vy - 14, { width: 110, align: 'center' });
    }

    compassAndScale(doc, M + CW - 30, plotY + 20, '= 2 km');

    doc.y = boxY + boxH - 24;
    dot(doc, M + 4, doc.y, 2.5, C.green); doc.fill(C.muted).fontSize(5.5).font('Helvetica'); t(doc, 'First logged point', M + 12, doc.y - 3, { width: 90 });
    dot(doc, M + 100, doc.y, 2, C.navy); t(doc, 'GPS ping', M + 108, doc.y - 3, { width: 70 });
    dot(doc, M + 180, doc.y, 2.5, C.red); t(doc, 'Overspeed event / Last ping', M + 188, doc.y - 3, { width: 140 });
    t(doc, 'Route rendered from logged coordinates — not a certified cartographic map', M + 330, doc.y - 3, { width: CW - 330 });
    doc.y = boxY + boxH + 10;
  }

  const sampleCount = Math.min(8, waypoints.length);
  const step = Math.max(1, Math.floor(waypoints.length / sampleCount));
  const samples = [];
  for (let i = 0; i < waypoints.length && samples.length < sampleCount; i += step) samples.push(waypoints[i]);
  const lastPoint = waypoints[waypoints.length - 1];
  if (samples[samples.length - 1] !== lastPoint) samples.push(lastPoint);

  ensureSpace(ctx, 20 + samples.length * 14);
  const cols = [M, M + 90, M + 220, M + 320, M + 400], colW = [86, 126, 96, 76, 126];
  tableHeader(doc, cols, colW, ['Time (UTC)', 'Lat, Lng', 'Speed', 'Heading', 'Event']);
  let y = doc.y;
  samples.forEach((w, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.stripe);
    const time = new Date(w.recorded_at).toISOString().replace('T', ' ').slice(0, 19);
    const isFirst = i === 0, isLast = w === lastPoint;
    const isPeak = peakSpeed != null && route.overspeedCount > 0 && w.speed_kmh === peakSpeed;
    const isFirstMove = w.speed_kmh != null && w.speed_kmh > 0 && !isFirst
      && samples.slice(0, i).every(s => !s.speed_kmh);
    const event = isPeak ? 'Overspeed peak'
      : isLast ? 'Last ping' : isFirstMove ? 'First movement' : isFirst ? 'Trace start' : '—';
    [time, `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`,
      w.speed_kmh != null ? `${w.speed_kmh.toFixed(0)} km/h` : '--',
      w.heading != null ? `${Math.round(w.heading)}°` : '--', event,
    ].forEach((v, j) => {
      doc.fill(j === 4 && event !== '—' ? (isPeak ? C.red : C.sub) : C.sub).fontSize(7).font(j === 4 && event !== '—' ? 'Helvetica-Bold' : 'Helvetica');
      t(doc, v, cols[j] + 3, y + 3, { width: colW[j] });
    });
    y += 14;
  });
  doc.y = y + 6;
}

function cfoPhotosTable(ctx, cfoPhotos) {
  if (!cfoPhotos.length) return;
  ensureSpace(ctx, 60 + Math.min(cfoPhotos.length, 10) * 14);
  const doc = ctx.doc, cols = [M, M + 55, M + 130, M + 230, M + 310, M + 390], colW = [51, 71, 96, 76, 76, 115];
  tableHeader(doc, cols, colW, ['Phase', 'Type', 'Plate', 'Lat', 'Lng', 'Time (UTC)']);
  let y = doc.y;
  cfoPhotos.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.stripe);
    const at = p.taken_at ? new Date(p.taken_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
    [(p.session || '').toUpperCase() || '--', p.photo_type || '--', p.plate_number || '--',
      p.lat != null ? parseFloat(p.lat).toFixed(4) : '--', p.lng != null ? parseFloat(p.lng).toFixed(4) : '--', at,
    ].forEach((v, j) => {
      doc.fill(j === 0 ? (p.session === 'sod' ? C.green : C.gold) : C.sub).fontSize(7).font(j === 0 ? 'Helvetica-Bold' : 'Helvetica');
      t(doc, v, cols[j] + 3, y + 3, { width: colW[j] });
    });
    y += 14;
  });
  doc.y = y + 4;
}

function fmtDur(mins) {
  if (mins == null) return '--';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Section A: Integrity Assessment ───────────────────────────────────────
function integritySection(ctx, letter, a, advisory, reportStatus) {
  const doc = ctx.doc;
  ensureSpace(ctx, 130);
  sectionHead(ctx, letter, 'Integrity Assessment');

  const vmap = {
    cleared: { label: 'CLEARED', fg: C.green, bg: C.greenBg, border: C.greenBorder, blurb: 'Full evidence coverage; no anomalies detected.' },
    review: { label: 'UNDER REVIEW', fg: C.amber, bg: C.amberBg, border: C.amberBorder, blurb: 'Convoy evidence is complete (photos, seals, chain-of-custody data). Findings below require dispatcher sign-off before this report can be certified CLEAR.' },
    exceptions: { label: 'EXCEPTIONS', fg: C.red, bg: C.redBg, border: C.redBorder, blurb: 'Critical anomalies detected — escalate before sign-off.' },
  };
  const v = vmap[a.verdict] || vmap.review;

  const bY = doc.y, bH = 50;
  doc.save().rect(M, bY, CW, bH).lineWidth(0.8).fillAndStroke(v.bg, v.border).restore();
  doc.rect(M, bY, 4, bH).fill(v.fg);
  pill(doc, M + 12, bY + 10, 90, v.label, v.fg, C.paper, v.border);
  doc.fill(C.ink).fontSize(8.5).font('Helvetica-Bold');
  t(doc, `Integrity Score: ${a.score} / 100`, M + 112, bY + 12, { width: 200 });
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, `${a.counts.critical} Critical  ·  ${a.counts.warning} Warning  ·  ${a.counts.info} Info`, M + 112, bY + 25, { width: 300 });
  doc.fill(C.sub).fontSize(6.5).font('Helvetica');
  t(doc, v.blurb, M + 12, bY + 37, { width: CW - 24 });
  doc.y = bY + bH + 10;

  const sevColor = { critical: C.red, warning: C.amber, info: C.muted };
  if (!a.findings.length) {
    ensureSpace(ctx, 18);
    dot(doc, M + 5, doc.y + 5, 3, C.green);
    doc.fill(C.green).fontSize(8).font('Helvetica-Bold');
    t(doc, 'No exceptions — all coverage, seal, and route checks passed.', M + 14, doc.y + 1, { width: CW - 20 });
    doc.y += 18;
  } else {
    const idCol = M, sevCol = M + 34, findCol = M + 110, actCol = M + 110 + (CW - 110) * 0.58;
    const findW = actCol - findCol - 8, actW = M + CW - actCol;
    ensureSpace(ctx, 15);
    doc.rect(M, doc.y, CW, 15).fill(C.stripe);
    doc.save().moveTo(M, doc.y + 15).lineTo(M + CW, doc.y + 15).lineWidth(0.5).strokeColor(C.hair).stroke().restore();
    ['ID', 'SEVERITY', 'FINDING', 'REQUIRED ACTION'].forEach((h, i) => {
      const x = [idCol, sevCol, findCol, actCol][i];
      doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
      t(doc, h, x + 3, doc.y + 4, { width: i === 2 ? findW : i === 3 ? actW : 70 });
    });
    doc.y += 17;

    a.findings.slice(0, 14).forEach((f, i) => {
      const detailH = doc.heightOfString(f.detail, { width: findW - 4 });
      const actionText = requiredActionFor(f);
      const actionH = doc.heightOfString(actionText, { width: actW - 8 });
      const rowH = Math.max(30, 16 + detailH, 16 + actionH);
      if (doc.y + rowH > BODY_BOTTOM) newPage(ctx);
      const ry = doc.y;
      if (i % 2 === 0) doc.rect(M, ry, CW, rowH).fill(C.stripe);
      doc.fill(C.ink).fontSize(7.5).font('Courier-Bold');
      t(doc, `F-${String(i + 1).padStart(2, '0')}`, idCol + 3, ry + 6, { width: 30 });
      pill(doc, sevCol, ry + 4, 68, f.severity.toUpperCase(), sevColor[f.severity] || C.muted, C.paper, sevColor[f.severity] || C.hair);
      doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
      t(doc, f.title, findCol + 3, ry + 4, { width: findW - 4 });
      doc.fill(C.sub).fontSize(6.5).font('Helvetica');
      doc.text(f.detail, findCol + 3, ry + 14, { width: findW - 4 });
      doc.fill(C.sub).fontSize(6.5).font('Helvetica');
      doc.text(actionText, actCol + 3, ry + 4, { width: actW - 8 });
      doc.y = ry + rowH;
    });
    if (a.findings.length > 14) {
      doc.fill(C.light).fontSize(7).font('Helvetica');
      t(doc, `+ ${a.findings.length - 14} further finding(s)`, M, doc.y + 2, { width: CW });
      doc.y += 14;
    }
  }

  if (advisory) {
    ensureSpace(ctx, 70);
    const ay = doc.y, aH = doc.heightOfString(
      `Data integrity advisory. Logged distance (${advisory.loggedKm} km) is inconsistent with the declared corridor (~${advisory.declaredKm} km, straight-line estimate). The GPS trace remains within a single ${advisory.clusterKm} km coordinate cluster for the full ${fmtDur(advisory.windowMin)} window, consistent with a truncated or end-of-route telemetry capture rather than a full-transit anomaly. This does not affect the completeness of photo or seal evidence above.${reportStatus === 'partial' ? ' Report status is held at PARTIAL pending confirmation.' : ''}`,
      { width: CW - 24 },
    ) + 16;
    doc.save().rect(M, ay, CW, aH).lineWidth(0.8).fillAndStroke(C.amberBg, C.amberBorder).restore();
    doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
    t(doc, 'Data integrity advisory.', M + 12, ay + 8, { width: CW - 24 });
    doc.fill(C.sub).fontSize(6.5).font('Helvetica');
    doc.text(
      ` Logged distance (${advisory.loggedKm} km) is inconsistent with the declared corridor (~${advisory.declaredKm} km, straight-line estimate). The GPS trace remains within a single ${advisory.clusterKm} km coordinate cluster for the full ${fmtDur(advisory.windowMin)} window, consistent with a truncated or end-of-route telemetry capture rather than a full-transit anomaly. This does not affect the completeness of photo or seal evidence above.${reportStatus === 'partial' ? ' Report status is held at PARTIAL pending confirmation.' : ''}`,
      M + 90, ay + 8, { width: CW - 24 - 90 },
    );
    doc.y = ay + aH + 10;
  }
}

// ─── Section E: Chain of Custody & Certification ───────────────────────────
function chainOfCustodySection(ctx, letter, assessment, cfos, report, generatedAt, reportNo, openFindingId) {
  const doc = ctx.doc;
  ensureSpace(ctx, 300);
  navyBanner(ctx, 'Chain of Custody Certification');

  doc.fill(C.sub).fontSize(7.5).font('Helvetica');
  const leadName = cfos[0]?.cfo_name || 'Field Compliance Officer';
  doc.text(
    `This report certifies that the photo, seal, and telemetry evidence in the preceding sections was captured in the field via the Sonalit Convoy System and is bound to the fingerprint below. Any post-generation alteration invalidates this certification.${openFindingId ? ` Finding ${openFindingId} remains open pending dispatcher sign-off — this report is not final until countersigned.` : ''}`,
    M, doc.y + 8, { width: CW },
  );
  doc.y += 8 + doc.heightOfString(
    `This report certifies that the photo, seal, and telemetry evidence in the preceding sections was captured in the field via the Sonalit Convoy System and is bound to the fingerprint below. Any post-generation alteration invalidates this certification.${openFindingId ? ` Finding ${openFindingId} remains open pending dispatcher sign-off — this report is not final until countersigned.` : ''}`,
    { width: CW },
  ) + 14;

  // Custody chain — 4 connected stages
  ensureSpace(ctx, 70);
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'CUSTODY CHAIN', M, doc.y, { width: 200 });
  doc.y += 12;
  const stageW = (CW - 30) / 4, stageH = 44, stageY = doc.y;
  const stages = [
    { title: leadName, sub: 'Captured', time: generatedAt.slice(11, 16) },
    { title: 'Sonalit Platform', sub: 'Hashed & Sealed', time: generatedAt.slice(11, 16) },
    { title: 'Sonalit Platform', sub: 'Report Issued', time: generatedAt.slice(11, 16) },
    { title: 'Dispatcher', sub: openFindingId ? 'Review Pending' : 'Review', time: '--' },
  ];
  stages.forEach((s, i) => {
    const x = M + i * (stageW + 10);
    const active = i === stages.length - 1 && openFindingId;
    doc.save().rect(x, stageY, stageW, stageH).lineWidth(0.8)
      .fillAndStroke(active ? C.amberBg : C.cream, active ? C.amberBorder : C.hair).restore();
    doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
    t(doc, s.title, x + 8, stageY + 8, { width: stageW - 16 });
    doc.fill(C.muted).fontSize(6.5).font('Helvetica');
    t(doc, s.sub, x + 8, stageY + 20, { width: stageW - 16 });
    doc.fill(C.light).fontSize(6);
    t(doc, s.time, x + 8, stageY + 31, { width: stageW - 16 });
    if (i < stages.length - 1) arrowRight(doc, x + stageW, stageY + stageH / 2, x + stageW + 10, C.muted);
  });
  doc.y = stageY + stageH + 16;

  // Verification glyph + SHA-256 fingerprint
  if (assessment?.evidenceDigest) {
    ensureSpace(ctx, 90);
    const gy = doc.y, glyphSize = 64;
    drawQrGlyph(doc, M, gy, glyphSize, assessment.evidenceDigest);
    doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
    t(doc, 'Verification Glyph', M + glyphSize + 14, gy, { width: CW - glyphSize - 14 });
    doc.fill(C.muted).fontSize(6.5).font('Helvetica');
    doc.text('— a visual pattern deterministically derived from the SHA-256 fingerprint at right, for quick cross-check against the platform record. Not a scannable barcode.',
      M + glyphSize + 14, gy + 11, { width: CW - glyphSize - 14 });
    doc.y = gy + glyphSize + 10;

    ensureSpace(ctx, 34);
    const fy = doc.y;
    doc.save().rect(M, fy, CW, 28).lineWidth(0.6).fillAndStroke(C.cream, C.hair).restore();
    doc.fill(C.muted).fontSize(6).font('Helvetica-Bold');
    t(doc, 'SHA-256 DIGITAL FINGERPRINT — VERIFY AGAINST PLATFORM RECORD', M + 10, fy + 5, { width: CW - 20 });
    doc.fill(C.ink).fontSize(7).font('Courier');
    t(doc, assessment.evidenceDigest, M + 10, fy + 16, { width: CW - 20 });
    doc.y = fy + 36;
  }

  // Signature blocks
  ensureSpace(ctx, 60);
  const sy = doc.y, sigColW = CW / 2 - 8;
  doc.save().moveTo(M, sy + 26).lineTo(M + sigColW, sy + 26).lineWidth(0.6).strokeColor(C.sub).stroke().restore();
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'FIELD COMPLIANCE OFFICER', M, sy, { width: sigColW });
  doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
  t(doc, leadName, M, sy + 30, { width: sigColW });
  doc.fill(C.muted).fontSize(6.5).font('Helvetica');
  t(doc, `${cfos[0]?.cfo_email || ''} · Submitted ${generatedAt}`, M, sy + 41, { width: sigColW });

  const sx2 = M + sigColW + 16;
  doc.save().moveTo(sx2, sy + 26).lineTo(sx2 + sigColW, sy + 26).lineWidth(0.6).strokeColor(C.sub).stroke().restore();
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'DISPATCHER REVIEW — SIGN & DATE TO CERTIFY FINAL', sx2, sy, { width: sigColW });
  doc.fill(openFindingId ? C.amber : C.muted).fontSize(7.5).font('Helvetica-Bold');
  t(doc, openFindingId ? `Pending — required to close ${openFindingId}` : 'Pending dispatcher countersignature', sx2, sy + 30, { width: sigColW });
  doc.y = sy + 54;

  // Scope & limitations
  ensureSpace(ctx, 50);
  doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'Scope & Limitations. ', M, doc.y, { width: 90 });
  const scopeText = 'This report certifies the completeness, integrity, and custody of digitally captured evidence (photo, seal, and GPS telemetry) for the referenced convoy. It does not constitute a physical cargo condition survey, weight verification, customs declaration, or insurance assessment, and no such determination should be inferred from its contents. Findings are based solely on evidence transmitted to the Sonalit platform at the time of generation.';
  doc.fill(C.sub).fontSize(6.5).font('Helvetica');
  doc.text(scopeText, M + 88, doc.y, { width: CW - 88 });
  doc.y += doc.heightOfString(scopeText, { width: CW - 88 }) + 14;

  ensureSpace(ctx, 40);
  doc.save().moveTo(M, doc.y).lineTo(M + CW, doc.y).lineWidth(0.6).strokeColor(C.hair).stroke().restore();
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, `SONALIT CONVOY SYSTEM — ${reportNo}`, M, doc.y + 8, { width: 300 });
  t(doc, `Generated ${generatedAt}`, M, doc.y + 8, { width: CW, align: 'right' });
  doc.y += 22;
  doc.fill(C.light).fontSize(6).font('Helvetica');
  const legal = "This document is issued by the Sonalit Convoy System based on field-captured telemetry, photographic, and seal-verification evidence at the time of transmission. It is confidential and intended solely for the named client's use in verifying chain-of-custody for the referenced convoy. Any unauthorized alteration, reproduction, or forgery of this document is unlawful. Sonalit's liability in connection with this report is limited to the terms of the governing service agreement.";
  doc.text(legal, M, doc.y, { width: CW });
  doc.y += doc.heightOfString(legal, { width: CW }) + 6;
}

function handoverSection(ctx, letter, handovers, trucks, formBuffers) {
  const doc = ctx.doc;
  ensureSpace(ctx, 40);
  sectionHead(ctx, letter, 'Handover');

  if (!handovers.length) {
    doc.fill(C.muted).fontSize(7.5).font('Helvetica');
    t(doc, 'No handover on record for this convoy.', M, doc.y, { width: CW });
    doc.y += 16;
    return;
  }

  handovers.forEach((h) => {
    const truck = h.convoy_truck_id ? trucks.find((tk) => tk.id === h.convoy_truck_id) : null;
    const label = truck
      ? `Truck ${truck.position} — ${truck.plate_number || String(truck.id).slice(0, 8)}`
      : 'Whole Convoy';
    const roleLabel = h.handed_over_by_role === 'cfo' ? 'CFO (self-handover)' : 'Handover Officer';
    const byName = h.handed_over_by_name || 'Unknown';
    const signedAt = h.signed_off_at
      ? new Date(h.signed_off_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '--';

    const buf = formBuffers.get(h.id);
    const isPdfForm = !buf && /\.pdf(\?|$)/i.test(h.form_url || '');
    const boxW = 220, boxH = 170;
    ensureSpace(ctx, (buf ? boxH : 0) + 60);

    doc.fill(C.ink).fontSize(8.5).font('Helvetica-Bold');
    t(doc, label, M, doc.y, { width: CW });
    doc.y += 12;
    doc.fill(C.muted).fontSize(7).font('Helvetica');
    t(doc, `${byName} · ${roleLabel} · signed off ${signedAt}`, M, doc.y, { width: CW });
    doc.y += 12;

    if (h.selfie_url) {
      dot(doc, M + 3, doc.y + 4, 3, C.green);
      doc.fill(C.green).fontSize(7).font('Helvetica-Bold');
      t(doc, 'Selfie sign-off verified', M + 12, doc.y + 1, { width: 200 });
      doc.y += 14;
    }

    if (h.notes) {
      doc.fill(C.sub).fontSize(7).font('Helvetica-Oblique');
      t(doc, h.notes, M, doc.y, { width: CW });
      doc.y += 12;
    }

    if (buf) {
      doc.save().rect(M, doc.y, boxW, boxH).lineWidth(0.6).stroke(C.hair).restore();
      try {
        doc.save();
        doc.rect(M, doc.y, boxW, boxH).clip();
        doc.image(buf, M, doc.y, { fit: [boxW, boxH], align: 'center', valign: 'center' });
        doc.restore();
      } catch {
        drawNoPhotoText(doc, M, doc.y, boxW, boxH);
      }
      doc.y += boxH + 8;
    } else if (isPdfForm && h.form_url) {
      doc.fill(C.amber).fontSize(7.5).font('Helvetica-Bold');
      t(doc, 'Handover form (PDF) — tap to open', M, doc.y, { width: CW, link: h.form_url, underline: true });
      doc.y += 16;
    } else {
      doc.fill(C.light).fontSize(7).font('Helvetica');
      t(doc, 'Form unavailable', M, doc.y, { width: CW });
      doc.y += 16;
    }
    doc.y += 10;
  });
}

async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate, cfoPhotos = [], waypoints = [], namedWaypoints = [], handovers = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const generatedAtIso = new Date().toISOString();
  const mismatchCount = photos.filter(p => p.location_mismatch).length;
  const sealCountPerTruck = convoy.seal_count_per_truck ?? 3;
  const assessment = assessConvoy({
    convoy, trucks, photos, seals: [], waypoints, namedWaypoints, report,
    reportDate, sealCountPerTruck,
  });
  const openFindingId = assessment.findings.length ? `F-${String(1).padStart(2, '0')}` : null;

  const [photoBuffers, routeMapImage, handoverBuffers, routeProgress] = await Promise.all([
    prefetchPhotoBuffers(photos),
    prefetchRouteMap(convoy, waypoints, namedWaypoints),
    prefetchHandoverBuffers(handovers),
    computeRouteProgress(convoy, waypoints),
  ]);
  // Needs the geocoded corridor endpoints, so it follows the batch above
  // rather than joining it (the geocode results are cached by then).
  const corridorMapImage = await prefetchCorridorMap(convoy, routeProgress, waypoints);
  const advisory = computeCorridorAdvisory(
    convoy, assessment.route, waypoints, photos, routeProgress.origin, routeProgress.dest,
  );

  const reportNo = report.id ? `RPT-${String(report.id).slice(0, 8).toUpperCase()}` : `RPT-${reportDate}`;
  const verdictMap = {
    cleared: { label: 'CLEARED', color: C.green },
    review: { label: 'UNDER REVIEW', color: C.amber },
    exceptions: { label: 'EXCEPTIONS', color: C.red },
  };
  const vStyle = verdictMap[assessment.verdict] || verdictMap.review;
  const statusMap = {
    generated: { label: 'COMPLETED', color: C.green },
    complete: { label: 'COMPLETED', color: C.green },
    partial: { label: 'PARTIAL', color: C.amber },
    pending: { label: 'PENDING', color: C.muted },
    failed: { label: 'FAILED', color: C.red },
  };
  const stStyle = statusMap[report.status] || statusMap.pending;

  // Build the section plan up front — letters are assigned to whichever
  // real sections this convoy's data actually produces, so the cover ToC and
  // the in-body lettered headings always agree, and a convoy with no CFO app
  // uploads / no handover on this date simply doesn't get those letters.
  const sectionPlan = [
    { key: 'integrity', label: 'Integrity Assessment' },
    { key: 'route', label: 'Route Analytics' },
    { key: 'details', label: 'Convoy Details' },
    { key: 'photos', label: 'Photo & Seal Evidence' },
  ];
  if (cfos.length) sectionPlan.push({ key: 'officers', label: 'Field Officers' });
  if (cfoPhotos.length) sectionPlan.push({ key: 'cfoPhotos', label: 'CFO App Photos' });
  if (handovers.length) sectionPlan.push({ key: 'handover', label: 'Handover' });
  sectionPlan.push({ key: 'custody', label: 'Chain of Custody & Certification' });
  sectionPlan.forEach((s, i) => { s.letter = String.fromCharCode(65 + i); });
  const letterOf = (key) => sectionPlan.find(s => s.key === key).letter;

  const sealsPerTruckMatched = trucks.map(truck => {
    const tp = photos.filter(p => p.convoy_truck_id === truck.id);
    const sod = new Set(tp.filter(p => p.session === 'sod' && p.photo_type === 'seal').map(p => String(p.seal_position)));
    const eod = new Set(tp.filter(p => p.session === 'eod' && p.photo_type === 'seal').map(p => String(p.seal_position)));
    return Array.from(sod).filter(c => eod.has(c)).length;
  });
  const totalSealsMatched = sealsPerTruckMatched.reduce((a, b) => a + b, 0);
  const totalSealsExpected = trucks.length * sealCountPerTruck;

  const vehicleRows = trucks.map(truck => {
    const tp = photos.filter(p => p.convoy_truck_id === truck.id);
    const sodCodes = Array.from(new Set(tp.filter(p => p.session === 'sod' && p.photo_type === 'seal').map(p => String(p.seal_position)))).sort();
    const eodCodes = Array.from(new Set(tp.filter(p => p.session === 'eod' && p.photo_type === 'seal').map(p => String(p.seal_position)))).sort();
    const receivedTotal = ['sod', 'eod'].reduce((sum, session) => {
      const sp = tp.filter(p => p.session === session);
      const fr = (sp.some(p => p.photo_type === 'front') ? 1 : 0) + (sp.some(p => p.photo_type === 'rear') ? 1 : 0);
      const seals = Math.min(new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size, sealCountPerTruck);
      return sum + fr + seals;
    }, 0);
    const expected = (2 + sealCountPerTruck) * 2;
    return {
      unit: truck.position, driver: truck.driver_name || '--', plate: truck.plate_number || '--',
      license: truck.driver_license_no || '--',
      seals: `${sodCodes.join(', ') || '--'} -> ${eodCodes.join(', ') || '--'}`,
      photos: `${receivedTotal}/${expected}`, photosOk: receivedTotal >= expected,
    };
  });

  const ctx = {
    doc: null, pageNum: 0, generatedAt, reportNo,
    subtitle: `${convoy.name || 'Convoy'} · ${reportDate}`,
  };
  return makePdf(doc => {
    ctx.doc = doc;

    doc.addPage();
    ctx.pageNum = 1;
    drawCoverPage(ctx, {
      convoyName: convoy.name || 'Convoy',
      origin: convoy.route_origin || 'Origin',
      destination: convoy.route_destination || 'Destination',
      verdictLabel: vStyle.label, verdictColor: vStyle.color, integrityScore: assessment.score,
      routeProgress, routeSectionLetter: letterOf('route'),
      corridorMap: corridorMapImage,
      trackCaption: waypoints.length
        ? `${assessment.route.distanceKm} km logged · ${waypoints.length} GPS points · legs are straight-line, not road-routed`
        : 'No live GPS track logged for this date — declared corridor shown.',
      commodity: { text: 'Not declared at time of capture', italic: true },
      sealsVerified: { text: totalSealsExpected > 0 ? `${totalSealsMatched} / ${totalSealsExpected} · SOD -> EOD matched` : 'No seals configured' },
      declaredDistance: { text: routeProgress.declaredKm != null ? `~ ${routeProgress.declaredKm} km (straight-line estimate)` : 'Not available' },
      vehicleRows,
      reportNo, reportDate, vehicleCount: `${trucks.length} Truck${trucks.length === 1 ? '' : 's'}`,
      region: convoy.region || '--',
      sectionPlan,
      clientLine: convoy.client_company || convoy.client_name || 'Unassigned',
      leadCfo: cfos[0]?.cfo_name || '--',
      generatedAt,
    });

    doc.addPage();
    ctx.pageNum = 2;
    drawFooter(ctx);
    drawTitleHeader(ctx, {
      reportNo, generatedAt, pageCount: '—',
      convoyName: convoy.name || 'Convoy', origin: convoy.route_origin || '--', destination: convoy.route_destination || '--',
      reportDate, region: convoy.region || '--',
      clientLine: convoy.client_company || convoy.client_name || 'Unassigned',
      statusLabel: (convoy.status || '').toUpperCase() || '--', statusColor: convoy.status === 'completed' ? C.green : C.ink,
      vehicleCount: `${trucks.length} Truck${trucks.length === 1 ? '' : 's'}`,
      leadCfo: cfos[0]?.cfo_name || '--',
    });

    integritySection(ctx, letterOf('integrity'), assessment, advisory, report.status);

    sectionHead(ctx, letterOf('route'), 'Route Analytics');
    if (!waypoints.length && !namedWaypoints.length) {
      doc.fill(C.muted).fontSize(7.5).font('Helvetica');
      t(doc, 'No GPS waypoints or planned route configured for this convoy.', M, doc.y, { width: CW });
      doc.y += 16;
    } else {
      drawCorridorProgress(ctx, convoy, namedWaypoints, waypoints.length > 0, routeProgress);
      if (waypoints.length > 1) {
        ensureSpace(ctx, 40);
        subLabel(ctx, "Today's Movement — GPS Trace");
        gpsTraceSection(ctx, waypoints, assessment.route, advisory, routeMapImage);
      }
    }

    sectionHead(ctx, letterOf('details'), 'Convoy Details');
    detailGrid(doc, [
      { label: 'Origin', value: convoy.route_origin || '--' },
      { label: 'Destination', value: convoy.route_destination || '--' },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Seals / Truck', value: String(sealCountPerTruck) },
    ]);

    sectionHead(ctx, letterOf('photos'), 'Photo & Seal Evidence', `${report.received_photo_count}/${report.required_photo_count} Captured`);
    const truckMatrix = trucks.map(truck => {
      const tp = photos.filter(p => p.convoy_truck_id === truck.id);
      const buildSession = (session) => {
        const sp = tp.filter(p => p.session === session);
        const sealHave = Math.min(
          new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size,
          sealCountPerTruck
        );
        return { front: sp.some(p => p.photo_type === 'front'), rear: sp.some(p => p.photo_type === 'rear'), sealHave, sealTotal: sealCountPerTruck };
      };
      return { ...truck, sod: buildSession('sod'), eod: buildSession('eod') };
    });
    photoMatrix(ctx, truckMatrix);
    mismatchTable(ctx, photos);

    trucks.forEach(truck => {
      const plate = truck.plate_number || truck.registration || `T${truck.position}`;
      // Exact match against convoyIntegrity's own truck-scoped finding titles
      // (`Incomplete coverage — ${plate}` / `No evidence for ${plate}`) — a
      // substring check here would wrongly match, say, plate "1" against a
      // finding titled "...— 12" for a different truck.
      const truckFindings = assessment.findings.filter(f =>
        (f.code === 'coverage_gap' || f.code === 'truck_no_photos')
        && (f.title === `Incomplete coverage — ${plate}` || f.title === `No evidence for ${plate}`));
      truckDetail(ctx, truck, photos.filter(p => p.convoy_truck_id === truck.id), sealCountPerTruck, photoBuffers, truckFindings);
    });

    if (cfos.length) {
      sectionHead(ctx, letterOf('officers'), 'Field Officers');
      let y = doc.y;
      cfos.forEach((c, i) => {
        if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.stripe);
        doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
        t(doc, c.cfo_name || c.cfo_user_id?.slice(-8) || '--', M + 4, y + 4, { width: CW / 2 - 8 });
        doc.fill(C.muted).fontSize(7.5).font('Helvetica');
        t(doc, c.cfo_email || '', M + CW / 2, y + 4, { width: CW / 2 - 4 });
        y += 16;
      });
      doc.y = y + 6;
    }

    if (cfoPhotos.length) {
      sectionHead(ctx, letterOf('cfoPhotos'), `CFO App Photos (${cfoPhotos.length} uploaded)`);
      cfoPhotosTable(ctx, cfoPhotos);
    }

    if (handovers.length) handoverSection(ctx, letterOf('handover'), handovers, trucks, handoverBuffers);

    chainOfCustodySection(ctx, letterOf('custody'), assessment, cfos, report, generatedAt, reportNo, openFindingId);

    // Page count on the title header was unknown until layout finished —
    // stamp the real final count onto page 2 now that doc.bufferedPageRange
    // knows it.
    const range = doc.bufferedPageRange();
    if (range.count > 1) {
      doc.switchToPage(1);
      doc.save().rect(PW - M - 90, 52, 90, 10).fill(C.paper).restore();
      doc.fill(C.muted).fontSize(7).font('Helvetica');
      t(doc, `Full Report — ${range.count} Pages`, M, 52, { width: CW, align: 'right' });
      doc.switchToPage(range.count - 1);
    }
  });
}

async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos, handovers = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const totalReq = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
  const totalRecv = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
  const overallPct = totalReq > 0 ? Math.round((totalRecv / totalReq) * 100) : 0;
  const sealCount = convoy.seal_count_per_truck ?? 3;
  const perTruckRequired = (2 + sealCount) * 2;
  const handoverBuffers = await prefetchHandoverBuffers(handovers);
  const reportNo = `ARC-${String(convoy.id).slice(0, 8).toUpperCase()}`;

  const ctx = { doc: null, pageNum: 0, generatedAt, reportNo, subtitle: `${convoy.name || 'Convoy'} · Archive Report` };
  return makePdf(doc => {
    ctx.doc = doc;
    doc.addPage();
    ctx.pageNum = 1;
    drawFooter(ctx);
    drawTitleHeader(ctx, {
      reportNo, generatedAt, pageCount: '—',
      convoyName: convoy.name || 'Convoy', origin: convoy.route_origin || '--', destination: convoy.route_destination || '--',
      reportDate: `${reports.length} report day${reports.length === 1 ? '' : 's'}`, region: convoy.region || '--',
      clientLine: convoy.client_company || convoy.client_name || 'Unassigned',
      statusLabel: (convoy.status || '').toUpperCase() || '--', statusColor: convoy.status === 'completed' ? C.green : C.ink,
      vehicleCount: `${trucks.length} Truck${trucks.length === 1 ? '' : 's'}`,
      leadCfo: cfos[0]?.cfo_name || '--',
    });

    let letterIdx = 0;
    const L = () => String.fromCharCode(65 + letterIdx++);

    sectionHead(ctx, L(), 'Archive Summary');
    detailGrid(doc, [
      { label: 'Convoy', value: convoy.name || '--' },
      { label: 'Client', value: convoy.client_name || '--' },
      { label: 'Status', value: (convoy.status || '').toUpperCase() || '--' },
      { label: 'Region', value: convoy.region || '--' },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Start Date', value: convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--' },
      { label: 'End Date', value: convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--' },
      { label: 'Trucks', value: String(trucks.length) },
      { label: 'CFOs', value: String(cfos.length) },
    ]);

    if (handovers.length) handoverSection(ctx, L(), handovers, trucks, handoverBuffers);

    sectionHead(ctx, L(), `Overall Completion (${overallPct}%)`);
    progressBar(doc, totalRecv, totalReq);

    sectionHead(ctx, L(), 'Daily Summary');
    const hCols = [M, M + 80, M + 160, M + 260, M + 335, M + 420];
    const hW = [76, 76, 96, 71, 81, 76];
    tableHeader(doc, hCols, hW, ['Date', 'Status', 'Photos', 'Mismatch', 'PDF', 'Generated']);

    let y = doc.y;
    reports.forEach((r, i) => {
      if (y + 16 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
      if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.stripe);
      const dateStr = String(r.report_date).slice(0, 10);
      const photoPct = r.required_photo_count > 0
        ? `${r.received_photo_count}/${r.required_photo_count} (${Math.round(r.received_photo_count / r.required_photo_count * 100)}%)`
        : '--';
      const dm = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr && p.location_mismatch).length;
      const genAt = r.generated_at ? new Date(r.generated_at).toISOString().slice(0, 10) : '--';
      [dateStr, (r.status || '').toUpperCase(), photoPct, dm > 0 ? `${dm} flagged` : '0', r.pdf_url ? 'Yes' : 'No', genAt].forEach((v, j) => {
        const color = j === 1 ? (r.status === 'generated' ? C.green : C.amber) : j === 3 && dm > 0 ? C.amber : C.sub;
        doc.fill(color).fontSize(7.5).font(j === 1 ? 'Helvetica-Bold' : 'Helvetica');
        t(doc, v, hCols[j] + 3, y + 4, { width: hW[j] });
      });
      y += 16;
    });
    doc.y = y + 4;

    if (reports.length > 0) {
      newPage(ctx);
      sectionHead(ctx, L(), 'Per-Day Truck Photo Counts');
      const barMaxW = CW * 0.35;
      reports.slice(0, 15).forEach(rpt => {
        ensureSpace(ctx, 18 + trucks.length * 12);
        const dateStr = String(rpt.report_date).slice(0, 10);
        const dayPhotos = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr);
        let dy = doc.y + 1;
        doc.rect(M, dy, CW, 14).fill(C.navy);
        doc.fill(C.paper).fontSize(7).font('Helvetica-Bold');
        t(doc, `${dateStr}  ${(rpt.status || '').toUpperCase()} — ${rpt.received_photo_count}/${rpt.required_photo_count}`,
          M + 4, dy + 3, { width: CW - 8 });
        dy += 15;
        trucks.forEach((tk, ti) => {
          const cnt = dayPhotos.filter(p => p.convoy_truck_id === tk.id).length;
          if (ti % 2 === 0) doc.rect(M, dy, CW, 11).fill(C.stripe);
          const bW = perTruckRequired > 0 ? Math.min(barMaxW, barMaxW * cnt / perTruckRequired) : 0;
          doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `T${tk.position}`, M + 2, dy + 2, { width: 16 });
          doc.fill(C.muted).font('Helvetica');
          t(doc, tk.driver_name, M + 20, dy + 2, { width: 128 });
          doc.save().rect(M + 152, dy + 1, barMaxW, 8).lineWidth(0.4).fillAndStroke('#e5e7eb', C.hair).restore();
          if (bW > 0) doc.rect(M + 152, dy + 1, bW, 8).fill(cnt >= perTruckRequired ? C.green : C.amber);
          doc.fill(C.sub).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `${cnt}/${perTruckRequired}`, M + 152 + barMaxW + 3, dy + 2, { width: 40 });
          dy += 11;
        });
        doc.y = dy + 3;
      });
    }

    const range = doc.bufferedPageRange();
    if (range.count > 1) {
      doc.switchToPage(0);
      doc.save().rect(PW - M - 90, 52, 90, 10).fill(C.paper).restore();
      doc.fill(C.muted).fontSize(7).font('Helvetica');
      t(doc, `Full Report — ${range.count} Pages`, M, 52, { width: CW, align: 'right' });
      doc.switchToPage(range.count - 1);
    }
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
