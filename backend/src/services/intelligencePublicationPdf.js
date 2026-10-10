const PDFDocument = require('pdfkit');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { PutObjectCommand, GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { query } = require('../config/database');
const { runWithOrgContext } = require('../utils/tenantContext');
const logger = require('../utils/logger');
const { buildProfessionalPdf, PDF_RENDERER_VERSION } = require('./intelligencePublicationPdfProfessional');
const { safeFetchPublicResearch, MAX_RESPONSE_BYTES: MAX_PDF_IMAGE_BYTES } = require('../utils/publicResearchFetch');
const PDF_IMAGE_CONTENT_TYPES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/tiff']);

const COUNTRY_NAMES = { KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania', RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea', SD:'Sudan', CD:'DR Congo' };
const BOUNDS = {
  KE:[33.8,-4.8,41.9,4.7], TZ:[29.3,-11.8,40.5,-0.9], UG:[29.5,-1.5,35.1,4.3], RW:[28.8,-2.9,30.9,-1.0], BI:[28.9,-4.5,30.9,-2.3], SO:[40.9,-1.9,51.5,12.2], ET:[32.9,3.3,47.9,14.9], SS:[23.4,3.4,35.9,12.2], DJ:[41.6,10.9,43.5,13.1], ER:[36.4,12.3,43.2,18.0], SD:[21.8,8.7,38.1,22.2], CD:[12.1,-13.5,31.3,5.4]
};

function esc(v){return String(v ?? '').replace(/[&<>\"]/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[s]||s));}
function severityScore(v){return ({critical:4,high:3,moderate:2,low:1,informational:0}[String(v||'').toLowerCase()] ?? 2);}
function svgMap(country, events){
  const [minLon,minLat,maxLon,maxLat]=BOUNDS[country]||[20,-20,55,20];
  const W=2400,H=1440,pad=140;
  const x=lon=>pad+((lon-minLon)/(maxLon-minLon))*(W-pad*2);
  const y=lat=>H-pad-((lat-minLat)/(maxLat-minLat))*(H-pad*2);
  const dots=events.filter(e=>Number.isFinite(Number(e.longitude))&&Number.isFinite(Number(e.latitude))).slice(0,80).map(e=>{
    const r=4+severityScore(e.severity)*2; const c={critical:'#ef4444',high:'#f97316',moderate:'#f59e0b',low:'#38bdf8',informational:'#94a3b8'}[String(e.severity||'moderate').toLowerCase()]||'#f59e0b';
    return `<circle cx="${x(Number(e.longitude)).toFixed(1)}" cy="${y(Number(e.latitude)).toFixed(1)}" r="${r}" fill="${c}" opacity=".9"><title>${esc(e.headline||e.title||'Event')}</title></circle>`;
  }).join('');
  const graticule=[]; for(let i=0;i<=6;i++){const yy=pad+i*((H-pad*2)/6);graticule.push(`<line x1="${pad}" y1="${yy}" x2="${W-pad}" y2="${yy}" stroke="#334155" stroke-width="1" opacity=".5"/>`)}
  for(let i=0;i<=8;i++){const xx=pad+i*((W-pad*2)/8);graticule.push(`<line x1="${xx}" y1="${pad}" x2="${xx}" y2="${H-pad}" stroke="#334155" stroke-width="1" opacity=".5"/>`)}
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b1220"/><rect x="${pad}" y="${pad}" width="${W-pad*2}" height="${H-pad*2}" rx="26" fill="#0f172a" stroke="#475569" stroke-width="3"/>${graticule.join('')}<text x="${pad}" y="78" fill="#f8fafc" font-family="Arial" font-size="54" font-weight="700">${esc(COUNTRY_NAMES[country]||country)} SECURITY EVENT MAP</text><text x="${pad}" y="118" fill="#94a3b8" font-family="Arial" font-size="28">Geospatial intelligence plot · event coordinates from Sonalit evidence ledger</text><text x="${W-230}" y="78" fill="#cbd5e1" font-family="Arial" font-size="28" font-weight="700">N</text><path d="M${W-220} 96 L${W-200} 150 L${W-180} 96 Z" fill="#cbd5e1"/><line x1="${W-360}" y1="${H-100}" x2="${W-160}" y2="${H-100}" stroke="#cbd5e1" stroke-width="5"/><line x1="${W-360}" y1="${H-112}" x2="${W-360}" y2="${H-88}" stroke="#cbd5e1" stroke-width="5"/><line x1="${W-160}" y1="${H-112}" x2="${W-160}" y2="${H-88}" stroke="#cbd5e1" stroke-width="5"/><text x="${W-360}" y="${H-65}" fill="#94a3b8" font-family="Arial" font-size="20">RELATIVE MAP SCALE</text>${dots}</svg>`);
}

async function buildPdf(publication, events, images){
  const body=publication.body||{};
  const doc=new PDFDocument({
    size:'A4',
    margin:42,
    info:{
      Title:publication.title,
      Author:'SONALIT INTELLIGENCE',
      Subject:'Evidence-governed security intelligence report'
    }
  });
  const chunks=[];
  doc.on('data',c=>chunks.push(c));
  const done=new Promise((resolve,reject)=>{
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);
  });

  const navy='#0b1220';
  const orange='#f97316';
  const ink='#111827';
  const muted='#64748b';
  const soft='#f8fafc';
  const line='#e2e8f0';
  const critical='#dc2626';
  const high='#ea580c';
  const moderate='#d97706';

  const retiredLabel = String.fromCharCode(51,73);
  const retiredLabelPattern = new RegExp('\\b'+retiredLabel+'\\b','gi');
  const safe=v=>String(v==null?'':v).replace(retiredLabelPattern,'').replace(/\s{2,}/g,' ').trim();
  const upper=v=>safe(v).toUpperCase();
  const score=s=>({CRITICAL:4,HIGH:3,MODERATE:2,LOW:1,INFORMATIONAL:0}[upper(s)]??2);

  function header(){
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted)
      .text('SONALIT  /  INTELLIGENCE & SECURITY OPERATIONS',42,24,{characterSpacing:1.1});
    doc.moveTo(42,36).lineTo(553,36).strokeColor(line).stroke();
  }
  function footer(){
    doc.font('Helvetica').fontSize(7).fillColor(muted)
      .text('Evidence-governed decision support · Confidential / controlled distribution',42,799,{width:430});
    doc.text(String(doc.page),515,799,{align:'right',width:38});
  }
  function newPage(){
    footer();
    doc.addPage();
    header();
  }
  function title(text,subtitle){
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(17).text(text,42,58,{width:511});
    if(subtitle) doc.fillColor(muted).font('Helvetica').fontSize(8.5).text(subtitle,42,82,{width:511});
    doc.moveTo(42,subtitle?101:86).lineTo(553,subtitle?101:86).strokeColor(line).stroke();
    doc.y=subtitle?116:101;
  }
  function tag(text,x,y,w=92,color=moderate){
    doc.roundedRect(x,y,w,18,5).fill(color);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7).text(upper(text),x+7,y+6,{width:w-14,align:'center'});
  }
  function card(x,y,w,h){
    doc.roundedRect(x,y,w,h,8).fill(soft);
    doc.roundedRect(x,y,w,h,8).lineWidth(0.5).strokeColor(line).stroke();
  }
  function paragraph(text,x=42,w=511,size=9.5,lh=4){
    doc.fillColor(ink).font('Helvetica').fontSize(size).text(safe(text)||'—',x,doc.y,{width:w,lineGap:lh});
  }
  function bullet(text,x=52,w=490){
    doc.fillColor(ink).font('Helvetica').fontSize(8.8).text('• '+safe(text),x,doc.y,{width:w,lineGap:3});
  }
  function refLine(ref,index){
    const source=safe(ref.source||'Source');
    const t=safe(ref.title||'Evidence record');
    const url=safe(ref.url||'');
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.4).text(String(index+1)+'. '+source,{continued:false});
    doc.fillColor(muted).font('Helvetica').fontSize(7.2).text(t,{width:460,indent:12});
    if(url) doc.fillColor('#475569').fontSize(6.7).text(url,{width:460,indent:12});
  }
  function sectionLabel(text,x=42,y=118){
    doc.fillColor(orange).font('Helvetica-Bold').fontSize(7).text(upper(text),x,y,{characterSpacing:1.15});
    doc.moveTo(x,y+12).lineTo(553,y+12).strokeColor(line).stroke();
  }
  function researchChain(x,y,w){
    const labels=['EVIDENCE','WEB RESEARCH','CORROBORATION','ANALYST WRITING','QA'];
    const widths=[w*.16,w*.19,w*.19,w*.23,w*.15];
    let cx=x;
    labels.forEach((label,i)=>{
      const bw=widths[i];
      doc.roundedRect(cx,y,bw-7,42,7).fill(i===3?orange:soft);
      doc.roundedRect(cx,y,bw-7,42,7).lineWidth(.5).strokeColor(line).stroke();
      doc.fillColor(i===3?'#fff':ink).font('Helvetica-Bold').fontSize(6.1).text(label,cx+6,y+16,{width:bw-19,align:'center'});
      if(i<labels.length-1){
        doc.moveTo(cx+bw-5,y+21).lineTo(cx+bw+1,y+21).lineWidth(1.3).strokeColor(orange).stroke();
      }
      cx+=bw;
    });
  }
  function postureGauge(x,y,w,level,confidence){
    const states=['LOW','MODERATE','HIGH','CRITICAL'];
    const active=Math.max(0,Math.min(3,states.indexOf(upper(level))));
    const gap=4,bw=(w-gap*3)/4;
    states.forEach((state,i)=>{
      const xx=x+i*(bw+gap);
      doc.roundedRect(xx,y,bw,14,5).fill(i===active?orange:'#e8edf3');
      doc.fillColor(i===active?'#fff':muted).font('Helvetica-Bold').fontSize(5.8).text(state,xx+4,y+4,{width:bw-8,align:'center'});
    });
    doc.fillColor(muted).font('Helvetica').fontSize(7).text('Confidence '+String(confidence||0)+'%',x,y+22,{width:w});
  }
  function chartBar(label,value,max,x,y,w,accent=orange){
    const v=Math.max(0,Number(value)||0), pct=Math.min(1,v/Math.max(1,max));
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(6.3).text(upper(label),x,y,{width:82});
    doc.roundedRect(x+88,y-2,w-120,8,4).fill('#e8edf3');
    if(pct>0)doc.roundedRect(x+88,y-2,(w-120)*pct,8,4).fill(accent);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(6.4).text(String(v),x+w-25,y,{width:25,align:'right'});
  }
  function timeline(items,x,y,w,h){
    const xs=Array.isArray(items)?items.slice(0,4):[];
    if(!xs.length){
      doc.fillColor(muted).font('Helvetica').fontSize(7.4).text('No event chronology was established by the research agent.',x,y,{width:w});
      return;
    }
    const lineX=x+10;
    doc.moveTo(lineX,y+5).lineTo(lineX,y+h-5).lineWidth(1.5).strokeColor('#cbd5e1').stroke();
    const rowH=(h-10)/xs.length;
    xs.forEach((item,i)=>{
      const yy=y+5+i*rowH;
      doc.circle(lineX,yy,3.4).fill(orange);
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(6.8).text(safe(item.time||'TIME NOT ESTABLISHED'),x+22,yy-5,{width:105});
      doc.fillColor(muted).font('Helvetica').fontSize(7).text(safe(item.event||''),x+132,yy-6,{width:w-140,lineGap:2});
    });
  }

  // Cover — styled as a controlled intelligence product, not a generic report.
  header();
  doc.rect(42,58,511,245).fill(navy);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
    .text('SONALIT',64,80,{characterSpacing:1.6});
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(28)
    .text(upper(publication.country_code||'REGIONAL'),64,116,{width:430});
  doc.fillColor('#dbe4f0').font('Helvetica').fontSize(15)
    .text(upper(publication.publication_type||'INTELLIGENCE')+' INSIGHT',64,160,{width:430});
  doc.fillColor('#cbd5e1').fontSize(9)
    .text(safe(body.subtitle||'Evidence-governed security intelligence'),64,194,{width:430});
  doc.fillColor(orange).font('Helvetica-Bold').fontSize(8.5)
    .text('CONFIDENTIAL  •  CONTROLLED DISTRIBUTION  •  EVIDENCE-LINKED',64,250,{characterSpacing:0.8});
  doc.fillColor(muted).font('Helvetica').fontSize(8.5)
    .text('Reporting period: '+safe(body.period_start?new Date(body.period_start).toLocaleDateString('en-GB'):publication.period_start?new Date(publication.period_start).toLocaleDateString('en-GB'):'—')+' — '+safe(body.period_end?new Date(new Date(body.period_end).getTime()-1).toLocaleDateString('en-GB'):publication.period_end?new Date(new Date(publication.period_end).getTime()-1).toLocaleDateString('en-GB'):'—'),64,330,{width:430});
  doc.fillColor(muted).fontSize(8)
    .text('Generated by the Sonalit evidence → verification → fusion → assessment → forecast → dissemination fabric.',64,351,{width:430});
  footer();

  // Editorial contents / navigation page.
  doc.addPage(); header(); title('CONTENTS','Sonalit · research edition · controlled intelligence publication');
  const contentsItems=[
    ['01','Executive assessment','Senior decision view, posture and severity distribution'],
    ['02','Public safety & security overview','Observed environment and collection framing'],
    ['03','Emerging trends & key drivers','Evidence-derived concentrations and drivers'],
    ['04','Key findings & assessment','Priority findings and operational meaning'],
    ['05','Incident research dossiers','One researched case file per publication incident'],
    ['06','Regional updates','Geographic roll-up across the reporting period'],
    ['07','PMESI status','Political, Military, Economic, Social, Information & Media'],
    ['08','Major incidents map','High-resolution geospatial event plot'],
    ['09','Outlook & collection control','Forecast, triggers, intelligence gaps and evidence contract'],
    ['10','References & publication controls','Source provenance, generation record and controlled use']
  ];
  let cy=128;
  for(const [num,name,desc] of contentsItems){
    doc.roundedRect(42,cy,511,46,8).fill(soft).lineWidth(.5).strokeColor(line).stroke();
    doc.fillColor(orange).font('Helvetica-Bold').fontSize(8).text(num,57,cy+17,{width:24});
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text(name,94,cy+12,{width:180});
    doc.fillColor(muted).font('Helvetica').fontSize(7.2).text(desc,276,cy+12,{width:255,lineGap:2});
    cy+=55;
  }
  doc.fillColor(muted).font('Helvetica').fontSize(7.2).text('Each incident dossier carries its own research status, uncertainty statement and source trail. Web research is treated as untrusted input and does not override Sonalit evidence controls.',42,690,{width:511,lineGap:3});
  researchChain(42,735,511);
  footer();

  // Executive assessment + posture.
  doc.addPage(); header(); title('EXECUTIVE ASSESSMENT','Senior decision view · source-grounded summary');
  card(42,118,511,139);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('JUDGEMENT',58,134);
  doc.y=153; paragraph(publication.executive_assessment||body.executive_assessment,58,479,10,4.5);
  const p=body.threat_posture||{};
  const boxes=[
    ['POSTURE',upper(p.level||'—')],
    ['TRAJECTORY',upper(p.trajectory||'—')],
    ['EVENTS',String(events.length)],
    ['CONFIDENCE',publication.confidence!=null?String(Math.round(Number(publication.confidence)))+'%':'—']
  ];
  boxes.forEach((m,i)=>{
    const x=42+i*128;
    card(x,279,116,68);
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(6.8).text(m[0],x+10,291);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(17).text(m[1],x+10,308,{width:96});
  });
  postureGauge(42,357,511,p.level,publication.confidence!=null?Math.round(Number(publication.confidence)):0);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text('KEY JUDGEMENTS',42,395);
  (Array.isArray(body.assessment_highlights)?body.assessment_highlights:[]).slice(0,4).forEach(x=>{doc.y+=5;bullet(x,54,485);});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text('CHANGE ANALYSIS',42,517);
  paragraph(body.change_analysis?.summary||'No change analysis was supplied.',42,511,9.2,4);
  doc.y+=8;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('SEVERITY DISTRIBUTION',42,592);
  const dist=p.counts||{};
  const distRows=['critical','high','moderate','low','informational'];
  distRows.forEach((s,i)=>{
    const y=615+i*25;
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(7).text(upper(s),42,y);
    doc.roundedRect(115,y-2,320,10,4).fill('#eef2f7');
    const w=Math.min(320,(Number(dist[s]||0)/Math.max(1,events.length))*320);
    const c=s==='critical'?critical:s==='high'?high:s==='moderate'?moderate:'#94a3b8';
    if(w>0) doc.roundedRect(115,y-2,w,10,4).fill(c);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(7).text(String(dist[s]||0),448,y);
  });
  footer();

  // Public safety/security overview — reference-product executive structure.
  doc.addPage(); header(); title('PUBLIC SAFETY & SECURITY OVERVIEW','Environment summary · observed indicators · collection framing');
  const overview=body.public_safety_security_overview||{};
  card(42,118,511,94);
  paragraph(overview.summary||body.security_environment?.summary||publication.executive_assessment||'No overview available.',58,479,9.2,4);
  doc.y=230;
  const indicators=Array.isArray(overview.indicators)?overview.indicators:[];
  indicators.slice(0,4).forEach((m,i)=>{
    const x=42+i*128;
    card(x,230,116,66);
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(6.6).text(upper(m.label||'INDICATOR'),x+9,243,{width:98});
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text(safe(m.value??'—'),x+9,258,{width:98});
  });
  doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(safe(overview.methodology||'Indicators are derived from the current evidence ledger.'),42,314,{width:511});
  const env=body.security_environment||{};
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('HIGHEST PRIORITY SIGNAL',42,352);
  paragraph(env.highest_priority||'No material event recorded.',42,511,9,4);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('COLLECTION LIMIT',42,432);
  paragraph('Absence from the event ledger or incident plot must not be interpreted as proof of absence. Read the collection coverage and intelligence-gap sections before operational use.',42,511,8.6,4);
  footer();

  // Emerging trends and key drivers — explicitly evidence-derived, not pseudo-forecasting.
  doc.addPage(); header(); title('EMERGING TRENDS & KEY DRIVERS','Observed concentrations in the reporting period');
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('EMERGING TRENDS',42,118);
  const trends=Array.isArray(body.emerging_trends)?body.emerging_trends:[];
  if(trends.length){
    let y=145;
    for(const t of trends){
      if(y>705){footer();doc.addPage();header();title('EMERGING TRENDS & KEY DRIVERS','Continued');y=118;}
      card(42,y,511,74);
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text(safe(t.theme||'Theme'),56,y+12,{width:250});
      tag(String(t.share_percent??0)+'%',432,y+9,90,moderate);
      doc.fillColor(muted).font('Helvetica').fontSize(7.5).text(String(t.count??0)+' recorded event object(s)',56,y+29,{width:250});
      doc.fillColor(ink).font('Helvetica').fontSize(8.2).text(safe(t.assessment||'Observed concentration.'),56,y+46,{width:468,lineGap:3});
      y+=88;
    }
  } else {
    paragraph('No emerging trend could be identified from the recorded event set.');
  }
  let y2=trends.length?530:165;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('KEY DRIVERS',42,y2);
  y2+=25;
  const drivers=Array.isArray(body.key_drivers)?body.key_drivers:[];
  if(drivers.length){
    for(const d of drivers){
      if(y2>720){footer();doc.addPage();header();title('EMERGING TRENDS & KEY DRIVERS','Continued');y2=118;}
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(8.7).text(safe(d.driver||'Driver'),52,y2,{width:165});
      doc.fillColor(muted).font('Helvetica').fontSize(8.1).text(safe(d.evidence||'Evidence-linked driver.'),225,y2,{width:320,lineGap:3});
      y2+=37;
    }
  } else {
    paragraph('No structural driver could be established from the available evidence.',52,490,8.5,3);
  }
  footer();

  // Findings/assessment page keeps facts, assessment and implications visually separated.
  doc.addPage(); header(); title('KEY FINDINGS & ASSESSMENT','Priority findings · judgement · operational meaning');
  const findings=Array.isArray(body.key_findings_assessment?.findings)?body.key_findings_assessment.findings:[];
  if(findings.length){
    let fy=118;
    for(const f of findings){
      if(fy>680){footer();doc.addPage();header();title('KEY FINDINGS & ASSESSMENT','Continued');fy=118;}
      card(42,fy,511,150);
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(safe(f.headline||'Finding'),56,fy+14,{width:468});
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.4).text('ASSESSMENT',56,fy+46);
      doc.fillColor(ink).font('Helvetica').fontSize(8.4).text(safe(f.assessment||'Evidence-derived assessment.'),56,fy+61,{width:468,lineGap:3.2});
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.4).text('WHY IT MATTERS',56,fy+97);
      doc.fillColor(ink).font('Helvetica').fontSize(8.4).text(safe(f.why_it_matters||'Continued monitoring is warranted.'),56,fy+112,{width:468,lineGap:3.2});
      fy+=168;
    }
  } else {
    paragraph('No priority findings were generated from the current event set.',42,511,9,4);
  }
  footer();

  // Research and corroboration control — makes the research effort visible.
  doc.addPage(); header(); title('RESEARCH & CORROBORATION','Per-incident web research · provenance · uncertainty control');
  const dr=body.deep_research||{};
  card(42,118,511,118);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text('RESEARCH COVERAGE',58,136);
  const coverage=[
    ['INCIDENTS REQUESTED',String(dr.incidents_requested??events.length)],
    ['AGENT-RESEARCHED',String(dr.incidents_researched??0)],
    ['FALLBACK DOSSIERS',String(dr.incidents_fallback??0)],
    ['WEB SOURCES FOUND',String(dr.web_sources_discovered??0)]
  ];
  coverage.forEach((m,i)=>{
    const x=58+i*121;
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(6).text(m[0],x,162,{width:105});
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(17).text(m[1],x,176,{width:105});
  });
  doc.fillColor(muted).font('Helvetica').fontSize(7).text('Every incident is given an independent research attempt when deep research is enabled. A fallback dossier is explicitly marked rather than presented as researched fact.',58,208,{width:468,lineGap:3});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('RESEARCH PIPELINE',42,270);
  researchChain(42,292,511);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('INCIDENT RESEARCH STATUS',42,370);
  let ry=398;
  const researchEvents=Array.isArray(body.incident_dossiers)?body.incident_dossiers:((Array.isArray(body.key_developments)?body.key_developments:[]));
  researchEvents.slice(0,8).forEach((e,i)=>{
    const status=upper(e.research_status||'NOT RECORDED');
    const c=status==='RESEARCHED'?orange:'#94a3b8';
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.5).text(String(i+1).padStart(2,'0')+'  '+safe(e.headline||'Incident'),42,ry,{width:370});
    tag(status,430,ry-4,123,c);
    ry+=28;
  });
  if(!researchEvents.length)paragraph('No incident research records are attached to this publication.',42,511,8.5,3);
  footer();

  // Incident research dossiers — intentionally long-form; each incident owns two pages.
  const key=Array.isArray(body.incident_dossiers)?body.incident_dossiers:(Array.isArray(body.key_developments)?body.key_developments:events.slice(0,8));
  for(let idx=0;idx<key.length;idx++){
    const e=key[idx]||{};
    const sev=upper(e.severity||'moderate');
    const sevColor=sev==='CRITICAL'?critical:sev==='HIGH'?high:moderate;
    const incidentNo=String(idx+1).padStart(2,'0');

    // Page 1: long-form narrative and contextual explanation. No fixed card height.
    doc.addPage(); header(); title('INCIDENT RESEARCH DOSSIER','Incident '+incidentNo+' of '+String(key.length)+' · narrative & context');
    tag(sev,42,118,96,sevColor);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(14).text(safe(e.headline||e.title||'Incident'),152,118,{width:401});
    doc.fillColor(muted).font('Helvetica').fontSize(7.2).text(
      upper(e.region||'LOCATION NOT SPECIFIED')+'  ·  '+String(e.confidence??'—')+'% CONFIDENCE  ·  '+String(e.evidence_count||0)+' EVIDENCE  ·  '+String(e.source_count||0)+' SOURCES',
      42,145,{width:511}
    );
    sectionLabel('What happened',42,174);
    const narrative=safe(e.what_happened||e.brief||e.summary||'Evidence record available.');
    doc.fillColor(ink).font('Helvetica').fontSize(8.55).text(narrative,42,192,{width:511,lineGap:3.25});
    let p1y=192+doc.heightOfString(narrative,{width:511,font:'Helvetica',fontSize:8.55,lineGap:3.25})+22;
    if(p1y>650)p1y=650;
    sectionLabel('Context',42,p1y);
    const context=safe(e.context||'No additional context was established by the research agent.');
    doc.fillColor(ink).font('Helvetica').fontSize(8).text(context,42,p1y+18,{width:511,lineGap:3});
    const contextHeight=doc.heightOfString(context,{width:511,font:'Helvetica',fontSize:8,lineGap:3});
    const caveatY=Math.min(p1y+18+contextHeight+25,730);
    doc.fillColor(muted).font('Helvetica').fontSize(6.8).text(
      'RESEARCH STATUS  ·  '+upper(e.research_status||'NOT RECORDED')+
      '   |   PROVIDER  ·  '+safe(e.research_provider||'evidence-fallback-research')+
      '   |   RESEARCH SOURCES  ·  '+String(Array.isArray(e.research_sources)?e.research_sources.length:0),
      42,caveatY,{width:511}
    );
    doc.fillColor(muted).font('Helvetica').fontSize(6.8).text(
      'The narrative is an original synthesis of retrieved reporting and Sonalit evidence. It is not a reproduction of source copy.',
      42,caveatY+16,{width:511,lineGap:2.2}
    );
    footer();

    // Page 2: structured fact/assessment/provenance control surface.
    doc.addPage(); header(); title('INCIDENT RESEARCH DOSSIER','Incident '+incidentNo+' · facts, assessment & provenance');
    card(42,118,511,116);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text('ANALYTICAL ASSESSMENT',58,135);
    doc.fillColor(ink).font('Helvetica').fontSize(8.35).text(safe(e.assessment||'No additional analytical judgement supplied.'),58,152,{width:468,lineGap:3});
    const why=Array.isArray(e.why_it_matters)?e.why_it_matters.join(' '):safe(e.why_it_matters||'No explicit operational implication was established.');
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.5).text('WHY IT MATTERS',58,194);
    doc.fillColor(muted).font('Helvetica').fontSize(7.35).text(why,142,193,{width:383,lineGap:2.7});

    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8).text('CONFIRMED FACTS',42,264);
    const facts=Array.isArray(e.key_facts)?e.key_facts:[];
    let fy=281;
    facts.slice(0,5).forEach(x=>{
      const text='• '+safe(x);
      doc.fillColor(ink).font('Helvetica').fontSize(7.15).text(text,42,fy,{width:511,lineGap:2.2});
      fy+=Math.min(29,doc.heightOfString(text,{width:511,font:'Helvetica',fontSize:7.15,lineGap:2.2}))+5;
    });
    if(!facts.length)doc.fillColor(muted).font('Helvetica').fontSize(7).text('No additional structured facts were returned.',42,fy);

    const disputed=Array.isArray(e.reported_or_disputed)?e.reported_or_disputed:[];
    const dy=Math.min(fy+13,475);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8).text('REPORTED / DISPUTED',42,dy);
    let dyy=dy+16;
    disputed.slice(0,4).forEach(x=>{
      const text='• '+safe(x);
      doc.fillColor(muted).font('Helvetica').fontSize(7.1).text(text,42,dyy,{width:511,lineGap:2.2});
      dyy+=Math.min(28,doc.heightOfString(text,{width:511,font:'Helvetica',fontSize:7.1,lineGap:2.2}))+4;
    });
    if(!disputed.length)doc.fillColor(muted).font('Helvetica').fontSize(7).text('No material disagreement recorded.',42,dyy);

    sectionLabel('Chronology',42,575);
    timeline(e.chronology||[],42,597,511,78);

    sectionLabel('Source trail',42,705);
    const sourceRefs=Array.isArray(e.source_refs)?e.source_refs:[];
    const researchSources=Array.isArray(e.research_sources)?e.research_sources:[];
    const sources=researchSources.length?researchSources:sourceRefs;
    let sy=727;
    if(sources.length){
      sources.slice(0,4).forEach((r,i)=>{
        if(sy>785)return;
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(6.5).text(String(i+1)+'. '+safe(r.title||r.source||'Source'),42,sy,{width:511});
        sy+=9;
        doc.fillColor(muted).font('Helvetica').fontSize(5.9).text(safe(r.domain||r.source||r.url||''),42,sy,{width:511});
        sy+=13;
      });
    }else{
      doc.fillColor(muted).font('Helvetica').fontSize(6.6).text('No source trail was attached to this incident.',42,sy,{width:511});
    }
    footer();
  }

  // Regional roll-up, matching the sample product architecture.
  // Regional roll-up, matching the sample product architecture.
  const regions=Array.isArray(body.regional_news)?body.regional_news:[];
  doc.addPage(); header(); title('REGIONAL UPDATES','Geographic roll-up of evidence-backed event reporting');
  if(regions.length){
    for(const group of regions){
      if(doc.y>705){footer();doc.addPage();header();title('REGIONAL UPDATES','Continued');}
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(upper(group.region||'REGION'),42,doc.y);
      doc.moveTo(42,doc.y+15).lineTo(553,doc.y+15).strokeColor(line).stroke();
      doc.y+=24;
      for(const item of Array.isArray(group.items)?group.items:[]){
        if(doc.y>748){footer();doc.addPage();header();title('REGIONAL UPDATES','Continued');}
        const sev=upper(item.severity||'moderate');
        doc.fillColor(sev==='CRITICAL'?critical:sev==='HIGH'?high:ink).font('Helvetica-Bold').fontSize(8.2)
          .text(safe(item.headline||'Development'),42,doc.y,{width:350});
        doc.fillColor(muted).font('Helvetica').fontSize(7.2)
          .text(upper(item.severity||'MODERATE')+' · '+String(item.source_count||0)+' sources',405,doc.y,{width:148,align:'right'});
        doc.y+=14;
        paragraph(item.what_happened||item.brief||'Evidence record available.',42,511,8.1,3);
        doc.y+=10;
      }
      doc.y+=8;
    }
  } else {
    paragraph('No regional roll-up was available from the current evidence ledger.');
  }
  footer();

  // PMESI status.
  const pm=Array.isArray(body.pmesi)?body.pmesi:[];
  doc.addPage(); header(); title('PMESI STATUS','Political · Military · Economic · Social · Information & Media');
  for(const item of pm){
    if(doc.y>700){footer();doc.addPage();header();title('PMESI STATUS','Continued');}
    card(42,doc.y,511,86);
    const y=doc.y;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(9.5).text(upper(item.domain||'DOMAIN'),56,y+14,{width:180});
    tag(item.status||'NO MATERIAL UPDATE',420,y+10,112,score(item.status)>=3?high:moderate);
    doc.fillColor(ink).font('Helvetica').fontSize(8.2).text(safe(item.update||'No material update recorded.'),56,y+38,{width:468,lineGap:3});
    doc.y=y+101;
  }
  if(!pm.length) paragraph('PMESI status was not populated because no domain-level event mapping was available.');
  footer();

  // Visual intelligence board — actual source imagery with provenance.
  if(images.length){
    doc.addPage(); header(); title('VISUAL INTELLIGENCE','Source imagery embedded from evidence-linked or researched sources');
    const slots=images.slice(0,4);
    slots.forEach((img,i)=>{
      const col=i%2,row=Math.floor(i/2),x=42+col*260,y=118+row*280,w=245,h=218;
      card(x,y,w,h+34);
      try{doc.image(img.buffer,x+9,y+9,{fit:[w-18,h-18],align:'center',valign:'center'});}catch(error){logger.warn('PDF image placement failed: '+error.message)}
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(6.8).text(safe(img.label||'Source image'),x+10,y+h+4,{width:w-20});
      doc.fillColor(muted).font('Helvetica').fontSize(5.8).text(safe(img.source_url||''),x+10,y+h+17,{width:w-20});
    });
    doc.fillColor(muted).font('Helvetica').fontSize(6.8).text('Images are illustrative source material and do not, by themselves, establish the claims made elsewhere in the report. Provenance is retained with the publication record.',42,698,{width:511,lineGap:3});
    footer();
  }

  // Coordinate incident plot.
  doc.addPage(); header(); title('MAJOR INCIDENTS MAP','Coordinate plot of Sonalit event objects with usable latitude/longitude');
  const plotted=Array.isArray(body.incident_map?.points)&&body.incident_map.points.length
    ? body.incident_map.points
    : events.filter(e=>Number.isFinite(Number(e.latitude))&&Number.isFinite(Number(e.longitude))).map(e=>({event_id:e.id,headline:e.headline||e.title,latitude:Number(e.latitude),longitude:Number(e.longitude),severity:e.severity}));
  const mapEvents=plotted.map(p=>({headline:p.headline,latitude:p.latitude,longitude:p.longitude,severity:String(p.severity||'moderate').toLowerCase()}));
  const map=await sharp(svgMap(publication.country_code,mapEvents)).png().toBuffer();
  doc.image(map,42,112,{width:511});
  doc.fillColor(muted).font('Helvetica').fontSize(7.2).text('The plot reflects only events carrying usable coordinates; absence from the plot does not imply absence of an incident.',42,630,{width:511});
  const legend=[['CRITICAL',critical],['HIGH',high],['MODERATE',moderate],['LOW','#38bdf8']];
  legend.forEach((l,i)=>{tag(l[0],42+i*124,655,104,l[1]);});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('MAPPED INCIDENTS: '+String(plotted.length),42,700);
  footer();

  // Outlook, collection gaps, calendar and references.
  doc.addPage(); header(); title('OUTLOOK & COLLECTION CONTROL','Forecast, triggers, gaps and source provenance');
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('OUTLOOK',42,118);
  doc.y=139;
  (Array.isArray(body.outlook)?body.outlook:[]).forEach(x=>{bullet(x,52,490);doc.y+=4;});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('INTELLIGENCE GAPS',42,doc.y+18);
  doc.y+=39;
  (Array.isArray(body.intelligence_gaps)?body.intelligence_gaps:[]).forEach(x=>{bullet(x,52,490);doc.y+=4;});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('WEEK-AHEAD / FORWARD EVENTS',42,doc.y+18);
  doc.y+=39;
  paragraph(body.weekly_calendar?.note||'No forward events-calendar feed was attached to this product.',42,511,8.5,3);
  doc.y+=10;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('EVIDENCE CONTRACT',42,doc.y+12);
  doc.y+=31;
  paragraph(
    (body.collection_coverage?.evidence_contract_met?'MET':'NOT MET')+
    ' · '+String(body.collection_coverage?.evidence_count||0)+' evidence observations · '+
    String(body.collection_coverage?.source_count||0)+' distinct sources · '+
    'Automated deterministic publication mode remains evidence-first.',
    42,511,8.2,3
  );
  doc.y+=12;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('REFERENCES',42,doc.y);
  doc.y+=20;
  const refs=Array.isArray(body.references)?body.references:[];
  refs.slice(0,24).forEach((r,i)=>{if(doc.y>744){footer();doc.addPage();header();title('REFERENCES','Continued');}refLine(r,i);doc.y+=8;});
  if(!refs.length) paragraph('No source references were attached to the publication record.');
  footer();

  // Final controls/disclaimer.
  doc.addPage(); header(); title('PUBLICATION CONTROLS','Product provenance and controlled-use notice');
  card(42,116,511,175);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10).text('GENERATION',58,134);
  doc.fillColor(muted).font('Helvetica').fontSize(8.5).text('Engine',170,134);
  doc.fillColor(ink).text(safe(body.generator?.name||'SONALIT EVIDENCE-FIRST PUBLICATION FABRIC'),220,134,{width:315});
  doc.fillColor(muted).text('Mode',170,158);
  doc.fillColor(ink).text(safe(body.generator?.mode||'DETERMINISTIC_EVIDENCE_PUBLICATION'),220,158,{width:315});
  doc.fillColor(muted).text('Evidence contract',170,182);
  doc.fillColor(ink).text(body.collection_coverage?.evidence_contract_met?'MET':'NOT MET',220,182,{width:315});
  doc.fillColor(muted).text('Publication ID',170,206);
  doc.fillColor(ink).text(safe(publication.id||'—'),220,206,{width:315});
  doc.fillColor(muted).text('Version',170,230);
  doc.fillColor(ink).text(safe(publication.version||body.version||1),220,230,{width:315});
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(7.5).text('CONTROLLED USE',58,320);
  doc.y=338;
  paragraph(body.disclaimer||'This product is evidence-governed decision support and should be used with appropriate professional judgement.',58,479,9,4.5);
  doc.y+=14;
  paragraph(
    'Source records remain the authoritative evidence layer. Analytical wording in this product is bounded by the publication evidence contract; where the evidence is incomplete, the publication states the limitation rather than inventing detail.',
    58,479,8.6,4
  );
  doc.y+=22;
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(7.5).text('SONALIT · CONFIDENTIAL · CONTROLLED DISTRIBUTION',58,doc.y,{characterSpacing:0.8});
  footer();

  doc.end();
  return done;
}

