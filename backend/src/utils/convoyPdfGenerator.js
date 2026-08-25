const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const logger = require('./logger');
const { geocode, renderRouteMapImage } = require('./routeMapRenderer');
const { assessConvoy } = require('./convoyIntegrity');

// Redesign v2 — formal "intelligence report" / white-paper style matching the
// Sonalit Convoy Intelligence Report HTML mockup. Navy/gold accents on white
// paper; full cover page with ink stamp + verification glyph; chain-of-custody
// certification with SHA-256 evidence digest.
const C = {
  paper: '#ffffff', paper2: '#fafaf8',
  ink: '#12151c', inkSoft: '#3c4250', inkFaint: '#4b5563',
  line: '#d8dbe0', lineStrong: '#b9bec7',
  navy: '#1b2a4a',
  gold: '#9c6f16', goldBg: '#fbf3e2',
  red: '#9c1f24', redBg: '#fbebec',
  green: '#1e6b45', greenBg: '#eaf4ef',
  amber: '#a16207', amberBg: '#fef3c7',
  white: '#ffffff',
};

const PW = 595.28, PH = 841.89, M = 40, CW = PW - M * 2;
const LH_H = 56;
const BODY_TOP = LH_H + 12;
const BODY_BOTTOM = PH - 34;

function t(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, { ...opts, lineBreak: false });
}

function makePdf(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: { top: M, bottom: 0, left: M, right: M },
      size: 'A4',
      autoFirstPage: false,
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

function dot(doc, x, y, r, color, hollow) {
  doc.save();
  if (hollow) doc.circle(x, y, r).lineWidth(0.8).stroke(color);
  else doc.circle(x, y, r).fill(color);
  doc.restore();
}

// ── Photo / map prefetch (unchanged) ────────────────────────────────────────

async function fetchImageBuffer(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  let raw;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { logger.warn(`[convoyPdf] photo fetch non-2xx (${res.status}): ${url}`); return null; }
    raw = Buffer.from(await res.arrayBuffer());
  } catch (err) { logger.warn(`[convoyPdf] photo fetch failed: ${url} -- ${err.message}`); return null; }
  try {
    return await sharp(raw, { failOn: 'none' })
      .rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  } catch (err) {
    logger.warn(`[convoyPdf] sharp processing failed, using raw bytes: ${url} -- ${err.message}`);
    return raw;
  }
}

async function prefetchPhotoBuffers(photos) {
  const map = new Map();
  await Promise.all(photos.map(async (p) => { const buf = await fetchImageBuffer(p.photo_url); if (buf) map.set(p.id, buf); }));
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
      points = stops.map((s) => { const g = geocode(s.name); return g ? { lat: g[0], lng: g[1], label: s.name } : null; }).filter(Boolean);
    } else { return null; }
    if (points.length < 2) return null;
    return await renderRouteMapImage(points);
  } catch (err) { logger.warn(`[convoyPdf] route map prefetch failed: ${err.message}`); return null; }
}

// ── Verification glyph — deterministic QR-like pattern from SHA-256 ─────────

function renderGlyph(doc, x, y, hash, size) {
  const GRID = 16, cell = size / GRID;
  const finderPositions = [[0, 0], [GRID - 7, 0], [0, GRID - 7]];
  function inFinder(gx, gy) {
    for (const [fx, fy] of finderPositions) {
      if (gx >= fx && gx < fx + 7 && gy >= fy && gy < fy + 7) return [fx, fy];
    }
    return null;
  }
  function finderFill(gx, gy, fx, fy) {
    const lx = gx - fx, ly = gy - fy;
    if (lx === 0 || lx === 6 || ly === 0 || ly === 6) return true;
    if (lx === 1 || lx === 5 || ly === 1 || ly === 5) return false;
    return true;
  }
  doc.save();
  doc.rect(x - 1, y - 1, size + 2, size + 2).lineWidth(0.6).stroke(C.lineStrong);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const f = inFinder(gx, gy);
      let fill;
      if (f) fill = finderFill(gx, gy, f[0], f[1]);
      else {
        const bitIndex = (gy * GRID + gx) % (hash.length * 4);
        const hexChar = hash[Math.floor(bitIndex / 4)];
        const bitPos = bitIndex % 4;
        fill = ((parseInt(hexChar, 16) >> bitPos) & 1) === 1;
      }
      if (fill) doc.rect(x + gx * cell, y + gy * cell, cell, cell).fill(C.navy);
    }
  }
  doc.restore();
}

// ── Ink stamp (circular verdict seal) ───────────────────────────────────────

function drawInkStamp(doc, cx, cy, r, verdict, score) {
  doc.save();
  doc.circle(cx, cy, r).lineWidth(2.5).stroke(C.gold);
  doc.circle(cx, cy, r * 0.87).lineWidth(1.2).stroke(C.gold);
  // Arc text
  const arcText = 'SONALIT CONVOY SYSTEM • CHAIN OF CUSTODY •';
  const arcR = r * 0.78;
  doc.fontSize(5).font('Helvetica-Bold').fill(C.gold);
  const charSpacing = 0.105;
  const totalArc = arcText.length * charSpacing;
  let angle = -Math.PI / 2 - totalArc / 2;
  for (const ch of arcText) {
    angle += charSpacing / 2;
    const px = cx + arcR * Math.cos(angle);
    const py = cy + arcR * Math.sin(angle);
    doc.save();
    doc.translate(px, py);
    doc.rotate((angle + Math.PI / 2) * 180 / Math.PI);
    doc.text(ch, -2.5, -3, { lineBreak: false });
    doc.restore();
    angle += charSpacing / 2;
  }
  // Center verdict text
  const lines = verdict.toUpperCase().split(' ');
  let ty = cy - (lines.length * 13) / 2 - 2;
  doc.fill(C.gold).fontSize(11).font('Helvetica-Bold');
  lines.forEach(line => { t(doc, line, cx - 40, ty, { width: 80, align: 'center' }); ty += 13; });
  doc.fill(C.gold).fontSize(6).font('Helvetica');
  t(doc, `SCORE ${score}/100`, cx - 40, ty + 2, { width: 80, align: 'center' });
  doc.restore();
}

// ── Cover page ──────────────────────────────────────────────────────────────

