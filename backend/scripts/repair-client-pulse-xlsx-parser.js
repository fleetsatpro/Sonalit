const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../src/services/email/clientPulseWorkbook.service.js');
const source = fs.readFileSync(target, 'utf8');
const start = source.indexOf('function unzip(buffer) {');
const end = source.indexOf('\nfunction zip(entries) {', start);
if (start < 0 || end < 0) throw new Error('Client Pulse unzip/zip boundaries not found');

const replacement = `function unzip(buffer) {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  let eocd = -1;
  const tailStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= tailStart; i--) {
    if (i + 22 <= buffer.length && buffer.readUInt32LE(i) === EOCD) {
      const commentLength = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLength <= buffer.length) { eocd = i; break; }
    }
  }
  if (eocd < 0) throw new Error('Client Pulse template is not a valid ZIP/XLSX archive');

  const declaredCount = buffer.readUInt16LE(eocd + 10);
  const declaredCentralSize = buffer.readUInt32LE(eocd + 12);
  const declaredCentralOffset = buffer.readUInt32LE(eocd + 16);
  const maxCentralEnd = eocd;

  function parseCentralAt(startOffset, count) {
    if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset + 46 > maxCentralEnd) return null;
    const entries = [];
    let p = startOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > maxCentralEnd || buffer.readUInt32LE(p) !== CENTRAL) return null;
      const method = buffer.readUInt16LE(p + 10);
      const flags = buffer.readUInt16LE(p + 8);
      const compressedSize = buffer.readUInt32LE(p + 20);
      const uncompressedSize = buffer.readUInt32LE(p + 24);
      const nameLen = buffer.readUInt16LE(p + 28);
      const extraLen = buffer.readUInt16LE(p + 30);
      const commentLen = buffer.readUInt16LE(p + 32);
      const localOffset = buffer.readUInt32LE(p + 42);
      const recordEnd = p + 46 + nameLen + extraLen + commentLen;
      if (recordEnd > maxCentralEnd) return null;
      const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
      p = recordEnd;
    }
    return { entries, end: p };
  }

  let parsed = null;
  if (declaredCentralOffset + declaredCentralSize <= maxCentralEnd) {
    parsed = parseCentralAt(declaredCentralOffset, declaredCount);
    if (parsed && parsed.end !== declaredCentralOffset + declaredCentralSize) parsed = null;
  }

  if (!parsed) {
    const candidates = [];
    for (let p = 0; p + 46 <= maxCentralEnd; p++) {
      if (buffer.readUInt32LE(p) !== CENTRAL) continue;
      const candidate = parseCentralAt(p, declaredCount);
      if (candidate) candidates.push({ start: p, ...candidate });
    }
    if (!candidates.length) {
      throw new Error(\`Invalid XLSX central directory (declared offset \${declaredCentralOffset}, size \${declaredCentralSize}, archive \${buffer.length} bytes)\`);
    }
    parsed = candidates.sort((a, b) => Math.abs(a.end - eocd) - Math.abs(b.end - eocd))[0];
  }

  const entries = [];
  const centralOffsetDelta = parsed.start - declaredCentralOffset;
  for (const entry of parsed.entries) {
    const localCandidates = [entry.localOffset, entry.localOffset + centralOffsetDelta];
    const localOffset = localCandidates.find((candidate) => candidate >= 0 && candidate + 30 <= buffer.length && buffer.readUInt32LE(candidate) === LOCAL);
    if (localOffset == null) throw new Error(\`Invalid XLSX local header for \${entry.name}\`);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > buffer.length) throw new Error(\`XLSX entry bounds invalid for \${entry.name}\`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    if (entry.method === 0) data = Buffer.from(compressed);
    else if (entry.method === 8) data = require('zlib').inflateRawSync(compressed);
    else throw new Error(\`Unsupported XLSX compression method \${entry.method} for \${entry.name}\`);
    if (data.length !== entry.uncompressedSize) throw new Error(\`XLSX entry size mismatch for \${entry.name}\`);
    entries.push({ name: entry.name, data });
  }
  return entries;
}`;

const updated = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(target, updated);
require('child_process').execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
console.log('Client Pulse XLSX parser repaired:', target);
