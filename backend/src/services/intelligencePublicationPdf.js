const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { PutObjectCommand, GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { query } = require('../config/database');
const { runWithOrgContext } = require('../utils/tenantContext');
const logger = require('../utils/logger');

const COUNTRY_NAMES = { KE:'Kenya', SO:'Somalia', ET:'Ethiopia', UG:'Uganda', TZ:'Tanzania', RW:'Rwanda', BI:'Burundi', SS:'South Sudan', DJ:'Djibouti', ER:'Eritrea', SD:'Sudan', CD:'DR Congo' };
const BOUNDS = {
  KE:[33.8,-4.8,41.9,4.7], TZ:[29.3,-11.8,40.5,-0.9], UG:[29.5,-1.5,35.1,4.3], RW:[28.8,-2.9,30.9,-1.0], BI:[28.9,-4.5,30.9,-2.3], SO:[40.9,-1.9,51.5,12.2], ET:[32.9,3.3,47.9,14.9], SS:[23.4,3.4,35.9,12.2], DJ:[41.6,10.9,43.5,13.1], ER:[36.4,12.3,43.2,18.0], SD:[21.8,8.7,38.1,22.2], CD:[12.1,-13.5,31.3,5.4]
};

function esc(v){return String(v ?? '').replace(/[&<>\"]/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[s]||s));}
function severityScore(v){return ({critical:4,high:3,moderate:2,low:1,informational:0}[String(v||'').toLowerCase()] ?? 2);}
function svgMap(country, events){
  const [minLon,minLat,maxLon,maxLat]=BOUNDS[country]||[20,-20,55,20];
  const W=1200,H=720,pad=70;
  const x=lon=>pad+((lon-minLon)/(maxLon-minLon))*(W-pad*2);
  const y=lat=>H-pad-((lat-minLat)/(maxLat-minLat))*(H-pad*2);
  const dots=events.filter(e=>Number.isFinite(Number(e.longitude))&&Number.isFinite(Number(e.latitude))).slice(0,80).map(e=>{
    const r=4+severityScore(e.severity)*2; const c={critical:'#ef4444',high:'#f97316',moderate:'#f59e0b',low:'#38bdf8',informational:'#94a3b8'}[String(e.severity||'moderate').toLowerCase()]||'#f59e0b';
    return `<circle cx="${x(Number(e.longitude)).toFixed(1)}" cy="${y(Number(e.latitude)).toFixed(1)}" r="${r}" fill="${c}" opacity=".9"><title>${esc(e.headline||e.title||'Event')}</title></circle>`;
  }).join('');
  const graticule=[]; for(let i=0;i<=6;i++){const yy=pad+i*((H-pad*2)/6);graticule.push(`<line x1="${pad}" y1="${yy}" x2="${W-pad}" y2="${yy}" stroke="#334155" stroke-width="1" opacity=".5"/>`)}
  for(let i=0;i<=8;i++){const xx=pad+i*((W-pad*2)/8);graticule.push(`<line x1="${xx}" y1="${pad}" x2="${xx}" y2="${H-pad}" stroke="#334155" stroke-width="1" opacity=".5"/>`)}
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b1220"/><rect x="${pad}" y="${pad}" width="${W-pad*2}" height="${H-pad*2}" rx="18" fill="#0f172a" stroke="#475569" stroke-width="2"/>${graticule.join('')}<text x="${pad}" y="38" fill="#f8fafc" font-family="Arial" font-size="26" font-weight="700">${esc(COUNTRY_NAMES[country]||country)} SECURITY EVENT MAP</text><text x="${pad}" y="62" fill="#94a3b8" font-family="Arial" font-size="14">Geospatial intelligence plot · event coordinates from Sonalit evidence ledger</text>${dots}</svg>`);
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

  const safe=v=>String(v==null?'':v);
  const upper=v=>safe(v).toUpperCase();
  const score=s=>({CRITICAL:4,HIGH:3,MODERATE:2,LOW:1,INFORMATIONAL:0}[upper(s)]??2);

  function header(){
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted)
      .text('SONALIT  /  3I INTELLIGENCE & SECURITY OPERATIONS',42,24,{characterSpacing:1.1});
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

  // Cover — styled as a controlled intelligence product, not a generic report.
  header();
  doc.rect(42,58,511,245).fill(navy);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
    .text('SONALIT 3I',64,80,{characterSpacing:1.6});
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
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text('KEY JUDGEMENTS',42,378);
  (Array.isArray(body.assessment_highlights)?body.assessment_highlights:[]).slice(0,4).forEach(x=>{doc.y+=5;bullet(x,54,485);});
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text('CHANGE ANALYSIS',42,500);
  paragraph(body.change_analysis?.summary||'No change analysis was supplied.',42,511,9.2,4);
  doc.y+=8;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text('SEVERITY DISTRIBUTION',42,575);
  const dist=p.counts||{};
  const distRows=['critical','high','moderate','low','informational'];
  distRows.forEach((s,i)=>{
    const y=598+i*25;
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

  // Key developments, each grounded to event evidence.
  const key=Array.isArray(body.key_developments)?body.key_developments:events.slice(0,8);
  let idx=0;
  while(idx<key.length){
    doc.addPage(); header(); title('KEY DEVELOPMENTS', 'Priority reporting and evidence-linked assessment');
    for(let slot=0;slot<2 && idx<key.length;slot++,idx++){
      const e=key[idx]||{};
      const top=doc.y;
      const h=slot===0?304:304;
      card(42,top,511,h);
      const sev=upper(e.severity||'moderate');
      tag(sev,58,top+16,94,sev==='CRITICAL'?critical:sev==='HIGH'?high:moderate);
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(safe(e.headline||e.title||'Development'),164,top+17,{width:370});
      doc.fillColor(muted).font('Helvetica').fontSize(7.4).text(
        upper(e.region||'Location not specified')+'  ·  '+upper(e.confidence!=null?String(e.confidence)+'%':'CONFIDENCE —')+'  ·  '+String(e.evidence_count||0)+' EVIDENCE  ·  '+String(e.source_count||0)+' SOURCES',
        58,top+42,{width:466}
      );
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.5).text('WHAT HAPPENED',58,top+72);
      doc.fillColor(ink).font('Helvetica').fontSize(8.8).text(safe(e.what_happened||e.brief||e.summary),58,top+88,{width:466,lineGap:3.5});
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.5).text('ASSESSMENT',58,top+166);
      doc.fillColor(ink).font('Helvetica').fontSize(8.5).text(safe(e.assessment||'Evidence-derived assessment.'),58,top+181,{width:466,lineGap:3.5});
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(7.5).text('WHY IT MATTERS',58,top+230);
      const why=Array.isArray(e.why_it_matters)?e.why_it_matters.join(' '):safe(e.why_it_matters||'Continued monitoring is warranted.');
      doc.fillColor(ink).font('Helvetica').fontSize(8.3).text(why,58,top+245,{width:466,lineGap:3.2});
      const facts=Array.isArray(e.key_facts)?e.key_facts:[];
      if(facts.length){
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(7).text('KEY FACTS',58,top+282);
        doc.fillColor(muted).font('Helvetica').fontSize(7.1).text(facts.slice(0,2).map(x=>'• '+safe(x)).join('  '),110,top+281,{width:405,lineGap:2.4});
      }
      const refs=Array.isArray(e.source_refs)?e.source_refs:[];
      if(refs.length){
        doc.fillColor(muted).font('Helvetica-Bold').fontSize(6.8).text('SOURCES',58,top+305);
        doc.fillColor(muted).font('Helvetica').fontSize(6.8).text(refs.slice(0,2).map(r=>safe(r.source||'Source')).join(' · '),110,top+304,{width:412});
      }
      const caveats=Array.isArray(e.caveats)?e.caveats:[];
      if(caveats.length && slot===1){
        doc.fillColor(muted).font('Helvetica').fontSize(6.6).text('CAVEATS: '+caveats.slice(0,2).join(' '),58,top+318,{width:466,lineGap:2});
      }
      doc.y=top+h+18;
    }
    footer();
  }
  if(!key.length){
    doc.addPage(); header(); title('KEY DEVELOPMENTS');
    paragraph('No material event object was available for this reporting period. This is a collection statement and should be read together with the collection-gap note.');
    footer();
  }

  // Regional roll-up, matching the sample product architecture.
  const regions=Array.isArray(body.regional_news)?body.regional_news:[];
  doc.addPage(); header(); title('REGIONAL NEWS','Geographic roll-up of evidence-backed event reporting');
  if(regions.length){
    for(const group of regions){
      if(doc.y>705){footer();doc.addPage();header();title('REGIONAL NEWS','Continued');}
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(upper(group.region||'REGION'),42,doc.y);
      doc.moveTo(42,doc.y+15).lineTo(553,doc.y+15).strokeColor(line).stroke();
      doc.y+=24;
      for(const item of Array.isArray(group.items)?group.items:[]){
        if(doc.y>748){footer();doc.addPage();header();title('REGIONAL NEWS','Continued');}
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
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(7.5).text('SONALIT 3I · CONFIDENTIAL · CONTROLLED DISTRIBUTION',58,doc.y,{characterSpacing:0.8});
  footer();

  doc.end();
  return done;
}

async function getR2Client(){const {R2_ACCOUNT_ID,R2_ACCESS_KEY,R2_SECRET_KEY}=process.env;if(!(R2_ACCOUNT_ID&&R2_ACCESS_KEY&&R2_SECRET_KEY))return null;return new S3Client({region:'auto',endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:R2_ACCESS_KEY,secretAccessKey:R2_SECRET_KEY}})}
async function fetchImages(rows){const out=[];for(const row of rows){const url=row.raw_metadata?.image_url||row.raw_metadata?.imageUrl||row.raw_metadata?.thumbnail_url||row.raw_metadata?.thumbnailUrl;if(!url||!/^https?:\/\//i.test(url))continue;try{const r=await fetch(url,{redirect:'follow'});if(!r.ok)continue;const b=Buffer.from(await r.arrayBuffer());if(!b.length||b.length>5*1024*1024)continue;out.push({buffer:b,label:row.title||'Source image',source_url:row.url||url});if(out.length>=4)break;}catch(error){logger.warn(`Image fetch failed: ${error.message}`)}}return out;}

async function renderAndStorePublicationPdfUnsafe(orgId, publicationId){
  const {rows:[publication]}=await query('SELECT * FROM intel_publications WHERE id=$1 AND org_id=$2 LIMIT 1',[publicationId,orgId]);
  if(!publication)throw new Error('Publication not found');
  if(publication.status!=='published')return{status:'skipped',reason:'publication_not_published'};
  await query("UPDATE intel_publications SET pdf_status='generating',pdf_error=NULL WHERE id=$1 AND org_id=$2",[publicationId,orgId]);
  try{
    const {rows:events}=await query(`SELECT e.id,COALESCE(e.canonical_headline,e.title) AS headline,COALESCE(e.executive_brief,e.summary) AS brief,e.summary,e.title,e.severity,e.confidence,e.intelligence_type,e.latitude,e.longitude,e.last_seen_at,COUNT(DISTINCT eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count,array_agg(DISTINCT o.source_id) FILTER (WHERE o.source_id IS NOT NULL) AS source_ids,array_agg(DISTINCT jsonb_build_object('id',o.id,'title',o.title,'url',o.url,'raw_metadata',o.raw_metadata)) FILTER (WHERE o.id IS NOT NULL) AS observations FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4 GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT 120`,[orgId,publication.country_code,publication.period_start,publication.period_end]);
    const observationRows=[];for(const e of events){for(const o of e.observations||[])observationRows.push(o)}
    const images=await fetchImages(observationRows); const pdf=await buildPdf(publication,events,images);
    const r2=await getR2Client(); if(!r2)throw new Error('R2 not configured'); const bucket=process.env.R2_BUCKET; if(!bucket)throw new Error('R2_BUCKET not configured');
    const safe=`${publication.country_code}-${publication.publication_type}-${new Date(publication.period_start).toISOString().slice(0,10)}`.replace(/[^A-Z0-9._-]/gi,'-');const key=`intelligence-publications/${orgId}/${safe}-v${publication.pdf_version||1}.pdf`;
    await r2.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:pdf,ContentType:'application/pdf',CacheControl:'private, max-age=0'}));
    const publicBase=(process.env.R2_PUBLIC_URL||'').replace(/\/$/,''); const pdfUrl=publicBase?`${publicBase}/${key}`:null;
    await query("UPDATE intel_publications SET pdf_status='ready',pdf_key=$3,pdf_url=$4,pdf_generated_at=NOW(),pdf_error=NULL,updated_at=NOW() WHERE id=$1 AND org_id=$2",[publicationId,orgId,key,pdfUrl]);
    for(const img of images)await query('INSERT INTO intel_publication_pdf_assets (org_id,publication_id,asset_type,source_url,source_label,provenance) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',[orgId,publicationId,'image',img.source_url,img.label,JSON.stringify({embedded:true})]).catch(()=>{});
    return{status:'ready',publication_id:publicationId,pdf_url:pdfUrl,key};
  }catch(error){await query("UPDATE intel_publications SET pdf_status='failed',pdf_error=$3 WHERE id=$1 AND org_id=$2",[publicationId,orgId,String(error.message||error).slice(0,2000)]).catch(()=>{});throw error;}
}

async function getPublicationPdfAccessUrlUnsafe(orgId,publicationId){
  const {rows:[row]}=await query('SELECT pdf_key FROM intel_publications WHERE id=$1 AND org_id=$2 AND status=\'published\' AND pdf_status=\'ready\' LIMIT 1',[publicationId,orgId]);
  if(!row?.pdf_key)throw new Error('Publication PDF is not ready');
  const r2=await getR2Client(); if(!r2)throw new Error('R2 not configured');
  const bucket=process.env.R2_BUCKET; if(!bucket)throw new Error('R2_BUCKET not configured');
  return getSignedUrl(r2,new GetObjectCommand({Bucket:bucket,Key:row.pdf_key}),{expiresIn:300});
}

async function generateMissingPublicationPdfsUnsafe(orgId,limit=3){const {rows}=await query("SELECT id FROM intel_publications WHERE org_id=$1 AND status='published' AND (pdf_status='not_requested' OR pdf_status IS NULL OR (pdf_status='failed' AND updated_at < NOW()-INTERVAL '30 minutes')) ORDER BY published_at DESC NULLS LAST LIMIT $2",[orgId,limit]);const out=[];for(const r of rows){try{out.push(await renderAndStorePublicationPdfUnsafe(orgId,r.id))}catch(error){out.push({status:'failed',publication_id:r.id,error:error.message})}}return out;}
async function generateMissingPublicationPdfs(orgId,limit=3){
  return runWithOrgContext(orgId, () => generateMissingPublicationPdfsUnsafe(orgId, limit));
}

async function renderAndStorePublicationPdf(orgId, publicationId){
  return runWithOrgContext(orgId, () => renderAndStorePublicationPdfUnsafe(orgId, publicationId));
}

async function getPublicationPdfAccessUrl(orgId, publicationId){
  return runWithOrgContext(orgId, () => getPublicationPdfAccessUrlUnsafe(orgId, publicationId));
}

module.exports={renderAndStorePublicationPdf,generateMissingPublicationPdfs,getPublicationPdfAccessUrl};

