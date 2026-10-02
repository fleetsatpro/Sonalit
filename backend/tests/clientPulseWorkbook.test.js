const { buildManifestWorkbook } = require('../src/services/email/clientPulseWorkbook.service');

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readUInt16LE(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function zipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (readUInt32LE(buffer, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Generated workbook has no ZIP end record');

  const count = readUInt16LE(buffer, eocd + 10);
  const centralOffset = readUInt32LE(buffer, eocd + 16);
  const names = [];
  let offset = centralOffset;

  for (let i = 0; i < count; i += 1) {
    expect(readUInt32LE(buffer, offset)).toBe(0x02014b50);
    const nameLen = readUInt16LE(buffer, offset + 28);
    const extraLen = readUInt16LE(buffer, offset + 30);
    const commentLen = readUInt16LE(buffer, offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe('Client Pulse workbook generation', () => {
  test('produces a valid two-sheet XLSX even when the bundled template is unreadable', async () => {
    const workbook = await buildManifestWorkbook([{
      booking_number: 'BK-001',
      carrier_reference: 'CR-001',
      vessel: 'MV TEST',
      file_reference: 'AW-001',
      commodity: 'General Cargo',
      container_number: 'MSCU1234567',
      iso_type: '22G1',
      seal_number: 'SEAL-001',
      status: 'in_transit',
      clamped_at: new Date('2026-10-02T09:00:00.000Z'),
      unclamped_at: null,
      lock_number: 'LOCK-001',
      yard_status: 'outbound',
      transporter: 'Sonalit Logistics',
      horse_reg: 'KDA 001A',
      trailer_reg: 'Z 001',
      driver_name: 'Test Driver',
      driver_contact: '+254700000000',
      invoiced: true,
    }], new Date('2026-10-02T09:00:00.000Z'));

    expect(Buffer.isBuffer(workbook)).toBe(true);
    expect(workbook.length).toBeGreaterThan(1000);

    const names = zipEntries(workbook);
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/worksheets/sheet2.xml');
    expect(names).toContain('xl/styles.xml');
    expect(names).toContain('[Content_Types].xml');
  });
});
