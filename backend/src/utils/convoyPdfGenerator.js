const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const logger = require('./logger');
const { geocode, renderRouteMapImage } = require('./routeMapRenderer');
const C = {
  dark: '#0b1220', dark2: '#152238', navy: '#1a2a4a', accent: '#d97706', gold: '#f5a623',
  green: '#16a34a', greenBg: '#dcfce7', greenBorder: '#86efac',
  red: '#dc2626', redBg: '#fee2e2', redBorder: '#fca5a5',
  amber: '#d97706', amberBg: '#fef3c7', muted: '#6b7280', light: '#9ca3af',
  stripe: '#f8fafc', border: '#e5e7eb', text: '#111827', sub: '#374151', white: '#ffffff',
};

const PW = 595.28, PH = 841.89, M = 40, CW = PW - M * 2;
const BODY_TOP = 68, BODY_BOTTOM = PH - 50;
const COVER_H = 118, STAT_H = 46, CHECK_H = 46;
const COVER_BODY_TOP = COVER_H + STAT_H + CHECK_H + 22;

function t(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, { ...opts, lineBreak: false });
}

function makePdf(buildFn) {
  return new Promise((resolve, reject) => {
    // bottom: 0 — the footer band is drawn at an absolute y around 816-830,
    // outside a uniform 40pt margin (whose bottom boundary sits at ~802).
    // PDFKit's own auto-pagination treats any text draw past that boundary
    // as overflow and silently inserts an extra blank page to continue it —
    // it has no way to know this was an intentional fixed-position footer.
    // This file already does all its own pagination manually (ensureSpace /
    // newPage / BODY_BOTTOM), so PDFKit's built-in margin-triggered paging
    // is pure interference here; disabling just the bottom margin removes it
    // without affecting the manual layout logic, which never relied on it.
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

function pill(doc, x, y, w, label, fg, bg) {
  doc.save().rect(x, y, w, 14).fill(bg).restore();
  doc.fill(fg).fontSize(6.5).font('Helvetica-Bold');
  t(doc, label, x, y + 4, { width: w, align: 'center' });
}

// Small bullet/status dot drawn as a vector shape rather than a "●"/"✓"
// text glyph — PDFKit's standard 14 fonts only cover WinAnsi (CP1252), which
// has no bullet, check mark, or arrow glyphs, so those render as garbage
// (e.g. "%Ï") instead of the intended symbol.
function dot(doc, x, y, r, color, hollow) {
  doc.save();
  if (hollow) doc.circle(x, y, r).lineWidth(0.8).stroke(color);
  else doc.circle(x, y, r).fill(color);
  doc.restore();
}

// Tall branded banner + quick-stat strip + completion checklist — replaces
// the plain slim header on the report's first page only. Every field here
// comes from data the pipeline already fetches (convoy/report/cfos/photos);
// nothing here depends on integrations we don't have (weather, elevation,
// fuel logs) so this can ship without any backend changes.
function drawCoverHeader(ctx, meta) {
  const doc = ctx.doc;
  doc.rect(0, 0, PW, COVER_H).fill(C.dark);
  doc.rect(0, COVER_H, PW, 3).fill(C.gold);

  const badgeW = 230;
  doc.save().rect(M, 14, badgeW, 14).lineWidth(0.6).strokeColor(C.gold).stroke().restore();
  dot(doc, M + 10, 21, 2, C.gold);
  doc.fill(C.gold).fontSize(6.5).font('Helvetica-Bold');
  t(doc, meta.eyebrow, M + 16, 18, { width: badgeW - 22 });

  doc.fill(C.white).fontSize(19).font('Helvetica-Bold');
  t(doc, meta.title, M, 33, { width: CW - 170 });
  doc.fill(C.gold).fontSize(10).font('Helvetica-Bold');
  t(doc, meta.subtitle, M, 56, { width: CW - 170 });
  doc.fill('#c7ced9').fontSize(8).font('Helvetica');
  t(doc, meta.routeLine, M, 70, { width: CW - 170 });

  // brand mark, top right
  const rx = PW - M - 110;
  doc.save().rect(rx, 14, 24, 24).fill(C.gold).restore();
  doc.fill(C.dark).fontSize(9).font('Helvetica-Bold');
  t(doc, 'SL', rx, 21, { width: 24, align: 'center' });
  doc.fill(C.white).fontSize(11).font('Helvetica-Bold');
  t(doc, 'SONALIT', rx + 30, 19, { width: 80 });
  doc.fill('#9ca3af').fontSize(6).font('Helvetica');
  t(doc, 'GUARDIAN CFO SYSTEM', rx - 6, 33, { width: 116, align: 'right' });

  t(doc, meta.reportRef, rx - 90, 50, { width: 200, align: 'right' });
  pill(doc, rx - 30, 60, 116, meta.statusLabel, meta.statusFg, meta.statusBg);
  doc.fill('#9ca3af').fontSize(6).font('Helvetica');
  t(doc, `Generated ${meta.generatedAt}`, rx - 90, 78, { width: 200, align: 'right' });

  // Quick-stat strip
  const sy = COVER_H + 3, cols = meta.stats.length, colW = CW / cols;
  doc.rect(0, sy, PW, STAT_H).fill(C.dark2);
  meta.stats.forEach((s, i) => {
    const x = M + i * colW;
    doc.fill(C.light).fontSize(6).font('Helvetica');
    t(doc, s.label.toUpperCase(), x, sy + 8, { width: colW - 10 });
    doc.fill(s.color || C.white).fontSize(11).font('Helvetica-Bold');
    t(doc, s.value, x, sy + 20, { width: colW - 10 });
  });

  // Completion bar (row 1) + checklist chips (row 2) — kept on separate rows
  // since the bar + all five chips don't fit on one line within page width.
  const cy = sy + STAT_H + 8;
  const barW = 220;
  doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'REPORT COMPLETENESS', M, cy + 3, { width: 110 });
  doc.save().rect(M + 122, cy, barW, 8).lineWidth(0.5).fillAndStroke('#e5e7eb', C.border).restore();
  const bw = Math.max(0, Math.min(1, meta.pct / 100)) * barW;
  if (bw > 0) doc.rect(M + 122, cy, bw, 8).fill(meta.pct >= 100 ? C.green : meta.pct >= 50 ? C.amber : C.red);
  doc.fill(C.text).fontSize(7.5).font('Helvetica-Bold');
  t(doc, `${meta.pct}%`, M + 122 + barW + 6, cy + 1, { width: 34 });

  const cy2 = cy + 18, chipW = CW / meta.checklist.length;
  meta.checklist.forEach((item, i) => {
    const cx = M + i * chipW;
    dot(doc, cx + 3, cy2 + 4.5, 3, item.ok ? C.green : C.light, !item.ok);
    doc.fill(item.ok ? C.green : C.light).fontSize(7).font('Helvetica-Bold');
    t(doc, item.label, cx + 10, cy2 + 1, { width: chipW - 12 });
  });

  ctx.doc.y = COVER_BODY_TOP;
}

function drawHeader(ctx) {
  const doc = ctx.doc, rx = PW - M - 80;
  doc.rect(0, 0, PW, 55).fill(C.dark);
  doc.rect(0, 55, PW, 2).fill(C.accent);
  doc.fill(C.white).fontSize(13).font('Helvetica-Bold');
  t(doc, 'CONVOY INTELLIGENCE REPORT', M, 12, { width: CW - 100 });
  doc.fill('#9ca3af').fontSize(8).font('Helvetica');
  t(doc, ctx.subtitle || '', M, 30, { width: CW - 100 });
  doc.fill(C.accent).fontSize(16).font('Helvetica-Bold');
  t(doc, 'SONALIT', rx, 12, { width: 80, align: 'right' });
  doc.fill('#9ca3af').fontSize(6).font('Helvetica');
  t(doc, 'GUARDIAN CFO SYSTEM', rx, 30, { width: 80, align: 'right' });
}

function drawFooter(ctx) {
  const doc = ctx.doc;
  const fy = PH - 26;
  doc.rect(0, fy, PW, 26).fill(C.dark);
  doc.fill(C.muted).fontSize(6.5).font('Helvetica');
  t(doc, `Generated ${ctx.generatedAt}`, M, fy + 9, { width: 250 });
  t(doc, `Page ${ctx.pageNum}`, PW - M - 60, fy + 9, { width: 60, align: 'right' });
}

function newPage(ctx) {
  ctx.doc.addPage();
  ctx.pageNum++;
  drawHeader(ctx);
  drawFooter(ctx);
  ctx.doc.y = BODY_TOP;
}

function ensureSpace(ctx, needed) {
  if (ctx.doc.y + needed > BODY_BOTTOM) newPage(ctx);
}

function nextLetter(ctx) {
  const idx = ctx.letterIdx || 0;
  ctx.letterIdx = idx + 1;
  return String.fromCharCode(65 + idx);
}

// Fetches a photo's bytes for embedding in the PDF — the report previously
// only showed a text "Present/MISSING" indicator per photo, never the actual
// image, which defeats the point of a report meant to be visual proof of
// vehicle/seal condition. Failures return null so one bad/slow URL degrades
// to a placeholder box instead of failing the whole report.
//
// Downscaled + recompressed via sharp before returning: raw camera photos
// (several MB each, full resolution) were being embedded as-is even though
// they only ever render as a small thumbnail — a 5-page report with ~20
// photos came out to 23.7MB. 640px wide at JPEG q70 is plenty for a printed
// thumbnail and is typically tens of KB instead of multiple MB.
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
    // failOn: 'none' — some Guardian devices produce JPEGs with malformed
    // SOS markers ("Invalid SOS parameters for sequential JPEG") that
    // libvips' default strict mode rejects outright even though the image
    // is perfectly viewable in a browser. Confirmed from production logs:
    // every photo on a report was failing this exact way, falling back to
    // raw un-recompressed bytes that PDFKit's own (stricter) JPEG parser
    // then also rejected, ending up as "NO PHOTO" despite the photo being
    // genuinely present. Telling sharp to attempt a best-effort decode
    // instead of erroring fixes it at the source.
    return await sharp(raw, { failOn: 'none' })
      .rotate() // apply EXIF orientation before stripping metadata
      .resize({ width: 640, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    // Still failed even with lenient parsing (e.g. truly corrupt/truncated
    // data) — fall back to the original fetched bytes rather than dropping
    // a real, present photo down to a "NO PHOTO" placeholder. PDFKit can
    // only embed JPEG/PNG directly; if the raw bytes aren't one of those,
    // it still fails when drawPhotoCard tries doc.image(), but that's
    // caught there.
    logger.warn(`[convoyPdf] sharp processing failed, using raw bytes: ${url} -- ${err.message}`);
    return raw;
  }
}

// Prefetches every present photo's bytes in parallel, keyed by photo id, so
// truckDetail() can synchronously embed images while laying out the PDF.
async function prefetchPhotoBuffers(photos) {
  const map = new Map();
  await Promise.all(photos.map(async (p) => {
    const buf = await fetchImageBuffer(p.photo_url);
    if (buf) map.set(p.id, buf);
  }));
  return map;
}

// Renders a real map image (OSM tiles + route overlay) for the day's
// movement section, preferring live GPS pings when there are any and
// falling back to the dispatcher-entered known-town route otherwise. Never
// throws — any failure (geocoding miss, tile fetch down, etc.) returns null
// so routeSection falls back to its vector schematic instead of losing the
// section entirely.
async function prefetchRouteMap(convoy, waypoints, namedWaypoints) {
  try {
    let points;
    if (waypoints.length > 0) {
      // Subsample so the overlay SVG stays a reasonable size — a full day
      // of GPS pings (up to 500, per the query limit) is far more detail
      // than a page-width map can usefully show.
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
      points = stops
        .map((s) => {
          const g = geocode(s.name);
          return g ? { lat: g[0], lng: g[1], label: s.name } : null;
        })
        .filter(Boolean);
    } else {
      return null;
    }
    if (points.length < 2) return null;
    return await renderRouteMapImage(points);
  } catch (err) {
    logger.warn(`[convoyPdf] route map prefetch failed: ${err.message}`);
    return null;
  }
}

function sectionHead(ctx, letter, label, status) {
  ensureSpace(ctx, 30);
  const doc = ctx.doc;
  const y = doc.y + 6;
  if (letter) {
    doc.save().rect(M, y, 16, 16).fill(C.gold).restore();
    doc.fill(C.dark).fontSize(9).font('Helvetica-Bold');
    t(doc, letter, M, y + 4, { width: 16, align: 'center' });
  }
  const textX = letter ? M + 22 : M;
  doc.fill(C.text).fontSize(9).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), textX, y + 4, { width: CW - (letter ? 200 : 178) });
  if (status) {
    doc.fill(C.muted).fontSize(7).font('Helvetica');
    t(doc, status, M + CW - 160, y + 4, { width: 160, align: 'right' });
  }
  doc.save().moveTo(M, y + 20).lineTo(M + CW, y + 20).lineWidth(1.5).strokeColor(C.text).stroke().restore();
  doc.y = y + 26;
}

