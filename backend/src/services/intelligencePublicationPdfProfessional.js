'use strict';

const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { cleanPublicationText, dedupeSources: dedupePublicationSources, uniqueStrings } = require('../utils/publicationQuality');

const PDF_RENDERER_VERSION = '2.4.0';

const COUNTRY_NAMES = {
  KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania',
  RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea',
  SD:'Sudan', CD:'DR Congo'
};

const COUNTRY_ISO3 = {
  KE:'KEN', SO:'SOM', ET:'ETH', UG:'UGA', TZ:'TZA', RW:'RWA',
  BI:'BDI', SS:'SSD', DJ:'DJI', ER:'ERI', SD:'SDN', CD:'COD'
};

const SEVERITY_SCORE = { critical:4, high:3, moderate:2, low:1, informational:0 };
const SEVERITY_COLOR = {
  critical:'#b91c1c',
  high:'#ea580c',
  moderate:'#d97706',
  low:'#2563eb',
  informational:'#64748b'
};
const DOMAIN_COLOR = '#0f172a';
const ACCENT = '#f97316';
const INK = '#0f172a';
const MUTED = '#64748b';
const SOFT = '#f8fafc';
const LINE = '#e2e8f0';
const LIGHT = '#eef2f7';
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - (MARGIN * 2);
const TOP = 94;
const BOTTOM = 784;

const boundaryCache = new Map();

function text(v, max=5000) {
  return cleanPublicationText(v, max);
}

function upper(v) {
  return text(v, 300).toUpperCase();
}

function severityScore(v) {
  return SEVERITY_SCORE[String(v || '').toLowerCase()] ?? 2;
}

function severityColor(v) {
  return SEVERITY_COLOR[String(v || '').toLowerCase()] || '#64748b';
}

function safeUrl(v) {
  try {
    const u = new URL(String(v));
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch (_) {
    return null;
  }
}

function dedupeSources(list, max=6) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const url = safeUrl(item && item.url);
    const domain = text(item && item.domain || item && item.source || '', 120).toLowerCase();
    const title = text(item && item.title || 'Source', 240).toLowerCase();
    const key = (url || domain + '|' + title).replace(/\/$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, url: url || null, domain: domain || item.domain || null });
    if (out.length >= max) break;
  }
  return out;
}

function researchForEvent(publicationBody, event) {
  const dossiers = Array.isArray(publicationBody && publicationBody.incident_dossiers)
    ? publicationBody.incident_dossiers
    : [];
  const direct = dossiers.find(d => String(d && d.event_id) === String(event && event.id));
  return direct || null;
}

function mergeIncident(event, publicationBody) {
  const dossier = researchForEvent(publicationBody, event) || {};
  return {
    ...event,
    research: dossier,
    headline: text(dossier.headline || event.canonical_headline || event.headline || event.title || 'Security development', 220),
    brief: text(dossier.what_happened || event.executive_brief || event.brief || event.summary || event.title || 'Evidence record available.', 2600),
    region: text(dossier.region || event.region || 'Location not established', 140),
    assessmentText: text(dossier.assessment || (event.assessment && event.assessment.judgement) || '', 1600),
    contextText: text(dossier.context || '', 1300),
    whyText: Array.isArray(dossier.why_it_matters) ? dossier.why_it_matters.map(x => text(x, 700)).filter(Boolean).slice(0,4) : [],
    facts: Array.isArray(dossier.key_facts) ? dossier.key_facts.map(x => text(x, 600)).filter(Boolean).slice(0,5) : [],
    uncertainty: Array.isArray(dossier.caveats) ? dossier.caveats.map(x => text(x, 700)).filter(Boolean).slice(0,4) : [],
    disputed: Array.isArray(dossier.reported_or_disputed) ? dossier.reported_or_disputed.map(x => text(x, 700)).filter(Boolean).slice(0,4) : [],
    chronology: Array.isArray(dossier.chronology) ? dossier.chronology.slice(0,5).map(x => ({
      time:text(x && x.time, 80),
      event:text(x && x.event, 460)
    })).filter(x => x.time || x.event) : [],
    sources: dedupeSources(
      (Array.isArray(dossier.research_sources) ? dossier.research_sources : [])
        .concat(Array.isArray(dossier.source_refs) ? dossier.source_refs : [])
        .concat(Array.isArray(event.evidence) ? event.evidence : []),
      8
    ),
    researchStatus: upper(dossier.research_status || ''),
    researchProvider: text(dossier.research_provider || '', 100),
    researchNotes: text(dossier.search_notes || '', 700)
  };
}

function priorityEvents(events, max=6) {
  const ordered = (Array.isArray(events) ? events : [])
    .map(e => ({ e, score: severityScore(e.severity) * 1000 + Number(e.confidence || 0) * 2 + Number(e.source_count || 0) * 10 }))
    .sort((a,b) => b.score - a.score || new Date(b.e.last_seen_at || 0) - new Date(a.e.last_seen_at || 0))
    .map(x => x.e);

  const selected = [];
  const types = new Set();
  for (const e of ordered) {
    const t = upper(e.intelligence_type || 'OTHER');
    if (selected.length < max && !types.has(t) && severityScore(e.severity) >= 2) {
      selected.push(e);
      types.add(t);
    }
  }
  for (const e of ordered) {
    if (selected.length >= max) break;
    if (!selected.some(x => String(x.id) === String(e.id))) selected.push(e);
  }
  return selected.slice(0, max);
}

function dateLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'DATE NOT ESTABLISHED';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
}

function periodLabel(publication) {
  const s = publication.period_start || publication.body && publication.body.period_start;
  const e0 = publication.period_end || publication.body && publication.body.period_end;
  if (!s || !e0) return 'REPORTING PERIOD NOT ESTABLISHED';
  const e = new Date(new Date(e0).getTime() - 1);
  return dateLabel(s) + ' - ' + dateLabel(e);
}

function addPage(doc) {
  doc.addPage();
  return TOP;
}

function drawRule(doc, y, x=MARGIN, w=CONTENT_W, color=LINE) {
  doc.moveTo(x, y).lineTo(x+w, y).lineWidth(0.6).strokeColor(color).stroke();
}

function sectionHeading(doc, y, title, subtitle) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text(upper(title), MARGIN, y, { width:CONTENT_W });
  if (subtitle) {
    y += 23;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(text(subtitle, 240), MARGIN, y, { width:CONTENT_W });
    y += 19;
  } else {
    y += 24;
  }
  drawRule(doc, y);
  return y + 15;
}

function blockHeight(doc, value, width, font='Helvetica', size=9, lineGap=3) {
  const s = text(value, 10000) || '-';
  return doc.heightOfString(s, { width, font, fontSize:size, lineGap });
}

function ensure(doc, y, needed) {
  if (y + needed <= BOTTOM) return y;
  return addPage(doc);
}

function paragraph(doc, y, value, opts={}) {
  const width = opts.width || CONTENT_W;
  const size = opts.size || 9;
  const font = opts.font || 'Helvetica';
  const lineGap = opts.lineGap == null ? 3.1 : opts.lineGap;
  const max = opts.max || 10000;
  const s = text(value, max) || '-';
  const h = blockHeight(doc, s, width, font, size, lineGap);
  y = ensure(doc, y, h + 2);
  doc.fillColor(opts.color || INK).font(font).fontSize(size).text(s, opts.x || MARGIN, y, { width, lineGap });
  return y + h;
}

function smallLabel(doc, x, y, label, width=120) {
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.7).text(upper(label), x, y, { width, characterSpacing:0.7 });
}

