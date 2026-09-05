const zlib = require('zlib');

const COLUMNS = [
  ['booking_number','BOOKING NO'],['carrier_reference','CARRIER REF'],['vessel','VESSEL'],['file_reference','AW FILE REF NO'],['controller','CONTROLLER'],['commodity','COMMODITY'],
  ['packing_list_no','PACKING LIST NO'],['container_number','CONTAINER NO'],['iso_type','TYPE'],['seal_number','SEAL 1'],['seal_number_2','SEAL 2'],['status','STAGE'],['clamped_at','DATE CLAMPED'],['clamped_at_t','TIME CLAMPED'],['unclamped_at','TIME UNCLAMPED'],['lock_number','LOCK NO'],['terminal','TERMINAL'],['yard_status','LOCATION'],['transporter','TRANSPORTER'],['horse_reg','HORSE REG'],['trailer_reg','TRAILER REG'],['driver_name','DRIVER NAME'],['driver_contact','DRIVER CONTACT'],['invoiced','INVOICED']
];
const ACTIVE = new Set(['pending','assigned','in_transit','at_port']);
const CLOSED = new Set(['completed','delivered','cancelled','canceled','archived','closed']);
function isActiveRow(row) { const b=String(row.booking_status||'').toLowerCase(); const c=String(row.status||'').toLowerCase(); return !CLOSED.has(b) && (ACTIVE.has(c) || !['delivered','completed'].includes(c)); }
function esc(v) { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function col(n) { let s=''; for(n++;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; }
function fmt(v,time=false) { if(v==null||v==='') return ''; const d=new Date(v); if(Number.isNaN(d.getTime())) return String(v); return new Intl.DateTimeFormat('en-GB',{timeZone:process.env.CDS_CLIENT_PULSE_TIMEZONE||'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit',...(time?{hour:'2-digit',minute:'2-digit',hour12:false}:{})}).format(d); }
function cell(r,v,style='') { if(v==null||v==='') return ''; return `<c r="${r}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`; }
function sheet(rows) {
  let x='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>';
  x+='<row r="1" ht="22" customHeight="1">'; COLUMNS.forEach(([,h],i)=>x+=cell(`${col(i)}1`,h,' s="1"')); x+='</row>';
  rows.forEach((row,ri)=>{const r=ri+2;x+=`<row r="${r}">`;COLUMNS.forEach(([k],i)=>{let v=row[k];if(k==='clamped_at')v=fmt(v);else if(k==='clamped_at_t'||k==='unclamped_at')v=fmt(v,true);x+=cell(`${col(i)}${r}`,v);});x+='</row>';});
  return x+`</sheetData><autoFilter ref="A1:X${rows.length+1}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
function crc32(b) { let t=crc32.t;if(!t){t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}crc32.t=t;}let c=0xffffffff;for(const v of b)c=t[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0; }
function zip(entries) {
  const parts=[],cd=[];let off=0;
  for(const e of entries){const name=Buffer.from(e.name),data=Buffer.isBuffer(e.data)?e.data:Buffer.from(e.data);const def=zlib.deflateRawSync(data),method=def.length<data.length?8:0,body=method?def:data,crc=crc32(data);
    const l=Buffer.alloc(30+name.length);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt16LE(method,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(body.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(name.length,26);name.copy(l,30);parts.push(l,body);
    const c=Buffer.alloc(46+name.length);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(off,42);name.copy(c,46);cd.push(c);off+=l.length+body.length;
  }
  const central=Buffer.concat(cd),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(cd.length,8);end.writeUInt16LE(cd.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(off,16);return Buffer.concat([...parts,central,end]);
}
async function buildManifestWorkbook(rows) {
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const root='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Booking Manifest" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rel='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellXfs></styleSheet>';
  return zip([{name:'[Content_Types].xml',data:types},{name:'_rels/.rels',data:root},{name:'xl/workbook.xml',data:wb},{name:'xl/_rels/workbook.xml.rels',data:rel},{name:'xl/styles.xml',data:styles},{name:'xl/worksheets/sheet1.xml',data:sheet(rows)}]);
}
module.exports={buildManifestWorkbook,isActiveRow};