// Slim navy banner used for sub-groupings nested inside a lettered section
// (e.g. per-truck SOD/EOD photo evidence) — mirrors the sectionHead style at
// a smaller scale so nested groups still read as structured, not bolted-on.
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
  doc.save().rect(M, top, CW, rows * rowH).lineWidth(0.6).strokeColor(C.border).stroke().restore();
  items.forEach((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * cellW, y = top + row * rowH;
    if (col > 0) doc.save().moveTo(x, y).lineTo(x, y + rowH).lineWidth(0.6).strokeColor(C.border).stroke().restore();
    if (row > 0) doc.save().moveTo(x, y).lineTo(x + cellW, y).lineWidth(0.6).strokeColor(C.border).stroke().restore();
    doc.fill(C.light).fontSize(6).font('Helvetica');
    t(doc, (item.label || '').toUpperCase(), x + 10, y + 5, { width: cellW - 20 });
    doc.fill(item.color || C.text).fontSize(9.5).font('Helvetica-Bold');
    t(doc, item.value ?? '--', x + 10, y + 15, { width: cellW - 20 });
  });
  doc.y = top + rows * rowH + 8;
}

function progressBar(doc, received, required) {
  const pct = required > 0 ? Math.min(1, received / required) : 0, y = doc.y;
  doc.save().rect(M, y, CW, 10).lineWidth(0.5).fillAndStroke('#e5e7eb', C.border).restore();
  if (pct > 0) doc.rect(M, y, CW * pct, 10).fill(pct >= 1 ? C.green : pct >= 0.5 ? C.amber : C.red);
  doc.fill(C.text).fontSize(7).font('Helvetica-Bold');
  t(doc, `${received} / ${required}  (${Math.round(pct * 100)}%)`, M + 4, y + 2, { width: CW - 8 });
  doc.y = y + 18;
}