function badge(doc, x, y, label, width=88, color=ACCENT) {
  doc.roundedRect(x, y, width, 18, 5).fill(color);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(6.5).text(upper(label), x+5, y+6, { width:width-10, align:'center' });
}

function card(doc, x, y, w, h, fill=SOFT) {
  doc.roundedRect(x, y, w, h, 9).fill(fill);
  doc.roundedRect(x, y, w, h, 9).lineWidth(0.5).strokeColor(LINE).stroke();
}

function metricCard(doc, x, y, w, label, value, note) {
  card(doc, x, y, w, 73);
  smallLabel(doc, x+11, y+12, label, w-22);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(text(value, 40) || '-', x+11, y+28, { width:w-22 });
  if (note) doc.fillColor(MUTED).font('Helvetica').fontSize(6.8).text(text(note, 90), x+11, y+53, { width:w-22 });
}

function trendsHaveBaseline(trends){
  return Array.isArray(trends)&&trends.some(t=>t&&t.basis==='PERIOD_COMPARISON');
}

function listHeight(doc, items, width, size=8.2, gap=5) {
  let total=0;
  for(const item of Array.isArray(items)?items:[]){
    const s=text(item,950);
    if(!s)continue;
    total+=blockHeight(doc,'- '+s,width,'Helvetica',size,2.6)+gap;
  }
  return total;
}

function bullets(doc, y, items, opts={}) {
  const width = opts.width || CONTENT_W - 20;
  const x = opts.x || MARGIN + 8;
  const size = opts.size || 8.2;
  const gap = opts.gap == null ? 5 : opts.gap;
  for (const item of Array.isArray(items) ? items : []) {
    const s = text(item, 950);
    if (!s) continue;
    const h = blockHeight(doc, '- ' + s, width, 'Helvetica', size, 2.6);
    y = ensure(doc, y, h + gap);
    doc.fillColor(opts.color || INK).font('Helvetica').fontSize(size).text('- ' + s, x, y, { width, lineGap:2.6 });
    y += h + gap;
  }
  return y;
}

function drawConfidence(doc, x, y, width, confidence) {
  const value = Math.max(0, Math.min(100, Number(confidence) || 0));
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5).text('ANALYTICAL CONFIDENCE', x, y, { width });
  doc.roundedRect(x, y+13, width, 8, 4).fill(LIGHT);
  if (value > 0) doc.roundedRect(x, y+13, width * value / 100, 8, 4).fill(ACCENT);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(value + '%', x, y+28, { width, align:'right' });
}

async function countryGeometry(country) {
  if (boundaryCache.has(country)) return boundaryCache.get(country);
  const iso3 = COUNTRY_ISO3[country];
  if (!iso3) return null;
  const url = 'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/' + iso3 + '.geo.json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers:{ 'User-Agent':'Sonalit-Professional-Publication/1.0' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    boundaryCache.set(country, data);
    return data;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function geometryCoordinates(geometry) {
  const coords = [];
  function walk(v) {
    if (!Array.isArray(v)) return;
    if (v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) {
      coords.push([Number(v[0]), Number(v[1])]);
      return;
    }
    for (const child of v) walk(child);
  }
  walk(geometry && geometry.coordinates);
  return coords;
}

function geometryFeatures(geo) {
  if (!geo) return [];
  if (geo.type === 'FeatureCollection') return geo.features || [];
  if (geo.type === 'Feature') return [geo];
  if (geo.type) return [{ type:'Feature', geometry:geo, properties:{} }];
  return [];
}

function geometryBounds(geo) {
  const points=geometryFeatures(geo).flatMap(f=>geometryCoordinates(f.geometry));
  return projectBounds(points,null);
}

function projectBounds(points, geo) {
  const all=(Array.isArray(points)?points:[]).concat(
    geometryFeatures(geo).flatMap(f=>geometryCoordinates(f.geometry))
  );
  const finite=all.filter(p=>Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));
  if(!finite.length)return [0,0,1,1];
  let minLon=Math.min(...finite.map(p=>p[0]));
  let maxLon=Math.max(...finite.map(p=>p[0]));
  let minLat=Math.min(...finite.map(p=>p[1]));
  let maxLat=Math.max(...finite.map(p=>p[1]));
  if(maxLon-minLon<1){minLon-=0.5;maxLon+=0.5;}
  if(maxLat-minLat<1){minLat-=0.5;maxLat+=0.5;}
  const lonPad=(maxLon-minLon)*0.08;
  const latPad=(maxLat-minLat)*0.08;
  return [minLon-lonPad,minLat-latPad,maxLon+lonPad,maxLat+latPad];
}

function pointInsideBounds(point,bounds,pad=0.15){
  const [minLon,minLat,maxLon,maxLat]=bounds;
  const lonSpan=Math.max(maxLon-minLon,0.1);
  const latSpan=Math.max(maxLat-minLat,0.1);
  return point[0]>=minLon-lonSpan*pad&&point[0]<=maxLon+lonSpan*pad&&
    point[1]>=minLat-latSpan*pad&&point[1]<=maxLat+latSpan*pad;
}

function svgPathForGeometry(geometry, bounds, box) {
  const [minLon,minLat,maxLon,maxLat] = bounds;
  const [x0,y0,w,h] = box;
  const project = p => [
    x0 + ((p[0]-minLon)/(maxLon-minLon))*w,
    y0 + h - ((p[1]-minLat)/(maxLat-minLat))*h
  ];
  const polygons = [];
  function ringPath(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return '';
    return ring.map((p,i) => {
      const [x,y] = project(p);
      return (i===0?'M':'L') + x.toFixed(2) + ' ' + y.toFixed(2);
    }).join(' ') + ' Z';
  }
  const type = geometry && geometry.type;
  if (type === 'Polygon') {
    for (const ring of geometry.coordinates || []) {
      const d=ringPath(ring); if(d) polygons.push(d);
    }
  } else if (type === 'MultiPolygon') {
    for (const poly of geometry.coordinates || []) {
      for (const ring of poly || []) {
        const d=ringPath(ring); if(d) polygons.push(d);
      }
    }
  }
  return polygons.join(' ');
}