async function getR2Client(){const {R2_ACCOUNT_ID,R2_ACCESS_KEY,R2_SECRET_KEY}=process.env;if(!(R2_ACCOUNT_ID&&R2_ACCESS_KEY&&R2_SECRET_KEY))return null;return new S3Client({region:'auto',endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:R2_ACCESS_KEY,secretAccessKey:R2_SECRET_KEY}})}
async function fetchImages(rows,researchSources=[]){
  const candidates=[];
  for(const row of rows||[]){
    const url=row.raw_metadata?.image_url||row.raw_metadata?.imageUrl||row.raw_metadata?.thumbnail_url||row.raw_metadata?.thumbnailUrl;
    if(url)candidates.push({image_url:url,label:row.title||'Source image',source_url:row.url||url});
  }
  for(const src of researchSources||[])if(src?.image_url)candidates.push({image_url:src.image_url,label:src.title||'Research source image',source_url:src.url||src.image_url});
  const seen=new Set(),out=[];
  for(const candidate of candidates){
    const url=candidate.image_url;
    // Images are optional context, never authoritative evidence. Fetch them
    // only through the validated public-HTTPS boundary, with byte and pixel
    // ceilings before they can enter the PDF renderer.
    if(!/^https:\/\//i.test(url)||seen.has(url))continue;
    seen.add(url);
    try{
      const response=await safeFetchPublicResearch(url,{timeoutMs:10000,maxBytes:MAX_PDF_IMAGE_BYTES});
      if(!response.ok)continue;
      const contentType=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!PDF_IMAGE_CONTENT_TYPES.has(contentType))continue;
      const raw=Buffer.from(await response.arrayBuffer());
      if(!raw.length||raw.length>MAX_PDF_IMAGE_BYTES)continue;
      const metadata=await sharp(raw,{limitInputPixels:30_000_000}).metadata();
      if(!['jpeg','png','webp','avif','heif','tiff'].includes(String(metadata.format||'').toLowerCase()))continue;
      const buffer=await sharp(raw,{limitInputPixels:30_000_000})
        .resize({width:1800,height:1200,fit:'inside',withoutEnlargement:true})
        .jpeg({quality:82,mozjpeg:true})
        .toBuffer();
      if(!buffer.length||buffer.length>MAX_PDF_IMAGE_BYTES)continue;
      out.push({buffer,label:candidate.label,source_url:candidate.source_url});
      if(out.length>=6)break;
    }catch(error){
      const sourceHost=(()=>{try{return new URL(url).hostname.toLowerCase().slice(0,255)}catch(_){return 'invalid-url'}})();
      logger.warn('Publication image fetch failed host='+sourceHost+': '+String(error&&error.message||'unknown').slice(0,300));
    }
  }
  return out;
}