function drawCoverPage(doc, meta) {
  doc.addPage();
  // Subtle grid background
  doc.save().strokeColor(C.navy).strokeOpacity(0.05).lineWidth(0.5);
  for (let gx = 0; gx < PW; gx += 26) doc.moveTo(gx, 0).lineTo(gx, PH).stroke();
  for (let gy = 0; gy < PH; gy += 26) doc.moveTo(0, gy).lineTo(PW, gy).stroke();
  doc.restore();

  let y = 42;

  // Letterhead: mark + name (left) + classification badge (right)
  doc.rect(M, y, 34, 34).fill(C.navy);
  doc.fill(C.white).fontSize(17).font('Helvetica-Bold');
  t(doc, 'S', M, y + 9, { width: 34, align: 'center' });
  doc.fill(C.navy).fontSize(16).font('Helvetica-Bold');
  t(doc, 'SONALIT', M + 46, y + 4, { width: 200 });
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
  t(doc, 'Sonalit Convoy System · Chain-of-Custody Freight Intelligence', M + 46, y + 21, { width: 300 });
  // Classification badge
  const classW = doc.widthOfString(meta.classification) + 18;
  doc.save().rect(PW - M - classW, y + 2, classW, 18).lineWidth(1).stroke(C.red).restore();
  doc.fill(C.red).fontSize(7).font('Helvetica-Bold');
  t(doc, meta.classification, PW - M - classW, y + 7, { width: classW, align: 'center' });

  // Navy rule
  y += 48;
  doc.save().moveTo(M, y).lineTo(PW - M, y).lineWidth(2.5).strokeColor(C.navy).stroke().restore();

  // Hero section
  y += 22;
  doc.fill(C.gold).fontSize(8).font('Helvetica');
  t(doc, 'CONVOY INTELLIGENCE REPORT', M, y, { width: CW });
  y += 18;
  doc.fill(C.ink).fontSize(30).font('Helvetica-Bold');
  const titleLines = doc.heightOfString(`${meta.convoyId}\n${meta.origin} → ${meta.destination}`, { width: CW * 0.7 });
  t(doc, meta.convoyId, M, y, { width: CW * 0.7 });
  y += 30;
  doc.fill(C.ink).fontSize(22).font('Helvetica-Bold');
  t(doc, `${meta.origin} → ${meta.destination}`, M, y, { width: CW * 0.7 });

  // Route arrow
  y += 32;
  doc.fill(C.navy).fontSize(12).font('Helvetica-Bold');
  t(doc, (meta.origin || '').toUpperCase(), M, y + 2, { width: 120 });
  const arrowX = M + 130, arrowW = 100;
  doc.save().moveTo(arrowX, y + 7).lineTo(arrowX + arrowW, y + 7).lineWidth(1).strokeColor(C.lineStrong).stroke().restore();
  // Arrowhead
  doc.save().moveTo(arrowX + arrowW - 1, y + 4).lineTo(arrowX + arrowW + 5, y + 7).lineTo(arrowX + arrowW - 1, y + 10)
    .lineWidth(1.2).strokeColor(C.navy).stroke().restore();
  doc.fill(C.navy).fontSize(12).font('Helvetica-Bold');
  t(doc, (meta.destination || '').toUpperCase(), arrowX + arrowW + 12, y + 2, { width: 160 });

  // Split: route map box + ink stamp
  y += 34;
  const mapBoxW = CW * 0.6, mapBoxH = 120, stampW = CW - mapBoxW - 18;
  doc.save().rect(M, y, mapBoxW, mapBoxH).lineWidth(0.6).stroke(C.lineStrong).restore();
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica-Bold');
  t(doc, 'ROUTE OVERVIEW — GPS TRACE', M + 10, y + 10, { width: mapBoxW - 20 });
  // Mini schematic in map box
  if (meta.mapImage) {
    try {
      doc.save();
      doc.rect(M + 2, y + 24, mapBoxW - 4, mapBoxH - 34).clip();
      doc.image(meta.mapImage.buffer, M + 2, y + 24, { fit: [mapBoxW - 4, mapBoxH - 34], align: 'center', valign: 'center' });
      doc.restore();
    } catch { /* fall through to text fallback */ }
  } else {
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    t(doc, 'See Section B for full analysis', M + 10, y + mapBoxH / 2, { width: mapBoxW - 20 });
  }
  doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
  t(doc, `${meta.distanceKm} km logged · ${meta.gpsPoints} GPS points`, M + 10, y + mapBoxH - 14, { width: mapBoxW - 20 });

  // Ink stamp
  const stampCx = M + mapBoxW + 18 + stampW / 2, stampCy = y + mapBoxH / 2;
  doc.save().rect(M + mapBoxW + 18, y, stampW, mapBoxH).lineWidth(0.6).stroke(C.lineStrong).restore();
  drawInkStamp(doc, stampCx, stampCy, Math.min(stampW, mapBoxH) / 2 - 8, meta.verdict, meta.score);

  // Cargo summary strip (3 blocks)
  y += mapBoxH + 12;
  const cargoBlockW = CW / 3;
  meta.cargoBlocks.forEach((blk, i) => {
    const bx = M + i * cargoBlockW;
    doc.save().rect(bx, y, cargoBlockW, 36).lineWidth(0.6).stroke(C.line).restore();
    if (i > 0) doc.save().moveTo(bx, y).lineTo(bx, y + 36).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    t(doc, blk.label.toUpperCase(), bx + 10, y + 6, { width: cargoBlockW - 20 });
    doc.fill(blk.color || C.ink).fontSize(9).font('Helvetica-Bold');
    t(doc, blk.value, bx + 10, y + 19, { width: cargoBlockW - 20 });
  });

  // Vehicle table
  y += 48;
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica-Bold');
  t(doc, 'VEHICLES & PERSONNEL', M, y, { width: CW });
  y += 12;
  const vCols = [M, M + 40, M + 140, M + 240, M + 310, M + 410];
  const vWidths = [36, 96, 96, 66, 96, CW - 410];
  const vHeaders = ['Unit', 'Driver', 'Plate / Reg', 'License', 'Seals (SOD → EOD)', 'Photos'];
  // Header row
  doc.rect(M, y, CW, 14).fill(C.paper2);
  doc.save().rect(M, y, CW, 14).lineWidth(0.6).stroke(C.line).restore();
  vHeaders.forEach((h, i) => {
    doc.fill(C.inkFaint).fontSize(6).font('Helvetica-Bold');
    t(doc, h.toUpperCase(), vCols[i] + 4, y + 4, { width: vWidths[i] });
  });
  y += 14;
  meta.vehicleRows.forEach((row) => {
    doc.save().rect(M, y, CW, 16).lineWidth(0.4).stroke(C.line).restore();
    row.forEach((v, j) => {
      doc.fill(j === 5 ? C.green : C.inkSoft).fontSize(7).font(j === 0 ? 'Courier' : 'Helvetica');
      t(doc, v, vCols[j] + 4, y + 4, { width: vWidths[j] });
    });
    y += 16;
  });

  // Key facts strip (4 blocks)
  y += 10;
  const factW = CW / 4;
  doc.save().rect(M, y, CW, 38).lineWidth(0.6).stroke(C.lineStrong).restore();
  meta.facts.forEach((f, i) => {
    const fx = M + i * factW;
    if (i > 0) doc.save().moveTo(fx, y).lineTo(fx, y + 38).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    t(doc, f.label.toUpperCase(), fx + 12, y + 8, { width: factW - 24 });
    doc.fill(C.ink).fontSize(10).font('Helvetica-Bold');
    t(doc, f.value, fx + 12, y + 20, { width: factW - 24 });
  });

  // Contents index
  y += 50;
  doc.save().moveTo(M, y).lineTo(PW - M, y).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  y += 10;
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica-Bold');
  t(doc, 'REPORT CONTENTS', M, y, { width: CW });
  y += 12;
  const sections = meta.contents || [];
  const secW = CW / 5;
  sections.forEach((s, i) => {
    const sx = M + (i % 5) * secW;
    const sy = y + Math.floor(i / 5) * 16;
    doc.rect(sx, sy, 14, 14).fill(C.navy);
    doc.fill(C.white).fontSize(7).font('Helvetica-Bold');
    t(doc, s.letter, sx, sy + 4, { width: 14, align: 'center' });
    doc.fill(C.inkSoft).fontSize(7.5).font('Helvetica');
    t(doc, s.label, sx + 18, sy + 3, { width: secW - 22 });
  });
  y += Math.ceil(sections.length / 5) * 16 + 8;

  // Cover footer
  y = PH - 42;
  doc.save().moveTo(M, y).lineTo(PW - M, y).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  y += 8;
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
  t(doc, `Prepared for ${meta.clientName || 'Client'} · Field Compliance Officer ${meta.leadOfficer || '--'}`, M, y, { width: CW * 0.7 });
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
  t(doc, `Generated ${meta.generatedAt}`, M, y, { width: CW, align: 'right' });
}

// ── Inner page chrome ───────────────────────────────────────────────────────

function drawLetterhead(ctx) {
  const doc = ctx.doc;
  // Navy top rule
  doc.save().moveTo(M, 14).lineTo(PW - M, 14).lineWidth(2.5).strokeColor(C.navy).stroke().restore();
  // Mark + name
  doc.rect(M, 18, 22, 22).fill(C.navy);
  doc.fill(C.white).fontSize(11).font('Helvetica-Bold');
  t(doc, 'S', M, 24, { width: 22, align: 'center' });
  doc.fill(C.navy).fontSize(12).font('Helvetica-Bold');
  t(doc, 'SONALIT', M + 28, 22, { width: 100 });
  doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
  t(doc, 'Sonalit Convoy System · Chain-of-Custody Freight Intelligence', M + 28, 34, { width: 280 });
  // Report ref + classification
  doc.fill(C.ink).fontSize(8).font('Courier');
  t(doc, `REPORT NO. ${ctx.reportRef || ''}`, PW - M - 200, 22, { width: 200, align: 'right' });
  if (ctx.classification) {
    const cw = doc.widthOfString(ctx.classification) + 14;
    doc.save().rect(PW - M - cw, 33, cw, 13).lineWidth(0.6).stroke(C.red).restore();
    doc.fill(C.red).fontSize(5.5).font('Helvetica-Bold');
    t(doc, ctx.classification, PW - M - cw, 37, { width: cw, align: 'center' });
  }
  // Subheader
  const sy = 48;
  doc.save().moveTo(M, sy).lineTo(PW - M, sy).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
  t(doc, `Convoy Intelligence Report · Generated ${ctx.generatedAt}`, M, sy + 3, { width: CW * 0.7 });
  t(doc, ctx.subtitle || '', M, sy + 3, { width: CW, align: 'right' });
}

function drawPageFooter(ctx) {
  const doc = ctx.doc, fy = PH - 26;
  doc.save().moveTo(M, fy).lineTo(PW - M, fy).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
  t(doc, `SONALIT CONVOY SYSTEM — ${ctx.reportRef || ''}`, M, fy + 6, { width: CW * 0.6 });
  t(doc, `Generated ${ctx.generatedAt}`, M, fy + 6, { width: CW, align: 'right' });
}

function newPage(ctx) {
  ctx.doc.addPage();
  ctx.pageNum++;
  drawLetterhead(ctx);
  drawPageFooter(ctx);
  ctx.doc.y = BODY_TOP;
}

function ensureSpace(ctx, needed) { if (ctx.doc.y + needed > BODY_BOTTOM) newPage(ctx); }
function nextLetter(ctx) { const idx = ctx.letterIdx || 0; ctx.letterIdx = idx + 1; return String.fromCharCode(65 + idx); }

// ── Section head — navy-bordered with letter badge and ghost watermark ──────

