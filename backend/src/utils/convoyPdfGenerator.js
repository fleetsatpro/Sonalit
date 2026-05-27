/**
 * PDF generator for CFO daily and archive reports.
 * Uses pdfkit with enhanced layout: cover page, photo matrix, mismatch section.
 */
const PDFDocument = require('pdfkit');

const C = {
  dark: '#0d1426',
  navy: '#1a2a4a',
  accent: '#f07020',
  accent2: '#ff9040',
  green: '#16a34a',
  greenBg: '#dcfce7',
  greenBorder: '#86efac',
  red: '#dc2626',
  redBg: '#fee2e2',
  redBorder: '#fca5a5',
  amber: '#d97706',
  amberBg: '#fef3c7',
  muted: '#64748b',
  light: '#f8fafc',
  stripe: '#f1f5f9',
  text: '#1e293b',
  white: 'white',
};

const PW = 595.28;
const PH = 841.89;
const M = 40;
const CW = PW - M * 2;

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

function addPage(doc) {
  doc.addPage();
  doc.y = M;
}

function pageHeader(doc, convoy, reportDate) {
  doc.rect(0, 0, PW, 52).fill(C.dark);
  doc.rect(0, 52, PW, 3).fill(C.accent);
  doc.fill(C.white).fontSize(15).font('Helvetica-Bold')
    .text(convoy.name, M, 12, { width: CW - 90 });
  doc.fill(C.accent2).fontSize(9).font('Helvetica')
    .text(reportDate ? `Daily Report — ${reportDate}` : 'Archive Report', M, 32, { width: CW - 90 });
  doc.fill(C.muted).fontSize(8)
    .text('SONALIT', PW - 90, 20, { width: 80, align: 'right' });
  doc.y = 68;
}

function pageFooter(doc, pageNum, generatedAt) {
  const fy = PH - 24;
  doc.rect(0, fy, PW, 24).fill(C.dark);
  doc.fill(C.muted).fontSize(7).font('Helvetica')
    .text(`Generated ${generatedAt}`, M, fy + 7)
    .text(`Page ${pageNum}`, 0, fy + 7, { width: PW - M, align: 'right' });
}

function sectionTitle(doc, text) {
  if (doc.y > PH - 160) return false;
  doc.moveDown(0.5);
  doc.rect(M, doc.y, CW, 20).fill(C.navy);
  doc.fill(C.white).fontSize(9).font('Helvetica-Bold')
    .text(text.toUpperCase(), M + 6, doc.y - 14, { width: CW - 12 });
  doc.fill(C.text).y = doc.y + 8;
  return true;
}

function kv2col(doc, rows) {
  const lw = 145, vw = 105;
  const cols = [M, M + lw, M + CW / 2, M + CW / 2 + lw];
  const rh = 17;
  let y = doc.y;
  for (let i = 0; i < rows.length; i += 2) {
    if (i % 4 === 0) doc.rect(M, y, CW, rh).fill(C.stripe);
    doc.fill(C.muted).fontSize(8).font('Helvetica').text(rows[i][0], cols[0] + 3, y + 4, { width: lw });
    doc.fill(C.text).font('Helvetica-Bold').text(String(rows[i][1] ?? '—'), cols[1], y + 4, { width: vw });
    if (rows[i + 1]) {
      doc.fill(C.muted).font('Helvetica').text(rows[i + 1][0], cols[2] + 3, y + 4, { width: lw });
      doc.fill(C.text).font('Helvetica-Bold').text(String(rows[i + 1][1] ?? '—'), cols[3], y + 4, { width: vw });
    }
    y += rh;
  }
  doc.y = y + 4;
}

function completionBar(doc, received, required) {
  const pct = required > 0 ? Math.min(1, received / required) : 0;
  const barW = CW;
  const barH = 12;
  const y = doc.y;
  doc.rect(M, y, barW, barH).fill(C.redBg).stroke(C.redBorder);
  if (pct > 0) {
    const fillColor = pct >= 1 ? C.green : C.amber;
    doc.rect(M, y, barW * pct, barH).fill(fillColor);
  }
  const label = `${received} / ${required} photos  (${Math.round(pct * 100)}%)`;
  doc.fill(pct >= 0.5 ? C.white : C.text).fontSize(8).font('Helvetica-Bold')
    .text(label, M, y + 2, { width: barW, align: 'center' });
  doc.y = y + barH + 6;
}