async function renderAndStorePublicationPdfUnsafe(orgId, publicationId){
  const {rows:[publication]}=await query('SELECT * FROM intel_publications WHERE id=$1 AND org_id=$2 LIMIT 1',[publicationId,orgId]);
  if(!publication)throw new Error('Publication not found');
  if(publication.status!=='published')return{status:'skipped',reason:'publication_not_published'};
  await query("UPDATE intel_publications SET pdf_status='generating',pdf_error=NULL,updated_at=NOW() WHERE id=$1 AND org_id=$2",[publicationId,orgId]);
  try{
    const {rows:events}=await query(`SELECT e.id,COALESCE(e.canonical_headline,e.title) AS headline,COALESCE(e.executive_brief,e.summary) AS brief,e.summary,e.title,e.severity,e.confidence,e.intelligence_type,e.latitude,e.longitude,e.last_seen_at,COUNT(DISTINCT eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count,array_agg(DISTINCT o.source_id) FILTER (WHERE o.source_id IS NOT NULL) AS source_ids,array_agg(DISTINCT jsonb_build_object('id',o.id,'title',o.title,'url',o.url,'raw_metadata',o.raw_metadata)) FILTER (WHERE o.id IS NOT NULL) AS observations FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4 GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT 120`,[orgId,publication.country_code,publication.period_start,publication.period_end]);
    const observationRows=[];for(const e of events){for(const o of e.observations||[])observationRows.push(o)}
    const researchSources=(Array.isArray(publication.body?.incident_dossiers)?publication.body.incident_dossiers:[]).flatMap(e=>Array.isArray(e?.research_sources)?e.research_sources:[]);
    const images=await fetchImages(observationRows,researchSources); const pdf=await buildProfessionalPdf(publication,events,images);
    const r2=await getR2Client(); if(!r2)throw new Error('R2 not configured'); const bucket=process.env.R2_BUCKET; if(!bucket)throw new Error('R2_BUCKET not configured');
    const safe=`${publication.country_code}-${publication.publication_type}-${new Date(publication.period_start).toISOString().slice(0,10)}`.replace(/[^A-Z0-9._-]/gi,'-');
    const pdfVersion=Number(publication.pdf_version)||1;
    const keyPrefix=`intelligence-publications/${orgId}/${safe}-r${PDF_RENDERER_VERSION}-v${pdfVersion}-`;
    const priorKey=String(publication.pdf_key||'');
    const priorSuffix=priorKey.startsWith(keyPrefix)?priorKey.slice(keyPrefix.length):'';
    const key=/^[0-9a-f-]{36}\.pdf$/i.test(priorSuffix)?priorKey:`${keyPrefix}${crypto.randomUUID()}.pdf`;
    await r2.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:pdf,ContentType:'application/pdf',CacheControl:'private, max-age=0'}));
    // Publication PDFs are returned only by streamPublicationPdf after
    // tenant- and role-scoped authorization; never publish a raw R2 URL.
    await query("UPDATE intel_publications SET pdf_status='ready',pdf_key=$3,pdf_url=NULL,pdf_generated_at=NOW(),pdf_error=NULL,updated_at=NOW() WHERE id=$1 AND org_id=$2",[publicationId,orgId,key]);
    for(const img of images)await query('INSERT INTO intel_publication_pdf_assets (org_id,publication_id,asset_type,source_url,source_label,provenance) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',[orgId,publicationId,'image',img.source_url,img.label,JSON.stringify({embedded:true})]).catch(()=>{});
    return{status:'ready',publication_id:publicationId,pdf_url:null};
  }catch(error){await query("UPDATE intel_publications SET pdf_status='failed',pdf_error=$3,updated_at=NOW() WHERE id=$1 AND org_id=$2",[publicationId,orgId,String(error.message||error).slice(0,2000)]).catch(()=>{});throw error;}
}