async function buildIncidentMap(country, events) {
  const allPoints=(Array.isArray(events)?events:[])
    .filter(e=>Number.isFinite(Number(e.latitude))&&Number.isFinite(Number(e.longitude)))
    .map((e,i)=>({
      n:i+1,
      lon:Number(e.longitude),
      lat:Number(e.latitude),
      headline:text(e.headline||e.title||('Event '+(i+1)),90),
      severity:e.severity||'moderate'
    }));

  const points=allPoints
    .slice()
    .sort((a,b)=>severityScore(b.severity)-severityScore(a.severity)||a.n-b.n)
    .slice(0,24)
    .map((p,i)=>({...p,n:i+1}));

  const geo=await countryGeometry(country);
  const countryBounds=geo?geometryBounds(geo):null;
  const plotPoints=countryBounds
    ? points.filter(p=>pointInsideBounds([p.lon,p.lat],countryBounds,0.12))
    : points;
  const excludedPoints=points.length-plotPoints.length;
  const pointsLonLat=plotPoints.map(p=>[p.lon,p.lat]);
  const bounds=countryBounds||projectBounds(pointsLonLat,null);
  const W=3200,H=1800,pad=150,mapBox=[pad,235,W-pad*2,H-390];
  const [minLon,minLat,maxLon,maxLat]=bounds;
  const proj=p=>[
    mapBox[0]+((p.lon-minLon)/(maxLon-minLon))*mapBox[2],
    mapBox[1]+mapBox[3]-((p.lat-minLat)/(maxLat-minLat))*mapBox[3]
  ];
  const paths=[];
  for(const feature of geometryFeatures(geo)){
    const d=svgPathForGeometry(feature.geometry,bounds,mapBox);
    if(d)paths.push('<path d="'+d+'" fill="#19313b" stroke="#8ca3ad" stroke-width="3" fill-rule="evenodd"/>');
  }
  const graticule=[];
  for(let i=1;i<4;i++){
    const gy=mapBox[1]+mapBox[3]*i/4;
    const gx=mapBox[0]+mapBox[2]*i/4;
    graticule.push('<line x1="'+mapBox[0]+'" y1="'+gy+'" x2="'+(mapBox[0]+mapBox[2])+'" y2="'+gy+'" stroke="#cbd5e1" stroke-width="2" opacity=".45"/>');
    graticule.push('<line x1="'+gx+'" y1="'+mapBox[1]+'" x2="'+gx+'" y2="'+(mapBox[1]+mapBox[3])+'" stroke="#cbd5e1" stroke-width="2" opacity=".45"/>');
  }
  const escXml=v=>text(v,220).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const markers=plotPoints.map(p=>{
    const [x,y]=proj(p),c=severityColor(p.severity),r=9+severityScore(p.severity)*2;
    const labelX=x+16,labelY=y-9;
    return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(r+9).toFixed(1)+'" fill="'+c+'" opacity=".11"/>'+
      '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+c+'" stroke="#f8fafc" stroke-width="4"/>'+
      '<text x="'+labelX.toFixed(1)+'" y="'+labelY.toFixed(1)+'" fill="#f8fafc" font-family="Arial" font-size="20" font-weight="700">#'+p.n+'</text>'+
      '<text x="'+labelX.toFixed(1)+'" y="'+(labelY+20).toFixed(1)+'" fill="#b7c7cd" font-family="Arial" font-size="14">'+escXml(String(p.severity||"moderate").toUpperCase())+'</text>';
  }).join('');
  const label=geo ? (COUNTRY_NAMES[country]||country)+' - INCIDENT GEOGRAPHY' : 'COORDINATE PLOT - GEOGRAPHIC COVERAGE';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+
    '<rect width="100%" height="100%" fill="#08131a"/>'+
    '<rect x="55" y="30" width="'+(W-110)+'" height="'+(H-60)+'" rx="18" fill="#0d2028" stroke="#29414b"/>'+
    '<text x="'+pad+'" y="64" font-family="Arial" font-size="48" font-weight="700" fill="#f4f7f8">'+escXml(label)+'</text>'+
    '<text x="'+pad+'" y="104" font-family="Arial" font-size="23" fill="#9eb0b8">'+
      escXml(geo?'Recorded event coordinates; marker numbers correspond to the spatial register.':'Usable event coordinates plotted without inventing a geographic boundary.')+'</text>'+
    graticule.join('')+paths.join('')+markers+
    '<text x="'+pad+'" y="'+(H-78)+'" font-family="Arial" font-size="19" fill="#64748b">Extent: '+minLon.toFixed(2)+' to '+maxLon.toFixed(2)+' longitude | '+minLat.toFixed(2)+' to '+maxLat.toFixed(2)+' latitude</text>'+
    '<rect x="'+pad+'" y="'+(H-166)+'" width="510" height="78" rx="12" fill="#f5f7f8"/>'+
    '<text x="'+(pad+18)+'" y="'+(H-142)+'" fill="#20313a" font-family="Arial" font-size="16" font-weight="700">LEGEND · SIZE = SEVERITY · NUMBER = REGISTERED EVENT</text>'+
    '<circle cx="'+(pad+24)+'" cy="'+(H-113)+'" r="7" fill="#b91c1c"/>'+
    '<text x="'+(pad+41)+'" y="'+(H-108)+'" fill="#5d7078" font-family="Arial" font-size="15">CRITICAL / HIGH PRIORITY</text>'+
    '<circle cx="'+(pad+274)+'" cy="'+(H-113)+'" r="7" fill="#d97706"/>'+
    '<text x="'+(pad+291)+'" y="'+(H-108)+'" fill="#5d7078" font-family="Arial" font-size="15">MODERATE</text>'+
    '<text x="'+(pad+18)+'" y="'+(H-95)+'" fill="#6f858e" font-family="Arial" font-size="14">'+escXml('Position represents the recorded coordinate only; it does not establish an affected-area boundary.')+'</text>'+
    '<text x="'+pad+'" y="'+(H-46)+'" font-family="Arial" font-size="18" fill="#64748b">'+
      escXml(geo?'Boundary source: country GeoJSON | Event source: Sonalit evidence ledger':'Boundary source unavailable; this is a coordinate plot, not a country map.')+'</text>'+
    '</svg>';
  return {
    image:await sharp(Buffer.from(svg)).png().toBuffer(),
    points:plotPoints,
    excludedPoints,
    totalPoints:allPoints.length,
    source:geo?'country GeoJSON boundary':'coordinate plot fallback'
  };
}

