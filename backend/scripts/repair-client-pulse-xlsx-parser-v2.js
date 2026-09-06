const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const target = path.resolve(__dirname, '../src/services/email/clientPulseWorkbook.service.js');
let source = fs.readFileSync(target, 'utf8');
const start = source.indexOf('function unzip(buffer) {');
const end = source.indexOf('\nfunction zip(entries) {', start);
if (start < 0 || end < 0) throw new Error('Client Pulse unzip/zip boundaries not found');

const replacement = String.raw`function unzip(buffer) {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (i + 22 <= buffer.length && buffer.readUInt32LE(i) === EOCD) {
      const commentLength = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLength <= buffer.length) { eocd = i; break; }
    }
  }
  if (eocd < 0) throw new Error('Client Pulse template is not a valid ZIP/XLSX archive');

  const count = buffer.readUInt16LE(eocd + 10);
  const declaredSize = buffer.readUInt32LE(eocd + 12);
  const declaredOffset = buffer.readUInt32LE(eocd + 16);

  function inflateEntry(name, method, compressed, expectedSize) {
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(\`Unsupported XLSX compression method \${method} for \${name}\`);
    if (expectedSize != null && expectedSize !== 0xffffffff && data.length !== expectedSize) {
      throw new Error(\`XLSX entry size mismatch for \${name}\`);
    }
    return data;
  }

  function parseCentralAt(offset) {
    if (!Number.isInteger(offset) || offset < 0 || offset + 46 > eocd) return null;
    const entries = [];
    let p = offset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > eocd || buffer.readUInt32LE(p) !== CENTRAL) return null;
      const flags = buffer.readUInt16LE(p + 8);
      const method = buffer.readUInt16LE(p + 10);
      const compressedSize = buffer.readUInt32LE(p + 20);
      const uncompressedSize = buffer.readUInt32LE(p + 24);
      const nameLen = buffer.readUInt16LE(p + 28);
      const extraLen = buffer.readUInt16LE(p + 30);
      const commentLen = buffer.readUInt16LE(p + 32);
      const localOffset = buffer.readUInt32LE(p + 42);
      const recordEnd = p + 46 + nameLen + extraLen + commentLen;
      if (recordEnd > eocd) return null;
      const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
      p = recordEnd;
    }
    return { entries, start: offset, end: p };
  }

  let parsed = null;
  if (declaredOffset + declaredSize <= eocd) {
    parsed = parseCentralAt(declaredOffset);
  }

  if (!parsed) {
    for (let p = 0; p + 46 <= eocd; p++) {
      if (buffer.readUInt32LE(p) !== CENTRAL) continue;
      const candidate = parseCentralAt(p);
      if (candidate) {
        parsed = candidate;
        break;
      }
    }
  }

  if (parsed) {
    const delta = parsed.start - declaredOffset;
    const entries = [];
    for (const entry of parsed.entries) {
      const offsets = [entry.localOffset, entry.localOffset + delta];
      let localOffset = null;
      for (const candidate of offsets) {
        if (candidate >= 0 && candidate + 30 <= buffer.length && buffer.readUInt32LE(candidate) === LOCAL) {
          localOffset = candidate;
          break;
        }
      }
      if (localOffset == null) {
        throw new Error(\`Invalid XLSX local header for \${entry.name}\`);
      }
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + entry.compressedSize;
      if (dataStart < 0 || dataEnd > buffer.length) throw new Error(\`XLSX entry bounds invalid for \${entry.name}\`);
      entries.push({ name: entry.name, data: inflateEntry(entry.name, entry.method, buffer.subarray(dataStart, dataEnd), entry.uncompressedSize) });
    }
    return entries;
  }

  const recovered = [];
  let p = 0;
  while (p + 30 <= eocd && recovered.length < count) {
    const sig = buffer.readUInt32LE(p);
    if (sig !== LOCAL) { p += 1; continue; }
    const flags = buffer.readUInt16LE(p + 6);
    const method = buffer.readUInt16LE(p + 8);
    const compressedSize = buffer.readUInt32LE(p + 18);
    const uncompressedSize = buffer.readUInt32LE(p + 22);
    const nameLen = buffer.readUInt16LE(p + 26);
    const extraLen = buffer.readUInt16LE(p + 28);
    const dataStart = p + 30 + nameLen + extraLen;
    const name = buffer.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    if (flags & 0x0008) {
      throw new Error(\`Malformed XLSX local data descriptor for \${name}; central directory is unrecoverable\`);
    }
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > eocd) throw new Error(\`XLSX local entry bounds invalid for \${name}\`);
    recovered.push({ name, data: inflateEntry(name, method, buffer.subarray(dataStart, dataEnd), uncompressedSize) });
    p = dataEnd;
  }
  if (recovered.length !== count) {
    throw new Error(\`Unable to recover XLSX entries (expected \${count}, recovered \${recovered.length}; declared offset \${declaredOffset}, size \${declaredSize}, archive \${buffer.length} bytes)\`);
  }
  return recovered;
}`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, source);
require('child_process').execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
console.log('Client Pulse XLSX parser v2 repair applied:', target);
