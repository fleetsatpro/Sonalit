/**
 * Unit test for the EXIF GPS parser in routes/guardianCfo.js — builds a minimal
 * geotagged JPEG (little-endian TIFF, lat 1°0'0"N, lng 36°30'0"E) entirely in
 * memory and asserts the parser recovers 1.0 / 36.5. Guards against the old
 * behaviour where extractExifLatLng always returned null.
 */
const { extractExifLatLng } = require('../src/routes/guardianCfo');

function buildTiff() {
  const t = Buffer.alloc(128);
  t.write('II', 0, 'ascii');
  t.writeUInt16LE(0x002A, 2);
  t.writeUInt32LE(8, 4);          // IFD0 offset

  t.writeUInt16LE(1, 8);          // IFD0: 1 entry
  t.writeUInt16LE(0x8825, 10);    //   tag = GPS Info IFD pointer
  t.writeUInt16LE(4, 12);         //   type LONG
  t.writeUInt32LE(1, 14);         //   count
  t.writeUInt32LE(26, 18);        //   value = GPS IFD offset
  t.writeUInt32LE(0, 22);         // IFD0 next = none

  t.writeUInt16LE(4, 26);         // GPS IFD: 4 entries (value field is at entry+8)
  // 0x0001 GPSLatitudeRef = 'N'
  t.writeUInt16LE(0x0001, 28); t.writeUInt16LE(2, 30); t.writeUInt32LE(2, 32); t.write('N', 36, 'ascii');
  // 0x0002 GPSLatitude -> rationals at 80
  t.writeUInt16LE(0x0002, 40); t.writeUInt16LE(5, 42); t.writeUInt32LE(3, 44); t.writeUInt32LE(80, 48);
  // 0x0003 GPSLongitudeRef = 'E'
  t.writeUInt16LE(0x0003, 52); t.writeUInt16LE(2, 54); t.writeUInt32LE(2, 56); t.write('E', 60, 'ascii');
  // 0x0004 GPSLongitude -> rationals at 104
  t.writeUInt16LE(0x0004, 64); t.writeUInt16LE(5, 66); t.writeUInt32LE(3, 68); t.writeUInt32LE(104, 72);
  t.writeUInt32LE(0, 76);         // GPS IFD next = none

  // lat 1°0'0"
  t.writeUInt32LE(1, 80); t.writeUInt32LE(1, 84); t.writeUInt32LE(0, 88); t.writeUInt32LE(1, 92); t.writeUInt32LE(0, 96); t.writeUInt32LE(1, 100);
  // lng 36°30'0"
  t.writeUInt32LE(36, 104); t.writeUInt32LE(1, 108); t.writeUInt32LE(30, 112); t.writeUInt32LE(1, 116); t.writeUInt32LE(0, 120); t.writeUInt32LE(1, 124);
  return t;
}

function buildJpeg() {
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), buildTiff()]);
  const segLen = Buffer.alloc(2);
  segLen.writeUInt16BE(app1.length + 2, 0); // JPEG segment length includes the length field
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]), segLen, app1, Buffer.from([0xFF, 0xD9])]);
}

test('extractExifLatLng recovers GPS from a geotagged JPEG', () => {
  const result = extractExifLatLng(buildJpeg());
  expect(result).not.toBeNull();
  expect(result.lat).toBeCloseTo(1.0, 5);
  expect(result.lng).toBeCloseTo(36.5, 5);
});

test('extractExifLatLng returns null for a non-JPEG buffer', () => {
  expect(extractExifLatLng(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
});

test('extractExifLatLng returns null for a JPEG with no EXIF', () => {
  expect(extractExifLatLng(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]))).toBeNull();
});
