const fs = require('fs');
const path = require('path');

function replaceOnce(file, source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`${label}: expected source pattern not found`);
  return source.replace(needle, replacement);
}

const workbookTarget = path.resolve(__dirname, '../src/services/email/clientPulseWorkbook.service.js');
let workbookSource = fs.readFileSync(workbookTarget, 'utf8');
const start = workbookSource.indexOf('function unzip(buffer) {');
const end = workbookSource.indexOf('\nfunction zip(entries) {', start);
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
    return { entries, end: p, start: startOffset };
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
      if (candidate) candidates.push(candidate);
    }
    if (!candidates.length) throw new Error(\`Invalid XLSX central directory (declared offset \${declaredCentralOffset}, size \${declaredCentralSize}, archive \${buffer.length} bytes)\`);
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
workbookSource = workbookSource.slice(0, start) + replacement + workbookSource.slice(end);
fs.writeFileSync(workbookTarget, workbookSource);

const scopedTarget = path.resolve(__dirname, '../src/services/email/scopedClientPulse.service.js');
let scoped = fs.readFileSync(scopedTarget, 'utf8');
scoped = replaceOnce(scoped, scoped, 'const idempotencyKey = `cds-client-pulse:${customerId}:${snapshot.toISOString().slice(0,13)}`;', "const idempotencyKey = reason === 'scheduled' ? `cds-client-pulse:${customerId}:${snapshot.toISOString().slice(0,13)}` : `cds-client-pulse:${customerId}:manual:${snapshot.toISOString()}`;", 'scoped idempotency');
scoped = replaceOnce(scoped, scoped, "const stamp = snapshot.toISOString().replace(/[:]/g, '').replace(/\\.\\d{3}Z$/, 'Z'); const filename = `CDS_Client_Pulse_${customerName.replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}_EAT.xlsx`;", "const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(snapshot).reduce((o, p) => { o[p.type] = p.value; return o; }, {}); const stamp = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`; const filename = `${customerName.replace(/[^A-Za-z0-9_-]+/g, '_')}_Client_Dispatch_Master_Active_Bookings_${stamp}_EAT.xlsx`;", 'scoped filename');
fs.writeFileSync(scopedTarget, scoped);

const adminTarget = path.resolve(__dirname, '../src/routes/admin.js');
let admin = fs.readFileSync(adminTarget, 'utf8');
const adminKey = '`cds-client-pulse:super-admin:${snapshotAt.toISOString().slice(0,13)}`';
admin = replaceOnce(admin, admin, adminKey, '`cds-client-pulse:super-admin:manual:${snapshotAt.toISOString()}`', 'admin run idempotency');
admin = replaceOnce(admin, admin, adminKey, '`cds-client-pulse:super-admin:manual:${snapshotAt.toISOString()}`', 'admin email idempotency');
fs.writeFileSync(adminTarget, admin);

const queueTarget = path.resolve(__dirname, '../src/config/queue.js');
let queue = fs.readFileSync(queueTarget, 'utf8');
queue = replaceOnce(queue, queue, 'password: url.password || process.env.REDIS_PASSWORD || undefined', "password: url.password ? decodeURIComponent(url.password) : (process.env.REDIS_PASSWORD || undefined)", 'BullMQ Redis password decoding');
fs.writeFileSync(queueTarget, queue);

const workerTarget = path.resolve(__dirname, '../src/workers/resendEmailWorker.js');
let worker = fs.readFileSync(workerTarget, 'utf8');
worker = replaceOnce(worker, worker, "password: url.password || process.env.REDIS_PASSWORD || undefined", "password: url.password ? decodeURIComponent(url.password) : (process.env.REDIS_PASSWORD || undefined)", 'email worker Redis password decoding');
const readyNeedle = "logger.info(`Resend email worker starting: queue=email concurrency=${concurrency} from=${FROM}`);";
const readyReplacement = `${readyNeedle}\n  worker.waitUntilReady().then(() => logger.info('Resend email worker ready: Redis connection established')).catch(err => logger.error(\`Resend email worker Redis readiness failed: \${err.message}\`));`;
if (worker.includes(readyNeedle) && !worker.includes('Redis readiness failed')) worker = worker.replace(readyNeedle, readyReplacement);
fs.writeFileSync(workerTarget, worker);

for (const target of [workbookTarget, scopedTarget, adminTarget, queueTarget, workerTarget]) {
  require('child_process').execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
}
console.log('Client Pulse production hardening applied:', workbookTarget);