async function getPublicationPdfAccessUrlUnsafe(orgId,publicationId,{download=false}={}){
  const {rows:[row]}=await query('SELECT pdf_key,body FROM intel_publications WHERE id=$1 AND org_id=$2 AND status=\'published\' AND pdf_status=\'ready\' LIMIT 1',[publicationId,orgId]);
  if(!row?.pdf_key)throw new Error('Publication PDF is not ready');
  if(String(row.body?.generator?.pdf_renderer_version||'')!==PDF_RENDERER_VERSION)throw Object.assign(new Error('Publication PDF is stale and awaiting regeneration'),{code:'publication_pdf_stale'});
  const r2=await getR2Client(); if(!r2)throw new Error('R2 not configured');
  const bucket=process.env.R2_BUCKET; if(!bucket)throw new Error('R2_BUCKET not configured');
  const filename=('sonalit-'+String(publicationId)+'.pdf').replace(/[^A-Za-z0-9._-]/g,'-');
  return getSignedUrl(r2,new GetObjectCommand({Bucket:bucket,Key:row.pdf_key,...(download?{ResponseContentType:'application/pdf',ResponseContentDisposition:`attachment; filename="${filename}"`}: {})}),{expiresIn:300});
}

async function generateMissingPublicationPdfsUnsafe(orgId,limit=3){const {rows}=await query("SELECT id FROM intel_publications WHERE org_id=$1 AND status='published' AND (pdf_status='not_requested' OR pdf_status IS NULL OR (pdf_status='failed' AND updated_at < NOW()-INTERVAL '30 minutes') OR (pdf_status='generating' AND updated_at < NOW()-INTERVAL '30 minutes') OR (pdf_status='ready' AND COALESCE(body->'generator'->>'pdf_renderer_version','') <> $2)) ORDER BY COALESCE(pdf_generated_at,published_at,created_at) ASC NULLS FIRST LIMIT $3",[orgId,PDF_RENDERER_VERSION,limit]);const out=[];for(const r of rows){try{out.push(await renderAndStorePublicationPdfUnsafe(orgId,r.id))}catch(error){out.push({status:'failed',publication_id:r.id,error:error.message})}}return out;}
async function generateMissingPublicationPdfs(orgId,limit=3){
  return runWithOrgContext(orgId, () => generateMissingPublicationPdfsUnsafe(orgId, limit));
}

