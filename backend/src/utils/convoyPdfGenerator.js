/**
 * PDF generator for CFO daily and archive reports.
 * Uses pdfkit — streaming collected into a Buffer before returning.
 */
const PDFDocument = require('pdfkit');

const BRAND = '#1a3a5c';
const LIGHT = '#f0f4f8';

function makePdf(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 70).fill(BRAND);
  doc.fill('white').fontSize(18).font('Helvetica-Bold').text(title, 40, 22, { width: doc.page.width - 80 });
  doc.fontSize(10).font('Helvetica').text(subtitle, 40, 46, { width: doc.page.width - 80 });
  doc.fill('black').moveDown(4);
}

function sectionTitle(doc, text) {
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND).text(text);
  doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor(BRAND).stroke();
  doc.fillColor('black').moveDown(0.3);
}

function summaryTable(doc, rows) {
  const COL = [40, 200];
  doc.fontSize(9).font('Helvetica');
  let y = doc.y;
  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.rect(COL[0], y, doc.page.width - 80, 16).fill(LIGHT).stroke(LIGHT);
    }
    doc.fill('#444').text(label, COL[0] + 4, y + 3, { width: 150 });
    doc.fill('black').text(String(value ?? '—'), COL[1], y + 3, { width: 300 });
    y += 18;
  });
  doc.y = y + 4;
}

function photoTable(doc, session, photos, sealCount) {
  const TYPES = ['front', 'rear', ...Array.from({ length: sealCount }, (_, i) => `seal (pos ${i + 1})`)];
  const COL_W = [100, 80, 160, 90];
  const COLS = [40, 140, 220, 380];
  const ROW_H = 16;

  doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND);
  doc.rect(40, doc.y, doc.page.width - 80, ROW_H).fill(BRAND);
  doc.fill('white');
  ['Photo Type', 'Seal Pos', 'Uploaded At', 'Loc OK'].forEach((h, i) =>
    doc.text(h, COLS[i] + 2, doc.y - ROW_H + 3, { width: COL_W[i] })
  );
  doc.fill('black').moveDown(0.1);

  TYPES.forEach((ptype, idx) => {
    const isSeal = ptype.startsWith('seal');
    const sealPos = isSeal ? String(idx - 1) : null; // position offset within seals
    const match = photos.find((p) => {
      if (p.session !== session) return false;
      if (!isSeal) return p.photo_type === ptype;
      return p.photo_type === 'seal' && String(p.seal_position) === String(idx - 1);
    });

    const rowY = doc.y;
    if (idx % 2 === 0) doc.rect(40, rowY, doc.page.width - 80, ROW_H).fill(LIGHT).stroke(LIGHT);

    const uploadedAt = match ? new Date(match.uploaded_at).toISOString().replace('T', ' ').slice(0, 16) : '—';
    const locOk = match ? (match.location_mismatch ? '⚠ mismatch' : '✓') : '—';

    doc.fill(match ? 'black' : '#cc0000').font('Helvetica');
    doc.text(ptype, COLS[0] + 2, rowY + 3, { width: COL_W[0] });
    doc.text(sealPos || '—', COLS[1] + 2, rowY + 3, { width: COL_W[1] });
    doc.text(uploadedAt, COLS[2] + 2, rowY + 3, { width: COL_W[2] });
    doc.text(locOk, COLS[3] + 2, rowY + 3, { width: COL_W[3] });
    doc.fill('black').y = rowY + ROW_H;
  });

  doc.moveDown(0.5);
}

/**
 * Generate a daily report PDF for one convoy+date.
 * @param {Object} convoy   - convoy row (id, name, seal_count_per_truck, timezone, ...)
 * @param {Array}  trucks   - convoy_trucks rows for this convoy
 * @param {Array}  cfos     - convoy_cfos rows joined with user name/email
 * @param {Array}  photos   - convoy_truck_photos rows for this report_date
 * @param {Object} report   - convoy_daily_reports row (status, required, received)
 * @param {string} reportDate - YYYY-MM-DD
 * @returns {Promise<Buffer>}
 */
