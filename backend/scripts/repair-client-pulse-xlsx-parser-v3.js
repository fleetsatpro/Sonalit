const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const target = path.resolve(__dirname, '../src/services/email/clientPulseWorkbook.service.js');
let source = fs.readFileSync(target, 'utf8');
const start = source.indexOf('function unzip(buffer) {');
const end = source.indexOf('\nfunction zip(entries) {', start);
if (start < 0 || end < 0) throw new Error('Client Pulse unzip/zip boundaries not found');

const replacement = String.raw`function unzip(buffer) {
  const LOCAL = 0x04034b50;
  const CENTRAL = 0x02014b50;
  const EOCD = 0x06054b50;
  const entries = [];
  let p = 0;

  // The supplied workbook has a damaged central-directory offset. Do not trust
  // the central directory at all: XLSX/ZIP local file records contain enough
  // information to recover every XML/media entry needed by the renderer.
  while (p + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(p);
    if (signature === CENTRAL || signature === EOCD) break;
    if (signature !== LOCAL) {
      // Some malformed archives contain padding/junk between records. Search
      // forward for the next local-file signature rather than failing early.
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), p + 1);
      if (next < 0) break;
      p = next;
      continue;
    }

    const flags = buffer.readUInt16LE(p + 6);
    const method = buffer.readUInt16LE(p + 8);
    let compressedSize = buffer.readUInt32LE(p + 18);
    const uncompressedSize = buffer.readUInt32LE(p + 22);
    const nameLen = buffer.readUInt16LE(p + 26);
    const extraLen = buffer.readUInt16LE(p + 28);
    const headerEnd = p + 30 + nameLen + extraLen;
    if (headerEnd > buffer.length) throw new Error('Invalid XLSX local header bounds');
    const name = buffer.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const dataStart = headerEnd;

    // Normal XLSX records have sizes in the local header. If bit 3 is set,
    // recover the compressed payload by locating the next ZIP record and
    // testing the candidate payload with zlib.
    let dataEnd = dataStart + compressedSize;
    let compressed;
    if ((flags & 0x0008) === 0 && dataEnd <= buffer.length) {
      compressed = buffer.subarray(dataStart, dataEnd);
    } else {
      const candidates = [];
      for (const sig of [LOCAL, CENTRAL, EOCD]) {
        const bytes = Buffer.allocUnsafe(4);
        bytes.writeUInt32LE(sig, 0);
        let q = buffer.indexOf(bytes, dataStart);
        while (q >= 0) { candidates.push(q); q = buffer.indexOf(bytes, q + 1); }
      }
      candidates.sort((a, b) => a - b);
      let recovered = null;
      for (const q of candidates) {
        if (q <= dataStart) continue;
        const candidate = buffer.subarray(dataStart, q);
        try {
          if (method === 0) { recovered = candidate; break; }
          if (method === 8) { recovered = zlib.inflateRawSync(candidate); break; }
        } catch (_) { /* try the next ZIP boundary */ }
      }
      if (!recovered) throw new Error('Unable to recover XLSX entry ' + name);
      if (method === 0) entries.push({ name, data: Buffer.from(recovered) });
      else entries.push({ name, data: recovered });
      // Skip to the next local/central record. For descriptor archives the
      // payload search already identified that boundary.
      const nextLocal = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const nextCentral = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      const nextEnd = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), dataStart);
      const nexts = [nextLocal, nextCentral, nextEnd].filter(v => v >= 0);
      p = nexts.length ? Math.min(...nexts) : buffer.length;
      continue;
    }

    if (dataEnd > buffer.length) throw new Error('XLSX entry data exceeds archive bounds for ' + name);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error('Unsupported XLSX compression method ' + method + ' for ' + name);
    if (uncompressedSize !== 0 && uncompressedSize !== 0xffffffff && data.length !== uncompressedSize) {
      throw new Error('XLSX entry size mismatch for ' + name);
    }
    entries.push({ name, data });
    p = dataEnd;
  }

  if (!entries.length) throw new Error('Unable to recover XLSX local file records');
  return entries;
}`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source);
require('child_process').execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
console.log('Client Pulse XLSX parser v3 local-record recovery applied:', target);
