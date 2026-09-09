const zlib = require('zlib');
const { buildManifestWorkbook, isActiveRow } = require('../src/services/email/clientPulseWorkbook.service');

function extractZipEntry(buffer, wantedName) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('invalid zip');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === wantedName) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = buffer.subarray(start, start + compressedSize);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`missing zip entry: ${wantedName}`);
}

describe('CDS Client Pulse futuristic workbook', () => {
  test('keeps active-row semantics and excludes closed bookings', () => {
    expect(isActiveRow({ booking_status: 'confirmed', status: 'pending' })).toBe(true);
    expect(isActiveRow({ booking_status: 'completed', status: 'pending' })).toBe(false);
    expect(isActiveRow({ booking_status: 'confirmed', status: 'delivered' })).toBe(false);
  });

  test('renders the template with Overview and the preserved operational fields', async () => {
    const rows = [{
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
    }];

    const workbook = await buildManifestWorkbook(rows, new Date('2026-09-07T16:10:00Z'));
    expect(Buffer.isBuffer(workbook)).toBe(true);
    expect(workbook.subarray(0, 2).toString()).toBe('PK');

    const workbookXml = extractZipEntry(workbook, 'xl/workbook.xml');
    const overviewXml = extractZipEntry(workbook, 'xl/worksheets/sheet1.xml');
    const detailXml = extractZipEntry(workbook, 'xl/worksheets/sheet2.xml');

    expect(workbookXml).toContain('name="Overview"');
    expect(workbookXml).not.toContain('name="COMMAND CENTER"');
    expect(detailXml).toContain('BOOKING NO');
    expect(detailXml).toContain('CARRIER REF');
    expect(detailXml).toContain('TIME UNCLAMPED');
    expect(detailXml).toContain('CARRIER-REF-001');
    expect(detailXml).toContain('06/09/2026, 11:12');
    expect(detailXml).not.toContain('TRHU3066037');
    expect(detailXml).not.toContain('BSE0339598');
    expect(overviewXml).toContain('CDS CLIENT PULSE');
  });
});