function photoMatrix(doc, trucks, sealCount) {
  const sessions = ['sod', 'eod'];
  const slotW = 30;
  const slotH = 22;
  const labelW = 100;
  const sessionW = (2 + sealCount) * (slotW + 2);
  const rowH = slotH + 4;

  // Column header row
  const headerY = doc.y;
  doc.fill(C.muted).fontSize(7).font('Helvetica')
    .text('Truck / Driver', M, headerY + 4, { width: labelW });

  let x = M + labelW + 8;
  sessions.forEach(session => {
    doc.rect(x, headerY, sessionW, 14).fill(C.navy);
    doc.fill(C.white).fontSize(7).font('Helvetica-Bold')
      .text(session.toUpperCase(), x, headerY + 3, { width: sessionW, align: 'center' });
    x += sessionW + 10;
  });
  doc.y = headerY + 16;

  // Slot type header
  const typeHeaderY = doc.y;
  doc.fill(C.muted).fontSize(6).font('Helvetica').text('', M, typeHeaderY);
  x = M + labelW + 8;
  sessions.forEach(() => {
    ['FR', 'RR', ...Array.from({ length: sealCount }, (_, i) => `S${i + 1}`)].forEach((label, idx) => {
      doc.fill(C.muted).fontSize(6).font('Helvetica')
        .text(label, x + idx * (slotW + 2), typeHeaderY + 2, { width: slotW, align: 'center' });
    });
    x += sessionW + 10;
  });
  doc.y = typeHeaderY + 12;

  trucks.forEach((truck, ti) => {
    if (doc.y + rowH > PH - 60) return;
    const rowY = doc.y;
    if (ti % 2 === 0) doc.rect(M, rowY, CW, rowH).fill(C.stripe);

    doc.fill(C.text).fontSize(8).font('Helvetica-Bold')
      .text(`T${truck.position}`, M + 2, rowY + 4, { width: 18 });
    doc.font('Helvetica').fontSize(7).fill(C.muted)
      .text(truck.driver_name, M + 22, rowY + 4, { width: labelW - 24 })
      .text(truck.vehicle_id || '—', M + 22, rowY + 12, { width: labelW - 24 });

    x = M + labelW + 8;
    sessions.forEach(session => {
      const sData = truck[session] || { front: false, rear: false, seals: [] };
      const slots = [
        { label: 'FR', present: sData.front },
        { label: 'RR', present: sData.rear },
        ...sData.seals.map((s, i) => ({ label: `S${i + 1}`, present: s })),
      ];
      slots.forEach((slot, idx) => {
        const sx = x + idx * (slotW + 2);
        doc.rect(sx, rowY + 1, slotW, slotH)
          .fill(slot.present ? C.greenBg : C.redBg)
          .stroke(slot.present ? C.greenBorder : C.redBorder);
        doc.fill(slot.present ? C.green : C.red).fontSize(9).font('Helvetica-Bold')
          .text(slot.present ? '✓' : '✗', sx, rowY + 7, { width: slotW, align: 'center' });
      });
      x += sessionW + 10;
    });
    doc.y = rowY + rowH;
  });
  doc.moveDown(0.5);
}

function mismatchSection(doc, photos) {
  const mismatches = photos.filter(p => p.location_mismatch);
  if (!mismatches.length) return;
  if (!sectionTitle(doc, `⚠ Location Mismatches (${mismatches.length})`)) return;

  const cols = [M, M + 90, M + 190, M + 260, M + 360];
  const colW = [86, 96, 66, 96, 90];
  const headers = ['Truck ID', 'Photo Type', 'Session', 'Uploaded At', 'Notes'];
  const rh = 16;

  doc.rect(M, doc.y, CW, rh).fill(C.amber);
  headers.forEach((h, i) => {
    doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold')
      .text(h, cols[i] + 2, doc.y - rh + 4, { width: colW[i] });
  });
  doc.y += 2;

  mismatches.forEach((p, i) => {
    if (doc.y + rh > PH - 60) return;
    if (i % 2 === 0) doc.rect(M, doc.y, CW, rh).fill(C.amberBg);
    const vals = [
      String(p.convoy_truck_id).slice(-8),
      `${p.photo_type}${p.seal_position != null ? ` pos:${p.seal_position}` : ''}`,
      p.session?.toUpperCase(),
      p.uploaded_at ? new Date(p.uploaded_at).toISOString().slice(0, 16).replace('T', ' ') : '—',
      'GPS mismatch >2km',
    ];
    vals.forEach((v, j) => {
      doc.fill(C.text).fontSize(7.5).font('Helvetica')
        .text(String(v ?? '—'), cols[j] + 2, doc.y + 4, { width: colW[j] });
    });
    doc.y += rh;
  });
  doc.moveDown(0.4);
}

