/**
 * PDF generator for CFO daily and archive reports.
 * Every .text() call uses lineBreak:false to prevent PDFKit auto-paging.
 */
const PDFDocument = require('pdfkit');

const C = {
  dark: '#0d1426', navy: '#1a2a4a',
  accent: '#f07020', accent2: '#ff9040',
  green: '#16a34a', greenBg: '#dcfce7', greenBorder: '#86efac',
  red: '#dc2626', redBg: '#fee2e2', redBorder: '#fca5a5',
  amber: '#d97706', amberBg: '#fef3c7',
  muted: '#64748b', stripe: '#f1f5f9', text: '#1e293b', white: '#ffffff',
};

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - M * 2;
const BODY_TOP = 68;
const BODY_BOTTOM = PH - 48;

function t(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, { ...opts, lineBreak: false });
}

function makePdf(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: M, size: 'A4', autoFirstPage: false });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

function newPage(ctx) {
  ctx.doc.addPage();
  ctx.pageNum++;
  const doc = ctx.doc;

  doc.rect(0, 0, PW, 52).fill(C.dark);
  doc.rect(0, 52, PW, 3).fill(C.accent);
  doc.fill(C.white).fontSize(14).font('Helvetica-Bold');
  t(doc, ctx.title || 'Convoy Report', M, 14, { width: CW - 90 });
  doc.fill(C.accent2).fontSize(9).font('Helvetica');
  t(doc, ctx.subtitle || '', M, 33, { width: CW - 90 });
  doc.fill(C.muted).fontSize(7);
  t(doc, 'SONALIT', PW - 80, 20, { width: 60, align: 'right' });

  const fy = PH - 28;
  doc.rect(0, fy, PW, 28).fill(C.dark);
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, `Generated ${ctx.generatedAt}`, M, fy + 9, { width: 250 });
  doc.fill(C.muted).fontSize(7);
  t(doc, `Page ${ctx.pageNum}`, PW - M - 60, fy + 9, { width: 60, align: 'right' });

  doc.y = BODY_TOP;
}

function ensureSpace(ctx, needed) {
  if (ctx.doc.y + needed > BODY_BOTTOM) newPage(ctx);
}

function section(ctx, label) {
  ensureSpace(ctx, 36);
  const doc = ctx.doc;
  const y = doc.y + 3;
  doc.rect(M, y, CW, 20).fill(C.navy);
  doc.fill(C.white).fontSize(9).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), M + 6, y + 5, { width: CW - 12 });
  doc.y = y + 26;
}

function kvPairs(doc, rows) {
  const lw = 135, halfCW = CW / 2, rh = 17;
  let y = doc.y;
  for (let i = 0; i < rows.length; i += 2) {
    if (i % 4 === 0) doc.rect(M, y, CW, rh).fill(C.stripe);
    doc.fill(C.muted).fontSize(8).font('Helvetica');
    t(doc, rows[i][0], M + 4, y + 4, { width: lw });
    doc.fill(C.text).font('Helvetica-Bold');
    t(doc, rows[i][1] ?? '--', M + lw + 4, y + 4, { width: halfCW - lw - 8 });
    if (rows[i + 1]) {
      doc.fill(C.muted).font('Helvetica');
      t(doc, rows[i + 1][0], M + halfCW + 4, y + 4, { width: lw });
      doc.fill(C.text).font('Helvetica-Bold');
      t(doc, rows[i + 1][1] ?? '--', M + halfCW + lw + 4, y + 4, { width: halfCW - lw - 8 });
    }
    y += rh;
  }
  doc.y = y + 6;
}

function progressBar(doc, received, required) {
  const pct = required > 0 ? Math.min(1, received / required) : 0;
  const y = doc.y;
  doc.save().rect(M, y, CW, 14).lineWidth(0.5).fillAndStroke(C.redBg, C.redBorder).restore();
  if (pct > 0) doc.rect(M, y, CW * pct, 14).fill(pct >= 1 ? C.green : C.amber);
  doc.fill(pct >= 0.5 ? C.white : C.text).fontSize(8).font('Helvetica-Bold');
  t(doc, `${received} / ${required} photos  (${Math.round(pct * 100)}%)`, M, y + 3, { width: CW, align: 'center' });
  doc.y = y + 22;
}