function drawVectorAnalytics(doc,y,events,publication){
  const width=CONTENT_W, gap=12, panelW=(width-gap)/2, panelH=250;
  const start=new Date(publication?.period_start||publication?.body?.period_start||Date.now());
  const end=new Date(publication?.period_end||publication?.body?.period_end||Date.now());
  const span=Math.max(1,end.getTime()-start.getTime());
  card(doc,MARGIN,y,panelW,panelH,'#f8fafc');
  smallLabel(doc,MARGIN+14,y+14,'ACTIVITY TIMELINE',panelW-28);
  doc.fillColor(MUTED).font('Helvetica').fontSize(6.6).text('Recorded security events distributed across the completed reporting window.',MARGIN+14,y+28,{width:panelW-28});
  const bins=Math.max(8,Math.min(24,Math.round(span/3600000)));
  const counts=new Array(bins).fill(0);
  for(const e of Array.isArray(events)?events:[]){
    const t=new Date(e.occurred_from||e.last_seen_at||0).getTime();
    if(!Number.isFinite(t)||t<start.getTime()||t>=end.getTime())continue;
    counts[Math.min(bins-1,Math.max(0,Math.floor((t-start.getTime())/span*bins)))]++;
  }
  const max=Math.max(1,...counts), chartX=MARGIN+18, chartY=y+60, chartW=panelW-36, chartH=132;
  doc.moveTo(chartX,chartY+chartH).lineTo(chartX+chartW,chartY+chartH).lineWidth(.6).strokeColor(LINE).stroke();
  const bw=Math.max(3,(chartW-(bins-1)*2)/bins);
  counts.forEach((v,i)=>{const h=chartH*(v/max);const x=chartX+i*(bw+2);doc.roundedRect(x,chartY+chartH-h,bw,Math.max(1,h),2).fill(ACCENT);if(i===0||i===bins-1||i%Math.max(1,Math.floor(bins/6))===0){doc.fillColor(MUTED).font('Helvetica').fontSize(5.5).text(String(i),x,chartY+chartH+7,{width:bw,align:'center'});}});
  doc.fillColor(MUTED).font('Helvetica').fontSize(5.6).text('BIN',chartX,chartY+chartH+20);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.4).text('Peak bin: '+String(counts.indexOf(max)+1).padStart(2,'0')+' · '+String(max)+' event(s)',chartX,y+218,{width:panelW-36});
  const sx=MARGIN+panelW+gap, sy=y;
  card(doc,sx,sy,panelW,panelH,'#f8fafc');
  smallLabel(doc,sx+14,sy+14,'SEVERITY + GEOGRAPHIC CONCENTRATION',panelW-28);
  const sevKeys=['critical','high','moderate','low','informational'];
  const totals={critical:0,high:0,moderate:0,low:0,informational:0};
  for(const e of Array.isArray(events)?events:[]){const k=String(e.severity||'moderate').toLowerCase();if(Object.prototype.hasOwnProperty.call(totals,k))totals[k]++;}
  let cy=sy+46, used=0, total=Math.max(1,events.length);
  for(const k of sevKeys){const v=totals[k];smallLabel(doc,sx+14,cy,k.toUpperCase(),68);doc.roundedRect(sx+84,cy-2,panelW-116,10,4).fill(LIGHT);const bw2=(panelW-116)*v/total;if(bw2>0)doc.roundedRect(sx+84,cy-2,bw2,10,4).fill(severityColor(k));doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.8).text(String(v),sx+panelW-25,cy,{width:14,align:'right'});cy+=25;used+=v;}
  const regions=new Map();for(const e of Array.isArray(events)?events:[]){const region=text(e.region||'UNALLOCATED',80).toUpperCase();regions.set(region,(regions.get(region)||0)+1);}
  const topRegions=Array.from(regions.entries()).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.2).text('TOP RECORDED AREAS',sx+14,cy+4,{width:panelW-28});cy+=20;
  const maxRegion=Math.max(1,...topRegions.map(x=>x[1]));
  for(const [name,count] of topRegions){doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(5.8).text(name,sx+14,cy,{width:92});const bw3=(panelW-128)*count/maxRegion;doc.roundedRect(sx+108,cy-2,panelW-132,8,3).fill(LIGHT);if(bw3>0)doc.roundedRect(sx+108,cy-2,bw3,8,3).fill(ACCENT);doc.fillColor(INK).font('Helvetica-Bold').fontSize(5.8).text(String(count),sx+panelW-20,cy,{width:12,align:'right'});cy+=18;}
  doc.fillColor(MUTED).font('Helvetica').fontSize(5.8).text('Vector graphics are calculated from the stored evidence ledger; they are descriptive, not independent confirmation.',sx+14,sy+222,{width:panelW-28,lineGap:2});
  return y+panelH+18;
}
function sectionIndex(doc, y, rows) {
  let cy=y;
  for (const row of rows) {
    const h=50;
    card(doc,MARGIN,cy,CONTENT_W,h);
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8.5).text(row[0],MARGIN+14,cy+19,{width:30});
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.4).text(text(row[1],120),MARGIN+58,cy+14,{width:180});
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text(text(row[2],260),MARGIN+250,cy+14,{width:245,lineGap:2});
    cy+=58;
  }
  return cy;
}

function sourceLabel(source) {
  return text(source && (source.source_name || source.source || source.domain) || 'Source', 120);
}

function sourceTitle(source) {
  return text(source && source.title || 'Evidence record', 190);
}