/**
 * Generate a daily report PDF for one convoy+date.
 */
async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const sealCount = convoy.seal_count_per_truck ?? 3;
  const completePct = report.required_photo_count > 0
    ? Math.round((report.received_photo_count / report.required_photo_count) * 100) : 0;
  let pageNum = 0;

  return makePdf(doc => {
    // ── Page 1: Summary ──────────────────────────────────────────────────────
    addPage(doc);
    pageNum++;
    pageHeader(doc, convoy, reportDate);
    pageFooter(doc, pageNum, generatedAt);

    sectionTitle(doc, 'Convoy Summary');
    kv2col(doc, [
      ['Convoy ID', convoy.id?.slice(-12)],
      ['Status', convoy.status?.toUpperCase()],
      ['Timezone', convoy.timezone],
      ['Region', convoy.region],
      ['Route Origin', convoy.route_origin],
      ['Route Destination', convoy.route_destination],
      ['Start Date', convoy.start_date ? String(convoy.start_date).slice(0, 10) : '—'],
      ['End Date', convoy.end_date ? String(convoy.end_date).slice(0, 10) : '—'],
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Seal Count / Truck', sealCount],
      ['Report Date', reportDate],
    ]);

    doc.moveDown(0.4);
    sectionTitle(doc, `Photo Completion — ${completePct}%`);
    completionBar(doc, report.received_photo_count, report.required_photo_count);

    if (cfos.length) {
      sectionTitle(doc, 'Field Officers');
      cfos.forEach((c, i) => {
        if (i % 2 === 0) doc.rect(M, doc.y, CW, 16).fill(C.stripe);
        doc.fill(C.text).fontSize(8.5).font('Helvetica')
          .text(`${c.cfo_name || c.cfo_user_id}`, M + 4, doc.y + 4, { width: CW / 2 - 8 });
        doc.fill(C.muted).fontSize(8)
          .text(c.cfo_email || '', M + CW / 2, doc.y - 8, { width: CW / 2 });
        doc.y += 16;
      });
      doc.moveDown(0.3);
    }

    // ── Page 2: Photo Matrix ─────────────────────────────────────────────────
    addPage(doc);
    pageNum++;
    pageHeader(doc, convoy, reportDate);
    pageFooter(doc, pageNum, generatedAt);

    sectionTitle(doc, 'Photo Status Matrix');

    // Build per-truck session data
    const truckMatrix = trucks.map(truck => {
      const tp = photos.filter(p => p.convoy_truck_id === truck.id);
      return {
        ...truck,
        sod: {
          front: tp.some(p => p.session === 'sod' && p.photo_type === 'front'),
          rear: tp.some(p => p.session === 'sod' && p.photo_type === 'rear'),
          seals: Array.from({ length: sealCount }, (_, i) =>
            tp.some(p => p.session === 'sod' && p.photo_type === 'seal' && String(p.seal_position) === String(i + 1))
          ),
        },
        eod: {
          front: tp.some(p => p.session === 'eod' && p.photo_type === 'front'),
          rear: tp.some(p => p.session === 'eod' && p.photo_type === 'rear'),
          seals: Array.from({ length: sealCount }, (_, i) =>
            tp.some(p => p.session === 'eod' && p.photo_type === 'seal' && String(p.seal_position) === String(i + 1))
          ),
        },
        total_photos: tp.length,
        required_photos: (2 + sealCount) * 2,
      };
    });

    photoMatrix(doc, truckMatrix, sealCount);
    mismatchSection(doc, photos);

    // ── Per-truck detail pages ───────────────────────────────────────────────
    trucks.forEach((truck, ti) => {
      const truckPhotos = photos.filter(p => p.convoy_truck_id === truck.id);
      addPage(doc);
      pageNum++;
      pageHeader(doc, convoy, reportDate);
      pageFooter(doc, pageNum, generatedAt);

      sectionTitle(doc, `Truck ${truck.position} — ${truck.driver_name}`);
      kv2col(doc, [
        ['Vehicle ID', truck.vehicle_id || '—'],
        ['Driver Phone', truck.driver_phone || '—'],
        ['License No.', truck.driver_license_no || '—'],
        ['Photos Today', `${truckPhotos.length} / ${(2 + sealCount) * 2}`],
      ]);

      ['sod', 'eod'].forEach(session => {
        const label = session === 'sod' ? 'Start of Day (SOD)' : 'End of Day (EOD)';
        doc.moveDown(0.3);
        if (!sectionTitle(doc, label)) return;

        const sessionPhotos = truckPhotos.filter(p => p.session === session);
        const types = ['front', 'rear', ...Array.from({ length: sealCount }, (_, i) => `seal-${i + 1}`)];
        const rh = 16;

        // Table header
        const hdrCols = [M, M + 110, M + 210, M + 330, M + 430];
        const hdrW = [106, 96, 116, 96, 80];
        doc.rect(M, doc.y, CW, rh).fill(C.navy);
        ['Photo Type', 'Seal Pos', 'Uploaded At', 'Location', 'Status'].forEach((h, i) => {
          doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold')
            .text(h, hdrCols[i] + 2, doc.y - rh + 4, { width: hdrW[i] });
        });
        doc.y += 2;

        types.forEach((ptype, idx) => {
          if (doc.y + rh > PH - 60) return;
          const isSeal = ptype.startsWith('seal');
          const sealPos = isSeal ? String(idx - 1) : null;
          const match = sessionPhotos.find(p => {
            if (!isSeal) return p.photo_type === ptype;
            return p.photo_type === 'seal' && String(p.seal_position) === String(idx - 1);
          });

          if (idx % 2 === 0) doc.rect(M, doc.y, CW, rh).fill(C.stripe);
          const rowY = doc.y;

          const label = isSeal ? `Seal (position ${idx - 1})` : ptype.charAt(0).toUpperCase() + ptype.slice(1);
          const uploadedAt = match ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '—';
          const locStatus = match ? (match.location_mismatch ? '⚠ Mismatch' : '✓ OK') : '—';
          const status = match ? 'Present' : 'MISSING';

          doc.fill(match ? C.text : C.red).fontSize(8).font(match ? 'Helvetica' : 'Helvetica-Bold')
            .text(label, M + 2, rowY + 4, { width: 106 });
          doc.fill(C.muted).font('Helvetica')
            .text(sealPos || '—', hdrCols[1] + 2, rowY + 4, { width: 96 })
            .text(uploadedAt, hdrCols[2] + 2, rowY + 4, { width: 116 });
          doc.fill(match?.location_mismatch ? C.amber : C.muted)
            .text(locStatus, hdrCols[3] + 2, rowY + 4, { width: 96 });
          doc.fill(match ? C.green : C.red).font('Helvetica-Bold')
            .text(status, hdrCols[4] + 2, rowY + 4, { width: 80 });
          doc.y = rowY + rh;
        });
      });
    });
  });
}