function tableHeader(doc, cols, widths, headers) {
  const y = doc.y;
  const rh = 16;
  doc.rect(M, y, CW, rh).fill(C.navy);
  headers.forEach((h, i) => {
    doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold');
    t(doc, h, cols[i] + 2, y + 4, { width: widths[i] });
  });
  doc.y = y + rh + 1;
}

function photoMatrix(ctx, trucks) {
  const doc = ctx.doc;
  const labelW = 110;
  const cellW = 42;
  const cellH = 20;
  const gap = 2;
  const cols = ['FR', 'RR', 'SEALS'];
  const sessionW = cols.length * (cellW + gap);
  const rowH = cellH + 6;

  let y = doc.y;
  doc.fill(C.muted).fontSize(7).font('Helvetica');
  t(doc, 'Truck / Driver', M, y + 4, { width: labelW });

  let x = M + labelW + 4;
  ['SOD', 'EOD'].forEach(s => {
    doc.rect(x, y, sessionW, 14).fill(C.navy);
    doc.fill(C.white).fontSize(7).font('Helvetica-Bold');
    t(doc, s, x, y + 3, { width: sessionW, align: 'center' });
    x += sessionW + 10;
  });
  y += 16;

  x = M + labelW + 4;
  ['SOD', 'EOD'].forEach(() => {
    cols.forEach((cl, idx) => {
      doc.fill(C.muted).fontSize(6).font('Helvetica');
      t(doc, cl, x + idx * (cellW + gap), y + 1, { width: cellW, align: 'center' });
    });
    x += sessionW + 10;
  });
  y += 11;

  trucks.forEach((truck, ti) => {
    if (y + rowH > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (ti % 2 === 0) doc.rect(M, y, CW, rowH).fill(C.stripe);

    doc.fill(C.text).fontSize(8).font('Helvetica-Bold');
    t(doc, `T${truck.position}`, M + 2, y + 4, { width: 20 });
    doc.fill(C.muted).fontSize(7).font('Helvetica');
    t(doc, truck.driver_name || '--', M + 22, y + 3, { width: labelW - 28 });
    doc.fill(C.muted).fontSize(6);
    t(doc, truck.plate_number || '--', M + 22, y + 13, { width: labelW - 28 });

    x = M + labelW + 4;
    ['sod', 'eod'].forEach(session => {
      const sd = truck[session] || { front: false, rear: false, sealHave: 0, sealTotal: 0 };
      const vals = [
        { ok: sd.front, label: sd.front ? 'Y' : '--' },
        { ok: sd.rear, label: sd.rear ? 'Y' : '--' },
        { ok: sd.sealHave >= sd.sealTotal && sd.sealTotal > 0,
          label: `${sd.sealHave}/${sd.sealTotal}` },
      ];
      vals.forEach((v, idx) => {
        const sx = x + idx * (cellW + gap);
        doc.save().rect(sx, y + 2, cellW, cellH).lineWidth(0.5)
          .fillAndStroke(v.ok ? C.greenBg : C.redBg, v.ok ? C.greenBorder : C.redBorder)
          .restore();
        doc.fill(v.ok ? C.green : C.red).fontSize(9).font('Helvetica-Bold');
        t(doc, v.label, sx, y + 7, { width: cellW, align: 'center' });
      });
      x += sessionW + 10;
    });
    y += rowH;
  });
  doc.y = y + 4;
}

function mismatchTable(ctx, photos) {
  const mismatches = photos.filter(p => p.location_mismatch);
  if (!mismatches.length) return;
  section(ctx, `Location Mismatches (${mismatches.length})`);
  const doc = ctx.doc;
  const cols = [M, M + 100, M + 200, M + 280, M + 380];
  const colW = [96, 96, 76, 96, 80];
  tableHeader(doc, cols, colW, ['Truck', 'Photo Type', 'Session', 'Uploaded', 'Flag']);

  let y = doc.y;
  mismatches.forEach((p, i) => {
    if (y + 16 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
    if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.amberBg);
    const vals = [
      String(p.convoy_truck_id).slice(-8),
      `${p.photo_type}${p.seal_position ? ` #${p.seal_position}` : ''}`,
      (p.session || '').toUpperCase(),
      p.uploaded_at ? new Date(p.uploaded_at).toISOString().slice(0, 16).replace('T', ' ') : '--',
      'GPS >2km',
    ];
    vals.forEach((v, j) => {
      doc.fill(C.text).fontSize(7.5).font('Helvetica');
      t(doc, v, cols[j] + 2, y + 4, { width: colW[j] });
    });
    y += 16;
  });
  doc.y = y + 4;
}

function truckDetail(ctx, truck, truckPhotos) {
  newPage(ctx);
  const doc = ctx.doc;

  const sealPositions = Array.from(new Set(
    truckPhotos.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))
  )).sort();

  const totalPhotos = truckPhotos.length;
  const expectedPerSession = 2 + sealPositions.length;
  const expectedTotal = expectedPerSession * 2;

  section(ctx, `Truck ${truck.position} -- ${truck.driver_name || 'Unknown'}`);
  kvPairs(doc, [
    ['Plate / Reg No.', truck.plate_number || '--'],
    ['Driver Phone', truck.driver_phone || '--'],
    ['License No.', truck.driver_license_no || '--'],
    ['Photos Received', `${totalPhotos} / ${expectedTotal}`],
    ['Seal Positions', sealPositions.length > 0 ? sealPositions.join(', ') : '--'],
    ['', ''],
  ]);

  ['sod', 'eod'].forEach(session => {
    const label = session === 'sod' ? 'Start of Day (SOD)' : 'End of Day (EOD)';
    ensureSpace(ctx, 60 + (2 + sealPositions.length) * 16);
    section(ctx, label);

    const sp = truckPhotos.filter(p => p.session === session);
    const types = [
      { typeLabel: 'Front', photoType: 'front', sealPos: null },
      { typeLabel: 'Rear', photoType: 'rear', sealPos: null },
      ...sealPositions.map(pos => ({ typeLabel: `Seal`, photoType: 'seal', sealPos: pos })),
    ];

    const cols = [M, M + 90, M + 170, M + 280, M + 370];
    const colW = [86, 76, 106, 86, 90];
    tableHeader(doc, cols, colW, ['Photo Type', 'Seal Code', 'Uploaded At', 'Location', 'Status']);

    let y = doc.y;
    types.forEach((row, idx) => {
      if (y + 16 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
      const match = row.sealPos != null
        ? sp.find(p => p.photo_type === 'seal' && String(p.seal_position) === row.sealPos)
        : sp.find(p => p.photo_type === row.photoType);

      if (idx % 2 === 0) doc.rect(M, y, CW, 16).fill(C.stripe);

      const uploaded = match?.uploaded_at
        ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
      const loc = match ? (match.location_mismatch ? 'MISMATCH' : 'OK') : '--';
      const status = match ? 'Present' : 'MISSING';

      doc.fill(match ? C.text : C.red).fontSize(8).font(match ? 'Helvetica' : 'Helvetica-Bold');
      t(doc, row.typeLabel, M + 2, y + 4, { width: 86 });

      doc.fill(C.muted).font('Helvetica');
      t(doc, row.sealPos || '--', cols[1] + 2, y + 4, { width: 76 });
      t(doc, uploaded, cols[2] + 2, y + 4, { width: 106 });

      doc.fill(match?.location_mismatch ? C.amber : C.muted);
      t(doc, loc, cols[3] + 2, y + 4, { width: 86 });

      doc.fill(match ? C.green : C.red).font('Helvetica-Bold');
      t(doc, status, cols[4] + 2, y + 4, { width: 90 });
      y += 16;
    });
    doc.y = y + 6;
  });
}