function sectionHead(ctx, letter, label, status) {
  ensureSpace(ctx, 30);
  const doc = ctx.doc, y = doc.y + 8;
  // Ghost watermark letter
  if (letter) {
    doc.save().fill(C.navy).fillOpacity(0.055).fontSize(52).font('Helvetica-Bold');
    t(doc, letter, PW - M - 36, y - 32, { width: 36, align: 'right' });
    doc.restore();
  }
  // Letter badge
  if (letter) {
    doc.fill(C.navy).fontSize(10).font('Helvetica-Bold');
    t(doc, letter, M, y + 2, { width: 14 });
  }
  const textX = letter ? M + 16 : M;
  doc.fill(C.navy).fontSize(10).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), textX, y + 2, { width: CW - (letter ? 180 : 160) });
  if (status) {
    doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
    t(doc, status, M + CW - 160, y + 4, { width: 160, align: 'right' });
  }
  doc.save().moveTo(M, y + 18).lineTo(M + CW, y + 18).lineWidth(1.5).strokeColor(C.navy).stroke().restore();
  doc.y = y + 24;
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function subBanner(ctx, label, status) {
  ensureSpace(ctx, 26);
  const doc = ctx.doc, y = doc.y;
  doc.rect(M, y, CW, 18).fill(C.navy);
  doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), M + 8, y + 5, { width: CW - 170 });
  if (status) {
    doc.fill('#9ca3af').fontSize(6.5).font('Helvetica');
    t(doc, status, M + CW - 160, y + 5.5, { width: 152, align: 'right' });
  }
  doc.y = y + 24;
}

function detailGrid(doc, items, cols = 2) {
  const cellW = CW / cols, rowH = 30;
  const rows = Math.ceil(items.length / cols);
  const top = doc.y;
  doc.save().rect(M, top, CW, rows * rowH).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  items.forEach((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * cellW, y = top + row * rowH;
    if (col > 0) doc.save().moveTo(x, y).lineTo(x, y + rowH).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    if (row > 0) doc.save().moveTo(x, y).lineTo(x + cellW, y).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    t(doc, (item.label || '').toUpperCase(), x + 10, y + 5, { width: cellW - 20 });
    doc.fill(item.color || C.ink).fontSize(9.5).font('Helvetica-Bold');
    t(doc, item.value ?? '--', x + 10, y + 15, { width: cellW - 20 });
  });
  doc.y = top + rows * rowH + 8;
}

function progressBar(doc, received, required) {
  const pct = required > 0 ? Math.min(1, received / required) : 0, y = doc.y;
  doc.save().rect(M, y, CW, 10).lineWidth(0.5).fillAndStroke('#e5e7eb', C.line).restore();
  if (pct > 0) doc.rect(M, y, CW * pct, 10).fill(pct >= 1 ? C.green : pct >= 0.5 ? C.amber : C.red);
  doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
  t(doc, `${received} / ${required}  (${Math.round(pct * 100)}%)`, M + 4, y + 2, { width: CW - 8 });
  doc.y = y + 18;
}

