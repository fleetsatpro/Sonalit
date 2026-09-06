const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Railway runs the worker from /app/backend, while the approved template is
// stored at repository root /templates. Keep a small fallback set so the
// renderer remains portable across local, Docker and CI runtimes.
const TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../../../../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(__dirname, '../../../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(process.cwd(), '../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(process.cwd(), 'templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
];
const TEMPLATE_PATH = TEMPLATE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || TEMPLATE_CANDIDATES[0];
const ACTIVE = new Set(['pending', 'assigned', 'in_transit', 'at_port']);
const CLOSED = new Set(['completed', 'delivered', 'cancelled', 'canceled', 'archived', 'closed']);

function isActiveRow(row) {
  const b = String(row.booking_status || '').toLowerCase();
  const c = String(row.status || '').toLowerCase();
  return !CLOSED.has(b) && (ACTIVE.has(c) || !['delivered', 'completed'].includes(c));
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(n) {
  let s = '';
  for (n += 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (const v of buffer) c = table[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Client Pulse template is not a valid ZIP/XLSX archive');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid XLSX central directory');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid XLSX local header for ${name}`);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method} for ${name}`);
    if (data.length !== uncompressedSize) throw new Error(`XLSX entry size mismatch for ${name}`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    parts.push(local, body);

    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    name.copy(cd, 46);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function replaceCell(xml, address, value) {
  const safe = xmlEscape(value);
  const re = new RegExp(`(<c r=\\"${address}\\"[^>]*)(?:>.*?</c>|/>)`);
  const match = xml.match(re);
  if (!match) throw new Error(`Template cell ${address} not found`);
  const attrs = match[1].replace(/\s+t=\\"[^\\"]*\\"/g, '');
  return xml.replace(re, `${attrs} t=\\"inlineStr\\"><is><t xml:space=\\"preserve\\">${safe}</t></is></c>`);
}

function blankCell(address, styleId = 1) {
  return `<c r=\\"${address}\\" s=\\"${styleId}\\" t=\\"inlineStr\\"></c>`;
}

function cell(address, value, styleId) {
  if (value == null || value === '') return blankCell(address, styleId);
  return `<c r=\\"${address}\\" s=\\"${styleId}\\" t=\\"inlineStr\\"><is><t xml:space=\\"preserve\\">${xmlEscape(value)}</t></is></c>`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function stageLabel(row) {
  const s = String(row.status || '').toLowerCase();
  if (s === 'in_transit') return '● IN TRANSIT';
  if (s === 'at_port') return '● AT PORT';
  if (s === 'assigned') return '◐ ASSIGNED';
  return '○ PENDING';
}

function locationLabel(row) {
  if (row.yard_status) return row.yard_status;
  const s = String(row.status || '').toLowerCase();
  return s === 'in_transit' ? 'outbound' : 'yard';
}

function rowValues(row) {
  return [
    row.booking_number || '—', row.vessel || '—', row.file_reference || '—', row.commodity || '—',
    row.container_number || '—', row.iso_type || '—', row.seal_number || '—', stageLabel(row),
    formatDate(row.clamped_at), formatDateTime(row.clamped_at), row.lock_number || row.lock_serial || '—',
    locationLabel(row), row.transporter || '—', row.horse_reg || row.horse_reg_derived || '—', row.trailer_reg || '—',
    row.driver_name || row.driver_name_derived || '—', row.driver_contact || row.driver_contact_derived || '—', row.invoiced ? 'YES' : 'NO',
  ];
}

function manifestRowXml(row, index) {
  const even = index % 2 === 1;
  const styles = even
    ? [44,45,46,46,46,44,44,50,51,51,51,52,51,51,51,51,51,48]
    : [37,38,39,37,39,37,37,40,41,41,41,42,41,41,41,41,41,43];
  const status = String(row.status || '').toLowerCase();
  if (status === 'in_transit' || status === 'at_port' || status === 'assigned') styles[7] = even ? 47 : 49;
  const values = rowValues(row);
  const r = index + 5;
  return `<row r=\\"${r}\\">${values.map((v, i) => cell(`${colName(i)}${r}`, v, styles[i])).join('')}</row>`;
}

function getRowXml(xml, rowNumber) {
  const match = xml.match(new RegExp(`<row r=\\"${rowNumber}\\"[^>]*>[\\s\\S]*?<\\/row>`));
  if (!match) throw new Error(`Client Pulse template row ${rowNumber} is missing`);
  return match[0];
}

function updateSheet2(xml, rows, snapshotAt, scopeLabel) {
  const units = rows.length;
  const bookings = new Set(rows.map(r => r.booking_number).filter(Boolean)).size;
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(snapshotAt).replace(',', '').toUpperCase().replace('SEPT', 'SEP');
  const title = `◉  ${scopeLabel === 'GLOBAL' ? 'GLOBAL' : scopeLabel.toUpperCase()} ACTIVE BOOKINGS  •  CONTAINER TRACKING MATRIX`;
  const sub = `DATA STREAM  ›  ${units} UNITS  •  ${bookings} BOOKINGS  •  SYNCED ${stamp} EAT`;
  const footer = `◈  CDS CLIENT PULSE  •  ${scopeLabel === 'GLOBAL' ? 'GLOBAL' : scopeLabel.toUpperCase()}  •  END OF DATA STREAM  •  ALL SYSTEMS NOMINAL`;
  let preamble = [1, 2, 3, 4].map(r => getRowXml(xml, r)).join('');
  preamble = replaceCell(preamble, 'A1', title);
  preamble = replaceCell(preamble, 'A2', sub);
  const footerRow = rows.length + 5;
  const footerXml = `<row r=\\"${footerRow}\\"><c r=\\"A${footerRow}\\" s=\\"33\\" t=\\"inlineStr\\"><is><t xml:space=\\"preserve\\">${xmlEscape(footer)}</t></is></c><c r=\\"S${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"T${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"U${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"V${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"W${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"X${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"Y${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"Z${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"AA${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"AB${footerRow}\\" s=\\"1\\" t=\\"n\\"></c><c r=\\"AC${footerRow}\\" s=\\"1\\" t=\\"n\\"></c></row>`;
  const sheetData = `<sheetData>${preamble}${rows.map(manifestRowXml).join('')}${footerXml}</sheetData>`;
  xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
  xml = xml.replace(/<dimension ref=\\"A1:[^\\"]+\\"\/>/, `<dimension ref=\\"A1:AC${footerRow}\\"/>`);
  xml = xml.replace(/<autoFilter ref=\\"[^\\"]+\\"\/>/, `<autoFilter ref=\\"A4:R${footerRow - 1}\\"/>`);
  xml = xml.replace(/<mergeCell ref=\\"A38:R38\\"\/>/, `<mergeCell ref=\\"A${footerRow}:R${footerRow}\\"/>`);
  return xml;
}

function updateSheet1(xml, rows, snapshotAt, scopeLabel) {
  const units = rows.length;
  const inTransit = rows.filter(r => String(r.status || '').toLowerCase() === 'in_transit').length;
  const pending = units - inTransit;
  const vessels = new Map();
  for (const r of rows) {
    const vessel = r.vessel || 'UNASSIGNED';
    vessels.set(vessel, (vessels.get(vessel) || 0) + 1);
  }
  const vesselRows = [...vessels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const bookingCount = new Set(rows.map(r => r.booking_number).filter(Boolean)).size;
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(snapshotAt).replace(',', '').toUpperCase().replace('SEPT', 'SEP');
  const title = `◈  CDS CLIENT PULSE  •  ${scopeLabel === 'GLOBAL' ? 'GLOBAL ACTIVE BOOKINGS' : `${scopeLabel.toUpperCase()} ACTIVE BOOKINGS`}`;
  const subtitle = scopeLabel === 'GLOBAL' ? 'REAL-TIME LOGISTICS COMMAND INTERFACE  |  EAST AFRICA OPERATIONS' : `REAL-TIME LOGISTICS COMMAND INTERFACE  |  ${scopeLabel.toUpperCase()}`;
  const sync = `LAST SYNC  ›  ${stamp} EAT  •  STATUS: LIVE`;
  for (const [addr, val] of [['B2', title], ['B3', subtitle], ['B4', sync], ['B9', units], ['C9', inTransit], ['D9', pending], ['E9', vessels.size], ['F9', bookingCount]]) xml = replaceCell(xml, addr, val);
  const vesselCells = [['B16', 'C16', 'D16'], ['B17', 'C17', 'D17']];
  vesselRows.forEach(([v, count], i) => { xml = replaceCell(xml, vesselCells[i][0], v); xml = replaceCell(xml, vesselCells[i][1], count); xml = replaceCell(xml, vesselCells[i][2], 'ACTIVE'); });
  for (let i = vesselRows.length; i < 2; i++) { xml = replaceCell(xml, vesselCells[i][0], '—'); xml = replaceCell(xml, vesselCells[i][1], 0); xml = replaceCell(xml, vesselCells[i][2], '—'); }
  const pctTransit = units ? `${(inTransit / units * 100).toFixed(1)}%` : '0.0%';
  const pctPending = units ? `${(pending / units * 100).toFixed(1)}%` : '0.0%';
  for (const [addr, val] of [['F16', 'IN TRANSIT'], ['G16', inTransit], ['H16', pctTransit], ['F17', 'PENDING'], ['G17', pending], ['H17', pctPending]]) xml = replaceCell(xml, addr, val);
  const movementRows = rows.filter(r => String(r.status || '').toLowerCase() === 'in_transit').slice(0, 8);
  for (let i = 0; i < 8; i++) {
    const r = movementRows[i];
    const rr = 22 + i;
    const vals = r ? [r.container_number || '—', r.vessel || '—', r.transporter || '—', r.driver_name || r.driver_name_derived || '—', r.driver_contact || r.driver_contact_derived || '—', formatDateTime(r.clamped_at), r.lock_number || r.lock_serial || '—'] : ['—', '—', '—', '—', '—', '—', '—'];
    vals.forEach((v, j) => { xml = replaceCell(xml, `${colName(j + 1)}${rr}`, v); });
  }
  const footer = `◈  CDS LOGISTICS INTELLIGENCE PLATFORM  •  ${scopeLabel === 'GLOBAL' ? 'GLOBAL' : scopeLabel.toUpperCase()}  •  CLASSIFIED OPERATIONAL DATA  •  UNAUTHORIZED ACCESS PROHIBITED`;
  xml = replaceCell(xml, 'B30', footer);
  return xml;
}

async function buildManifestWorkbook(rows, snapshotAt = new Date(), options = {}) {
  const scopeLabel = String(options.scopeLabel || 'GLOBAL').trim() || 'GLOBAL';
  if (!fs.existsSync(TEMPLATE_PATH)) throw new Error(`Client Pulse XLSX template not found. Checked: ${TEMPLATE_CANDIDATES.join(', ')}`);
  const template = fs.readFileSync(TEMPLATE_PATH);
  const entries = unzip(template);
  const byName = new Map(entries.map(e => [e.name, e]));
  const s1 = byName.get('xl/worksheets/sheet1.xml');
  const s2 = byName.get('xl/worksheets/sheet2.xml');
  if (!s1 || !s2) throw new Error('Client Pulse XLSX template is missing command center or active bookings sheets');
  s1.data = Buffer.from(updateSheet1(s1.data.toString('utf8'), rows, snapshotAt, scopeLabel));
  s2.data = Buffer.from(updateSheet2(s2.data.toString('utf8'), rows, snapshotAt, scopeLabel));
  return zip(entries);
}

module.exports = { buildManifestWorkbook, isActiveRow, TEMPLATE_PATH };