function cfoPhotosTable(ctx, cfoPhotos) {
  if (!cfoPhotos.length) return;
  newPage(ctx);
  section(ctx, `CFO App Photos (${cfoPhotos.length} uploaded)`);
  const doc = ctx.doc;
  const cols = [M, M + 55, M + 130, M + 230, M + 310, M + 390];
  const colW = [51, 71, 96, 76, 76, 115];
  tableHeader(doc, cols, colW, ['Phase', 'Type', 'Plate', 'Lat', 'Lng', 'Time (UTC)']);

  let y = doc.y;
  cfoPhotos.forEach((p, i) => {
    if (y + 16 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y + 4; }
    if (i % 2 === 0) doc.rect(M, y, CW, 16).fill(C.stripe);
    const takenAt = p.taken_at
      ? new Date(p.taken_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
    const vals = [
      (p.session || '').toUpperCase() || '--', p.photo_type || '--', p.plate_number || '--',
      p.lat != null ? parseFloat(p.lat).toFixed(4) : '--',
      p.lng != null ? parseFloat(p.lng).toFixed(4) : '--', takenAt,
    ];
    vals.forEach((v, j) => {
      doc.fill(j === 0 ? (p.session === 'sod' ? C.green : C.accent) : C.text)
        .fontSize(8).font(j === 0 ? 'Helvetica-Bold' : 'Helvetica');
      t(doc, v, cols[j] + 2, y + 4, { width: colW[j] });
    });
    y += 16;
  });
  doc.y = y + 4;
}

async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate, cfoPhotos = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const pct = report.required_photo_count > 0
    ? Math.round((report.received_photo_count / report.required_photo_count) * 100) : 0;

  const ctx = {
    doc: null, pageNum: 0, generatedAt,
    title: convoy.name || 'Convoy Report',
    subtitle: `Daily Report -- ${reportDate}`,
  };

  return makePdf(doc => {
    ctx.doc = doc;

    newPage(ctx);
    section(ctx, 'Convoy Summary');
    kvPairs(doc, [
      ['Convoy', convoy.name || '--'],
      ['Status', (convoy.status || '').toUpperCase() || '--'],
      ['Timezone', convoy.timezone || 'UTC'],
      ['Region', convoy.region || '--'],
      ['Origin', convoy.route_origin || '--'],
      ['Destination', convoy.route_destination || '--'],
      ['Start Date', convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--'],
      ['End Date', convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--'],
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Seals / Truck', convoy.seal_count_per_truck ?? '--'],
      ['Report Date', reportDate],
    ]);

    section(ctx, `Photo Completion -- ${pct}%`);
    progressBar(doc, report.received_photo_count, report.required_photo_count);

    if (cfos.length) {
      section(ctx, 'Field Officers');
      let y = doc.y;
      cfos.forEach((c, i) => {
        if (i % 2 === 0) doc.rect(M, y, CW, 18).fill(C.stripe);
        doc.fill(C.text).fontSize(9).font('Helvetica-Bold');
        t(doc, c.cfo_name || c.cfo_user_id?.slice(-8) || '--', M + 4, y + 4, { width: CW / 2 - 8 });
        doc.fill(C.muted).fontSize(8).font('Helvetica');
        t(doc, c.cfo_email || '', M + CW / 2, y + 4, { width: CW / 2 - 4 });
        y += 18;
      });
      doc.y = y + 6;
    }

    newPage(ctx);
    section(ctx, 'Photo Status Matrix');

    const truckMatrix = trucks.map(truck => {
      const tp = photos.filter(p => p.convoy_truck_id === truck.id);
      const sealPositions = Array.from(new Set(
        tp.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))
      ));
      const buildSession = (session) => {
        const sp = tp.filter(p => p.session === session);
        const sealHave = sealPositions.filter(pos =>
          sp.some(p => p.photo_type === 'seal' && String(p.seal_position) === pos)
        ).length;
        return {
          front: sp.some(p => p.photo_type === 'front'),
          rear: sp.some(p => p.photo_type === 'rear'),
          sealHave,
          sealTotal: sealPositions.length,
        };
      };
      return { ...truck, sod: buildSession('sod'), eod: buildSession('eod') };
    });
    photoMatrix(ctx, truckMatrix);
    mismatchTable(ctx, photos);

    trucks.forEach(truck => {
      truckDetail(ctx, truck, photos.filter(p => p.convoy_truck_id === truck.id));
    });

    cfoPhotosTable(ctx, cfoPhotos);
  });
}