/**
 * Generate a full convoy archive PDF covering all days.
 */
async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos) {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const totalRequired = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
  const totalReceived = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
  const overallPct = totalRequired > 0 ? Math.round((totalReceived / totalRequired) * 100) : 0;
  let pageNum = 0;

  return makePdf(doc => {
    addPage(doc);
    pageNum++;
    pageHeader(doc, convoy, null);
    pageFooter(doc, pageNum, generatedAt);

    sectionTitle(doc, 'Full Archive Report');
    kv2col(doc, [
      ['Convoy ID', convoy.id?.slice(-12)],
      ['Status', convoy.status?.toUpperCase()],
      ['Region', convoy.region],
      ['Timezone', convoy.timezone],
      ['Start Date', convoy.start_date ? String(convoy.start_date).slice(0, 10) : '—'],
      ['End Date', convoy.end_date ? String(convoy.end_date).slice(0, 10) : '—'],
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Seal Count / Truck', convoy.seal_count_per_truck ?? 3],
      ['Report Days', reports.length],
      ['Total Photos Required', totalRequired],
      ['Total Photos Received', totalReceived],
    ]);

    doc.moveDown(0.4);
    sectionTitle(doc, `Overall Completion — ${overallPct}%`);
    completionBar(doc, totalReceived, totalRequired);

    sectionTitle(doc, 'Daily Summary');
    const rh = 17;
    const hdrCols = [M, M + 90, M + 185, M + 280, M + 350, M + 440];
    const hdrW = [86, 91, 91, 66, 86, 70];
    const hdrs = ['Date', 'Status', 'Photos', 'Mismatches', 'PDF', 'Generated'];
    doc.rect(M, doc.y, CW, rh).fill(C.navy);
    hdrs.forEach((h, i) => {
      doc.fill(C.white).fontSize(7.5).font('Helvetica-Bold')
        .text(h, hdrCols[i] + 2, doc.y - rh + 4, { width: hdrW[i] });
    });
    doc.y += 2;

    reports.forEach((r, i) => {
      if (doc.y + rh > PH - 60) {
        addPage(doc);
        pageNum++;
        pageHeader(doc, convoy, null);
        pageFooter(doc, pageNum, generatedAt);
      }
      if (i % 2 === 0) doc.rect(M, doc.y, CW, rh).fill(C.stripe);
      const rowY = doc.y;
      const dateStr = String(r.report_date).slice(0, 10);
      const pct = r.required_photo_count > 0
        ? `${r.received_photo_count}/${r.required_photo_count} (${Math.round(r.received_photo_count / r.required_photo_count * 100)}%)`
        : '—';
      const dayMismatches = allPhotos.filter(p =>
        String(p.report_date).slice(0, 10) === dateStr && p.location_mismatch
      ).length;
      const genAt = r.generated_at ? new Date(r.generated_at).toISOString().slice(0, 10) : '—';
      const vals = [
        dateStr,
        r.status?.toUpperCase(),
        pct,
        dayMismatches > 0 ? `⚠ ${dayMismatches}` : '0',
        r.pdf_url ? '✓' : '✗',
        genAt,
      ];
      vals.forEach((v, j) => {
        const color = j === 1 ? (r.status === 'generated' ? C.green : C.amber)
          : j === 3 && dayMismatches > 0 ? C.amber
          : C.text;
        doc.fill(color).fontSize(8).font(j === 1 ? 'Helvetica-Bold' : 'Helvetica')
          .text(String(v), hdrCols[j] + 2, rowY + 4, { width: hdrW[j] });
      });
      doc.y = rowY + rh;
    });

    // Per-day truck breakdown
    if (reports.length > 0) {
      addPage(doc);
      pageNum++;
      pageHeader(doc, convoy, null);
      pageFooter(doc, pageNum, generatedAt);

      sectionTitle(doc, 'Per-Day Truck Photo Counts');
      const sealCount = convoy.seal_count_per_truck ?? 3;
      const required = (2 + sealCount) * 2;

      reports.slice(0, 15).forEach(report => {
        if (doc.y + 20 + trucks.length * 14 > PH - 60) {
          addPage(doc);
          pageNum++;
          pageHeader(doc, convoy, null);
          pageFooter(doc, pageNum, generatedAt);
        }
        const dateStr = String(report.report_date).slice(0, 10);
        const dayPhotos = allPhotos.filter(p => String(p.report_date).slice(0, 10) === dateStr);
        doc.moveDown(0.3);
        doc.rect(M, doc.y, CW, 14).fill(C.navy);
        doc.fill(C.white).fontSize(8).font('Helvetica-Bold')
          .text(dateStr, M + 4, doc.y - 9, { width: 100 })
          .text(`${report.status?.toUpperCase()} — ${report.received_photo_count}/${report.required_photo_count}`, M + 110, doc.y - 9, { width: 200 });
        doc.y += 4;
        trucks.forEach((truck, ti) => {
          const tp = dayPhotos.filter(p => p.convoy_truck_id === truck.id).length;
          if (ti % 2 === 0) doc.rect(M, doc.y, CW, 13).fill(C.stripe);
          const rowY = doc.y;
          const pct = required > 0 ? Math.round(tp / required * 100) : 0;
          const barW = Math.min(CW - 230, CW * 0.4 * (tp / required));
          doc.fill(C.text).fontSize(7.5).font('Helvetica-Bold')
            .text(`T${truck.position}`, M + 2, rowY + 3, { width: 20 });
          doc.font('Helvetica').fill(C.muted)
            .text(truck.driver_name, M + 24, rowY + 3, { width: 130 });
          doc.rect(M + 158, rowY + 2, CW * 0.4, 9).fill(C.redBg).stroke(C.redBorder);
          if (barW > 0) {
            doc.rect(M + 158, rowY + 2, barW, 9).fill(pct >= 100 ? C.green : C.amber);
          }
          doc.fill(pct >= 100 ? C.green : C.text).fontSize(7.5).font('Helvetica-Bold')
            .text(`${tp}/${required}`, M + 158 + CW * 0.4 + 4, rowY + 3, { width: 50 });
          doc.y = rowY + 13;
        });
      });
    }
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