async function generateDailyReport(convoy, trucks, cfos, photos, report, reportDate) {
  return makePdf((doc) => {
    const sealCount = convoy.seal_count_per_truck ?? 3;
    const completePct = report.required_photo_count > 0
      ? Math.round((report.received_photo_count / report.required_photo_count) * 100)
      : 0;

    header(doc, `${convoy.name} — Daily Report`, `Date: ${reportDate}  |  Status: ${report.status}  |  Completion: ${completePct}%`);

    sectionTitle(doc, 'Convoy Summary');
    summaryTable(doc, [
      ['Convoy ID', convoy.id],
      ['Status', convoy.status],
      ['Timezone', convoy.timezone],
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Photos Required', report.required_photo_count],
      ['Photos Received', report.received_photo_count],
      ['Seal Count / Truck', sealCount],
    ]);

    sectionTitle(doc, 'Field Officers');
    cfos.forEach((c) => {
      doc.fontSize(9).font('Helvetica').text(`• ${c.cfo_name || c.cfo_user_id} <${c.cfo_email || ''}>`);
    });

    trucks.forEach((truck) => {
      const truckPhotos = photos.filter((p) => p.convoy_truck_id === truck.id);

      if (doc.y > doc.page.height - 160) doc.addPage();
      sectionTitle(doc, `Truck ${truck.position} — ${truck.driver_name}`);
      summaryTable(doc, [
        ['Vehicle ID', truck.vehicle_id],
        ['Driver Phone', truck.driver_phone || '—'],
        ['License No.', truck.driver_license_no || '—'],
        ['Photos Today', truckPhotos.length],
      ]);

      ['sod', 'eod'].forEach((session) => {
        doc.fontSize(10).font('Helvetica-Bold').text(`  ${session.toUpperCase()} Session`).moveDown(0.2);
        photoTable(doc, session, truckPhotos, sealCount);
      });
    });

    doc.fontSize(8).fill('#888')
      .text(`Generated at ${new Date().toISOString()}`, 40, doc.page.height - 30, { align: 'center' });
  });
}

/**
 * Generate a full convoy archive PDF covering all days.
 * @param {Object} convoy
 * @param {Array}  trucks
 * @param {Array}  cfos
 * @param {Array}  reports  - convoy_daily_reports rows ordered by date
 * @param {Array}  allPhotos - all convoy_truck_photos for this convoy
 * @returns {Promise<Buffer>}
 */
async function generateArchiveReport(convoy, trucks, cfos, reports, allPhotos) {
  return makePdf((doc) => {
    header(doc, `${convoy.name} — Full Archive Report`,
      `Convoy ID: ${convoy.id}  |  ${convoy.start_date || '?'} → ${convoy.end_date || '?'}  |  Status: ${convoy.status}`);

    sectionTitle(doc, 'Convoy Overview');
    const totalRequired = reports.reduce((s, r) => s + (r.required_photo_count || 0), 0);
    const totalReceived = reports.reduce((s, r) => s + (r.received_photo_count || 0), 0);
    summaryTable(doc, [
      ['Trucks', trucks.length],
      ['CFOs Assigned', cfos.length],
      ['Seal Count / Truck', convoy.seal_count_per_truck ?? 3],
      ['Report Days', reports.length],
      ['Total Photos Required', totalRequired],
      ['Total Photos Received', totalReceived],
      ['Overall Completion', totalRequired > 0 ? `${Math.round((totalReceived / totalRequired) * 100)}%` : '—'],
    ]);

    reports.forEach((report) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const dayPhotos = allPhotos.filter((p) => p.report_date === report.report_date || String(p.report_date).slice(0, 10) === report.report_date);
      sectionTitle(doc, `Day: ${report.report_date}  (${report.status}  ${report.received_photo_count}/${report.required_photo_count})`);

      trucks.forEach((truck) => {
        const truckPhotos = dayPhotos.filter((p) => p.convoy_truck_id === truck.id);
        doc.fontSize(9).font('Helvetica-Bold').text(`  Truck ${truck.position} — ${truck.driver_name}: ${truckPhotos.length} photos`);
      });
    });

    doc.fontSize(8).fill('#888')
      .text(`Generated at ${new Date().toISOString()}`, 40, doc.page.height - 30, { align: 'center' });
  });
}

module.exports = { generateDailyReport, generateArchiveReport };