function tableHeader(doc, cols, widths, headers) {
  const y = doc.y;
  doc.rect(M, y, CW, 15).fill(C.stripe);
  doc.save().moveTo(M, y + 15).lineTo(M + CW, y + 15).lineWidth(0.5).strokeColor(C.border).stroke().restore();
  headers.forEach((h, i) => { doc.fill(C.muted).fontSize(6.5).font('Helvetica-Bold'); t(doc, h.toUpperCase(), cols[i] + 3, y + 4, { width: widths[i] }); });
  doc.y = y + 17;
}

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
    doc.fill(C.white).fontSize(6.5).font('Helvetica-Bold');
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
    if (ti % 2 === 0) doc.rect(M, y, CW, rowH).fill(C.stripe);

    doc.fill(C.text).fontSize(8).font('Helvetica-Bold');
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
  sectionHead(ctx, nextLetter(ctx), `Location Mismatches (${mm.length})`);
  const doc = ctx.doc, cols = [M,M+100,M+200,M+290,M+390], colW = [96,96,86,96,80];
  tableHeader(doc, cols, colW, ['Truck','Photo Type','Session','Uploaded','Flag']);
  let y = doc.y;
  mm.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.amberBg);
    [String(p.convoy_truck_id).slice(-8), `${p.photo_type}${p.seal_position?' #'+p.seal_position:''}`,
     (p.session||'').toUpperCase(), p.uploaded_at?new Date(p.uploaded_at).toISOString().slice(0,16).replace('T',' '):'--', 'GPS >2km',
    ].forEach((v,j) => { doc.fill(C.sub).fontSize(7).font('Helvetica'); t(doc,v,cols[j]+3,y+3,{width:colW[j]}); });
    y += 14;
  });
  doc.y = y + 4;
}

