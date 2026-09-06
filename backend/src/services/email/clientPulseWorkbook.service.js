const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const TEMPLATE_CANDIDATES = [
  path.resolve(__dirname, '../../../../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(__dirname, '../../../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(process.cwd(), '../templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
  path.resolve(process.cwd(), 'templates/CDS_Client_Pulse_FUTURISTIC_Active_Bookings.xlsx'),
];
const TEMPLATE_PATH = TEMPLATE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || TEMPLATE_CANDIDATES[0];
const ACTIVE = new Set(['pending', 'assigned', 'in_transit', 'at_port']);
const CLOSED = new Set(['completed', 'delivered', 'cancelled', 'canceled', 'archived', 'closed']);
const TZ = process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi';

function isActiveRow(row) {
  const b = String(row.booking_status || '').toLowerCase();
  const c = String(row.status || '').toLowerCase();
  return !CLOSED.has(b) && (ACTIVE.has(c) || !['delivered', 'completed'].includes(c));
}
function formatDate(value) { if (!value) return '—'; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value); return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d); }
function formatDateTime(value) { if (!value) return '—'; const d = new Date(value); if (Number.isNaN(d.getTime())) return String(value); return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
function stamp(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value).replace(',', '').toUpperCase().replace('SEPT', 'SEP'); }
function stageLabel(row) { const s = String(row.status || '').toLowerCase(); if (s === 'in_transit') return '● IN TRANSIT'; if (s === 'at_port') return '● AT PORT'; if (s === 'assigned') return '◐ ASSIGNED'; return '○ PENDING'; }
function locationLabel(row) { if (row.yard_status) return row.yard_status; return String(row.status || '').toLowerCase() === 'in_transit' ? 'outbound' : 'yard'; }
function rowValues(row) { return [row.booking_number || '—', row.vessel || '—', row.file_reference || '—', row.commodity || '—', row.container_number || '—', row.iso_type || '—', row.seal_number || '—', stageLabel(row), formatDate(row.clamped_at), formatDateTime(row.clamped_at), row.lock_number || row.lock_serial || '—', locationLabel(row), row.transporter || '—', row.horse_reg || row.horse_reg_derived || '—', row.trailer_reg || '—', row.driver_name || row.driver_name_derived || '—', row.driver_contact || row.driver_contact_derived || '—', row.invoiced ? 'YES' : 'NO']; }
function applyBaseStyle(ws) { ws.views = [{ state: 'frozen', ySplit: 4 }]; ws.sheetProperties.pageSetUpPr = { fitToPage: true }; ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }; ws.headerFooter.oddFooter = '&L CDS CLIENT PULSE&RPage &P of &N'; }
function addTitle(ws, title, subtitle, sync, endCol) { ws.mergeCells(`A1:${endCol}1`); ws.mergeCells(`A2:${endCol}2`); ws.mergeCells(`A3:${endCol}3`); [[title,18],[subtitle,10],[sync,9]].forEach(([v,size],i)=>{ const c=ws.getCell(`A${i+1}`); c.value=v; c.font={name:'Aptos Display',size,bold:true}; c.alignment={vertical:'middle',horizontal:'left'}; ws.getRow(i+1).height=i===0?30:20; }); }
function buildCommandCenter(workbook, rows, snapshotAt, scopeLabel) {
  const ws=workbook.addWorksheet('COMMAND CENTER'); applyBaseStyle(ws);
  const units=rows.length, inTransit=rows.filter(r=>String(r.status||'').toLowerCase()==='in_transit').length, pending=units-inTransit, vessels=new Map();
  for(const r of rows){const v=r.vessel||'UNASSIGNED'; vessels.set(v,(vessels.get(v)||0)+1);} const bookingCount=new Set(rows.map(r=>r.booking_number).filter(Boolean)).size;
  addTitle(ws,`◈ CDS CLIENT PULSE • ${scopeLabel==='GLOBAL'?'GLOBAL ACTIVE BOOKINGS':`${scopeLabel.toUpperCase()} ACTIVE BOOKINGS`}`,scopeLabel==='GLOBAL'?'REAL-TIME LOGISTICS COMMAND INTERFACE | EAST AFRICA OPERATIONS':`REAL-TIME LOGISTICS COMMAND INTERFACE | ${scopeLabel.toUpperCase()}`,`LAST SYNC › ${stamp(snapshotAt)} EAT • STATUS: LIVE`,'H');
  [['ACTIVE UNITS',units],['IN TRANSIT',inTransit],['PENDING / OTHER',pending],['VESSELS',vessels.size],['BOOKINGS',bookingCount]].forEach(([label,value],i)=>{const a=ws.getCell(5,i+1),b=ws.getCell(6,i+1);a.value=label;b.value=value;a.font={bold:true,size:9};b.font={bold:true,size:18};a.alignment=b.alignment={horizontal:'center',vertical:'middle'};}); ws.getRow(5).height=18; ws.getRow(6).height=30;
  ws.getRow(8).values=['VESSEL / SERVICE','ACTIVE UNITS','STATUS','','','MOVEMENT','UNITS','SHARE']; ws.getRow(8).font={bold:true};
  const vesselRows=[...vessels.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2); for(let i=0;i<2;i++){const r=9+i,v=vesselRows[i]; ws.getRow(r).values=v?[v[0],v[1],'ACTIVE','','','IN TRANSIT',inTransit,units?`${(inTransit/units*100).toFixed(1)}%`:'0.0%`']:[i===0?'—':'—',0,'—','','',i===0?'IN TRANSIT':'PENDING',i===0?inTransit:pending,units?`${((i===0?inTransit:pending)/units*100).toFixed(1)}%`:'0.0%'];}
  ws.getRow(13).values=['CONTAINER','VESSEL','TRANSPORTER','DRIVER','CONTACT','LAST MOVEMENT','E-LOCK']; ws.getRow(13).font={bold:true}; const movementRows=rows.filter(r=>String(r.status||'').toLowerCase()==='in_transit').slice(0,8);
  for(let i=0;i<8;i++){const r=movementRows[i];ws.getRow(14+i).values=r?[r.container_number||'—',r.vessel||'—',r.transporter||'—',r.driver_name||r.driver_name_derived||'—',r.driver_contact||r.driver_contact_derived||'—',formatDateTime(r.clamped_at),r.lock_number||r.lock_serial||'—']:['—','—','—','—','—','—','—'];}
  ws.mergeCells('A24:H24'); ws.getCell('A24').value=`◈ CDS LOGISTICS INTELLIGENCE PLATFORM • ${scopeLabel.toUpperCase()} • CLASSIFIED OPERATIONAL DATA • UNAUTHORIZED ACCESS PROHIBITED`; ws.getCell('A24').font={bold:true,size:9}; ws.getCell('A24').alignment={horizontal:'center',vertical:'middle'}; ws.getRow(24).height=24; ws.columns=[18,18,20,22,18,20,16,16]; return ws;
}
function buildActiveBookings(workbook, rows, snapshotAt, scopeLabel) {
  const ws=workbook.addWorksheet('ACTIVE BOOKINGS'); applyBaseStyle(ws); const units=rows.length, bookings=new Set(rows.map(r=>r.booking_number).filter(Boolean)).size;
  addTitle(ws,`◉ ${scopeLabel==='GLOBAL'?'GLOBAL':scopeLabel.toUpperCase()} ACTIVE BOOKINGS • CONTAINER TRACKING MATRIX`,`DATA STREAM › ${units} UNITS • ${bookings} BOOKINGS`,`SYNCED ${stamp(snapshotAt)} EAT`,'R');
  const headers=['BOOKING','VESSEL','FILE REF','COMMODITY','CONTAINER','ISO TYPE','SEAL','STAGE','CLAMP DATE','CLAMP TIME','E-LOCK','LOCATION','TRANSPORTER','HORSE REG','TRAILER REG','DRIVER','CONTACT','INVOICED']; ws.getRow(4).values=headers; ws.getRow(4).font={bold:true,size:9}; ws.getRow(4).alignment={horizontal:'center',vertical:'middle',wrapText:true}; ws.getRow(4).height=30;
  rows.forEach((row,index)=>{const er=ws.addRow(rowValues(row)); er.height=24; er.eachCell(cell=>{cell.alignment={vertical:'middle',horizontal:'left',wrapText:true}; if(index%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F4F7'}};});});
  const footerRow=rows.length+5; ws.mergeCells(`A${footerRow}:R${footerRow}`); ws.getCell(`A${footerRow}`).value=`◈ CDS CLIENT PULSE • ${scopeLabel.toUpperCase()} • END OF DATA STREAM • ALL SYSTEMS NOMINAL`; ws.getCell(`A${footerRow}`).font={bold:true,size:9}; ws.getCell(`A${footerRow}`).alignment={horizontal:'center',vertical:'middle'}; ws.getRow(footerRow).height=24; ws.autoFilter={from:'A4',to:`R${footerRow-1}`}; ws.columns=[14,18,16,18,18,11,15,17,13,17,16,16,18,15,15,22,20,12].map(width=>({width})); return ws;
}
async function buildManifestWorkbook(rows, snapshotAt=new Date(), options={}) {
  const scopeLabel=String(options.scopeLabel||'GLOBAL').trim()||'GLOBAL'; const workbook=new ExcelJS.Workbook(); workbook.creator='Sonalit'; workbook.lastModifiedBy='Sonalit'; workbook.created=snapshotAt; workbook.modified=snapshotAt; workbook.properties.subject='CDS Client Dispatch Master — Active Bookings'; workbook.properties.title=`${scopeLabel} Client Dispatch Master — Active Bookings`;
  buildCommandCenter(workbook,rows,snapshotAt,scopeLabel); buildActiveBookings(workbook,rows,snapshotAt,scopeLabel); const buffer=await workbook.xlsx.writeBuffer(); if(!buffer||buffer.length<1000)throw new Error('Client Pulse XLSX generation returned an invalid workbook');
  const verification=new ExcelJS.Workbook(); await verification.xlsx.load(buffer); if(!verification.getWorksheet('COMMAND CENTER')||!verification.getWorksheet('ACTIVE BOOKINGS'))throw new Error('Client Pulse XLSX verification failed: required sheets missing'); return Buffer.from(buffer);
}
module.exports={buildManifestWorkbook,isActiveRow,TEMPLATE_PATH};