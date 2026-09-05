const fs = require('fs');
const { buildManifestWorkbook, isActiveRow, TEMPLATE_PATH } = require('../src/services/email/clientPulseWorkbook.service');

describe('CDS Client Pulse workbook', () => {
  test('uses the approved template and renders customer-scoped data', async () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
    const snapshot = new Date('2026-09-05T19:10:25+03:00');
    const rows = [
      {
        booking_number: 'TZ_26_08_OB_00000002',
        vessel: 'CMA CGM OMBASA',
        file_reference: 'BSE0339598',
        commodity: '16111',
        container_number: 'TRHU3066037',
        iso_type: '20GP',
        seal_number: 'L3901098',
        status: 'pending',
        booking_status: 'open',
        yard_status: 'yard',
        invoiced: false,
      },
    ];

    const workbook = await buildManifestWorkbook(rows, snapshot, { scopeLabel: 'ACME LTD' });
    expect(Buffer.isBuffer(workbook)).toBe(true);
    expect(workbook.subarray(0, 2).toString()).toBe('PK');
    expect(workbook.length).toBeGreaterThan(10000);
    expect(isActiveRow(rows[0])).toBe(true);
    expect(isActiveRow({ booking_status: 'delivered', status: 'pending' })).toBe(false);
  });
});