function tableHeader(doc, cols, widths, headers) {
  const y = doc.y;
  doc.rect(M, y, CW, 15).fill(C.paper2);
  doc.save().rect(M, y, CW, 15).lineWidth(0.5).stroke(C.line).restore();
  headers.forEach((h, i) => { doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica-Bold'); t(doc, h.toUpperCase(), cols[i] + 3, y + 4, { width: widths[i] }); });
  doc.y = y + 17;
}

// ── Integrity section — verdict box + findings register ─────────────────────

function fmtDur(mins) {
  if (mins == null) return '--';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function integritySection(ctx, a) {
  const doc = ctx.doc;
  ensureSpace(ctx, 130);
  sectionHead(ctx, nextLetter(ctx), 'Integrity Assessment');

  const vmap = {
    cleared:    { label: 'CLEARED',      fg: C.green, bg: C.greenBg, border: '#86efac' },
    review:     { label: 'UNDER REVIEW', fg: C.gold,  bg: C.goldBg,  border: C.gold },
    exceptions: { label: 'EXCEPTIONS',   fg: C.red,   bg: C.redBg,   border: '#fca5a5' },
  };
  const v = vmap[a.verdict] || vmap.review;

  // Verdict box — bordered card matching HTML .verdict-box
  const bY = doc.y, bH = 54;
  doc.save().rect(M, bY, CW, bH).lineWidth(1).stroke(C.lineStrong).restore();
  doc.rect(M + 1, bY + 1, CW - 2, bH - 2).fill(C.paper2);
  // Status badge
  const badgeW = doc.widthOfString(v.label) + 20;
  doc.save().rect(M + 14, bY + 10, badgeW, 20).lineWidth(1).fillAndStroke(v.bg, v.fg).restore();
  doc.fill(v.fg).fontSize(9).font('Helvetica-Bold');
  t(doc, v.label, M + 14, bY + 15, { width: badgeW, align: 'center' });
  // Score
  doc.fill(C.inkSoft).fontSize(8).font('Courier');
  t(doc, `Integrity Score: ${a.score} / 100  ·  ${a.counts.critical} Critical · ${a.counts.warning} Warning · ${a.counts.info} Info`,
    M + badgeW + 30, bY + 15, { width: CW - badgeW - 50 });
  // Blurb
  const blurbMap = {
    cleared: 'Full evidence coverage; no anomalies detected.',
    review: 'Minor gaps or anomalies require dispatcher review.',
    exceptions: 'Critical anomalies detected — escalate before sign-off.',
  };
  doc.fill(C.inkSoft).fontSize(7.5).font('Helvetica');
  t(doc, blurbMap[a.verdict] || '', M + 14, bY + 36, { width: CW - 28 });
  doc.y = bY + bH + 10;

  // Findings register table
  const sevColor = { critical: C.red, warning: C.gold, info: C.inkFaint };
  if (!a.findings.length) {
    ensureSpace(ctx, 18);
    dot(doc, M + 5, doc.y + 5, 3, C.green);
    doc.fill(C.green).fontSize(8).font('Helvetica-Bold');
    t(doc, 'No exceptions — all coverage, seal, and route checks passed.', M + 14, doc.y + 1, { width: CW - 20 });
    doc.y += 18;
  } else {
    ensureSpace(ctx, 26 + a.findings.length * 16);
    // Table header
    const fCols = [M, M + 50, M + 130], fWidths = [46, 76, CW - 130];
    tableHeader(doc, fCols, fWidths, ['ID', 'Severity', 'Finding']);
    a.findings.slice(0, 14).forEach((f, i) => {
      if (doc.y + 16 > BODY_BOTTOM) newPage(ctx);
      const ry = doc.y;
      if (i % 2 === 0) doc.rect(M, ry, CW, 16).fill(C.paper2);
      doc.save().rect(M, ry, CW, 16).lineWidth(0.3).stroke(C.line).restore();
      doc.fill(C.inkSoft).fontSize(7).font('Courier');
      t(doc, `F-${String(i + 1).padStart(2, '0')}`, fCols[0] + 3, ry + 4, { width: fWidths[0] });
      const sc = sevColor[f.severity] || C.inkFaint;
      const sevW = doc.widthOfString(f.severity.toUpperCase()) + 12;
      doc.save().rect(fCols[1] + 3, ry + 3, sevW, 11).lineWidth(0.6).fillAndStroke(f.severity === 'warning' ? C.goldBg : f.severity === 'critical' ? C.redBg : '#eef1f5', sc).restore();
      doc.fill(sc).fontSize(6).font('Helvetica-Bold');
      t(doc, f.severity.toUpperCase(), fCols[1] + 3, ry + 5, { width: sevW, align: 'center' });
      doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
      t(doc, f.title, fCols[2] + 3, ry + 1, { width: fWidths[2] - 6 });
      doc.fill(C.inkSoft).fontSize(6.5).font('Helvetica');
      t(doc, f.detail, fCols[2] + 3, ry + 9, { width: fWidths[2] - 6 });
      doc.y = ry + 16;
    });
  }

  // Data integrity advisory
  if (a.advisory) {
    ensureSpace(ctx, 40);
    const ay = doc.y + 4;
    doc.save().moveTo(M, ay).lineTo(M, ay + 30).lineWidth(3).strokeColor(C.gold).stroke().restore();
    doc.rect(M + 3, ay, CW - 3, 30).fill(C.goldBg);
    doc.fill(C.ink).fontSize(7).font('Helvetica-Bold');
    t(doc, 'Data integrity advisory.', M + 10, ay + 4, { width: CW - 20 });
    doc.fill(C.inkSoft).fontSize(6.5).font('Helvetica');
    doc.text(a.advisory, M + 10, ay + 14, { width: CW - 20, lineBreak: true, height: 14 });
    doc.y = ay + 36;
  }

  // Route analytics
  if (a.route.hasTrack) {
    ensureSpace(ctx, 46);
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica-Bold');
    t(doc, 'ROUTE ANALYTICS', M, doc.y + 2, { width: 200 });
    doc.y += 13;
    detailGrid(doc, [
      { label: 'Distance', value: `${a.route.distanceKm} km` },
      { label: 'Duration', value: fmtDur(a.route.durationMin) },
      { label: 'Avg Speed', value: a.route.avgSpeedKmh != null ? `${a.route.avgSpeedKmh} km/h` : '--' },
      { label: 'Peak Speed', value: a.route.maxSpeedKmh != null ? `${a.route.maxSpeedKmh} km/h` : '--', color: a.route.overspeedCount > 0 ? C.red : C.ink },
      { label: 'Stops', value: String(a.route.stops) },
      { label: 'Max Deviation', value: a.route.deviationKm != null ? `${a.route.deviationKm} km` : '--', color: (a.route.deviationKm != null && a.route.deviationKm > 8) ? C.red : C.ink },
    ], 6);
  }
}

// ── Route section ───────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function drawMapImageBox(doc, mapResult, boxH) {
  const y = doc.y;
  doc.save().rect(M, y, CW, boxH).lineWidth(0.6).stroke(C.lineStrong).restore();
  try {
    doc.save();
    doc.rect(M, y, CW, boxH).clip();
    doc.image(mapResult.buffer, M, y, { fit: [CW, boxH], align: 'center', valign: 'center' });
    doc.restore();
    const scale = Math.min(CW / mapResult.width, boxH / mapResult.height);
    const offX = M + (CW - mapResult.width * scale) / 2;
    const offY = y + (boxH - mapResult.height * scale) / 2;
    mapResult.points.forEach((p) => {
      if (!p.label) return;
      const px = offX + p.x * scale, py = offY + p.y * scale;
      const lw = 92, lh = 12, lx = px - lw / 2, ly = py - 26;
      doc.save().rect(lx, ly, lw, lh).fill(C.white).restore();
      doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
      t(doc, p.label, lx, ly + 2, { width: lw, align: 'center' });
    });
  } catch {
    doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
    t(doc, 'Map image unavailable', M, y + boxH / 2 - 4, { width: CW, align: 'center' });
  }
  doc.fill(C.inkFaint).fontSize(5.5).font('Helvetica');
  t(doc, '(c) OpenStreetMap contributors', M, y + boxH + 3, { width: CW });
  doc.y = y + boxH + 14;
}

function plannedRouteMap(ctx, convoy, namedWaypoints) {
  const doc = ctx.doc;
  const trim = (s) => (s || '').trim().toLowerCase();
  const stops = [
    { name: convoy.route_origin || 'Origin' },
    ...namedWaypoints,
    { name: convoy.route_destination || 'Destination' },
  ].filter((s, i, arr) => i === 0 || trim(s.name) !== trim(arr[i - 1].name));
  const perRow = 5, rowH = 62;
  const rows = Math.ceil(stops.length / perRow);
  const mapH = Math.max(120, 34 + rows * rowH);
  ensureSpace(ctx, mapH + 20);
  const mapY = doc.y, padX = 34;

  // Route panel box (styled like HTML .route-panel)
  doc.save().rect(M, mapY, CW, mapH).lineWidth(0.6).stroke(C.lineStrong).restore();
  // Header
  doc.rect(M, mapY, CW, 22).fill(C.paper2);
  doc.save().moveTo(M, mapY + 22).lineTo(M + CW, mapY + 22).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  doc.fill(C.inkSoft).fontSize(7).font('Helvetica-Bold');
  t(doc, 'PLANNED ROUTE', M + 10, mapY + 6, { width: 200 });
  doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
  t(doc, 'Dispatcher-entered, not GPS-verified', M + 10, mapY + 14, { width: 250 });

  const chipW = 70, chipH = 24, chipX = M + CW - chipW - 8, chipY = mapY + 28;
  doc.save().rect(chipX, chipY, chipW, chipH).lineWidth(0.6).fillAndStroke(C.white, C.line).restore();
  doc.fill(C.inkFaint).fontSize(6).font('Helvetica'); t(doc, 'STOPS', chipX + 8, chipY + 4, { width: chipW - 16 });
  doc.fill(C.ink).fontSize(11).font('Helvetica-Bold'); t(doc, String(stops.length), chipX + 8, chipY + 13, { width: chipW - 16 });

  const usableW = CW - padX * 2;
  const positions = stops.map((s, i) => {
    const row = Math.floor(i / perRow), idxInRow = i % perRow;
    const itemsInRow = Math.min(perRow, stops.length - row * perRow);
    const ltr = row % 2 === 0;
    const displayIdx = ltr ? idxInRow : itemsInRow - 1 - idxInRow;
    const rowColW = itemsInRow > 1 ? usableW / (itemsInRow - 1) : 0;
    const x = M + padX + (itemsInRow > 1 ? displayIdx * rowColW : usableW / 2);
    const y = mapY + 40 + row * rowH + rowH / 2;
    return { x, y, name: s.name, endpoint: i === 0 || i === stops.length - 1 };
  });

  doc.save().lineWidth(1.4).strokeColor(C.navy);
  for (let i = 1; i < positions.length; i++) doc.moveTo(positions[i - 1].x, positions[i - 1].y).lineTo(positions[i].x, positions[i].y);
  doc.stroke().restore();
  positions.forEach((p, i) => {
    dot(doc, p.x, p.y, p.endpoint ? 4 : 3, p.endpoint ? C.navy : C.inkFaint);
    doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
    t(doc, p.name, p.x - 45, i % 2 === 0 ? p.y - 17 : p.y + 6, { width: 90, align: 'center' });
  });
  doc.y = mapY + mapH + 8;
}

function routeSection(ctx, waypoints, convoy, namedWaypoints = [], mapImage = null) {
  const doc = ctx.doc;
  ensureSpace(ctx, 240);
  sectionHead(ctx, nextLetter(ctx), "Route Analytics");

  if (!waypoints.length) {
    doc.fill(C.inkFaint).fontSize(7.5).font('Helvetica');
    t(doc, 'No GPS waypoints logged for this date.', M, doc.y, { width: CW });
    doc.y += 14;
    if (!namedWaypoints.length) {
      doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
      t(doc, 'No known route waypoints configured for this convoy either.', M, doc.y, { width: CW });
      doc.y += 16;
      return;
    }
    if (mapImage) {
      ensureSpace(ctx, 215);
      doc.fill(C.inkSoft).fontSize(7).font('Helvetica-Bold');
      t(doc, 'PLANNED ROUTE (dispatcher-entered, not GPS-verified)', M, doc.y, { width: CW });
      doc.y += 12;
      drawMapImageBox(doc, mapImage, 190);
    } else {
      plannedRouteMap(ctx, convoy, namedWaypoints);
    }
    return;
  }

  let distanceKm = 0;
  for (let i = 1; i < waypoints.length; i++) distanceKm += haversineKm(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
  const speeds = waypoints.map(w => w.speed_kmh).filter(v => v != null);
  const peakSpeed = speeds.length ? Math.max(...speeds) : null;
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  const first = new Date(waypoints[0].recorded_at), last = new Date(waypoints[waypoints.length - 1].recorded_at);
  const driveMs = Math.max(0, last - first);
  const driveHrs = Math.floor(driveMs / 3600000), driveMin = Math.round((driveMs % 3600000) / 60000);

  // Stats table (styled like HTML .stat-table)
  const statItems = [
    { label: 'Distance Logged', value: `${distanceKm.toFixed(1)} km` },
    { label: 'Peak Speed', value: peakSpeed != null ? `${peakSpeed.toFixed(0)} km/h` : '--', color: peakSpeed > 90 ? C.red : C.ink },
    { label: 'Avg Speed', value: avgSpeed != null ? `${avgSpeed.toFixed(0)} km/h` : '--' },
    { label: 'Drive Time', value: `${driveHrs}h ${driveMin}m` },
    { label: 'GPS Points', value: String(waypoints.length) },
  ];
  detailGrid(doc, statItems, 5);

  ensureSpace(ctx, 190);
  if (mapImage) {
    drawMapImageBox(doc, mapImage, 150);
  } else {
    const mapH = 150, mapY = doc.y, padPx = 16;
    doc.save().rect(M, mapY, CW, mapH).lineWidth(0.6).stroke(C.lineStrong).restore();
    const lats = waypoints.map(w => w.lat), lngs = waypoints.map(w => w.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latRange = Math.max(maxLat - minLat, 0.0005), lngRange = Math.max(maxLng - minLng, 0.0005);
    const project = (lat, lng) => [
      M + padPx + ((lng - minLng) / lngRange) * (CW - padPx * 2),
      mapY + padPx + (1 - (lat - minLat) / latRange) * (mapH - padPx * 2),
    ];
    doc.save().lineWidth(1.4).strokeColor(C.navy);
    waypoints.forEach((w, i) => { const [x, y] = project(w.lat, w.lng); if (i === 0) doc.moveTo(x, y); else doc.lineTo(x, y); });
    doc.stroke().restore();
    const [sx, sy] = project(waypoints[0].lat, waypoints[0].lng);
    const [ex, ey] = project(waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng);
    dot(doc, sx, sy, 3.5, C.green);
    dot(doc, ex, ey, 3.5, C.red);
    // Legend
    doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
    t(doc, 'Schematic route track (not to scale) — start (green) to last logged position (red)', M, mapY + mapH + 4, { width: CW });
    doc.y = mapY + mapH + 16;
  }

  // GPS sample table
  const sampleCount = Math.min(8, waypoints.length);
  const step = Math.max(1, Math.floor(waypoints.length / sampleCount));
  const samples = [];
  for (let i = 0; i < waypoints.length && samples.length < sampleCount; i += step) samples.push(waypoints[i]);
  const lastPoint = waypoints[waypoints.length - 1];
  if (samples[samples.length - 1] !== lastPoint) samples.push(lastPoint);
  ensureSpace(ctx, 20 + samples.length * 14);
  const gCols = [M, M + 90, M + 220, M + 340], gW = [86, 126, 116, 166];
  tableHeader(doc, gCols, gW, ['Time (UTC)', 'Lat, Lng', 'Speed', 'Heading']);
  let gy = doc.y;
  samples.forEach((w, i) => {
    if (gy + 14 > BODY_BOTTOM) { newPage(ctx); gy = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, gy, CW, 14).fill(C.paper2);
    doc.save().rect(M, gy, CW, 14).lineWidth(0.3).stroke(C.line).restore();
    const time = new Date(w.recorded_at).toISOString().replace('T', ' ').slice(0, 19);
    const spd = w.speed_kmh != null ? `${w.speed_kmh.toFixed(0)} km/h` : '--';
    const hdg = w.heading != null ? `${Math.round(w.heading)} deg` : '--';
    [time, `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`, spd, hdg].forEach((v, j) => {
      doc.fill(C.inkSoft).fontSize(7).font(j === 0 ? 'Courier' : 'Helvetica');
      t(doc, v, gCols[j] + 3, gy + 3, { width: gW[j] });
    });
    gy += 14;
  });
  doc.y = gy + 6;
}

// ── Photo evidence sections ─────────────────────────────────────────────────

function photoMatrix(ctx, trucks) {
  const doc = ctx.doc;
  const labelW = 115;
  const cellW = 44, cellH = 18, gap = 2;
  const cols = ['FR', 'RR', 'SEALS'];
  const sessionW = cols.length * (cellW + gap);
  const rowH = cellH + 5;
  let y = doc.y;
  doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'TRUCK / DRIVER', M, y + 4, { width: labelW });
  let x = M + labelW;
  ['START OF DAY', 'END OF DAY'].forEach(s => {
    doc.rect(x, y, sessionW, 13).fill(C.navy);
    doc.fill(C.white).fontSize(6.5).font('Helvetica-Bold');
    t(doc, s, x, y + 3, { width: sessionW, align: 'center' });
    x += sessionW + 8;
  });
  y += 15;
  x = M + labelW;
  [0, 1].forEach(() => {
    cols.forEach((cl, idx) => {
      doc.fill(C.inkFaint).fontSize(5.5).font('Helvetica');
      t(doc, cl, x + idx * (cellW + gap), y + 1, { width: cellW, align: 'center' });
    });
    x += sessionW + 8;
  });
  y += 10;
  trucks.forEach((truck, ti) => {
    if (y + rowH > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (ti % 2 === 0) doc.rect(M, y, CW, rowH).fill(C.paper2);
    doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
    t(doc, `T${truck.position}`, M + 2, y + 3, { width: 18 });
    doc.fill(C.inkSoft).fontSize(7).font('Helvetica');
    t(doc, truck.driver_name || '--', M + 20, y + 2, { width: labelW - 24 });
    doc.fill(C.inkFaint).fontSize(6);
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
          .fillAndStroke(c.ok ? C.greenBg : C.redBg, c.ok ? '#86efac' : '#fca5a5').restore();
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
  sectionHead(ctx, nextLetter(ctx), `Location Mismatches (${mm.length})`);
  const doc = ctx.doc, cols = [M, M + 100, M + 200, M + 290, M + 390], colW = [96, 96, 86, 96, 80];
  tableHeader(doc, cols, colW, ['Truck', 'Photo Type', 'Session', 'Uploaded', 'Flag']);
  let y = doc.y;
  mm.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.amberBg);
    [String(p.convoy_truck_id).slice(-8), `${p.photo_type}${p.seal_position ? ' #' + p.seal_position : ''}`,
      (p.session || '').toUpperCase(), p.uploaded_at ? new Date(p.uploaded_at).toISOString().slice(0, 16).replace('T', ' ') : '--', 'GPS >2km',
    ].forEach((v, j) => { doc.fill(C.inkSoft).fontSize(7).font('Helvetica'); t(doc, v, cols[j] + 3, y + 3, { width: colW[j] }); });
    y += 14;
  });
  doc.y = y + 4;
}

function drawPhotoCard(doc, x, y, w, photoH, captionH, slot, match, photoBuffers) {
  doc.save().rect(x, y, w, photoH).lineWidth(0.6).fillAndStroke(C.paper2, C.lineStrong).restore();
  const buf = match ? photoBuffers.get(match.id) : null;
  if (buf) {
    try {
      doc.save();
      doc.rect(x, y, w, photoH).clip();
      doc.image(buf, x, y, { fit: [w, photoH], align: 'center', valign: 'center' });
      doc.restore();
    } catch { drawNoPhotoText(doc, x, y, w, photoH); }
  } else { drawNoPhotoText(doc, x, y, w, photoH); }
  // Status badge
  const present = !!match;
  const badgeW = 52, badgeH = 12;
  doc.save().rect(x + w - badgeW - 4, y + 4, badgeW, badgeH).lineWidth(0.6)
    .fillAndStroke(present ? C.greenBg : C.redBg, present ? C.green : C.red).restore();
  doc.fill(present ? C.green : C.red).fontSize(6).font('Helvetica-Bold');
  t(doc, present ? 'VERIFIED' : 'MISSING', x + w - badgeW - 4, y + 7, { width: badgeW, align: 'center' });
  // Caption
  let cy = y + photoH + 4;
  doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
  t(doc, slot.label, x, cy, { width: w });
  cy += 11;
  doc.fill(C.inkFaint).fontSize(6).font('Courier');
  const uploaded = match?.uploaded_at ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
  t(doc, uploaded, x, cy, { width: w });
  cy += 9;
  const gps = match?.lat != null && match?.lng != null
    ? `${parseFloat(match.lat).toFixed(4)}, ${parseFloat(match.lng).toFixed(4)}` : 'GPS --';
  doc.fill(match?.location_mismatch ? C.amber : C.inkFaint).fontSize(6);
  t(doc, gps, x, cy, { width: w });
}

function drawNoPhotoText(doc, x, y, w, h) {
  doc.fill(C.inkFaint).fontSize(7.5).font('Helvetica');
  t(doc, 'NO PHOTO', x, y + h / 2 - 4, { width: w, align: 'center' });
}

function truckDetail(ctx, truck, truckPhotos, sealCountPerTruck, photoBuffers) {
  newPage(ctx);
  const doc = ctx.doc;
  const displaySealCap = Math.min(sealCountPerTruck, 2);
  const sealCodesFor = (session) => Array.from(new Set(
    truckPhotos.filter(p => p.session === session && p.photo_type === 'seal').map(p => String(p.seal_position))
  )).sort().slice(0, displaySealCap);
  const sodSealCodes = sealCodesFor('sod'), eodSealCodes = sealCodesFor('eod');
  const expectedTotal = (2 + sealCountPerTruck) * 2;
  const receivedTotal = ['sod', 'eod'].reduce((sum, session) => {
    const sp = truckPhotos.filter(p => p.session === session);
    const frontRear = (sp.some(p => p.photo_type === 'front') ? 1 : 0) + (sp.some(p => p.photo_type === 'rear') ? 1 : 0);
    const sealCount = Math.min(new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size, sealCountPerTruck);
    return sum + frontRear + sealCount;
  }, 0);

  subBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'}`, `${receivedTotal}/${expectedTotal} Photos`);
  detailGrid(doc, [
    { label: 'Plate / Reg', value: truck.plate_number || '--' },
    { label: 'Driver Phone', value: truck.driver_phone || '--' },
    { label: 'License No', value: truck.driver_license_no || '--' },
    { label: `Seal Codes (${displaySealCap} of ${sealCountPerTruck} shown)`,
      value: (sodSealCodes.length || eodSealCodes.length)
        ? `SOD: ${sodSealCodes.join(', ') || '--'}  ·  EOD: ${eodSealCodes.join(', ') || '--'}` : '--' },
  ]);

  const colGap = 16, colW = (CW - colGap) / 2;
  const colDefs = [
    { x: M, label: 'START OF DAY (SOD)', session: 'sod' },
    { x: M + colW + colGap, label: 'END OF DAY (EOD)', session: 'eod' },
  ];
  const bannerH = 18, photoH = 145, captionH = 28, photoGap = 10;
  const heroPairH = (photoH + 6 + captionH) * 2 + photoGap;
  const sealCols = 2, sealGap = 8;
  const sealCardW = (colW - sealGap * (sealCols - 1)) / sealCols;
  const sealPhotoH = 78, sealCaptionH = 24, sealRowStride = sealPhotoH + 6 + sealCaptionH + 10;
  const sealRows = Math.ceil(displaySealCap / sealCols);

  ensureSpace(ctx, bannerH + 8 + heroPairH + 20);
  const topY = doc.y;
  colDefs.forEach(col => {
    doc.rect(col.x, topY, colW, bannerH).fill(C.navy);
    doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
    t(doc, col.label, col.x + 8, topY + 5, { width: colW - 16 });
  });
  const heroY = topY + bannerH + 8;
  colDefs.forEach(col => {
    const sp = truckPhotos.filter(p => p.session === col.session);
    drawPhotoCard(doc, col.x, heroY, colW, photoH, captionH,
      { label: 'FRONT', photoType: 'front', sealPos: null }, sp.find(p => p.photo_type === 'front'), photoBuffers);
    drawPhotoCard(doc, col.x, heroY + photoH + 6 + captionH + photoGap, colW, photoH, captionH,
      { label: 'REAR', photoType: 'rear', sealPos: null }, sp.find(p => p.photo_type === 'rear'), photoBuffers);
  });
  doc.y = heroY + heroPairH + 12;

  if (displaySealCap <= 0) return;
  const sealCodesByCol = { sod: sodSealCodes, eod: eodSealCodes };
  for (let row = 0; row < sealRows; row++) {
    const pageBefore = ctx.pageNum;
    ensureSpace(ctx, sealRowStride + 10);
    if (ctx.pageNum !== pageBefore) {
      subBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'} (seals, continued)`);
      const contY = doc.y;
      colDefs.forEach(col => {
        doc.rect(col.x, contY, colW, bannerH).fill(C.navy);
        doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
        t(doc, col.label, col.x + 8, contY + 5, { width: colW - 16 });
      });
      doc.y = contY + bannerH + 8;
    }
    const rowY = doc.y;
    colDefs.forEach(col => {
      const sp = truckPhotos.filter(p => p.session === col.session);
      const codes = sealCodesByCol[col.session];
      for (let sc = 0; sc < sealCols; sc++) {
        const idx = row * sealCols + sc;
        if (idx >= displaySealCap) break;
        const pos = codes[idx] || null;
        const slot = { label: pos ? `SEAL ${pos}` : `SEAL ${idx + 1}`, photoType: 'seal', sealPos: pos };
        const match = pos ? sp.find(p => p.photo_type === 'seal' && String(p.seal_position) === pos) : null;
        drawPhotoCard(doc, col.x + sc * (sealCardW + sealGap), rowY, sealCardW, sealPhotoH, sealCaptionH, slot, match, photoBuffers);
      }
    });
    doc.y = rowY + sealRowStride;
  }
}

// ── CFO photos + handover ───────────────────────────────────────────────────

function cfoPhotosTable(ctx, cfoPhotos) {
  if (!cfoPhotos.length) return;
  ensureSpace(ctx, 60 + Math.min(cfoPhotos.length, 10) * 14);
  sectionHead(ctx, nextLetter(ctx), `CFO App Photos (${cfoPhotos.length} uploaded)`);
  const doc = ctx.doc, cols = [M, M + 55, M + 130, M + 230, M + 310, M + 390], colW = [51, 71, 96, 76, 76, 115];
  tableHeader(doc, cols, colW, ['Phase', 'Type', 'Plate', 'Lat', 'Lng', 'Time (UTC)']);
  let y = doc.y;
  cfoPhotos.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.paper2);
    doc.save().rect(M, y, CW, 14).lineWidth(0.3).stroke(C.line).restore();
    const at = p.taken_at ? new Date(p.taken_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
    [(p.session || '').toUpperCase() || '--', p.photo_type || '--', p.plate_number || '--',
      p.lat != null ? parseFloat(p.lat).toFixed(4) : '--', p.lng != null ? parseFloat(p.lng).toFixed(4) : '--', at,
    ].forEach((v, j) => {
      doc.fill(j === 0 ? (p.session === 'sod' ? C.green : C.gold) : C.inkSoft).fontSize(7).font(j === 0 ? 'Helvetica-Bold' : 'Helvetica');
      t(doc, v, cols[j] + 3, y + 3, { width: colW[j] });
    });
    y += 14;
  });
  doc.y = y + 4;
}

function handoverSection(ctx, handovers, trucks, formBuffers) {
  const doc = ctx.doc;
  ensureSpace(ctx, 40);
  sectionHead(ctx, nextLetter(ctx), 'Handover');
  if (!handovers.length) {
    doc.fill(C.inkFaint).fontSize(7.5).font('Helvetica');
    t(doc, 'No handover on record for this convoy.', M, doc.y, { width: CW });
    doc.y += 16;
    return;
  }
  handovers.forEach((h) => {
    const truck = h.convoy_truck_id ? trucks.find((tk) => tk.id === h.convoy_truck_id) : null;
    const label = truck ? `Truck ${truck.position} — ${truck.plate_number || String(truck.id).slice(0, 8)}` : 'Whole Convoy';
    const roleLabel = h.handed_over_by_role === 'cfo' ? 'CFO (self-handover)' : 'Handover Officer';
    const byName = h.handed_over_by_name || 'Unknown';
    const signedAt = h.signed_off_at ? new Date(h.signed_off_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '--';
    const buf = formBuffers.get(h.id);
    const isPdfForm = !buf && /\.pdf(\?|$)/i.test(h.form_url || '');
    const boxW = 220, boxH = 170;
    ensureSpace(ctx, (buf ? boxH : 0) + 60);
    doc.fill(C.ink).fontSize(8.5).font('Helvetica-Bold');
    t(doc, label, M, doc.y, { width: CW });
    doc.y += 12;
    doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
    t(doc, `${byName} · ${roleLabel} · signed off ${signedAt}`, M, doc.y, { width: CW });
    doc.y += 12;
    if (h.notes) { doc.fill(C.inkSoft).fontSize(7).font('Helvetica-Oblique'); t(doc, h.notes, M, doc.y, { width: CW }); doc.y += 12; }
    if (buf) {
      doc.save().rect(M, doc.y, boxW, boxH).lineWidth(0.6).stroke(C.lineStrong).restore();
      try {
        doc.save(); doc.rect(M, doc.y, boxW, boxH).clip();
        doc.image(buf, M, doc.y, { fit: [boxW, boxH], align: 'center', valign: 'center' });
        doc.restore();
      } catch { drawNoPhotoText(doc, M, doc.y, boxW, boxH); }
      doc.y += boxH + 8;
    } else if (isPdfForm && h.form_url) {
      doc.fill(C.navy).fontSize(7.5).font('Helvetica-Bold');
      t(doc, 'Handover form (PDF) — tap to open', M, doc.y, { width: CW, link: h.form_url, underline: true });
      doc.y += 16;
    } else {
      doc.fill(C.inkFaint).fontSize(7).font('Helvetica');
      t(doc, 'Form unavailable', M, doc.y, { width: CW });
      doc.y += 16;
    }
    doc.y += 10;
  });
}

// ── Chain of Custody & Certification section ────────────────────────────────

function certificationSection(ctx, received, required, mismatchCount, cfos, report, convoy, assessment) {
  ensureSpace(ctx, 120);
  sectionHead(ctx, nextLetter(ctx), 'Chain of Custody & Certification');
  const doc = ctx.doc;

  // Certification block (styled like HTML .cert-block)
  const certY = doc.y;
  doc.save().rect(M, certY, CW, 18).fill(C.navy).restore();
  doc.fill(C.white).fontSize(9).font('Helvetica-Bold');
  t(doc, 'CHAIN OF CUSTODY CERTIFICATION', M + 12, certY + 5, { width: CW - 24 });
  doc.y = certY + 24;

  // Statement
  const stmt = `This report certifies that the photo, seal, and telemetry evidence was captured in the field via the Sonalit Convoy System and is bound to the fingerprint below. Any post-generation alteration invalidates this certification.`;
  doc.fill(C.inkSoft).fontSize(7.5).font('Helvetica');
  doc.text(stmt, M + 12, doc.y, { width: CW - 24, lineBreak: true });
  doc.y += 34;

  // Custody chain strip
  const reportId = report.id ? `RPT-${String(report.id).slice(0, 8).toUpperCase()}` : '--';
  const generatedAt = report.generated_at ? new Date(report.generated_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
  const chain = [
    { who: cfos[0]?.cfo_name || 'CFO', what: 'Captured', when: report.generated_at ? new Date(report.generated_at).toISOString().slice(11, 16) : '--' },
    { who: 'Sonalit Platform', what: 'Hashed & Sealed', when: generatedAt.slice(11, 16) || '--' },
    { who: 'Sonalit Platform', what: 'Report Issued', when: generatedAt.slice(11, 16) || '--' },
    { who: 'Dispatcher', what: 'Review Pending', when: '—', pending: true },
  ];
  doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'CUSTODY CHAIN', M + 12, doc.y, { width: CW - 24 });
  doc.y += 10;
  const chainY = doc.y, stepW = 105;
  chain.forEach((step, i) => {
    const sx = M + 12 + i * (stepW + 16);
    if (sx + stepW > PW - M) return;
    const bg = step.pending ? C.goldBg : C.paper2;
    const border = step.pending ? C.gold : C.lineStrong;
    doc.save().rect(sx, chainY, stepW, 36).lineWidth(0.6).fillAndStroke(bg, border).restore();
    doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
    t(doc, step.who, sx + 8, chainY + 5, { width: stepW - 16 });
    doc.fill(C.inkSoft).fontSize(6.5).font('Helvetica');
    t(doc, step.what, sx + 8, chainY + 16, { width: stepW - 16 });
    doc.fill(C.inkFaint).fontSize(6.5).font('Courier');
    t(doc, step.when, sx + 8, chainY + 26, { width: stepW - 16 });
    if (i < chain.length - 1 && sx + stepW + 16 < PW - M) {
      doc.fill(C.inkFaint).fontSize(10).font('Helvetica');
      t(doc, '→', sx + stepW + 3, chainY + 12, { width: 14 });
    }
  });
  doc.y = chainY + 46;

  // Glyph + hash
  if (assessment?.evidenceDigest) {
    ensureSpace(ctx, 80);
    const glyphSize = 56;
    const glyphY = doc.y;
    renderGlyph(doc, M + 14, glyphY, assessment.evidenceDigest, glyphSize);
    doc.fill(C.ink).fontSize(7.5).font('Helvetica-Bold');
    t(doc, 'Verification Glyph', M + 14 + glyphSize + 14, glyphY + 2, { width: CW - glyphSize - 40 });
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    doc.text(
      'A visual pattern deterministically derived from the SHA-256 fingerprint, for quick cross-check against the platform record. Not a scannable barcode.',
      M + 14 + glyphSize + 14, glyphY + 13, { width: CW - glyphSize - 60, lineBreak: true }
    );
    doc.y = glyphY + glyphSize + 8;

    // Hash row
    const hashY = doc.y;
    doc.save().rect(M + 12, hashY, CW - 24, 28).lineWidth(0.6).fillAndStroke(C.paper2, C.line).restore();
    doc.fill(C.inkFaint).fontSize(5.5).font('Helvetica-Bold');
    t(doc, 'SHA-256 DIGITAL FINGERPRINT — VERIFY AGAINST PLATFORM RECORD', M + 20, hashY + 4, { width: CW - 40 });
    doc.fill(C.inkSoft).fontSize(7).font('Courier');
    t(doc, assessment.evidenceDigest, M + 20, hashY + 14, { width: CW - 40 });
    doc.y = hashY + 36;
  }

  // Signature grid
  ensureSpace(ctx, 50);
  const sigY = doc.y;
  const sigLabels = cfos.length
    ? [cfos[0]?.cfo_name || 'Field Compliance Officer', 'Dispatcher Review — Sign & Date']
    : ['Field Compliance Officer', 'Dispatcher Review — Sign & Date'];
  const sigW = CW / 2 - 20;
  sigLabels.forEach((label, i) => {
    const sx = M + 12 + i * (sigW + 30);
    doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
    t(doc, label, sx, sigY, { width: sigW });
    doc.save().moveTo(sx, sigY + 22).lineTo(sx + sigW, sigY + 22).lineWidth(0.5).strokeColor(C.ink).stroke().restore();
    if (i === 0 && cfos.length) {
      doc.fill(C.ink).fontSize(7.5).font('Helvetica');
      t(doc, cfos[0]?.cfo_name || '', sx, sigY + 26, { width: sigW });
      doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
      t(doc, cfos[0]?.cfo_email || '', sx, sigY + 36, { width: sigW });
    }
  });
  doc.y = sigY + 46;

  // Scope & limitations
  ensureSpace(ctx, 40);
  doc.save().moveTo(M + 12, doc.y).lineTo(M + CW - 12, doc.y).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  doc.y += 6;
  doc.fill(C.inkSoft).fontSize(6).font('Helvetica-Bold');
  t(doc, 'Scope & Limitations.', M + 12, doc.y, { width: CW - 24 });
  doc.y += 8;
  doc.fill(C.inkFaint).fontSize(6).font('Helvetica');
  doc.text(
    'This report certifies the completeness, integrity, and custody of digitally captured evidence (photo, seal, and GPS telemetry) for the referenced convoy. It does not constitute a physical cargo condition survey, weight verification, customs declaration, or insurance assessment.',
    M + 12, doc.y, { width: CW - 24, lineBreak: true }
  );
  doc.y += 30;

  // Completeness metrics (compact cards replacing old summarySection cards)
  ensureSpace(ctx, 60);
  const pct = required > 0 ? Math.round((received / required) * 100) : 0;
  const metricY = doc.y;
  const metricW = CW / 3 - 6;
  const metrics = [
    { title: 'COMPLETENESS', rows: [['Photos', `${received}/${required}`], ['Location Anomalies', String(mismatchCount)], ['Report Status', (report.status || '').toUpperCase() || '--']] },
    { title: 'CONVOY SUMMARY', rows: [['Vehicles', String(convoy.truckCount ?? '--')], ['Seals / Truck', String(convoy.seal_count_per_truck ?? '--')], ['Region', convoy.region || '--']] },
    { title: 'REPORT METADATA', rows: [['Report ID', reportId], ['Generated', generatedAt], ['System', 'Sonalit Convoy']] },
  ];
  metrics.forEach((card, i) => {
    const cx = M + i * (metricW + 9);
    doc.save().rect(cx, metricY, metricW, 54).lineWidth(0.6).fillAndStroke(C.paper2, C.line).restore();
    doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
    t(doc, card.title, cx + 8, metricY + 6, { width: metricW - 16 });
    card.rows.forEach((r, ri) => {
      const ry = metricY + 18 + ri * 11;
      doc.fill(C.inkFaint).fontSize(6.5).font('Helvetica');
      t(doc, r[0], cx + 8, ry, { width: metricW / 2 });
      doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
      t(doc, r[1], cx + metricW / 2, ry, { width: metricW / 2 - 8, align: 'right' });
    });
  });
  doc.y = metricY + 62;
  progressBar(doc, received, required);

  // Legal footer
  doc.y += 6;
  doc.save().moveTo(M, doc.y).lineTo(PW - M, doc.y).lineWidth(0.5).strokeColor(C.line).stroke().restore();
  doc.y += 6;
  doc.fill(C.inkFaint).fontSize(5.5).font('Helvetica');
  doc.text(
    'This document is issued by the Sonalit Convoy System based on field-captured telemetry, photographic, and seal-verification evidence at the time of transmission. It is confidential and intended solely for the named client’s use in verifying chain-of-custody for the referenced convoy. Sonalit’s liability in connection with this report is limited to the terms of the governing service agreement.',
    M, doc.y, { width: CW, lineBreak: true }
  );
}

// ── Main generators ─────────────────────────────────────────────────────────

async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate, cfoPhotos = [], waypoints = [], namedWaypoints = [], handovers = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const pct = report.required_photo_count > 0
    ? Math.round((report.received_photo_count / report.required_photo_count) * 100) : 0;
  const mismatchCount = photos.filter(p => p.location_mismatch).length;
  const sealCountPerTruckTop = convoy.seal_count_per_truck ?? 3;
  const assessment = assessConvoy({ convoy, trucks, photos, seals: [], waypoints, namedWaypoints, report, reportDate, sealCountPerTruck: sealCountPerTruckTop });
  const verdictLabelMap = { cleared: 'Cleared', review: 'Under Review', exceptions: 'Exceptions' };

  const [photoBuffers, routeMapImage, handoverBuffers] = await Promise.all([
    prefetchPhotoBuffers(photos),
    prefetchRouteMap(convoy, waypoints, namedWaypoints),
    prefetchHandoverBuffers(handovers),
  ]);

  const reportRef = report.id ? `RPT-${String(report.id).slice(0, 8).toUpperCase()}` : `RPT-${reportDate}`;
  const sealCountPerTruck = convoy.seal_count_per_truck ?? 3;

  // Seal codes for cover page vehicle table
  const truckSealSummary = (truck) => {
    const tp = photos.filter(p => p.convoy_truck_id === truck.id);
    const sodCodes = Array.from(new Set(tp.filter(p => p.session === 'sod' && p.photo_type === 'seal').map(p => String(p.seal_position)))).sort().slice(0, 2);
    const eodCodes = Array.from(new Set(tp.filter(p => p.session === 'eod' && p.photo_type === 'seal').map(p => String(p.seal_position)))).sort().slice(0, 2);
    return `${sodCodes.join(', ') || '--'} → ${eodCodes.join(', ') || '--'}`;
  };

  const sections = [];
  let secIdx = 0;
  const addSec = (label) => { sections.push({ letter: String.fromCharCode(65 + secIdx++), label }); };
  addSec('Integrity Assessment');
  addSec('Convoy Details');
  addSec('Route Analytics');
  if (cfos.length) addSec('Field Officers');
  addSec('Photo Status Matrix');
  addSec('Photo & Seal Evidence');
  if (cfoPhotos.length) addSec('CFO App Photos');
  if (handovers.length) addSec('Handover');
  addSec('Chain of Custody');

  const ctx = { doc: null, pageNum: 0, generatedAt, letterIdx: 0, reportRef, classification: 'Confidential — Client Use Only',
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · ${reportDate}` };

  return makePdf(doc => {
    ctx.doc = doc;

    // ── Cover page ──
    drawCoverPage(doc, {
      classification: 'Confidential — Client Use Only',
      convoyId: convoy.name || '--',
      origin: convoy.route_origin || '--',
      destination: convoy.route_destination || '--',
      verdict: verdictLabelMap[assessment.verdict] || 'Under Review',
      score: assessment.score,
      mapImage: routeMapImage,
      distanceKm: waypoints.length > 1 ? (() => {
        let d = 0;
        for (let i = 1; i < waypoints.length; i++) d += haversineKm(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
        return d.toFixed(1);
      })() : '0',
      gpsPoints: waypoints.length,
      cargoBlocks: [
        { label: 'Commodity', value: 'As declared', color: C.inkFaint },
        { label: 'Total Seals Verified', value: `${report.received_photo_count > 0 ? 'SOD → EOD matched' : '--'}`, color: C.green },
        { label: 'Route Distance (Declared)', value: `≈ ${convoy.route_distance_km || '--'} km`, color: C.ink },
      ],
      vehicleRows: trucks.map(tk => [
        `T${tk.position}`, tk.driver_name || '--', tk.plate_number || '--',
        tk.driver_license_no || '--', truckSealSummary(tk),
        `${photos.filter(p => p.convoy_truck_id === tk.id).length}/${(2 + sealCountPerTruck) * 2}`,
      ]),
      facts: [
        { label: 'Report No.', value: reportRef },
        { label: 'Report Date', value: reportDate },
        { label: 'Vehicles', value: `${trucks.length} Trucks` },
        { label: 'Region', value: convoy.region || '--' },
      ],
      contents: sections,
      clientName: convoy.client_name || 'Unassigned',
      leadOfficer: cfos[0]?.cfo_name || '--',
      generatedAt,
    });
    ctx.pageNum = 1;

    // ── Inner pages ──
    newPage(ctx);

    integritySection(ctx, assessment);

    sectionHead(ctx, nextLetter(ctx), 'Convoy Details', `${pct}% Complete`);
    detailGrid(doc, [
      { label: 'Convoy ID', value: convoy.name || '--' },
      { label: 'Client', value: convoy.client_name || '--' },
      { label: 'Report Date', value: reportDate },
      { label: 'Origin', value: convoy.route_origin || '--' },
      { label: 'Destination', value: convoy.route_destination || '--' },
      { label: 'Convoy Status', value: (convoy.status || '').toUpperCase() || '--', color: convoy.status === 'completed' ? C.green : C.ink },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Start / End Date', value: `${convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--'} – ${convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--'}` },
      { label: 'Seals / Truck', value: String(convoy.seal_count_per_truck ?? '--') },
    ]);

    routeSection(ctx, waypoints, convoy, namedWaypoints, routeMapImage);

    if (cfos.length) {
      sectionHead(ctx, nextLetter(ctx), 'Field Officers');
      let y = doc.y;
      cfos.forEach((c, i) => {
        if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.paper2);
        doc.save().rect(M, y, CW, 16).lineWidth(0.3).stroke(C.line).restore();
        doc.fill(C.ink).fontSize(8).font('Helvetica-Bold');
        t(doc, c.cfo_name || c.cfo_user_id?.slice(-8) || '--', M + 4, y + 4, { width: CW / 2 - 8 });
        doc.fill(C.inkFaint).fontSize(7.5).font('Helvetica');
        t(doc, c.cfo_email || '', M + CW / 2, y + 4, { width: CW / 2 - 4 });
        y += 16;
      });
      doc.y = y + 6;
    }

    ensureSpace(ctx, 70 + trucks.length * 23);
    sectionHead(ctx, nextLetter(ctx), 'Photo Status Matrix');
    const truckMatrix = trucks.map(truck => {
      const tp = photos.filter(p => p.convoy_truck_id === truck.id);
      const buildSession = (session) => {
        const sp = tp.filter(p => p.session === session);
        const sealHave = Math.min(new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size, sealCountPerTruck);
        return { front: sp.some(p => p.photo_type === 'front'), rear: sp.some(p => p.photo_type === 'rear'), sealHave, sealTotal: sealCountPerTruck };
      };
      return { ...truck, sod: buildSession('sod'), eod: buildSession('eod') };
    });
    photoMatrix(ctx, truckMatrix);
    mismatchTable(ctx, photos);

    trucks.forEach(truck => {
      truckDetail(ctx, truck, photos.filter(p => p.convoy_truck_id === truck.id), sealCountPerTruck, photoBuffers);
    });

    cfoPhotosTable(ctx, cfoPhotos);
    if (handovers.length) handoverSection(ctx, handovers, trucks, handoverBuffers);

    certificationSection(ctx, report.received_photo_count, report.required_photo_count, mismatchCount,
      cfos, report, { ...convoy, truckCount: trucks.length }, assessment);
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

  const reportRef = `ARCHIVE-${(convoy.name || 'RPT').toUpperCase()}`;
  const ctx = { doc: null, pageNum: 0, generatedAt, letterIdx: 0, reportRef, classification: 'Confidential',
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · Archive Report` };

  return makePdf(doc => {
    ctx.doc = doc;

    // Cover page for archive
    drawCoverPage(doc, {
      classification: 'Confidential — Client Use Only',
      convoyId: convoy.name || '--',
      origin: convoy.route_origin || '--',
      destination: convoy.route_destination || '--',
      verdict: overallPct >= 100 ? 'Complete' : 'Partial',
      score: overallPct,
      mapImage: null,
      distanceKm: '0', gpsPoints: 0,
      cargoBlocks: [
        { label: 'Report Days', value: `${reports.length} day${reports.length === 1 ? '' : 's'}`, color: C.ink },
        { label: 'Total Photos', value: `${totalRecv}/${totalReq}`, color: overallPct >= 100 ? C.green : C.gold },
        { label: 'Convoy Status', value: (convoy.status || '--').toUpperCase(), color: C.ink },
      ],
      vehicleRows: trucks.map(tk => [
        `T${tk.position}`, tk.driver_name || '--', tk.plate_number || '--', tk.driver_license_no || '--', '--',
        `${allPhotos.filter(p => p.convoy_truck_id === tk.id).length}`,
      ]),
      facts: [
        { label: 'Archive', value: reportRef },
        { label: 'Vehicles', value: `${trucks.length} Trucks` },
        { label: 'CFOs', value: String(cfos.length) },
        { label: 'Region', value: convoy.region || '--' },
      ],
      contents: [
        { letter: 'A', label: 'Archive Summary' },
        { letter: 'B', label: 'Handover' },
        { letter: 'C', label: 'Overall Completion' },
        { letter: 'D', label: 'Daily Summary' },
        { letter: 'E', label: 'Per-Day Truck Photos' },
      ],
      clientName: convoy.client_name || 'Unassigned',
      leadOfficer: cfos[0]?.cfo_name || '--',
      generatedAt,
    });
    ctx.pageNum = 1;

    newPage(ctx);

    sectionHead(ctx, nextLetter(ctx), 'Archive Summary');
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

    handoverSection(ctx, handovers, trucks, handoverBuffers);

    sectionHead(ctx, nextLetter(ctx), `Overall Completion (${overallPct}%)`);
    progressBar(doc, totalRecv, totalReq);

    sectionHead(ctx, nextLetter(ctx), 'Daily Summary');
    const hCols = [M, M + 80, M + 160, M + 260, M + 335, M + 420];
    const hW = [76, 76, 96, 71, 81, 76];
    tableHeader(doc, hCols, hW, ['Date', 'Status', 'Photos', 'Mismatch', 'PDF', 'Generated']);
    let y = doc.y;
    reports.forEach((r, i) => {
      if (y + 16 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
      if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.paper2);
      doc.save().rect(M, y, CW, 16).lineWidth(0.3).stroke(C.line).restore();
      const dateStr = String(r.report_date).slice(0, 10);
      const photoPct = r.required_photo_count > 0
        ? `${r.received_photo_count}/${r.required_photo_count} (${Math.round(r.received_photo_count / r.required_photo_count * 100)}%)` : '--';
      const dm = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr && p.location_mismatch).length;
      const genAt = r.generated_at ? new Date(r.generated_at).toISOString().slice(0, 10) : '--';
      [dateStr, (r.status || '').toUpperCase(), photoPct, dm > 0 ? `!! ${dm}` : '0', r.pdf_url ? 'Yes' : 'No', genAt].forEach((v, j) => {
        const color = j === 1 ? (r.status === 'generated' ? C.green : C.amber) : j === 3 && dm > 0 ? C.amber : C.inkSoft;
        doc.fill(color).fontSize(7.5).font(j === 1 ? 'Helvetica-Bold' : 'Helvetica');
        t(doc, v, hCols[j] + 3, y + 4, { width: hW[j] });
      });
      y += 16;
    });
    doc.y = y + 4;

    if (reports.length > 0) {
      newPage(ctx);
      sectionHead(ctx, nextLetter(ctx), 'Per-Day Truck Photo Counts');
      const barMaxW = CW * 0.35;
      reports.slice(0, 15).forEach(rpt => {
        ensureSpace(ctx, 18 + trucks.length * 12);
        const dateStr = String(rpt.report_date).slice(0, 10);
        const dayPhotos = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr);
        let dy = doc.y + 1;
        doc.rect(M, dy, CW, 14).fill(C.navy);
        doc.fill(C.white).fontSize(7).font('Helvetica-Bold');
        t(doc, `${dateStr}  ${(rpt.status || '').toUpperCase()} -- ${rpt.received_photo_count}/${rpt.required_photo_count}`,
          M + 4, dy + 3, { width: CW - 8 });
        dy += 15;
        trucks.forEach((tk, ti) => {
          const cnt = dayPhotos.filter(p => p.convoy_truck_id === tk.id).length;
          if (ti % 2 === 0) doc.rect(M, dy, CW, 11).fill(C.paper2);
          const bW = perTruckRequired > 0 ? Math.min(barMaxW, barMaxW * cnt / perTruckRequired) : 0;
          doc.fill(C.ink).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `T${tk.position}`, M + 2, dy + 2, { width: 16 });
          doc.fill(C.inkFaint).font('Helvetica');
          t(doc, tk.driver_name, M + 20, dy + 2, { width: 128 });
          doc.save().rect(M + 152, dy + 1, barMaxW, 8).lineWidth(0.4).fillAndStroke('#e5e7eb', C.line).restore();
          if (bW > 0) doc.rect(M + 152, dy + 1, bW, 8).fill(cnt >= perTruckRequired ? C.green : C.amber);
          doc.fill(C.inkSoft).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `${cnt}/${perTruckRequired}`, M + 152 + barMaxW + 3, dy + 2, { width: 40 });
          dy += 11;
        });
        doc.y = dy + 3;
      });
    }
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