async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const totalReq = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
  const totalRecv = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
  const overallPct = totalReq > 0 ? Math.round((totalRecv / totalReq) * 100) : 0;
  const sealCount = convoy.seal_count_per_truck ?? 3;
  const required = (2 + sealCount) * 2;

  const ctx = {
    doc: null, pageNum: 0, generatedAt,
    title: convoy.name || 'Convoy Report', subtitle: 'Archive Report',
  };

  return makePdf(doc => {
    ctx.doc = doc;

    newPage(ctx);
    section(ctx, 'Full Archive Report');
    kvPairs(doc, [
      ['Convoy', convoy.name || '--'],
      ['Status', (convoy.status || '').toUpperCase() || '--'],
      ['Region', convoy.region || '--'],
      ['Timezone', convoy.timezone || 'UTC'],
      ['Start Date', convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--'],
      ['End Date', convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--'],
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Seals / Truck', sealCount],
      ['Report Days', reports.length],
      ['Total Photos Required', totalReq],
      ['Total Photos Received', totalRecv],
    ]);
    section(ctx, `Overall Completion -- ${overallPct}%`);
    progressBar(doc, totalRecv, totalReq);

    section(ctx, 'Daily Summary');
    const hCols = [M, M + 85, M + 175, M + 270, M + 340, M + 430];
    const hW = [81, 86, 91, 66, 86, 70];
    tableHeader(doc, hCols, hW, ['Date', 'Status', 'Photos', 'Mismatch', 'PDF', 'Generated']);

    let y = doc.y;
    reports.forEach((r, i) => {
      if (y + 17 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
      if (i % 2 === 0) doc.rect(M, y, CW, 17).fill(C.stripe);
      const dateStr = String(r.report_date).slice(0, 10);
      const photoPct = r.required_photo_count > 0
        ? `${r.received_photo_count}/${r.required_photo_count} (${Math.round(r.received_photo_count / r.required_photo_count * 100)}%)`
        : '--';
      const dm = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr && p.location_mismatch).length;
      const genAt = r.generated_at ? new Date(r.generated_at).toISOString().slice(0, 10) : '--';
      const vals = [
        dateStr, (r.status || '').toUpperCase(), photoPct,
        dm > 0 ? `!! ${dm}` : '0', r.pdf_url ? 'Yes' : 'No', genAt,
      ];
      vals.forEach((v, j) => {
        const color = j === 1 ? (r.status === 'generated' ? C.green : C.amber)
          : j === 3 && dm > 0 ? C.amber : C.text;
        doc.fill(color).fontSize(8).font(j === 1 ? 'Helvetica-Bold' : 'Helvetica');
        t(doc, v, hCols[j] + 2, y + 4, { width: hW[j] });
      });
      y += 17;
    });
    doc.y = y + 4;

    if (reports.length > 0) {
      newPage(ctx);
      section(ctx, 'Per-Day Truck Photo Counts');
      reports.slice(0, 15).forEach(report => {
        ensureSpace(ctx, 22 + trucks.length * 14);
        const dateStr = String(report.report_date).slice(0, 10);
        const dayPhotos = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr);
        let dy = doc.y + 2;
        doc.rect(M, dy, CW, 16).fill(C.navy);
        doc.fill(C.white).fontSize(8).font('Helvetica-Bold');
        t(doc, dateStr, M + 4, dy + 4, { width: 100 });
        doc.fill(C.white).fontSize(8);
        t(doc, `${(report.status || '').toUpperCase()} -- ${report.received_photo_count}/${report.required_photo_count}`,
          M + 110, dy + 4, { width: 250 });
        dy += 18;
        trucks.forEach((truck, ti) => {
          const tp = dayPhotos.filter(p => p.convoy_truck_id === truck.id).length;
          if (ti % 2 === 0) doc.rect(M, dy, CW, 13).fill(C.stripe);
          const pct = required > 0 ? Math.round(tp / required * 100) : 0;
          const barMaxW = CW * 0.35;
          const barW = required > 0 ? Math.min(barMaxW, barMaxW * (tp / required)) : 0;
          doc.fill(C.text).fontSize(7.5).font('Helvetica-Bold');
          t(doc, `T${truck.position}`, M + 2, dy + 3, { width: 20 });
          doc.fill(C.muted).font('Helvetica');
          t(doc, truck.driver_name, M + 24, dy + 3, { width: 130 });
          doc.save().rect(M + 158, dy + 2, barMaxW, 9).lineWidth(0.5)
            .fillAndStroke(C.redBg, C.redBorder).restore();
          if (barW > 0) doc.rect(M + 158, dy + 2, barW, 9).fill(pct >= 100 ? C.green : C.amber);
          doc.fill(pct >= 100 ? C.green : C.text).fontSize(7.5).font('Helvetica-Bold');
          t(doc, `${tp}/${required}`, M + 158 + barMaxW + 4, dy + 3, { width: 50 });
          dy += 13;
        });
        doc.y = dy + 4;
      });
    }
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
