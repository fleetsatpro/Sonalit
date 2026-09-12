const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../CDS_Client_Pulse_Active_Bookings_BOOKING_OVERVIEW.xlsx');
const TZ = () => process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi';

const COLUMNS = [
  ['booking_number', 'BOOKING NO'],
  ['file_reference', 'CARRIER REF'],
  ['vessel', 'VESSEL'],
  ['file_reference', 'AW FILE REF'],
  ['commodity', 'COMMODITY'],
  ['container_number', 'CONTAINER NO'],
  ['iso_type', 'TYPE'],
  ['seal_number', 'SEAL 1'],
  ['status', 'STAGE'],
  ['clamped_date', 'DATE CLAMPED'],
  ['clamped_at', 'TIME CLAMPED'],
  ['unclamped_at', 'TIME UNCLAMPED'],
  ['lock_number', 'LOCK NO'],
  ['yard_status', 'LOCATION'],
  ['transporter', 'TRANSPORTER'],
  ['horse_reg', 'HORSE REG'],
  ['trailer_reg', 'TRAILER REG'],
  ['driver_name', 'DRIVER'],
  ['driver_contact', 'CONTACT'],
  ['invoiced', 'INVOICED'],
];

const ACTIVE = new Set(['pending', 'assigned', 'in_transit', 'at_port']);
const CLOSED = new Set(['completed', 'delivered', 'cancelled', 'canceled', 'archived', 'closed']);