function truckDetail(ctx, truck, truckPhotos, sealCountPerTruck, photoBuffers) {
  // Deliberate: every truck always starts on its own fresh page, even if
  // that leaves the previous page partly blank. Each truck's photo
  // evidence is meant to be reviewed as a self-contained block, and mixing
  // the tail end of one truck's grid with the start of another's on the
  // same page is worse than an underused page.
  newPage(ctx);
  const doc = ctx.doc;

  // A truck has exactly sealCountPerTruck physical seal slots — never more.
  // seal_position is CFO-entered free text though, not a fixed slot index,
  // so a reseal between SOD and EOD (a normal, expected occurrence, not a
  // data error) legitimately uses different codes for the same slots. That
  // means SOD's and EOD's distinct codes must be capped and displayed
  // *independently* — pooling both sessions into one combined list (the
  // previous approach) could show up to 2x sealCountPerTruck codes/cards,
  // which is exactly the "second truck that only has seals" confusion this
  // was built to avoid, and directly contradicts the hard 3-seal cap.
  const sealCodesFor = (session) => Array.from(new Set(
    truckPhotos.filter(p => p.session === session && p.photo_type === 'seal').map(p => String(p.seal_position))
  )).sort().slice(0, sealCountPerTruck);
  const sodSealCodes = sealCodesFor('sod');
  const eodSealCodes = sealCodesFor('eod');
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

  subBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'}`, `${receivedTotal}/${expectedTotal} Photos`);

  detailGrid(doc, [
    { label: 'Plate / Reg', value: truck.plate_number || '--' },
    { label: 'Driver Phone', value: truck.driver_phone || '--' },
    { label: 'License No', value: truck.driver_license_no || '--' },
    {
      label: `Seal Codes (${sealCountPerTruck}/truck)`,
      value: (sodSealCodes.length || eodSealCodes.length)
        ? `SOD: ${sodSealCodes.join(', ') || '--'}  ·  EOD: ${eodSealCodes.join(', ') || '--'}`
        : '--',
    },
  ]);

  // A truck's whole day reads as one page: SOD on the left half, EOD on the
  // right half, Front stacked over Rear in each half (the primary visual-
  // inspection evidence), with seals — a per-position checklist rather than
  // a single "how does the truck look" shot — as a smaller grid underneath
  // each half.
  const colGap = 16;
  const colW = (CW - colGap) / 2;
  const cols = [
    { x: M, label: 'START OF DAY (SOD)', session: 'sod' },
    { x: M + colW + colGap, label: 'END OF DAY (EOD)', session: 'eod' },
  ];

  const bannerH = 18;
  const photoH = 145, captionH = 28, photoGap = 10;
  const heroPairH = (photoH + 6 + captionH) * 2 + photoGap;

  const sealCols = 2, sealGap = 8;
  const sealCardW = (colW - sealGap * (sealCols - 1)) / sealCols;
  const sealPhotoH = 78, sealCaptionH = 24;
  const sealRowStride = sealPhotoH + 6 + sealCaptionH + 10;
  // Fixed to the convoy's configured slot count, not however many distinct
  // codes the data happens to contain — this is the hard cap that keeps
  // SOD's and EOD's grids the same size even when they used different
  // codes for a reseal, and guarantees this can never render more cards
  // than the truck actually has physical seal slots for.
  const sealRows = Math.ceil(sealCountPerTruck / sealCols);

  // The hero pair (banner + Front + Rear, both columns) always follows
  // straight after the truck's own fresh page, so it's virtually guaranteed
  // to fit — this ensureSpace is a safety net, not the primary pagination.
  ensureSpace(ctx, bannerH + 8 + heroPairH + 20);

  const topY = doc.y;
  cols.forEach(col => {
    doc.rect(col.x, topY, colW, bannerH).fill(C.navy);
    doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
    t(doc, col.label, col.x + 8, topY + 5, { width: colW - 16 });
  });

  const heroY = topY + bannerH + 8;
  cols.forEach(col => {
    const sp = truckPhotos.filter(p => p.session === col.session);
    const frontMatch = sp.find(p => p.photo_type === 'front');
    const rearMatch = sp.find(p => p.photo_type === 'rear');
    drawPhotoCard(doc, col.x, heroY, colW, photoH, captionH,
      { label: 'FRONT', photoType: 'front', sealPos: null }, frontMatch, photoBuffers);
    const rearY = heroY + photoH + 6 + captionH + photoGap;
    drawPhotoCard(doc, col.x, rearY, colW, photoH, captionH,
      { label: 'REAR', photoType: 'rear', sealPos: null }, rearMatch, photoBuffers);
  });
  doc.y = heroY + heroPairH + 12;

  if (sealCountPerTruck <= 0) return;
  const sealCodesByCol = { sod: sodSealCodes, eod: eodSealCodes };
  // Seal rows paginate on their own (unlike the hero pair above) — sealRows
  // is fixed at sealCountPerTruck, so this only ever runs for a genuinely
  // large configured seal count, not because the data happened to contain
  // more distinct codes than expected.
  for (let row = 0; row < sealRows; row++) {
    const pageBefore = ctx.pageNum;
    ensureSpace(ctx, sealRowStride + 10);
    if (ctx.pageNum !== pageBefore) {
      // A bare row of seal cards with no header context, spilled onto a
      // fresh page, reads as an unrelated truck rather than a continuation
      // of this one — confirmed confusing in practice. Re-identify whose
      // seals these are before drawing more.
      subBanner(ctx, `Truck ${truck.position} — ${truck.driver_name || 'Unknown Driver'} (seals, continued)`);
      const contY = doc.y;
      cols.forEach(col => {
        doc.rect(col.x, contY, colW, bannerH).fill(C.navy);
        doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
        t(doc, col.label, col.x + 8, contY + 5, { width: colW - 16 });
      });
      doc.y = contY + bannerH + 8;
    }
    const rowY = doc.y;
    cols.forEach(col => {
      const sp = truckPhotos.filter(p => p.session === col.session);
      const codes = sealCodesByCol[col.session];
      for (let sc = 0; sc < sealCols; sc++) {
        const idx = row * sealCols + sc;
        if (idx >= sealCountPerTruck) break;
        // The slot always exists (up to sealCountPerTruck) even if this
        // session has no code for it yet — draw it as MISSING rather than
        // skipping it, so both columns' grids stay the same shape.
        const pos = codes[idx] || null;
        const slot = { label: pos ? `SEAL ${pos}` : `SEAL ${idx + 1}`, photoType: 'seal', sealPos: pos };
        const match = pos ? sp.find(p => p.photo_type === 'seal' && String(p.seal_position) === pos) : null;
        drawPhotoCard(doc, col.x + sc * (sealCardW + sealGap), rowY, sealCardW, sealPhotoH, sealCaptionH, slot, match, photoBuffers);
      }
    });
    doc.y = rowY + sealRowStride;
  }
}

function drawPhotoCard(doc, x, y, w, photoH, captionH, slot, match, photoBuffers) {
  doc.save().rect(x, y, w, photoH).lineWidth(0.6).fillAndStroke(C.stripe, C.border).restore();

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

  // Status badge, overlaid top-right corner of the photo
  const present = !!match;
  const badgeW = 54, badgeH = 13;
  doc.save().rect(x + w - badgeW - 4, y + 4, badgeW, badgeH)
    .fill(present ? C.greenBg : C.redBg).restore();
  doc.fill(present ? C.green : C.red).fontSize(6).font('Helvetica-Bold');
  t(doc, present ? 'PRESENT' : 'MISSING', x + w - badgeW - 4, y + 7, { width: badgeW, align: 'center' });

  // Caption: label, timestamp, GPS
  let cy = y + photoH + 4;
  doc.fill(C.text).fontSize(7.5).font('Helvetica-Bold');
  t(doc, slot.label, x, cy, { width: w });
  cy += 11;
  doc.fill(C.muted).fontSize(6).font('Helvetica');
  const uploaded = match?.uploaded_at
    ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
  t(doc, uploaded, x, cy, { width: w });
  cy += 9;
  const gps = match?.lat != null && match?.lng != null
    ? `${parseFloat(match.lat).toFixed(4)}, ${parseFloat(match.lng).toFixed(4)}` : 'GPS --';
  doc.fill(match?.location_mismatch ? C.amber : C.light).fontSize(6);
  t(doc, gps, x, cy, { width: w });
}