async function buildProfessionalPdf(publication, events, images=[]) {
  const body = publication.body || {};
  const mergedEvents = (Array.isArray(events) ? events : []).map(e => mergeIncident(e, body));
  const maxDossiers = body.publication_type === 'weekly' ? 7 : body.publication_type === 'monthly' ? 7 : 5;
  const priorities = priorityEvents(mergedEvents, maxDossiers);
  const priorityMerged = priorities.map(e => mergeIncident(e, body));
  const confidence = mergedEvents.length
    ? Math.round(mergedEvents.reduce((n,e)=>n+Number(e.confidence||0),0)/mergedEvents.length)
    : 0;
  const counts = { critical:0, high:0, moderate:0, low:0, informational:0 };
  mergedEvents.forEach(e => {
    const k=String(e.severity||'moderate').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts,k)) counts[k] += 1;
    else counts.moderate += 1;
  });
  const posture = counts.critical ? 'CRITICAL' : counts.high ? 'HIGH' : counts.moderate ? 'MODERATE' : counts.low ? 'LOW' : 'INFORMATIONAL';
  const trajectory = text(body.threat_posture && body.threat_posture.trajectory || 'STABLE', 30).toUpperCase();

  const doc = new PDFDocument({
    size:'A4',
    margin:MARGIN,
    autoFirstPage:false,
    bufferPages:true,
    info:{
      Title:text(publication.title || 'Sonalit Intelligence Publication',220),
      Author:'SONALIT INTELLIGENCE & SECURITY OPERATIONS',
      Subject:'Evidence-governed intelligence publication',
      Keywords:'intelligence, security, assessment, evidence, Sonalit'
    }
  });
  const chunks=[];
  doc.on('data',c=>chunks.push(c));
  const done=new Promise((resolve,reject)=>{
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);
  });

  let y=addPage(doc);

  // COVER
  doc.rect(MARGIN,74,CONTENT_W,235).fill(DOMAIN_COLOR);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text('SONALIT',MARGIN+24,98,{characterSpacing:1.8});
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(28).text(upper(publication.country_code ? COUNTRY_NAMES[publication.country_code] : body.country_name || 'REGIONAL'),MARGIN+24,135,{width:430});
  doc.fillColor('#cbd5e1').font('Helvetica').fontSize(15).text(upper(body.publication_type || publication.publication_type || 'INTELLIGENCE') + ' INTELLIGENCE',MARGIN+24,177,{width:430});
  doc.fillColor('#dbe4f0').font('Helvetica').fontSize(9.5).text(text(publication.subtitle || body.subtitle || 'Evidence-governed decision support',200),MARGIN+24,210,{width:430});
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8.2).text('CONFIDENTIAL | CONTROLLED DISTRIBUTION | EVIDENCE-LINKED',MARGIN+24,259,{characterSpacing:.7});
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text('Reporting period: ' + periodLabel(publication),MARGIN+24,336,{width:430});
  doc.fillColor(MUTED).fontSize(7.8).text('Generated from the Sonalit evidence, research, assessment and publication-quality control pipeline.',MARGIN+24,357,{width:430});
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('DECISION PURPOSE',MARGIN,410);
  y=431;
  y=paragraph(doc,y, body.security_environment && body.security_environment.summary || publication.executive_assessment || 'Evidence-governed intelligence for operational decision support.', {size:9.4,max:1500});
  y+=10;
  card(doc,MARGIN,y,CONTENT_W,88);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('CURRENT POSTURE',MARGIN+14,y+15);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(posture,MARGIN+14,y+31);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Trajectory: ' + trajectory,MARGIN+150,y+16,{width:100});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Recorded events: ' + mergedEvents.length,MARGIN+150,y+36,{width:100});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Average confidence: ' + confidence + '%',MARGIN+150,y+56,{width:140});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Priority dossiers: ' + priorityMerged.length,MARGIN+320,y+16,{width:120});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Mapped events: ' + mergedEvents.filter(e=>e.latitude!=null&&e.longitude!=null).length,MARGIN+320,y+36,{width:120});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Research depth: ' + (body.deep_research && body.deep_research.incidents_researched || 0) + ' researched',MARGIN+320,y+56,{width:145});

  // CONTENTS
  y=addPage(doc);
  y=sectionHeading(doc,y,'Contents','A decision-oriented structure designed for rapid extraction, then deeper case reading.');
  y=sectionIndex(doc,y,[
    ['01','Executive assessment','Key judgments, posture, change, confidence and immediate watchpoints'],
    ['02','Operating environment','What the current evidence set says about public safety and security'],
    ['03','Emerging trends','Evidence-derived concentrations, drivers and analytical tension'],
    ['04','Priority incident dossiers','Deep case treatment for the incidents most relevant to decision-makers'],
    ['05','Regional picture','Concise geographic roll-up, without duplicating full dossiers'],
    ['06','PMESI','Political, military, economic, social and information environment'],
    ['07','Incident geography','Country boundary, coordinate plot and numbered incident register'],
    ['08','Outlook and collection','Forward indicators, gaps, confidence limits and collection priorities'],
    ['09','Source register','Corroboration, provenance and publication controls']
  ]);
  card(doc,MARGIN,699,CONTENT_W,66);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text('EDITORIAL RULE',MARGIN+14,713);
  paragraph(doc,731,'The report separates evidence from assessment, identifies material uncertainty, avoids false precision and uses visual material only where it adds decision value.',{size:7.6,color:MUTED,max:600});

  // EXECUTIVE ASSESSMENT
  y=addPage(doc);
  y=sectionHeading(doc,y,'Executive assessment','Senior decision view | the five questions: what changed, why it matters, how confident are we, what could invalidate the judgement, what to watch next.');
  card(doc,MARGIN,y,CONTENT_W,132);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('KEY JUDGEMENT',MARGIN+16,y+16);
  y=paragraph(doc,y+35,publication.executive_assessment || body.executive_assessment || 'No executive assessment was supplied.',{x:MARGIN+16,width:CONTENT_W-32,size:10,max:1700,lineGap:4});
  y+=13;
  const gap=8, mw=(CONTENT_W-gap*3)/4;
  metricCard(doc,MARGIN,y,mw,'POSTURE',posture,'current period');
  metricCard(doc,MARGIN+mw+gap,y,mw,'TRAJECTORY',trajectory,'risk velocity');
  metricCard(doc,MARGIN+(mw+gap)*2,y,mw,'EVENTS',mergedEvents.length,'recorded');
  metricCard(doc,MARGIN+(mw+gap)*3,y,mw,'CONFIDENCE',confidence+'%','average');
  y+=90;
  drawConfidence(doc,MARGIN,y,CONTENT_W,confidence);
  y+=54;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('KEY JUDGEMENTS',MARGIN,y);
  y+=20;
  const highlights=Array.isArray(body.assessment_highlights)?body.assessment_highlights:[];
  if(highlights.length){
    for(const item of highlights.slice(0,4)){
      const judgement=typeof item==='string'?item:item&&item.judgement||'';
      const headline=typeof item==='object'&&item?item.headline||'': '';
      const confidence=typeof item==='object'&&item?item.confidence:null;
      const h=Math.max(
        62,
        31 + blockHeight(doc,judgement,CONTENT_W-28,'Helvetica',8.1,2.7) +
        (headline?14:0) + (confidence!=null?11:0)
      );
      y=ensure(doc,y,h+9);
      card(doc,MARGIN,y,CONTENT_W,h);
      if(headline)doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(6.8).text(upper(headline),MARGIN+14,y+11,{width:CONTENT_W-28});
      doc.fillColor(INK).font('Helvetica').fontSize(8.1).text(text(judgement,900),MARGIN+14,y+(headline?25:13),{width:CONTENT_W-28,lineGap:2.7});
      if(confidence!=null){
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.3).text('CONFIDENCE '+String(Math.round(Number(confidence)))+'%',MARGIN+14,y+h-13,{width:CONTENT_W-28});
      }
      y+=h+9;
    }
  }else{
    y=paragraph(doc,y,'No standalone analytical judgement was established beyond the incident-level evidence record. This section intentionally does not convert event volume into unsupported strategic conclusions.',{size:8.2,color:MUTED,max:700});
  }
  y+=8;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('WHAT WOULD CHANGE THIS JUDGEMENT',MARGIN,y);
  y+=20;
  const triggerCandidates=[];
  for(const e of priorityMerged.slice(0,3)){
    const m=mergeIncident(e,body);
    if(m.assessmentText){
      triggerCandidates.push('Independent corroboration or material persistence would strengthen the assessment for '+m.headline+'.');
    }
    if(m.research&&Array.isArray(m.research.outlook_triggers?.upgrade)&&m.research.outlook_triggers.upgrade.length){
      triggerCandidates.push(...m.research.outlook_triggers.upgrade.slice(0,2));
    }
  }
  const triggers=uniqueStrings(triggerCandidates,3);
  if(triggers.length)y=bullets(doc,y,triggers,{size:8.2});
  else y=paragraph(doc,y,'No explicit change conditions were established in the source record; future corroboration, persistence or credible contradictory evidence should be reassessed as it emerges.',{size:8.1,color:MUTED,max:760});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.4).text('Assessment discipline: probability language should describe the likelihood of a development; confidence describes the strength of the information and reasoning supporting the judgement.',MARGIN,y,{width:CONTENT_W,lineGap:2.5});

  // OPERATING ENVIRONMENT
  y=addPage(doc);
  y=sectionHeading(doc,y,'Operating environment','Observed indicators, collection framing and the main conditions shaping the current picture.');
  const ov=body.public_safety_security_overview || {};
  y=paragraph(doc,y,ov.summary || body.security_environment && body.security_environment.summary || 'No environment summary was supplied.',{size:9.5,max:1600});
  y+=18;
  const inds=Array.isArray(ov.indicators)?ov.indicators:[];
  for(let i=0;i<Math.min(4,inds.length);i++){
    const x=MARGIN+i*(mw+gap);
    metricCard(doc,x,y,mw,text(inds[i].label,70),text(inds[i].value,30),'from current ledger');
  }
  y+=95;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('COLLECTION FRAME',MARGIN,y);
  y+=20;
  y=paragraph(doc,y,ov.methodology || 'Indicators use only event, evidence and location fields available to this publication run.',{size:8.3,color:MUTED,max:700});
  y+=13;
  card(doc,MARGIN,y,CONTENT_W,104);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('HIGHEST PRIORITY SIGNAL',MARGIN+14,y+14);
  y=paragraph(doc,y+31,body.security_environment && body.security_environment.highest_priority || 'No material event identified.',{x:MARGIN+14,width:CONTENT_W-28,size:10,max:260});
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Collection limitation',MARGIN+14,y+8);
  y=paragraph(doc,y+23,'Absence from the current ledger or map is not evidence that an incident did not occur. Collection coverage, source quality and unresolved gaps must be considered before operational use.',{x:MARGIN+14,width:CONTENT_W-28,size:7.8,color:MUTED,max:600});
  y+=18;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('SEVERITY DISTRIBUTION',MARGIN,y);
  y+=20;
  for (const k of ['critical','high','moderate','low','informational']) {
    const v=counts[k], width=330;
    smallLabel(doc,MARGIN,y,upper(k),80);
    doc.roundedRect(MARGIN+84,y-2,width,10,4).fill(LIGHT);
    const bw=mergedEvents.length ? width*v/mergedEvents.length : 0;
    if(bw>0)doc.roundedRect(MARGIN+84,y-2,bw,10,4).fill(severityColor(k));
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7).text(String(v),MARGIN+425,y,{width:36,align:'right'});
    y+=24;
  }

  // SECURITY ACTIVITY GRAPHICS
  y=addPage(doc);
  y=sectionHeading(doc,y,'Security activity graphics','High-resolution vector analysis built directly from the completed reporting ledger.');
  y=drawVectorAnalytics(doc,y,mergedEvents,publication);
  y=paragraph(doc,y,'Reading note: event volume, severity and geographic concentration describe the captured evidence set. They do not measure unobserved incidents and should not be treated as a substitute for collection coverage assessment.',{size:7.4,color:MUTED,max:850});

  // EMERGING TRENDS
  y=addPage(doc);
  const trendHasBaseline=trendsHaveBaseline(body.emerging_trends);
