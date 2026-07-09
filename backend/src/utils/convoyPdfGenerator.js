const PDFDocument = require('pdfkit');
const C = {
  dark: '#0d1426', navy: '#1a2a4a', accent: '#d97706', accent2: '#f59e0b',
  green: '#16a34a', greenBg: '#dcfce7', greenBorder: '#86efac',
  red: '#dc2626', redBg: '#fee2e2', redBorder: '#fca5a5',
  amber: '#d97706', amberBg: '#fef3c7', muted: '#6b7280', light: '#9ca3af',
  stripe: '#f8fafc', border: '#e5e7eb', text: '#111827', sub: '#374151', white: '#ffffff',
};

const PW = 595.28, PH = 841.89, M = 40, CW = PW - M * 2;
const BODY_TOP = 68, BODY_BOTTOM = PH - 50;

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

function sectionHead(ctx, label) {
  ensureSpace(ctx, 30);
  const doc = ctx.doc;
  const y = doc.y + 6;
  doc.save().moveTo(M, y + 16).lineTo(M + CW, y + 16).lineWidth(1.5).strokeColor(C.text).stroke().restore();
  doc.fill(C.text).fontSize(9).font('Helvetica-Bold');
  t(doc, label.toUpperCase(), M, y + 2, { width: CW });
  doc.y = y + 22;
}

