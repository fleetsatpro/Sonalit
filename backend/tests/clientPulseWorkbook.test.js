const { buildManifestWorkbook, isActiveRow } = require('../src/services/email/clientPulseWorkbook.service');

describe('CDS Client Pulse futuristic workbook', () => {
  test('keeps active-row semantics and excludes closed bookings', () => {
    expect(isActiveRow({ booking_status: 'confirmed', status: 'pending' })).toBe(true);
    expect(isActiveRow({ booking_status: 'completed', status: 'pending' })).toBe(false);
    expect(isActiveRow({ booking_status: 'confirmed', status: 'delivered' })).toBe(false);
  });

  test('loads the production template and returns a valid XLSX buffer', async () => {
    const workbook = await buildManifestWorkbook([{
      booking_number: 'TEST-BOOKING',
      carrier_reference: 'CARRIER-REF-001',
      vessel: 'TEST VESSEL',
      file_reference: 'AW-001',
      commodity: 'Copper',
      container_number: 'TEST000001',
      iso_type: '20GP',
      seal_number: 'SEAL001',
      status: 'in_transit',
      clamped_at: '2026-09-05T08:12:00Z',
      unclamped_at: '2026-09-06T08:12:00Z',
      lock_number: 'LOCK001',
      yard_status: 'outbound',
      transporter: 'TEST TRANSPORTER',
      driver_name: 'Test Driver',
      driver_contact: '255700000000',
      invoiced: false,
    }], new Date('2026-09-07T16:10:00Z'));

    expect(Buffer.isBuffer(workbook)).toBe(true);
    expect(workbook.length).toBeGreaterThan(5000);
    expect(workbook.subarray(0, 2).toString()).toBe('PK');
  });
});