async function renderAndStorePublicationPdf(orgId, publicationId){
  return runWithOrgContext(orgId, () => renderAndStorePublicationPdfUnsafe(orgId, publicationId));
}

async function streamPublicationPdf(orgId, publicationId, req, res){
  const download = String(req.query.download||'').toLowerCase()==='1' || String(req.query.download||'').toLowerCase()==='true';
  const pdf = await getPublicationPdfObject(orgId, publicationId);
  const filename = ('sonalit-' + publicationId + '.pdf').replace(/[^A-Za-z0-9._-]/g,'-');
  res.status(200);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',(download?'attachment':'inline')+'; filename="'+filename+'"');
  res.setHeader('Cache-Control','private, no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(Number.isFinite(Number(pdf.contentLength)))res.setHeader('Content-Length',String(pdf.contentLength));
  if(pdf.etag)res.setHeader('ETag',String(pdf.etag));
  if(pdf.lastModified)res.setHeader('Last-Modified',new Date(pdf.lastModified).toUTCString());
  const body=pdf.body;
  if(body && typeof body.pipe==='function'){
    body.once('error',error=>res.headersSent?res.destroy(error):res.destroy(error));
    body.pipe(res);
    return;
  }
  try{
    for await(const chunk of body)res.write(chunk);
    res.end();
  }catch(error){
    if(res.headersSent)res.destroy(error); else throw error;
  }
}

async function getPublicationPdfObjectUnsafe(orgId,publicationId){
  const {rows:[row]}=await query("SELECT pdf_key,body FROM intel_publications WHERE id=$1 AND org_id=$2 AND status='published' AND pdf_status='ready' LIMIT 1",[publicationId,orgId]);
  if(!row?.pdf_key)throw new Error('Publication PDF is not ready');
  if(String(row.body?.generator?.pdf_renderer_version||'')!==PDF_RENDERER_VERSION)throw Object.assign(new Error('Publication PDF is stale and awaiting regeneration'),{code:'publication_pdf_stale'});
  const r2=await getR2Client(); if(!r2)throw new Error('R2 not configured');
  const bucket=process.env.R2_BUCKET; if(!bucket)throw new Error('R2_BUCKET not configured');
  try{
    const object=await r2.send(new GetObjectCommand({Bucket:bucket,Key:row.pdf_key}));
    if(!object.Body)throw new Error('Publication PDF object is empty');
    return {body:object.Body,contentLength:object.ContentLength,etag:object.ETag,lastModified:object.LastModified};
  }catch(error){
    const status=error?.$metadata?.httpStatusCode;
    if(status===404||error?.name==='NoSuchKey'||error?.name==='NotFound'){
      const wrapped=new Error('Publication PDF object not found');
      wrapped.code='publication_pdf_object_not_found';
      throw wrapped;
    }
    throw error;
  }
}

async function getPublicationPdfObject(orgId,publicationId){
  return runWithOrgContext(orgId,()=>getPublicationPdfObjectUnsafe(orgId,publicationId));
}

async function getPublicationPdfAccessUrl(orgId, publicationId, options={}){
  return runWithOrgContext(orgId, () => getPublicationPdfAccessUrlUnsafe(orgId, publicationId, options));
}

module.exports={renderAndStorePublicationPdf,generateMissingPublicationPdfs,getPublicationPdfAccessUrl,getPublicationPdfObject,streamPublicationPdf};