function isActiveRow(row) {
  const bookingStatus = String(row.booking_status || '').trim().toLowerCase();
  const containerStatus = String(row.status || '').trim().toLowerCase();
  if (CLOSED.has(bookingStatus)) return false;
  return ACTIVE.has(containerStatus) || !['delivered', 'completed'].includes(containerStatus);
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    ...row,
    booking_number: row.booking_number ?? '',
    carrier_reference: row.carrier_reference ?? '',
    vessel: row.vessel ?? '',
    file_reference: row.file_reference ?? '',
    commodity: row.commodity ?? '',
    container_number: row.container_number ?? '',
    iso_type: row.iso_type ?? '',
    seal_number: row.seal_number ?? '',
    status: String(row.status || '').trim().toLowerCase(),
    clamped_date: row.clamped_at ?? null,
    clamped_at: row.clamped_at ?? null,
    unclamped_at: row.unclamped_at ?? null,
    lock_number: row.lock_number || row.lock_serial || '',
    yard_status: row.yard_status ?? '',
    transporter: row.transporter ?? '',
    horse_reg: row.horse_reg || row.horse_reg_derived || '',
    trailer_reg: row.trailer_reg ?? '',
    driver_name: row.driver_name || row.driver_name_derived || '',
    driver_contact: row.driver_contact || row.driver_contact_derived || '',
    invoiced: row.invoiced === true || String(row.invoiced).toLowerCase() === 'yes' || String(row.invoiced).toLowerCase() === 'true',
  }));
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = safeDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function formatDateTime(value) {
  const date = safeDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function displayStage(status) {
  switch (String(status || '').toLowerCase()) {
    case 'pending': return '○ PENDING';
    case 'in_transit': return '● IN TRANSIT';
    case 'assigned': return '● ASSIGNED';
    case 'at_port': return '● AT PORT';
    default: return status ? String(status).toUpperCase() : '—';
  }
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function displayInvoice(value) {
  return value ? '✓ YES' : '✕ NO';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cell(ref, value, style = 1, numeric = false) {
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}" t="n"></c>`;
  if (numeric && Number.isFinite(Number(value))) return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function replaceTag(xml, tag, replacement) {
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`);
  return re.test(xml) ? xml.replace(re, replacement) : xml;
}

function replaceSelfClosing(xml, tag, replacement) {
  const re = new RegExp(`<${tag}\\b[^>]*/>`);
  return re.test(xml) ? xml.replace(re, replacement) : xml;
}

function buildRows(rows) {
  const out = [];
  rows.forEach((row, index) => {
    const excelRow = index + 5;
    const baseStyle = index % 2 === 0 ? 52 : 59;
    const alt = index % 2 === 0;
    const styles = {
      text: baseStyle,
      vessel: alt ? 53 : 60,
      container: alt ? 54 : 61,
      stage: row.status === 'pending' ? (alt ? 55 : 65) : (alt ? 64 : 62),
      location: row.status === 'pending' ? (alt ? 57 : 67) : 62,
      invoice: alt ? 58 : 63,
    };
    const values = [
      displayValue(row.booking_number), displayValue(row.file_reference), displayValue(row.vessel), displayValue(row.file_reference),
      displayValue(row.commodity), displayValue(row.container_number), displayValue(row.iso_type),
      displayValue(row.seal_number), displayStage(row.status), formatDate(row.clamped_date),
      formatDateTime(row.clamped_at), formatDateTime(row.unclamped_at),
      displayValue(row.lock_number), displayValue(row.yard_status), displayValue(row.transporter),
      displayValue(row.horse_reg), displayValue(row.trailer_reg), displayValue(row.driver_name),
      displayValue(row.driver_contact), displayInvoice(row.invoiced),
    ];
    const cells = values.map((value, colIndex) => {
      const style = colIndex === 2 ? styles.vessel
        : colIndex === 5 ? styles.container
        : colIndex === 8 ? styles.stage
        : colIndex === 12 ? styles.location
        : colIndex === 19 ? styles.invoice
        : styles.text;
      return cell(`${columnLetter(colIndex)}${excelRow}`, value, style);
    }).join('');
    out.push(`<row r="${excelRow}" ht="20" customHeight="1">${cells}</row>`);
  });
  const endRow = rows.length + 4;
  out.push(`<row r="${endRow + 2}" ht="20" customHeight="1"><c r="A${endRow + 2}" s="49" t="inlineStr"><is><t>End of data stream</t></is></c></row>`);
  return out.join('');
}

function buildDetailSheet(templateXml, rows, snapshotAt) {
  const synced = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(snapshotAt);
  const header = COLUMNS.map(([, label], index) => cell(`${columnLetter(index)}4`, label, 51)).join('');
  const blankTop = `<row r="1" ht="24" customHeight="1"><c r="A1" s="50" t="inlineStr"><is><t>ACTIVE BOOKINGS  ·  CONTAINER TRACKING</t></is></c></row>`;
  const subtitle = `<row r="2"><c r="A2" s="3" t="inlineStr"><is><t>${xmlEscape(`${rows.length} units  ·  ${new Set(rows.map(r => r.booking_number).filter(Boolean)).size} bookings  ·  Synced ${synced} EAT`)}</t></is></c></row>`;
  const spacer = `<row r="3">${Array.from({ length: 20 }, (_, i) => `<c r="${columnLetter(i)}3" s="4" t="n"></c>`).join('')}</row>`;
  const headerRow = `<row r="4" ht="24" customHeight="1">${header}</row>`;
  const sheetData = `<sheetData>${blankTop}${subtitle}${spacer}${headerRow}${buildRows(rows)}</sheetData>`;

  let xml = replaceTag(templateXml, 'sheetData', sheetData);
  xml = xml.replace('<pageSetUpPr/>', '<pageSetUpPr fitToPage="1"/>');
  xml = xml.replace(/<dimension\s+ref="[^"]+"\s*\/>/, `<dimension ref="A1:T${rows.length + 6}"/>`);
  xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, '<cols>' + [18, 14, 20, 14, 13, 15, 10, 12, 14, 13, 16, 16, 12, 12, 13, 11, 11, 14, 15, 10].map((width, i) => `<col width="${width}" customWidth="1" min="${i + 1}" max="${i + 1}"/>`).join('') + '</cols>');
  xml = replaceSelfClosing(xml, 'autoFilter', `<autoFilter ref="A4:T${rows.length + 4}"/>`);
  xml = xml.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, `<mergeCells count="3"><mergeCell ref="A1:T1"/><mergeCell ref="A2:T2"/><mergeCell ref="A${rows.length + 6}:T${rows.length + 6}"/></mergeCells>`);
  xml = xml.replace(/<pageMargins[^>]*\/>/, '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>');
  return xml;
}

function metricStatus(rows) {
  const total = rows.length;
  const counts = new Map();
  rows.forEach(r => counts.set(r.status || 'unknown', (counts.get(r.status || 'unknown') || 0) + 1));
  const pending = counts.get('pending') || 0;
  const inTransit = counts.get('in_transit') || 0;
  const vessels = new Map();
  rows.forEach(r => vessels.set(r.vessel || '—', (vessels.get(r.vessel || '—') || 0) + 1));
  const sortedVessels = [...vessels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const invoiced = rows.filter(r => r.invoiced).length;
  const dispatched = rows.filter(r => ['assigned', 'in_transit', 'at_port'].includes(r.status)).length;
  const clamped = rows.filter(r => !!safeDate(r.clamped_at)).length;
  const outbound = rows.filter(r => String(r.yard_status || '').toLowerCase() === 'outbound' || r.status === 'in_transit').length;
  return { total, pending, inTransit, vessels: vessels.size, bookings: new Set(rows.map(r => r.booking_number).filter(Boolean)).size, counts, sortedVessels, invoiced, dispatched, clamped, outbound };
}

function priorityActions(rows, metrics) {
  const actions = [];
  if (metrics.pending > 0) actions.push(`Clear yard backlog — assign transport to ${metrics.pending} pending container${metrics.pending === 1 ? '' : 's'}`);
  if (metrics.invoiced < metrics.total) actions.push(`Trigger invoicing — ${metrics.total - metrics.invoiced} units still uninvoiced`);
  if (metrics.sortedVessels[0] && metrics.total > 0) {
    const [vessel, count] = metrics.sortedVessels[0];
    if (count / metrics.total >= 0.5) actions.push(`Monitor vessel concentration risk on ${vessel} (${count} units)`);
  }
  const missingOps = rows.filter(r => r.status === 'pending' && (!r.clamped_at || !(r.lock_number || '').trim())).length;
  if (missingOps > 0) actions.push(`Complete missing clamp / lock data on ${missingOps} pending unit${missingOps === 1 ? '' : 's'}`);
  if (!actions.length) actions.push('No critical actions — active booking flow is clear');
  return actions.slice(0, 4);
}

function buildOverviewSheet(templateXml, rows, snapshotAt) {
  const metrics = metricStatus(rows);
  const actions = priorityActions(rows, metrics);
  const yardPct = metrics.total ? Math.round((metrics.pending / metrics.total) * 100) : 0;
  const invoicedPct = metrics.total ? Math.round((metrics.invoiced / metrics.total) * 100) : 0;
  const vesselPct = metrics.total && metrics.sortedVessels[0] ? Math.round((metrics.sortedVessels[0][1] / metrics.total) * 100) : 0;
  const sync = new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(snapshotAt);

  const rowsXml = [];
  const blankRow = (r) => `<row r="${r}">${Array.from({ length: 11 }, (_, i) => `<c r="${columnLetter(i)}${r}" s="1" t="n"></c>`).join('')}</row>`;
  for (let r = 1; r <= 49; r += 1) rowsXml.push(blankRow(r));
  const set = (r, col, value, style, numeric = false) => {
    const idx = rowsXml.findIndex(s => s.includes(`<row r="${r}">`));
    const re = new RegExp(`<c r="${col}${r}"[^>]*>[\\s\\S]*?<\\/c>`);
    rowsXml[idx] = rowsXml[idx].replace(re, cell(`${col}${r}`, value, style, numeric));
  };
  const setRow = (r, entries) => entries.forEach(([col, value, style, numeric]) => set(r, col, value, style, numeric));

  setRow(2, [['B', 'CDS CLIENT PULSE', 2]]);
  setRow(3, [['B', `Global Active Bookings  ·  East Africa Operations  ·  Synced ${sync} EAT`, 3]]);
  setRow(7, [['B', 'TOTAL UNITS', 9], ['C', 'IN TRANSIT', 9], ['D', 'PENDING', 9], ['E', 'VESSELS', 9], ['F', 'BOOKINGS', 9]]);
  setRow(8, [['B', metrics.total, 10, true], ['C', metrics.inTransit, 11, true], ['D', metrics.pending, 12, true], ['E', metrics.vessels, 13, true], ['F', metrics.bookings, 14, true]]);
  setRow(9, [['B', 'Containers', 15], ['C', 'Moving now', 15], ['D', 'In yard', 15], ['E', 'Active', 15], ['F', 'Open', 15]]);
  setRow(11, [['B', `⚠  BOTTLENECK  ·  ${yardPct}% still in yard  ·  ${invoicedPct}% invoiced  ·  ${vesselPct}% volume on one vessel`, 17]]);
  setRow(13, [['B', 'VESSEL ALLOCATION', 18], ['E', 'STAGE DISTRIBUTION', 18]]);
  setRow(14, [['B', 'VESSEL', 19], ['C', 'UNITS', 19], ['D', 'STATUS', 19], ['E', 'STAGE', 19], ['F', 'COUNT', 19], ['G', '%', 19]]);

  const vessels = metrics.sortedVessels.slice(0, 2);
  if (metrics.sortedVessels.length > 2) vessels[1] = ['OTHER VESSELS', metrics.sortedVessels.slice(1).reduce((sum, [, count]) => sum + count, 0)];
  for (let i = 0; i < 2; i += 1) {
    const [vessel, count] = vessels[i] || ['—', 0];
    const styleBase = i === 0 ? [20, 21, 22] : [20, 21, 25];
    setRow(15 + i, [['B', vessel, styleBase[0]], ['C', count, styleBase[1], true], ['D', vessel === 'OTHER VESSELS' ? 'MULTIPLE' : (rows.some(r => r.vessel === vessel && r.status === 'in_transit') ? 'LOADING' : 'STANDBY'), styleBase[2]]]);
  }

  const stageEntries = [...metrics.counts.entries()].filter(([stage]) => stage !== 'completed' && stage !== 'delivered').sort((a, b) => b[1] - a[1]);
  const displayStages = stageEntries.length <= 2 ? stageEntries : [[stageEntries[0]?.[0] || '—', stageEntries[0]?.[1] || 0], ['other', stageEntries.slice(1).reduce((s, [, n]) => s + n, 0)]];
  for (let i = 0; i < 2; i += 1) {
    const [stage, count] = displayStages[i] || ['—', 0];
    const label = displayStage(stage).replace(/^[○●] /, '');
    const pct = metrics.total ? `${((count / metrics.total) * 100).toFixed(1)}%` : '0.0%';
    setRow(15 + i, [['E', label, 20], ['F', count, i === 0 ? 23 : 26, true], ['G', pct, i === 0 ? 24 : 27]]);
  }

  setRow(18, [['B', 'OPERATIONAL FLOW', 18]]);
  setRow(20, [['B', 'YARD HOLD', 30], ['C', 'DISPATCHED', 30], ['D', 'CLAMPED', 30], ['E', 'OUTBOUND', 30], ['F', 'INVOICED', 30]]);
  setRow(21, [['B', metrics.pending, 31, true], ['C', metrics.dispatched, 32, true], ['D', metrics.clamped, 33, true], ['E', metrics.outbound, 34, true], ['F', metrics.invoiced, 35, true]]);
  const flowLabels = [metrics.pending ? 'BOTTLENECK' : 'CLEAR', metrics.dispatched ? 'FLOWING' : 'IDLE', metrics.clamped ? 'FLOWING' : 'IDLE', metrics.outbound ? 'FLOWING' : 'IDLE', metrics.invoiced === metrics.total && metrics.total > 0 ? 'CLEAR' : 'BLOCKED'];
  setRow(22, [['B', flowLabels[0], 36], ['C', flowLabels[1], 37], ['D', flowLabels[2], 37], ['E', flowLabels[3], 37], ['F', flowLabels[4], 36]]);
  setRow(25, [['B', 'LIVE MOVEMENTS  ·  IN TRANSIT', 38]]);
  setRow(26, [['B', 'CONTAINER', 39], ['C', 'TRANSPORTER', 39], ['D', 'DRIVER', 39], ['E', 'CONTACT', 39], ['F', 'CLAMPED', 39], ['G', 'LOCK', 39]]);
  rows.filter(r => r.status === 'in_transit').slice(0, 5).forEach((r, i) => {
    const rowNo = 27 + i;
    const style = i % 2 === 0 ? 40 : 42;
    const body = i % 2 === 0 ? 41 : 43;
    setRow(rowNo, [['B', displayValue(r.container_number), style], ['C', displayValue(r.transporter), body], ['D', displayValue(r.driver_name), body], ['E', displayValue(r.driver_contact), body], ['F', formatDateTime(r.clamped_at), body], ['G', displayValue(r.lock_number), body]]);
  });
  setRow(33, [['B', 'PRIORITY ACTIONS', 18]]);
  actions.forEach((action, i) => setRow(34 + i, [['B', `${i + 1}  ${action}`, [44, 46, 47, 48][i] || 44]]));
  setRow(39, [['B', 'CDS Logistics Intelligence  ·  Confidential', 49]]);

  const sheetData = `<sheetData>${rowsXml.join('')}</sheetData>`;
  let xml = replaceTag(templateXml, 'sheetData', sheetData);
  xml = xml.replace('<pageSetUpPr/>', '<pageSetUpPr fitToPage="1"/>');
  xml = xml.replace(/<dimension ref="[^"]+"\s*\/>/, '<dimension ref="A1:M49"/>');
  xml = xml.replace(/<pageMargins[^>]*\/>/, '<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="1" paperSize="9"/>');
  return xml;
}

function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid XLSX template: ZIP end record not found');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX template: central directory entry missing');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries.push({ name, data });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xFFFFFFFF;
  for (const byte of buffer) c = table[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const method = compressed.length < data.length ? 8 : 0;
    const body = method ? compressed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    parts.push(local, body);
    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42); name.copy(c, 46); central.push(c);
    offset += local.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}

async function buildManifestWorkbook(rows, snapshotAt = new Date()) {
  if (!fs.existsSync(TEMPLATE_PATH)) throw new Error(`CDS Client Pulse template not found: ${TEMPLATE_PATH}`);
  const snapshot = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
  if (Number.isNaN(snapshot.getTime())) throw new Error('Invalid Client Pulse snapshot time');
  const normalized = normalizeRows(rows || []);
  const entries = readZip(fs.readFileSync(TEMPLATE_PATH));
  const sheet1 = entries.find(e => e.name === 'xl/worksheets/sheet1.xml');
  const sheet2 = entries.find(e => e.name === 'xl/worksheets/sheet2.xml');
  const workbook = entries.find(e => e.name === 'xl/workbook.xml');
  if (!sheet1 || !sheet2 || !workbook) throw new Error('Invalid CDS Client Pulse template: required workbook parts missing');

  sheet1.data = Buffer.from(buildOverviewSheet(sheet1.data.toString('utf8'), normalized, snapshot));
  sheet2.data = Buffer.from(buildDetailSheet(sheet2.data.toString('utf8'), normalized, snapshot));
  let workbookXml = workbook.data.toString('utf8');
  workbookXml = workbookXml.replace('name="COMMAND CENTER"', 'name="BOOKING OVERVIEW"');
  workbookXml = workbookXml.replace(/(<definedName name="_xlnm\._FilterDatabase" localSheetId="1" hidden="1">)[\s\S]*?(<\/definedName>)/, (match, open, close) => `${open}'ACTIVE BOOKINGS'!$A$4:$S${normalized.length + 4}${close}`);
  const printNames = `<definedName name="_xlnm.Print_Area" localSheetId="0">'BOOKING OVERVIEW'!$A$1:$G$39</definedName><definedName name="_xlnm.Print_Area" localSheetId="1">'ACTIVE BOOKINGS'!$A$1:$S$${normalized.length + 6}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'ACTIVE BOOKINGS'!$1:$4</definedName>`;
  if (workbookXml.includes('<definedNames>')) workbookXml = workbookXml.replace('</definedNames>', `${printNames}</definedNames>`);
  else workbookXml = workbookXml.replace('</sheets>', `</sheets><definedNames>${printNames}</definedNames>`);
  workbook.data = Buffer.from(workbookXml);
  return writeZip(entries);
}

module.exports = { buildManifestWorkbook, isActiveRow };