function drawNoPhotoText(doc, x, y, w, h) {
  doc.fill(C.light).fontSize(7.5).font('Helvetica');
  t(doc, 'NO PHOTO', x, y + h / 2 - 4, { width: w, align: 'center' });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Day's movement section — plots the convoy's actual logged GPS waypoints as
// a schematic path (lat/lng scaled to fit a box; not a to-scale/tiled map,
// which would need a basemap-tile integration we don't have) plus real
// distance/speed/drive-time stats computed from those same points, and a
// sampled route log table. All from convoy_waypoints, already populated by
// the Guardian app's live tracking — no new data source required.
// Most convoys have no continuous device tracking, so live GPS pings
// (convoy_waypoints) are the exception rather than the rule — a plain "No
// GPS waypoints logged" message left the section empty for the common case.
// When there's no live track for the day, fall back to the dispatcher-keyed
// known towns/checkpoints for the route (convoy_route_waypoints) so the
// report still shows the intended path, clearly labeled as planned rather
// than GPS-verified.
// Renders the dispatcher-entered stops as an actual route diagram — a
// connected line of checkpoints wrapping left-to-right / right-to-left in
// successive rows (like a metro map), rather than a plain bulleted list.
// Once Guardian devices are logging live GPS per truck, routeSection's own
// lat/lng-projected track (above this fallback in the call order) takes
// over automatically; this is only ever shown for days with no live ping.
function plannedRouteMap(ctx, convoy, namedWaypoints) {
  const doc = ctx.doc;
  const trim = (s) => (s || '').trim().toLowerCase();
  const stops = [
    { name: convoy.route_origin || 'Origin' },
    ...namedWaypoints,
    { name: convoy.route_destination || 'Destination' },
  // Collapse a duplicate stop where a dispatcher's last keyed-in waypoint is
  // effectively the same place as the origin/destination already shown
  // (e.g. "Dar es salaam" entered as a stop when the destination is already
  // "Dar es Salaam") — same name, different casing, back to back.
  ].filter((s, i, arr) => i === 0 || trim(s.name) !== trim(arr[i - 1].name));

  const perRow = 5;
  const rowH = 62;
  const rows = Math.ceil(stops.length / perRow);
  const mapH = Math.max(120, 34 + rows * rowH);
  ensureSpace(ctx, mapH + 20);
  const mapY = doc.y, padX = 34;
  doc.save().rect(M, mapY, CW, mapH).lineWidth(0.6).fillAndStroke('#f0fdf4', C.border).restore();

  doc.fill(C.sub).fontSize(6.5).font('Helvetica-Bold');
  t(doc, 'PLANNED ROUTE', M + 12, mapY + 9, { width: 200 });
  doc.fill(C.light).fontSize(6).font('Helvetica');
  t(doc, 'Dispatcher-entered, not GPS-verified', M + 12, mapY + 18, { width: 250 });

  const chipW = 90, chipH = 30, chipX = M + CW - chipW - 10, chipY = mapY + 8;
  doc.save().rect(chipX, chipY, chipW, chipH).lineWidth(0.6).fillAndStroke(C.white, C.border).restore();
  doc.fill(C.light).fontSize(6).font('Helvetica');
  t(doc, 'STOPS', chipX + 8, chipY + 5, { width: chipW - 16 });
  doc.fill(C.text).fontSize(12).font('Helvetica-Bold');
  t(doc, String(stops.length), chipX + 8, chipY + 15, { width: chipW - 16 });

  const usableW = CW - padX * 2;
  const positions = stops.map((s, i) => {
    const row = Math.floor(i / perRow);
    const idxInRow = i % perRow;
    const itemsInRow = Math.min(perRow, stops.length - row * perRow);
    const ltr = row % 2 === 0;
    const displayIdx = ltr ? idxInRow : itemsInRow - 1 - idxInRow;
    const rowColW = itemsInRow > 1 ? usableW / (itemsInRow - 1) : 0;
    const x = M + padX + (itemsInRow > 1 ? displayIdx * rowColW : usableW / 2);
    const y = mapY + 40 + row * rowH + rowH / 2;
    return { x, y, name: s.name, endpoint: i === 0 || i === stops.length - 1 };
  });

  doc.save().lineWidth(1.4).strokeColor(C.accent);
  for (let i = 1; i < positions.length; i++) {
    doc.moveTo(positions[i - 1].x, positions[i - 1].y).lineTo(positions[i].x, positions[i].y);
  }
  doc.stroke().restore();

  positions.forEach((p, i) => {
    dot(doc, p.x, p.y, p.endpoint ? 4 : 3, p.endpoint ? C.accent : C.light);
    const above = i % 2 === 0;
    doc.fill(C.text).fontSize(6.5).font('Helvetica-Bold');
    t(doc, p.name, p.x - 45, above ? p.y - 17 : p.y + 6, { width: 90, align: 'center' });
  });

  doc.y = mapY + mapH + 8;
}

// Embeds a real, pre-rendered map image (OSM tiles + route overlay — see
// routeMapRenderer.js) in place of the vector schematic. OSM's tile usage
// policy requires visible attribution on any rendered output.
function drawMapImageBox(doc, mapResult, boxH) {
  const y = doc.y;
  doc.save().rect(M, y, CW, boxH).lineWidth(0.6).stroke(C.border).restore();
  try {
    doc.save();
    doc.rect(M, y, CW, boxH).clip();
    doc.image(mapResult.buffer, M, y, { fit: [CW, boxH], align: 'center', valign: 'center' });
    doc.restore();

    // Labels are drawn here with PDFKit's own built-in font rather than
    // baked into the raster (see routeMapRenderer.js) — reproject each
    // point through the same fit-into-box scale/center PDFKit just applied
    // to the whole image, using the pixel positions the renderer returned.
    const scale = Math.min(CW / mapResult.width, boxH / mapResult.height);
    const offX = M + (CW - mapResult.width * scale) / 2;
    const offY = y + (boxH - mapResult.height * scale) / 2;
    mapResult.points.forEach((p) => {
      if (!p.label) return;
      const px = offX + p.x * scale, py = offY + p.y * scale;
      const lw = 92, lh = 12, lx = px - lw / 2, ly = py - 26;
      doc.save().rect(lx, ly, lw, lh).fill('#ffffff').restore();
      doc.fill(C.text).fontSize(6.5).font('Helvetica-Bold');
      t(doc, p.label, lx, ly + 2, { width: lw, align: 'center' });
    });
  } catch {
    doc.fill(C.light).fontSize(7).font('Helvetica');
    t(doc, 'Map image unavailable', M, y + boxH / 2 - 4, { width: CW, align: 'center' });
  }
  doc.fill(C.light).fontSize(5.5).font('Helvetica');
  t(doc, '(c) OpenStreetMap contributors', M, y + boxH + 3, { width: CW });
  doc.y = y + boxH + 14;
}

function routeSection(ctx, waypoints, convoy, namedWaypoints = [], mapImage = null) {
  const doc = ctx.doc;
  ensureSpace(ctx, 60);
  sectionHead(ctx, nextLetter(ctx), "Day's Movement — Route Track");

  if (!waypoints.length) {
    doc.fill(C.muted).fontSize(7.5).font('Helvetica');
    t(doc, 'No GPS waypoints logged for this date.', M, doc.y, { width: CW });
    doc.y += 14;
    if (!namedWaypoints.length) {
      doc.fill(C.light).fontSize(7).font('Helvetica');
      t(doc, 'No known route waypoints configured for this convoy either — add them on the convoy setup page to show a planned route here.',
        M, doc.y, { width: CW });
      doc.y += 16;
      return;
    }
    if (mapImage) {
      ensureSpace(ctx, 215);
      doc.fill(C.sub).fontSize(7).font('Helvetica-Bold');
      t(doc, 'PLANNED ROUTE (dispatcher-entered, not GPS-verified)', M, doc.y, { width: CW });
      doc.y += 12;
      drawMapImageBox(doc, mapImage, 190);
    } else {
      plannedRouteMap(ctx, convoy, namedWaypoints);
    }
    return;
  }

  let distanceKm = 0;
  for (let i = 1; i < waypoints.length; i++) {
    distanceKm += haversineKm(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng);
  }
  const speeds = waypoints.map(w => w.speed_kmh).filter(v => v != null);
  const peakSpeed = speeds.length ? Math.max(...speeds) : null;
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  const first = new Date(waypoints[0].recorded_at), last = new Date(waypoints[waypoints.length - 1].recorded_at);
  const driveMs = Math.max(0, last - first);
  const driveHrs = Math.floor(driveMs / 3600000), driveMin = Math.round((driveMs % 3600000) / 60000);

  ensureSpace(ctx, 190);
  if (mapImage) {
    drawMapImageBox(doc, mapImage, 150);
  } else {
    const mapH = 150, mapY = doc.y, padPx = 16;
    doc.save().rect(M, mapY, CW, mapH).lineWidth(0.6).fillAndStroke('#f0fdf4', C.border).restore();

    const lats = waypoints.map(w => w.lat), lngs = waypoints.map(w => w.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latRange = Math.max(maxLat - minLat, 0.0005);
    const lngRange = Math.max(maxLng - minLng, 0.0005);
    const project = (lat, lng) => [
      M + padPx + ((lng - minLng) / lngRange) * (CW - padPx * 2),
      mapY + padPx + (1 - (lat - minLat) / latRange) * (mapH - padPx * 2),
    ];

    doc.save().lineWidth(1.4).strokeColor(C.accent);
    waypoints.forEach((w, i) => {
      const [x, y] = project(w.lat, w.lng);
      if (i === 0) doc.moveTo(x, y); else doc.lineTo(x, y);
    });
    doc.stroke().restore();

    const [sx, sy] = project(waypoints[0].lat, waypoints[0].lng);
    const [ex, ey] = project(waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng);
    dot(doc, sx, sy, 3.5, C.green);
    dot(doc, ex, ey, 3.5, C.red);
    doc.fill(C.muted).fontSize(6).font('Helvetica');
    t(doc, 'Schematic route track (not to scale) -- start (green) to last logged position (red)',
      M, mapY + mapH + 4, { width: CW });
    doc.y = mapY + mapH + 16;
  }

  detailGrid(doc, [
    { label: 'Distance Logged', value: `${distanceKm.toFixed(1)} km` },
    { label: 'Peak Speed', value: peakSpeed != null ? `${peakSpeed.toFixed(0)} km/h` : '--' },
    { label: 'Avg Speed', value: avgSpeed != null ? `${avgSpeed.toFixed(0)} km/h` : '--' },
    { label: 'Drive Time', value: `${driveHrs}h ${driveMin}m` },
    { label: 'GPS Points', value: String(waypoints.length) },
  ], 5);

  const sampleCount = Math.min(8, waypoints.length);
  const step = Math.max(1, Math.floor(waypoints.length / sampleCount));
  const samples = [];
  for (let i = 0; i < waypoints.length && samples.length < sampleCount; i += step) samples.push(waypoints[i]);
  const lastPoint = waypoints[waypoints.length - 1];
  if (samples[samples.length - 1] !== lastPoint) samples.push(lastPoint);

  ensureSpace(ctx, 20 + samples.length * 14);
  const cols = [M, M + 90, M + 220, M + 340], colW = [86, 126, 116, 166];
  tableHeader(doc, cols, colW, ['Time (UTC)', 'Lat, Lng', 'Speed', 'Heading']);
  let y = doc.y;
  samples.forEach((w, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.stripe);
    const time = new Date(w.recorded_at).toISOString().replace('T', ' ').slice(0, 19);
    [time, `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`,
     w.speed_kmh != null ? `${w.speed_kmh.toFixed(0)} km/h` : '--',
     w.heading != null ? `${Math.round(w.heading)} deg` : '--',
    ].forEach((v, j) => {
      doc.fill(C.sub).fontSize(7).font('Helvetica');
      t(doc, v, cols[j] + 3, y + 3, { width: colW[j] });
    });
    y += 14;
  });
  doc.y = y + 6;
}

function cfoPhotosTable(ctx, cfoPhotos) {
  if (!cfoPhotos.length) return;
  ensureSpace(ctx, 60 + Math.min(cfoPhotos.length, 10) * 14);
  sectionHead(ctx, nextLetter(ctx), `CFO App Photos (${cfoPhotos.length} uploaded)`);
  const doc = ctx.doc, cols = [M,M+55,M+130,M+230,M+310,M+390], colW = [51,71,96,76,76,115];
  tableHeader(doc, cols, colW, ['Phase','Type','Plate','Lat','Lng','Time (UTC)']);
  let y = doc.y;
  cfoPhotos.forEach((p, i) => {
    if (y + 14 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 14).fill(C.stripe);
    const at = p.taken_at ? new Date(p.taken_at).toISOString().replace('T',' ').slice(0,16) : '--';
    [(p.session||'').toUpperCase()||'--', p.photo_type||'--', p.plate_number||'--',
     p.lat!=null?parseFloat(p.lat).toFixed(4):'--', p.lng!=null?parseFloat(p.lng).toFixed(4):'--', at,
    ].forEach((v,j) => {
      doc.fill(j===0?(p.session==='sod'?C.green:C.accent):C.sub).fontSize(7).font(j===0?'Helvetica-Bold':'Helvetica');
      t(doc, v, cols[j]+3, y+3, {width:colW[j]});
    });
    y += 14;
  });
  doc.y = y + 4;
}

// Reference-style 3-up footer card (metrics / trip performance / metadata)
// plus signature lines for whichever CFOs are actually assigned to this
// convoy — mirrors the polish of the "Enhanced Convoy Report" sample the
// user shared, using only fields this pipeline already has in hand.
function summarySection(ctx, received, required, mismatchCount, cfos, report, convoy) {
  ensureSpace(ctx, 120);
  sectionHead(ctx, nextLetter(ctx), 'Summary & Certification');
  const doc = ctx.doc;
  const pct = required > 0 ? Math.round((received / required) * 100) : 0;
  const colW = CW / 3 - 6, y = doc.y;

  const cards = [
    { title: 'COMPLETENESS METRICS', rows: [
      ['Photos', `${received}/${required}`],
      ['Location Anomalies', String(mismatchCount)],
      ['Report Status', (report.status || '').toUpperCase() || '--'],
    ] },
    { title: 'CONVOY SUMMARY', rows: [
      ['Vehicles', String(convoy.truckCount ?? '--')],
      ['Seals / Truck', String(convoy.seal_count_per_truck ?? '--')],
      ['Region', convoy.region || '--'],
    ] },
    { title: 'REPORT METADATA', rows: [
      ['Report ID', report.id ? `RPT-${String(report.id).slice(0, 8).toUpperCase()}` : '--'],
      ['Generated', report.generated_at ? new Date(report.generated_at).toISOString().slice(0, 16).replace('T', ' ') : '--'],
      ['System', 'Sonalit Guardian CFO'],
    ] },
  ];
  cards.forEach((card, i) => {
    const x = M + i * (colW + 9);
    doc.save().rect(x, y, colW, 58).lineWidth(0.6).strokeColor(C.border).stroke().restore();
    doc.fill(C.text).fontSize(6.5).font('Helvetica-Bold');
    t(doc, card.title, x + 8, y + 6, { width: colW - 16 });
    card.rows.forEach((r, ri) => {
      const ry = y + 18 + ri * 12;
      doc.fill(C.muted).fontSize(6.5).font('Helvetica');
      t(doc, r[0], x + 8, ry, { width: colW / 2 });
      doc.fill(C.text).fontSize(6.5).font('Helvetica-Bold');
      t(doc, r[1], x + colW / 2, ry, { width: colW / 2 - 8, align: 'right' });
    });
  });
  doc.y = y + 66;
  progressBar(doc, received, required);

  doc.y += 16;
  const sigLabels = cfos.length
    ? cfos.slice(0, 2).map(c => c.cfo_name || 'CFO').concat(['Date'])
    : ['Dispatcher Signature', 'CFO Lead Signature', 'Date'];
  const sigY = doc.y, sigW = CW / 3 - 8;
  sigLabels.forEach((label, i) => {
    const sx = M + i * (sigW + 12);
    doc.save().moveTo(sx, sigY + 22).lineTo(sx + sigW, sigY + 22).lineWidth(0.5).strokeColor(C.sub).stroke().restore();
    doc.fill(C.light).fontSize(6.5).font('Helvetica');
    t(doc, label, sx, sigY + 26, { width: sigW });
  });
  doc.y = sigY + 40;
}

async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate, cfoPhotos = [], waypoints = [], namedWaypoints = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const pct = report.required_photo_count > 0
    ? Math.round((report.received_photo_count / report.required_photo_count) * 100) : 0;
  const mismatchCount = photos.filter(p => p.location_mismatch).length;
  // Fetched up front (PDFKit's drawing calls are synchronous) so truckDetail
  // can embed the actual photo bytes instead of a text "Present" indicator.
  const [photoBuffers, routeMapImage] = await Promise.all([
    prefetchPhotoBuffers(photos),
    prefetchRouteMap(convoy, waypoints, namedWaypoints),
  ]);

  const statusMap = {
    generated: { label: 'FULLY GENERATED', fg: C.green, bg: C.greenBg },
    complete: { label: 'FULLY GENERATED', fg: C.green, bg: C.greenBg },
    partial: { label: 'PARTIAL', fg: C.amber, bg: C.amberBg },
    pending: { label: 'PENDING', fg: C.muted, bg: C.stripe },
    failed: { label: 'FAILED', fg: C.red, bg: C.redBg },
  };
  const st = statusMap[report.status] || statusMap.pending;

  const ctx = { doc: null, pageNum: 0, generatedAt, letterIdx: 0,
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · ${reportDate}` };
  return makePdf(doc => {
    ctx.doc = doc;
    doc.addPage();
    ctx.pageNum = 1;
    drawFooter(ctx);
    drawCoverHeader(ctx, {
      eyebrow: 'DAILY CONVOY REPORT',
      title: 'CONVOY REPORT',
      subtitle: convoy.name || '--',
      routeLine: `${convoy.route_origin || '--'}  ->  ${convoy.route_destination || '--'}`,
      reportRef: report.id ? `RPT-${String(report.id).slice(0, 8).toUpperCase()} · ${reportDate}` : reportDate,
      statusLabel: `${st.label} · ${pct}%`, statusFg: st.fg, statusBg: st.bg,
      generatedAt,
      pct,
      stats: [
        { label: 'Report Date', value: reportDate },
        { label: 'Lead CFO', value: cfos[0]?.cfo_name || '--', color: C.gold },
        { label: 'Vehicles', value: `${trucks.length} truck${trucks.length === 1 ? '' : 's'}` },
        { label: 'Total Photos', value: `${report.received_photo_count}/${report.required_photo_count}`, color: pct >= 100 ? '#4ade80' : C.white },
        { label: 'Convoy Status', value: (convoy.status || '--').toUpperCase() },
      ],
      checklist: [
        { label: 'Details', ok: true },
        { label: 'Route', ok: waypoints.length > 0 || namedWaypoints.length > 0 },
        { label: 'Officers', ok: cfos.length > 0 },
        { label: 'Photos', ok: pct >= 100 },
        { label: 'Summary', ok: report.status === 'generated' || report.status === 'complete' },
      ],
    });

    sectionHead(ctx, nextLetter(ctx), 'Convoy Details', `${pct}% Complete`);
    detailGrid(doc, [
      { label: 'Convoy ID', value: convoy.name || '--' },
      { label: 'Report Date', value: reportDate },
      { label: 'Origin', value: convoy.route_origin || '--' },
      { label: 'Destination', value: convoy.route_destination || '--' },
      { label: 'Convoy Status', value: (convoy.status || '').toUpperCase() || '--', color: convoy.status === 'completed' ? C.green : C.text },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Start / End Date', value: `${convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--'} – ${convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--'}` },
      { label: 'Seals / Truck', value: String(convoy.seal_count_per_truck ?? '--') },
    ]);

    routeSection(ctx, waypoints, convoy, namedWaypoints, routeMapImage);

    if (cfos.length) {
      sectionHead(ctx, nextLetter(ctx), 'Field Officers');
      let y = doc.y;
      cfos.forEach((c, i) => {
        if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.stripe);
        doc.fill(C.text).fontSize(8).font('Helvetica-Bold');
        t(doc, c.cfo_name || c.cfo_user_id?.slice(-8) || '--', M + 4, y + 4, { width: CW / 2 - 8 });
        doc.fill(C.muted).fontSize(7.5).font('Helvetica');
        t(doc, c.cfo_email || '', M + CW / 2, y + 4, { width: CW / 2 - 4 });
        y += 16;
      });
      doc.y = y + 6;
    }

    // Was an unconditional newPage regardless of how much room was left on
    // the current page — a short Field Officers list (or none) left most of
    // page 1 blank before jumping to a fresh page for this. ensureSpace only
    // pages when the matrix + its header rows genuinely won't fit.
    ensureSpace(ctx, 70 + trucks.length * 23);
    sectionHead(ctx, nextLetter(ctx), 'Photo Status Matrix');
    const sealCountPerTruck = convoy.seal_count_per_truck ?? 3;
    const truckMatrix = trucks.map(truck => {
      const tp = photos.filter(p => p.convoy_truck_id === truck.id);
      const buildSession = (session) => {
        const sp = tp.filter(p => p.session === session);
        // Cap at the convoy's actual configured seal count, not the number
        // of distinct seal_position values ever seen for this truck+session
        // — seal_position is CFO-entered free text, so a drifted code
        // shouldn't read as "6 seals required" when the convoy has 3.
        const sealHave = Math.min(
          new Set(sp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))).size,
          sealCountPerTruck
        );
        return {
          front: sp.some(p => p.photo_type === 'front'),
          rear: sp.some(p => p.photo_type === 'rear'),
          sealHave, sealTotal: sealCountPerTruck,
        };
      };
      return { ...truck, sod: buildSession('sod'), eod: buildSession('eod') };
    });
    photoMatrix(ctx, truckMatrix);
    mismatchTable(ctx, photos);

    trucks.forEach(truck => {
      truckDetail(ctx, truck, photos.filter(p => p.convoy_truck_id === truck.id), sealCountPerTruck, photoBuffers);
    });

    cfoPhotosTable(ctx, cfoPhotos);

    summarySection(ctx, report.received_photo_count, report.required_photo_count, mismatchCount,
      cfos, report, { ...convoy, truckCount: trucks.length });
  });
}

async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const totalReq = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
  const totalRecv = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
  const overallPct = totalReq > 0 ? Math.round((totalRecv / totalReq) * 100) : 0;
  const sealCount = convoy.seal_count_per_truck ?? 3;
  const perTruckRequired = (2 + sealCount) * 2;

  const ctx = { doc: null, pageNum: 0, generatedAt, letterIdx: 0,
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · Archive Report` };
  return makePdf(doc => {
    ctx.doc = doc;
    doc.addPage();
    ctx.pageNum = 1;
    drawFooter(ctx);
    drawCoverHeader(ctx, {
      eyebrow: 'CONVOY ARCHIVE REPORT',
      title: 'ARCHIVE REPORT',
      subtitle: convoy.name || '--',
      routeLine: `${convoy.route_origin || '--'}  ->  ${convoy.route_destination || '--'}`,
      reportRef: `${reports.length} report day${reports.length === 1 ? '' : 's'}`,
      statusLabel: `${overallPct}% OVERALL`, statusFg: overallPct >= 100 ? C.green : C.amber,
      statusBg: overallPct >= 100 ? C.greenBg : C.amberBg,
      generatedAt,
      pct: overallPct,
      stats: [
        { label: 'Region', value: convoy.region || '--' },
        { label: 'Vehicles', value: `${trucks.length} truck${trucks.length === 1 ? '' : 's'}` },
        { label: 'CFOs', value: String(cfos.length) },
        { label: 'Photos', value: `${totalRecv}/${totalReq}`, color: overallPct >= 100 ? '#4ade80' : C.white },
        { label: 'Convoy Status', value: (convoy.status || '--').toUpperCase() },
      ],
      checklist: [
        { label: 'Days Logged', ok: reports.length > 0 },
        { label: 'Photos', ok: overallPct >= 100 },
        { label: 'Summary', ok: true },
      ],
    });

    sectionHead(ctx, nextLetter(ctx), 'Archive Summary');
    detailGrid(doc, [
      { label: 'Convoy', value: convoy.name || '--' },
      { label: 'Status', value: (convoy.status || '').toUpperCase() || '--' },
      { label: 'Region', value: convoy.region || '--' },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Start Date', value: convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--' },
      { label: 'End Date', value: convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--' },
      { label: 'Trucks', value: String(trucks.length) },
      { label: 'CFOs', value: String(cfos.length) },
    ]);
    sectionHead(ctx, nextLetter(ctx), `Overall Completion (${overallPct}%)`);
    progressBar(doc, totalRecv, totalReq);

    sectionHead(ctx, nextLetter(ctx), 'Daily Summary');
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
      [dateStr, (r.status||'').toUpperCase(), photoPct, dm > 0 ? `!! ${dm}` : '0', r.pdf_url ? 'Yes' : 'No', genAt].forEach((v, j) => {
        const color = j === 1 ? (r.status === 'generated' ? C.green : C.amber) : j === 3 && dm > 0 ? C.amber : C.sub;
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
        t(doc, `${dateStr}  ${(rpt.status||'').toUpperCase()} -- ${rpt.received_photo_count}/${rpt.required_photo_count}`,
          M + 4, dy + 3, { width: CW - 8 });
        dy += 15;
        trucks.forEach((tk, ti) => {
          const cnt = dayPhotos.filter(p => p.convoy_truck_id === tk.id).length;
          if (ti % 2 === 0) doc.rect(M, dy, CW, 11).fill(C.stripe);
          const bW = perTruckRequired > 0 ? Math.min(barMaxW, barMaxW * cnt / perTruckRequired) : 0;
          doc.fill(C.text).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `T${tk.position}`, M + 2, dy + 2, { width: 16 });
          doc.fill(C.muted).font('Helvetica');
          t(doc, tk.driver_name, M + 20, dy + 2, { width: 128 });
          doc.save().rect(M+152, dy+1, barMaxW, 8).lineWidth(0.4).fillAndStroke('#e5e7eb',C.border).restore();
          if (bW > 0) doc.rect(M+152, dy+1, bW, 8).fill(cnt >= perTruckRequired ? C.green : C.amber);
          doc.fill(C.sub).fontSize(6.5).font('Helvetica-Bold');
          t(doc, `${cnt}/${perTruckRequired}`, M+152+barMaxW+3, dy+2, { width: 40 });
          dy += 11;
        });
        doc.y = dy + 3;
      });
    }
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