y=sectionHeading(doc,y,trendHasBaseline?'Emerging trends and key drivers':'Observed concentrations and key drivers',trendHasBaseline?'Period comparison is available and changes are stated explicitly.':'No prior-period baseline is attached; concentrations are not presented as time-series trends.');
  const trends=Array.isArray(body.emerging_trends)?body.emerging_trends:[];
  if(trends.length){
    for(const t of trends.slice(0,5)){
      const assessment=text(t.assessment||'Observed concentration.',650);
      const h=Math.max(76,52+blockHeight(doc,assessment,CONTENT_W-28,'Helvetica',8,2.7));
      y=ensure(doc,y,h+10);
      card(doc,MARGIN,y,CONTENT_W,h);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.2).text(upper(t.theme || 'THEME'),MARGIN+14,y+13,{width:250});
      badge(doc,MARGIN+CONTENT_W-76,y+10,(t.share_percent||0)+'%',66,ACCENT);
      const basis=t.basis==='PERIOD_COMPARISON'?'PERIOD COMPARISON':'CURRENT-PERIOD CONCENTRATION';
      doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text(String(t.count||0)+' event object(s) | '+basis,MARGIN+14,y+32,{width:300});
      doc.fillColor(INK).font('Helvetica').fontSize(8).text(assessment,MARGIN+14,y+48,{width:CONTENT_W-28,lineGap:2.7});
      y+=h+10;
    }
  } else {
    y=paragraph(doc,y,'No emerging trend could be established from the current evidence set without adding unsupported inference.',{size:8.8,color:MUTED,max:800});
  }
  y+=8;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('KEY DRIVERS',MARGIN,y);
  y+=20;
  const drivers=Array.isArray(body.key_drivers)?body.key_drivers:[];
  if(drivers.length){
    for(const d of drivers.slice(0,5)){
      y=ensure(doc,y,42);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.3).text(text(d.driver || 'Driver',120),MARGIN,y,{width:150});
      y=paragraph(doc,y,text(d.evidence || 'Evidence-linked observation.',900),{x:MARGIN+170,width:CONTENT_W-170,size:8.1,max:900,lineGap:2.5});
      y+=12;
    }
  } else {
    y=paragraph(doc,y,'No structural driver was identified from the present ledger.',{size:8.5,color:MUTED});
  }

  // PRIORITY INCIDENT DOSSIERS
  let incidentNo=0;
  for(const raw of priorityMerged){
    incidentNo+=1;
    y=addPage(doc);
    const m=mergeIncident(raw,body);
    y=sectionHeading(doc,y,'Priority incident dossier','Incident '+String(incidentNo).padStart(2,'0')+' of '+String(priorityMerged.length)+' | evidence, context, judgement, uncertainty and source trail');
    const sev=upper(m.severity||'moderate');
    badge(doc,MARGIN,y,sev,76,severityColor(m.severity));
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(m.headline,MARGIN+90,y-1,{width:CONTENT_W-90});
    y+=24;
    const metaParts=[
      upper(m.region || 'LOCATION NOT ESTABLISHED'),
      'CONFIDENCE '+String(Math.round(Number(m.confidence||0)))+'%',
      String(m.source_count||m.sources.length||0)+' SOURCE(S)'
    ];
    if(m.researchStatus)metaParts.push('RESEARCH '+m.researchStatus);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.1).text(metaParts.join(' | '),MARGIN,y,{width:CONTENT_W});
    y+=16;
    drawRule(doc,y);
    y+=14;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('WHAT HAPPENED',MARGIN,y);
    y+=15;
    y=paragraph(doc,y,m.brief,{size:8.5,max:1900,lineGap:3.1});
    y+=12;

    const colGap=14, colW=(CONTENT_W-colGap)/2;
    const leftX=MARGIN, rightX=MARGIN+colW+colGap;
    const contextText=text(m.contextText,900);
    const assessmentText=text(m.assessmentText,900);
    const whyItems=m.whyText.length?m.whyText:[];
    const uncertaintyItems=m.uncertainty.concat(m.disputed);
    const contextH=contextText?blockHeight(doc,contextText,colW-24,'Helvetica',7.7,2.8):0;
    const assessmentH=assessmentText?blockHeight(doc,assessmentText,colW-24,'Helvetica',7.7,2.8):0;
    const whyH=listHeight(doc,whyItems,colW-24,7.5,3);
    const uncertaintyH=listHeight(doc,uncertaintyItems,colW-24,7.5,3);
    const leftH=Math.max(74,36+(contextText?contextH:0)+(assessmentText?assessmentH+26:0)+14);
    const rightH=Math.max(74,36+(whyItems.length?whyH:0)+(uncertaintyItems.length?uncertaintyH+26:0)+14);
    const colH=Math.max(leftH,rightH);
    y=ensure(doc,y,colH+18);
    const colStart=y;
    card(doc,leftX,colStart,colW,colH);
    card(doc,rightX,colStart,colW,colH);

    let ly=colStart+12;
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7).text('CONTEXT',leftX+12,ly);
    ly+=18;
    if(contextText){
      doc.fillColor(INK).font('Helvetica').fontSize(7.7).text(contextText,leftX+12,ly,{width:colW-24,lineGap:2.8});
      ly+=contextH+13;
    }else{
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('Context not established in the available source set.',leftX+12,ly,{width:colW-24,lineGap:2.6});
      ly+=28;
    }
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7).text('ANALYTICAL ASSESSMENT',leftX+12,ly);
    ly+=18;
    if(assessmentText)doc.fillColor(INK).font('Helvetica').fontSize(7.7).text(assessmentText,leftX+12,ly,{width:colW-24,lineGap:2.8});
    else doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('No standalone analytical judgement is established for this record.',leftX+12,ly,{width:colW-24,lineGap:2.6});

    let ry=colStart+12;
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7).text('WHY IT MATTERS',rightX+12,ry);
    ry+=18;
    if(whyItems.length)ry=bullets(doc,ry,whyItems,{x:rightX+12,width:colW-24,size:7.5,gap:3});
    else{
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('No explicit operational implication was established in the record.',rightX+12,ry,{width:colW-24,lineGap:2.6});
      ry+=28;
    }
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7).text('UNCERTAINTY',rightX+12,Math.max(ry+4,colStart+Math.min(colH-36,104)));
    const uy=Math.max(ry+18,colStart+Math.min(colH-20,122));
    if(uncertaintyItems.length)bullets(doc,uy,uncertaintyItems,{x:rightX+12,width:colW-24,size:7.5,gap:3,color:MUTED});
    else doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text('No additional unresolved issue was recorded beyond the stated confidence and source coverage.',rightX+12,uy,{width:colW-24,lineGap:2.6});
    y=colStart+colH+15;

    if(m.chronology.length){
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('CHRONOLOGY',MARGIN,y);
      y+=15;
      for(const c of m.chronology.slice(0,4)){
        y=ensure(doc,y,27);
        doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(6.9).text(text(c.time || 'TIME NOT ESTABLISHED',95),MARGIN,y,{width:100});
        paragraph(doc,y,c.event || '-',{x:MARGIN+115,width:CONTENT_W-115,size:7.2,max:480,lineGap:2.3});
        y+=25;
      }
    }

    y=ensure(doc,y,65);
    y+=4;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('SOURCE TRAIL',MARGIN,y);
    y+=14;
    const srcs=dedupeSources(m.sources,4);
    if(srcs.length){
      for(let i=0;i<srcs.length;i++){
        y=ensure(doc,y,19);
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.5).text('['+(i+1)+'] '+sourceLabel(srcs[i]),MARGIN,y,{width:150});
        doc.fillColor(MUTED).font('Helvetica').fontSize(6.1).text(sourceTitle(srcs[i]),MARGIN+158,y,{width:CONTENT_W-158});
        y+=14;
      }
    } else {
      doc.fillColor(MUTED).font('Helvetica').fontSize(6.8).text('No attributable source trail is attached to this incident record.',MARGIN,y,{width:CONTENT_W});
      y+=14;
    }
    if(m.researchStatus==='FALLBACK'){
      doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text('Research status: fallback. External corroboration was not established at publication time; wording is intentionally bounded by the available evidence.',MARGIN,y,{width:CONTENT_W,lineGap:2.1});
    }else if(m.researchStatus==='RESEARCHED_LIMITED'){
      doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text('Research status: limited source base. Web research was retrieved, but the source set does not establish multi-domain corroboration; claims remain explicitly bounded.',MARGIN,y,{width:CONTENT_W,lineGap:2.1});
    }
  }

  // REGIONAL PICTURE
  y=addPage(doc);
  y=sectionHeading(doc,y,'Regional picture','A compact geographic ledger showing breadth of activity without rewriting priority dossiers.');
  const regions=Array.isArray(body.regional_news)?body.regional_news:[];
  if(regions.length){
    let regionRows=0;
    for(const group of regions){
      if(regionRows>=30)break;
      const items=Array.isArray(group.items)?group.items:[];
      y=ensure(doc,y,48);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(upper(group.region||'REGION'),MARGIN,y);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text(
        String(group.event_count||items.length)+' event(s) | highest severity '+upper(group.highest_severity||'INFORMATIONAL'),
        MARGIN+330,y,{width:181,align:'right'}
      );
      drawRule(doc,y+15,MARGIN,CONTENT_W,LINE);
      y+=24;
      for(const item of items.slice(0,5)){
        y=ensure(doc,y,30);
        doc.fillColor(severityColor(item.severity)).font('Helvetica-Bold').fontSize(6.7).text(upper(item.severity||'moderate'),MARGIN,y,{width:70});
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.8).text(text(item.headline||'Development',240),MARGIN+78,y,{width:CONTENT_W-78});
        y+=13;
        doc.fillColor(MUTED).font('Helvetica').fontSize(6.7).text(
          String(item.source_count||0)+' source(s) | '+String(item.evidence_count||0)+' evidence observation(s) | '+String(item.confidence??'—')+'% confidence',
          MARGIN+78,y,{width:CONTENT_W-78}
        );
        y+=18;
        regionRows++;
      }
      y+=8;
    }
  }else{
    y=paragraph(doc,y,'No regional roll-up was available for this reporting period.',{size:8.6,color:MUTED});
  }

  // PMESI
  y=addPage(doc);
  y=sectionHeading(doc,y,'PMESI status','A domain-level view to prevent the report from becoming a collection of disconnected incidents.');
  const pm=Array.isArray(body.pmesi)?body.pmesi:[];
  const noUpdate=[];
  for(const item of pm.slice(0,5)){
    const st=upper(item.status || 'NO MATERIAL UPDATE');
    if(!item.update && st==='NO MATERIAL UPDATE'){noUpdate.push(upper(item.domain||'DOMAIN'));continue;}
    const update=text(item.update||'',620);
    const h=Math.max(66,51+blockHeight(doc,update,CONTENT_W-28,'Helvetica',7.8,2.5));
    y=ensure(doc,y,h+9);
    card(doc,MARGIN,y,CONTENT_W,h);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(upper(item.domain||'DOMAIN'),MARGIN+14,y+13,{width:220});
    badge(doc,MARGIN+CONTENT_W-123,y+10,st,109,severityColor(st));
    if(update)doc.fillColor(INK).font('Helvetica').fontSize(7.8).text(update,MARGIN+14,y+35,{width:CONTENT_W-28,lineGap:2.5});
    y+=h+9;
  }
  if(noUpdate.length){
    y=ensure(doc,y,34);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('No material current-period update was mapped to: '+noUpdate.join(', ')+'.',MARGIN,y,{width:CONTENT_W,lineGap:2.4});
    y+=25;
  }
  if(!pm.length) y=paragraph(doc,y,'PMESI mapping was not available from the current ledger.',{size:8.5,color:MUTED});

  // VISUAL INTELLIGENCE (only actual images)
  const actualImages=Array.isArray(images)?images.filter(x=>x&&Buffer.isBuffer(x.buffer)).slice(0,4):[];
  if(actualImages.length){
    y=addPage(doc);
    y=sectionHeading(doc,y,'Visual intelligence','Source images embedded only where provenance exists. Images are not treated as independent proof of the associated judgement.');
    for(let i=0;i<actualImages.length;i++){
      const x=MARGIN+(i%2)*261, yy=y+Math.floor(i/2)*248;
      card(doc,x,yy,247,225);
      try{doc.image(actualImages[i].buffer,x+9,yy+9,{fit:[229,176],align:'center',valign:'center'});}catch(_){}
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.6).text(text(actualImages[i].label || 'Source image',180),x+9,yy+189,{width:229});
      doc.fillColor(MUTED).font('Helvetica').fontSize(5.8).text(text(actualImages[i].source_url || '',260),x+9,yy+202,{width:229});
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.8).text('Visual material is illustrative source material; the evidentiary judgement remains anchored in the referenced records and research trail.',MARGIN,y+490,{width:CONTENT_W,lineGap:2.4});
  }

  // MAP
  y=addPage(doc);
  y=sectionHeading(doc,y,'Incident geography','A true country-outline map is attempted from a public country-boundary dataset; when unavailable, the renderer retains a labelled coordinate grid and explicitly discloses the fallback.');
  const mapCountry=publication.country_code || body.country_code || 'KE';
  const mapResult=await buildIncidentMap(mapCountry,mergedEvents);
  card(doc,MARGIN,y,CONTENT_W,386);
  doc.image(mapResult.image,MARGIN+8,y+8,{width:CONTENT_W-16,height:370,fit:[CONTENT_W-16,370]});
  y+=398;
  const mapPoints=mapResult.points || [];
  if(mapResult.excludedPoints){
    y=paragraph(doc,y,'Excluded '+String(mapResult.excludedPoints)+' coordinate(s) outside the selected country boundary or map margin; these records remain in the evidence ledger.',{size:7.2,color:MUTED,max:500});
    y+=8;
  }
  if(mapPoints.length){
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('MAP REGISTER',MARGIN,y);
    y+=17;
    const columns=2;
    const cw=(CONTENT_W-12)/columns;
    for(let i=0;i<mapPoints.length;i++){
      const p=mapPoints[i];
      const col=i%2;
      const x=MARGIN+col*(cw+12);
      if(i%2===0){
        const rowBudget=38;
        y=ensure(doc,y,rowBudget);
      }
      const yy=y;
      doc.fillColor(severityColor(p.severity)).circle(x+4,yy+4,4).fill();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.8).text(String(p.n).padStart(2,'0')+' | '+upper(p.severity),x+14,yy-1,{width:88});
      doc.fillColor(MUTED).font('Helvetica').fontSize(6.6).text(text(p.headline,260),x+104,yy-1,{width:cw-104});
      if(col===1)y+=38;
    }
    if(mapPoints.length%2===1)y+=38;
  } else {
    y=paragraph(doc,y,'No event carried usable latitude/longitude for this reporting period, so no misleading points were fabricated.',{size:7.8,color:MUTED,max:500});
  }

  // OUTLOOK & COLLECTION
  y=addPage(doc);
  y=sectionHeading(doc,y,'Outlook and collection control','Forward-looking assessment, explicit triggers and what the current collection cannot tell us.');
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('OUTLOOK',MARGIN,y);
  y+=20;
  y=bullets(doc,y,Array.isArray(body.outlook)?body.outlook:[
    'Maintain the present posture while watching for new corroborated reporting, geographic expansion or persistence.',
    'Escalate when the evidence base changes materially rather than on the basis of headline volume alone.',
    'Downgrade only after sustained de-escalation is supported by adequate collection coverage.'
  ],{size:8.2});
  y+=10;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('INTELLIGENCE GAPS',MARGIN,y);
  y+=20;
  y=bullets(doc,y,Array.isArray(body.intelligence_gaps)?body.intelligence_gaps:['No additional structured gap statement was supplied by the publication builder.'],{size:8.2,color:INK});
  y+=8;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text('COLLECTION PRIORITIES',MARGIN,y);
  y+=20;
  const collection=[
    'Prioritise corroboration of incidents currently assessed high or critical.',
    'Resolve missing coordinates for operationally relevant events before relying on spatial concentration.',
    'Record a comparable prior-period baseline so changes in posture can be demonstrated rather than inferred.'
  ];
  y=bullets(doc,y,collection,{size:8.2});
  y+=6;
  card(doc,MARGIN,y,CONTENT_W,95);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text('EVIDENCE CONTRACT',MARGIN+14,y+14);
  const coverageBasis=body.collection_basis?.basis||'ORIGINAL_EVIDENCE';
  const coverageText=coverageBasis==='DIRECT_WEB_RESEARCH'
    ? 'DIRECT WEB RESEARCH BASIS | '+String(body.collection_basis?.research_source_count||0)+' attributable research source(s) across '+String(body.collection_basis?.research_source_domains||0)+' domain(s) | original observation contract not met.'
    : String(body.collection_coverage && body.collection_coverage.evidence_contract_met ? 'ORIGINAL EVIDENCE BASIS · MET' : 'ORIGINAL EVIDENCE BASIS · NOT MET')+
      ' | '+String(body.collection_coverage && body.collection_coverage.evidence_count || 0)+' evidence observations | '+
      String(body.collection_coverage && body.collection_coverage.source_count || 0)+' distinct sources.';
  paragraph(doc,y+32,coverageText+' Collection completeness is not equivalent to incident absence.',
    {x:MARGIN+14,width:CONTENT_W-28,size:7.6,max:550,lineGap:2.4,color:MUTED});

  // SOURCES
  y=addPage(doc);
  y=sectionHeading(doc,y,'Source register','Deduplicated provenance across original evidence and direct incident research; aggregator pages are excluded.');
  const sourceCandidates=[];
  for(const e of mergedEvents){
    const dossier=researchForEvent(body,e)||{};
    for(const s of (Array.isArray(dossier.research_sources)?dossier.research_sources:[])
      .concat(Array.isArray(dossier.source_refs)?dossier.source_refs:[])
      .concat(Array.isArray(e.evidence)?e.evidence:[])){
      sourceCandidates.push({...s,event_id:e.id,event_headline:e.headline});
    }
  }
  const sources=dedupePublicationSources(sourceCandidates,120);
  let refNo=1;
  for(const src of sources){
    const titleText=sourceTitle(src),sourceText=sourceLabel(src),url=text(src.url||'',260);
    const h=20+(url?10:0);
    y=ensure(doc,y,h+4);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.9).text('['+refNo+'] '+sourceText,MARGIN,y,{width:145});
    doc.fillColor(INK).font('Helvetica').fontSize(6.8).text(titleText,MARGIN+152,y,{width:CONTENT_W-152,lineGap:2});
    y+=10;
    if(url){doc.fillColor(MUTED).font('Helvetica').fontSize(5.9).text(url,MARGIN+152,y,{width:CONTENT_W-152});y+=10;}
    y+=5;
    refNo++;
    if(refNo>160)break;
  }
  if(!sources.length){
    y=paragraph(doc,y,'No direct attributable source records were available for the publication.',{size:8.6,color:MUTED});
  }

  // CONTROLS
  y=addPage(doc);
  y=sectionHeading(doc,y,'Publication controls','Generation provenance, editorial safeguards and controlled-use notice.');
  card(doc,MARGIN,y,CONTENT_W,208);
  const controls=[
    ['GENERATOR','SONALIT PROFESSIONAL INTELLIGENCE PUBLICATION RENDERER'],
    ['RENDERER VERSION',PDF_RENDERER_VERSION],
    ['MODE',text(body.generator && body.generator.mode || 'EVIDENCE_FIRST',80)],
    ['RESEARCH',''+String(body.deep_research && body.deep_research.incidents_researched || 0)+' researched incident(s)'+(body.deep_research && body.deep_research.incidents_researched_limited ? ' ('+String(body.deep_research.incidents_researched_limited)+' limited)' : '')+'; '+String(body.deep_research && body.deep_research.web_sources_discovered || 0)+' research source(s) recorded'],
    ['STATUS',text(publication.status || 'published',50).toUpperCase()],
    ['VERSION',text(publication.version || body.version || 1,30)],
    ['PERIOD',periodLabel(publication)]
  ];
  let cy=y+18;
  for(const [k,v] of controls){
    smallLabel(doc,MARGIN+16,cy,k,135);
    doc.fillColor(INK).font('Helvetica').fontSize(7.5).text(v,MARGIN+150,cy,{width:CONTENT_W-166});
    cy+=28;
  }
  y+=229;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text('CONTROLLED USE',MARGIN,y);
  y+=17;
  y=paragraph(doc,y,body.disclaimer || 'This product is evidence-governed decision support and should be used with appropriate professional judgement.',{size:8.3,max:1100,lineGap:3});
  y+=12;
  y=paragraph(doc,y,'The publication distinguishes underlying reporting from analytical judgement and retains uncertainty where the evidence does not resolve the issue. Web research is treated as an input to be evaluated, not as unquestioned ground truth.',{size:8.1,color:MUTED,max:900,lineGap:3});
  y+=18;
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(7.2).text('SONALIT | CONFIDENTIAL | CONTROLLED DISTRIBUTION',MARGIN,y,{characterSpacing:.7});

  // PAGE HEADERS/FOOTERS: add only after all content is laid out.
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.6).text('SONALIT  /  INTELLIGENCE & SECURITY OPERATIONS',MARGIN,25,{width:340,characterSpacing:.8});
    drawRule(doc,37,MARGIN,CONTENT_W,LINE);
    const footerY=PAGE_H-MARGIN-10;
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.4).text('Evidence-governed decision support | Confidential / controlled distribution',MARGIN,footerY,{width:350});
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.4).text(String(i+1).padStart(2,'0'),PAGE_W-MARGIN-28,footerY,{width:28,align:'right'});
  }

  doc.end();
  return done;
}

module.exports={ buildProfessionalPdf, priorityEvents, mergeIncident, periodLabel, buildIncidentMap, PDF_RENDERER_VERSION };