function detailGrid(doc, items, cols = 4) {
  const cellW = CW / cols, cellH = 34;
  let y = doc.y;
  items.forEach((item, i) => {
    const col = i % cols, x = M + col * cellW;
    if (col === 0 && i > 0) y += cellH;
    doc.save().rect(x, y, cellW - 3, cellH - 2).lineWidth(0.5).fillAndStroke(C.stripe, C.border).restore();
    doc.fill(C.light).fontSize(6).font('Helvetica');
    t(doc, (item.label || '').toUpperCase(), x + 6, y + 5, { width: cellW - 14 });
    doc.fill(C.text).fontSize(10).font('Helvetica-Bold');
    t(doc, item.value ?? '--', x + 6, y + 16, { width: cellW - 14 });
  });
  doc.y = y + cellH + 4;
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
  sectionHead(ctx, 'Location Mismatches (' + mm.length + ')');
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

function truckDetail(ctx, truck, truckPhotos, sealCountPerTruck) {
  newPage(ctx);
  const doc = ctx.doc;

  // sealPositions pools every distinct seal_position value ever seen — kept
  // as-is for listing/detail rows below (a code that drifted between SOD/EOD
  // is a real anomaly worth showing). But it must NOT be used as the
  // "required" denominator: seal_position is CFO-entered free text, not a
  // fixed slot count, so a truck can rack up more distinct codes than
  // seal_count_per_truck without that meaning more photos were genuinely
  // required — that's exactly the bug that let this box read "10/16" for a
  // convoy configured for 3 seals per truck.
  const sealPositions = Array.from(new Set(
    truckPhotos.filter(p => p.photo_type === 'seal').map(p => String(p.seal_position))
  )).sort();
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

  sectionHead(ctx, `Truck ${truck.position} -- ${truck.driver_name || 'Unknown Driver'}`);

  detailGrid(doc, [
    { label: 'Plate / Reg', value: truck.plate_number || '--' },
    { label: 'Driver Phone', value: truck.driver_phone || '--' },
    { label: 'License No', value: truck.driver_license_no || '--' },
    { label: 'Photos', value: `${receivedTotal} / ${expectedTotal}` },
  ]);

  if (sealPositions.length > 0) {
    doc.fill(C.light).fontSize(6.5).font('Helvetica');
    t(doc, `SEAL CODES: ${sealPositions.join(', ')}`, M, doc.y, { width: CW });
    doc.y += 14;
  }

  ['sod', 'eod'].forEach(session => {
    const label = session === 'sod' ? 'Start of Day (SOD)' : 'End of Day (EOD)';
    ensureSpace(ctx, 50 + (2 + sealPositions.length) * 15);
    sectionHead(ctx, label);

    const sp = truckPhotos.filter(p => p.session === session);
    const types = [
      { typeLabel: 'Front', photoType: 'front', sealPos: null },
      { typeLabel: 'Rear', photoType: 'rear', sealPos: null },
      ...sealPositions.map(pos => ({ typeLabel: 'Seal', photoType: 'seal', sealPos: pos })),
    ];

    const cols = [M, M + 85, M + 165, M + 280, M + 380];
    const colW = [81, 76, 111, 96, 90];
    tableHeader(doc, cols, colW, ['Photo Type', 'Seal Code', 'Uploaded At', 'Location', 'Status']);

    let y = doc.y;
    types.forEach((row, idx) => {
      if (y + 15 > BODY_BOTTOM) { newPage(ctx); y = ctx.doc.y; }
      const match = row.sealPos != null
        ? sp.find(p => p.photo_type === 'seal' && String(p.seal_position) === row.sealPos)
        : sp.find(p => p.photo_type === row.photoType);

      if (idx % 2 === 0) doc.rect(M, y, CW, 15).fill(C.stripe);

      const uploaded = match?.uploaded_at
        ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '--';
      const loc = match ? (match.location_mismatch ? 'MISMATCH' : 'OK') : '--';
      const status = match ? 'Present' : 'MISSING';

      doc.fill(match ? C.sub : C.red).fontSize(7.5).font(match ? 'Helvetica' : 'Helvetica-Bold');
      t(doc, row.typeLabel, M + 3, y + 4, { width: 81 });
      doc.fill(C.muted).font('Helvetica');
      t(doc, row.sealPos || '--', cols[1] + 3, y + 4, { width: 76 });
      t(doc, uploaded, cols[2] + 3, y + 4, { width: 111 });
      doc.fill(match?.location_mismatch ? C.amber : C.light);
      t(doc, loc, cols[3] + 3, y + 4, { width: 96 });
      doc.fill(match ? C.green : C.red).font('Helvetica-Bold');
      t(doc, status, cols[4] + 3, y + 4, { width: 90 });
      y += 15;
    });
    doc.y = y + 6;
  });
}

function cfoPhotosTable(ctx, cfoPhotos) {
  if (!cfoPhotos.length) return;
  newPage(ctx);
  sectionHead(ctx, `CFO App Photos (${cfoPhotos.length} uploaded)`);
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

function summarySection(ctx, received, required, mismatchCount) {
  ensureSpace(ctx, 100);
  sectionHead(ctx, 'Summary & Certification');
  const doc = ctx.doc;

  const pct = required > 0 ? Math.round((received / required) * 100) : 0;
  const halfW = CW / 2 - 4;
  const y = doc.y;

  doc.save().rect(M, y, halfW, 40).lineWidth(0.5).fillAndStroke(C.stripe, C.border).restore();
  doc.fill(C.light).fontSize(6).font('Helvetica');
  t(doc, 'TOTAL PHOTOS RECEIVED VS REQUIRED', M + 8, y + 5, { width: halfW - 16 });
  doc.fill(C.text).fontSize(14).font('Helvetica-Bold');
  t(doc, `${received} / ${required}`, M + 8, y + 18, { width: halfW - 16 });

  doc.save().rect(M + halfW + 8, y, halfW, 40).lineWidth(0.5).fillAndStroke(C.stripe, C.border).restore();
  doc.fill(C.light).fontSize(6).font('Helvetica');
  t(doc, 'LOCATION ANOMALIES', M + halfW + 16, y + 5, { width: halfW - 16 });
  doc.fill(mismatchCount > 0 ? C.red : C.green).fontSize(14).font('Helvetica-Bold');
  t(doc, String(mismatchCount), M + halfW + 16, y + 18, { width: halfW - 16 });

  doc.y = y + 48;
  progressBar(doc, received, required);

  doc.y += 16;
  const sigY = doc.y, sigW = CW / 3 - 8;
  ['Dispatcher Signature', 'CFO Lead Signature', 'Date'].forEach((label, i) => {
    const sx = M + i * (sigW + 12);
    doc.save().moveTo(sx, sigY + 22).lineTo(sx + sigW, sigY + 22).lineWidth(0.5).strokeColor(C.sub).stroke().restore();
    doc.fill(C.light).fontSize(6.5).font('Helvetica');
    t(doc, label, sx, sigY + 26, { width: sigW });
  });
  doc.y = sigY + 40;
}

async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate, cfoPhotos = []) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const pct = report.required_photo_count > 0
    ? Math.round((report.received_photo_count / report.required_photo_count) * 100) : 0;
  const mismatchCount = photos.filter(p => p.location_mismatch).length;

  const ctx = { doc: null, pageNum: 0, generatedAt,
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · ${reportDate}` };
  return makePdf(doc => {
    ctx.doc = doc;
    newPage(ctx);
    sectionHead(ctx, 'A -- Convoy Details');
    detailGrid(doc, [
      { label: 'Status', value: (convoy.status || '').toUpperCase() || '--' },
      { label: 'Start Date', value: convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--' },
      { label: 'End Date', value: convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--' },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Trucks', value: String(trucks.length) },
      { label: 'Seals / Truck', value: String(convoy.seal_count_per_truck ?? '--') },
      { label: 'Photos Received', value: `${report.received_photo_count}/${report.required_photo_count}` },
      { label: 'Completeness', value: `${pct}%` },
    ]);

    doc.fill(C.muted).fontSize(7).font('Helvetica');
    const statusIcon = report.status === 'generated' ? '[OK]' : report.status === 'partial' ? '[!!]' : '[..]';
    t(doc, `${statusIcon} Report status: ${(report.status || '').toUpperCase()} ${report.generated_at ? '-- Generated ' + new Date(report.generated_at).toISOString().replace('T',' ').slice(0,16) : ''}`,
      M, doc.y, { width: CW });
    doc.y += 14;

    sectionHead(ctx, 'B -- Photo Completion');
    progressBar(doc, report.received_photo_count, report.required_photo_count);

    if (cfos.length) {
      sectionHead(ctx, 'C -- Field Officers');
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

    newPage(ctx);
    sectionHead(ctx, 'D -- Photo Status Matrix');
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
      truckDetail(ctx, truck, photos.filter(p => p.convoy_truck_id === truck.id), sealCountPerTruck);
    });

    cfoPhotosTable(ctx, cfoPhotos);

    ensureSpace(ctx, 120);
    summarySection(ctx, report.received_photo_count, report.required_photo_count, mismatchCount);
  });
}

async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const totalReq = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
  const totalRecv = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
  const overallPct = totalReq > 0 ? Math.round((totalRecv / totalReq) * 100) : 0;
  const sealCount = convoy.seal_count_per_truck ?? 3;
  const perTruckRequired = (2 + sealCount) * 2;

  const ctx = { doc: null, pageNum: 0, generatedAt,
    title: convoy.name || 'Convoy Report', subtitle: `${convoy.name || 'Convoy'} · Archive Report` };
  return makePdf(doc => {
    ctx.doc = doc;
    newPage(ctx);
    sectionHead(ctx, 'A -- Archive Summary');
    detailGrid(doc, [
      { label: 'Convoy', value: convoy.name || '--' },
      { label: 'Status', value: (convoy.status || '').toUpperCase() || '--' },
      { label: 'Region', value: convoy.region || '--' },
      { label: 'Timezone', value: convoy.timezone || 'UTC' },
      { label: 'Start Date', value: convoy.start_date ? String(convoy.start_date).slice(0, 10) : '--' },
      { label: 'End Date', value: convoy.end_date ? String(convoy.end_date).slice(0, 10) : '--' },
      { label: 'Trucks', value: String(trucks.length) },
      { label: 'CFOs', value: String(cfos.length) },
      { label: 'Seals / Truck', value: String(sealCount) },
      { label: 'Report Days', value: String(reports.length) },
      { label: 'Photos Required', value: String(totalReq) },
      { label: 'Photos Received', value: String(totalRecv) },
    ]);
    sectionHead(ctx, `B -- Overall Completion (${overallPct}%)`);
    progressBar(doc, totalRecv, totalReq);

    sectionHead(ctx, 'C -- Daily Summary');
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
      sectionHead(ctx, 'D -- Per-Day Truck Photo Counts');
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
