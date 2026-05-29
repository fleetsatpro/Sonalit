/**
 * Generates a custody chain PDF for a convoy portal view.
 * Uses pdfkit consistent with convoyPdfGenerator.js patterns.
 */
const PDFDocument = require('pdfkit');

const C = {
  dark: '#0d1426',
  navy: '#1a2a4a',
  accent: '#f07020',
  accent2: '#ff9040',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#d97706',
  muted: '#64748b',
  text: '#1e293b',
  white: 'white',
  stripe: '#f1f5f9',
};

const PW = 595.28;
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

function fmtDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
}

function coverPage(doc, convoy) {
  doc.addPage();
  doc.rect(0, 0, PW, 80).fill(C.dark);
  doc.rect(0, 80, PW, 3).fill(C.accent);

  doc.fill(C.white).fontSize(20).font('Helvetica-Bold')
    .text('CUSTODY CHAIN REPORT', M, 20, { width: CW });
  doc.fill(C.accent2).fontSize(11).font('Helvetica')
    .text(`Convoy: ${convoy.reference}`, M, 46, { width: CW });
  doc.fill(C.muted).fontSize(9)
    .text('SONALIT', PW - 80, 28, { width: 68, align: 'right' });

  doc.y = 100;

  const rows = [
    ['Convoy Reference', convoy.reference],
    ['Status', (convoy.status ?? '').toUpperCase()],
    ['Origin', convoy.origin],
    ['Destination', convoy.destination],
    ['Departed', fmtDate(convoy.departed_at)],
    ['Arrived', fmtDate(convoy.arrived_at)],
    ['Estimated Arrival', fmtDate(convoy.estimated_arrival_at)],
    ['Vehicles', String(convoy.vehicle_count ?? 0)],
    ['Seal Intact', convoy.seal_intact == null ? '—' : convoy.seal_intact ? 'YES' : 'NO'],
    ['Cargo Owner Ref', convoy.cargo_owner_ref ?? '—'],
    ['Generated', fmtDate(new Date())],
  ];

  let yPos = doc.y + 12;
  rows.forEach(([label, value], idx) => {
    if (idx % 2 === 0) doc.rect(M, yPos, CW, 22).fill(C.stripe);
    doc.fill(C.muted).fontSize(9).font('Helvetica')
      .text(label, M + 6, yPos + 6, { width: 160 });
    doc.fill(C.text).fontSize(9).font('Helvetica-Bold')
      .text(value, M + 170, yPos + 6, { width: CW - 170 });
    yPos += 22;
  });

  doc.y = yPos + 16;
}

function positionSection(doc, positions) {
  if (!positions || !positions.length) return;

  doc.fill(C.dark).fontSize(12).font('Helvetica-Bold')
    .text('LOCATION HISTORY', M, doc.y);
  doc.rect(M, doc.y + 2, CW, 1).fill(C.accent);
  doc.y += 14;

  const colW = [90, 80, 80, 80, CW - 330];
  const headers = ['Timestamp', 'Lat', 'Lng', 'Speed (km/h)', 'Source'];
  let yPos = doc.y + 8;

  doc.rect(M, yPos, CW, 20).fill(C.navy);
  let xPos = M + 6;
  headers.forEach((h, i) => {
    doc.fill(C.white).fontSize(8).font('Helvetica-Bold')
      .text(h, xPos, yPos + 6, { width: colW[i] });
    xPos += colW[i];
  });
  yPos += 20;

  positions.slice(0, 50).forEach((p, idx) => {
    if (idx % 2 === 0) doc.rect(M, yPos, CW, 18).fill(C.stripe);
    const cells = [
      fmtDate(p.recorded_at),
      p.lat != null ? p.lat.toFixed(5) : '—',
      p.lng != null ? p.lng.toFixed(5) : '—',
      p.speed_kmh != null ? p.speed_kmh.toFixed(1) : '—',
      p.source ?? '—',
    ];
    xPos = M + 6;
    cells.forEach((cell, i) => {
      doc.fill(C.text).fontSize(8).font('Helvetica')
        .text(String(cell), xPos, yPos + 5, { width: colW[i] });
      xPos += colW[i];
    });
    yPos += 18;
    if (yPos > 780) {
      doc.addPage();
      yPos = M + 10;
    }
  });
  doc.y = yPos + 12;
}

/**
 * Generate custody chain PDF buffer.
 * @param {{ convoy: object, positions: object[] }} params
 */
async function generateCustodyPdf({ convoy, positions }) {
  return makePdf(doc => {
    coverPage(doc, convoy);
    positionSection(doc, positions);

    // Footer on all pages
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill(C.muted).fontSize(7).font('Helvetica')
        .text(
          `SONALIT Custody Chain — Confidential — Page ${i + 1} of ${pageCount}`,
          M, 820, { width: CW, align: 'center' },
        );
    }
  });
}

module.exports = { generateCustodyPdf };
