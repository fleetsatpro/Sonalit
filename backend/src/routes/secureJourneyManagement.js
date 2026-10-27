'use strict';
const crypto = require('crypto');
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { analyseRoute } = require('../utils/routeAnalyser');

const STATUSES = ['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','in_progress','paused','exception','arrival_pending_verification','closed','cancelled','aborted','on_hold'];
const TERMINAL_STATUSES = ['closed','cancelled','aborted'];
const STOP_TYPES = ['checkpoint','rest','refuelling','border','meeting','overnight','destination','other'];
const REPORT_TYPES = ['itinerary','daily','final'];
const SECTIONS = ['summary','itinerary','stops','route_assessment','operational_events','telemetry_snapshot'];
const EVENT_TYPES = ['operator_note','security_update','client_update','delay','incident','other'];
const LIFECYCLE_TRANSITIONS = {
  ready_to_depart: { from:['approved'], to:'ready_to_depart', timestamp:'ready_to_depart_at' },
  start: { from:['ready_to_depart'], to:'in_progress', timestamp:'started_at' },
  pause: { from:['in_progress'], to:'paused', timestamp:'paused_at', reasonRequired:true },
  resume: { from:['paused'], to:'in_progress' },
  raise_exception: { from:['in_progress','paused'], to:'exception', timestamp:'exception_at', reasonRequired:true },
  arrive: { from:['in_progress'], to:'arrival_pending_verification', timestamp:'arrival_pending_verification_at' },
  hold: { from:['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','in_progress','paused','exception'], to:'on_hold', timestamp:'on_hold_at', reasonRequired:true },
  cancel: { from:['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','on_hold'], to:'cancelled', timestamp:'cancelled_at', reasonRequired:true },
  abort: { from:['in_progress','paused','exception','arrival_pending_verification'], to:'aborted', timestamp:'aborted_at', reasonRequired:true },
  replan: { from:['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','paused','exception','on_hold'], to:'planning', timestamp:'planning_started_at', reasonRequired:true, clearPlan:true },
};
const DEFAULT_TEMPLATE = { title: 'Secure Journey Management Report', sections: SECTIONS };
const SJM_SCHEDULER_ORG_IDS = String(process.env.SJM_REPORT_SCHEDULER_ORG_IDS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
const SJM_ORG_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function dailyReportSchedulerAvailable(orgId){return SJM_SCHEDULER_ORG_IDS.length>0&&SJM_SCHEDULER_ORG_IDS.every(v=>SJM_ORG_UUID.test(v))&&SJM_ORG_UUID.test(String(orgId||'').toLowerCase())&&SJM_SCHEDULER_ORG_IDS.includes(String(orgId).toLowerCase());}

function lifecycleTransition(status, action) { const t=LIFECYCLE_TRANSITIONS[action]; return t && t.from.includes(status) ? t : null; }
function txt(v, max=500) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function validCoordinate(lat,lng) { return typeof lat==='number' && Number.isFinite(lat) && lat>=-90 && lat<=90 && typeof lng==='number' && Number.isFinite(lng) && lng>=-180 && lng<=180 && !(Math.abs(lat)<0.000001 && Math.abs(lng)<0.000001); }
function validDate(v) { return v==null || (typeof v==='string' && Number.isFinite(Date.parse(v))); }
function validateStop(s) {
  if (!s || typeof s!=='object' || Array.isArray(s)) return 'Each stop must be an object.';
  if (!txt(s.name,160)) return 'Every stop needs a name.';
  if (!STOP_TYPES.includes(s.stop_type || 'checkpoint')) return 'Stop type is not supported.';
  if ((s.lat==null)!==(s.lng==null)) return 'Stop latitude and longitude must be supplied together.';
  if (s.lat==null || s.lng==null) return 'Stop coordinates are required so the routed itinerary includes this stop.';
  if (!validCoordinate(s.lat,s.lng)) return 'Stop coordinates are invalid.';
  if (!validDate(s.planned_arrival_at) || !validDate(s.planned_departure_at)) return 'Stop times must be valid ISO dates.';
  if (s.duration_minutes!=null && (!Number.isInteger(s.duration_minutes)||s.duration_minutes<0||s.duration_minutes>10080)) return 'Stop duration must be between 0 and 10080 minutes.';
  return null;
}
function validateJourney(b) {
  if (!b || typeof b!=='object' || Array.isArray(b)) return 'A journey payload is required.';
  if (!txt(b.title,180)) return 'Journey title is required.';
  if (!txt(b.purpose,1200)) return 'Journey purpose is required.';
  if (!txt(b.origin_label,180) || !txt(b.destination_label,180)) return 'Origin and destination labels are required.';
  if (!validCoordinate(b.origin_lat,b.origin_lng) || !validCoordinate(b.destination_lat,b.destination_lng)) return 'Origin and destination coordinates must be valid and non-zero.';
  if (!validDate(b.planned_departure_at)||!validDate(b.planned_arrival_at)) return 'Planned times must be valid ISO dates.';
  if (b.planned_departure_at && b.planned_arrival_at && Date.parse(b.planned_arrival_at)<=Date.parse(b.planned_departure_at)) return 'Planned arrival must be after planned departure.';
  if (b.stops!=null && !Array.isArray(b.stops)) return 'Stops must be an array.';
  if ((b.stops||[]).length>23) return 'A journey can contain at most 23 stops.';
  for (const s of b.stops||[]) { const err=validateStop(s); if(err)return err; }
  if (b.client_id!=null && !/^[0-9a-f-]{36}$/i.test(String(b.client_id))) return 'Client ID must be a UUID.';
  if (b.convoy_id!=null && !/^[0-9a-f-]{36}$/i.test(String(b.convoy_id))) return 'Convoy ID must be a UUID.';
  if (b.transport_mode!=null && !['road','air','rail','sea','multimodal','other'].includes(b.transport_mode)) return 'Transport mode is not supported.';
  if (b.timezone != null && !tzValid(b.timezone)) return 'Reporting timezone must be a valid IANA timezone.';
  return null;
}
function approvalGate(a, review, ack) {
  if (a && (a.route_status==='blocked' || a.recommended_route?.blocked===true || a.safety_gate==='NO_GO')) return {ok:false,code:'ROUTE_BLOCKED',message:'The selected route is blocked and cannot be approved.'};
  if (!a || a.route_status!=='routed') return {ok:false,code:'ROUTED_EVIDENCE_REQUIRED',message:'A routed safety assessment is required before approval.'};
  if (a.safety_gate==='HUMAN_REVIEW' && review!=='approve_with_controls') return {ok:false,code:'HUMAN_REVIEW_REQUIRED',message:'A recorded human review decision is required before approval.'};
  if (!['GO','CONDITIONAL','HUMAN_REVIEW'].includes(a.safety_gate)) return {ok:false,code:'UNKNOWN_SAFETY_GATE',message:'Unknown route safety gate; approval is blocked.'};
  if (['CONDITIONAL','HUMAN_REVIEW'].includes(a.safety_gate) && txt(ack,1200).length<15) return {ok:false,code:'RISK_ACKNOWLEDGEMENT_REQUIRED',message:'Record at least 15 characters describing the operational controls and risk acknowledgement.'};
  return {ok:true};
}
function parseJson(v,fallback) { if(v==null)return fallback; if(typeof v==='object')return v; try{return JSON.parse(v)}catch(_){return fallback} }
function tzValid(tz) { try { new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(new Date()); return typeof tz==='string'&&tz.length>0&&tz.length<=100; } catch(_){return false} }
function dateInTimezone(d,tz) { const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d); const f=(k)=>p.find(x=>x.type===k)?.value||''; return f('year')+'-'+f('month')+'-'+f('day'); }
function csvCell(v) { if(v==null)return ''; const s=typeof v==='object'?JSON.stringify(v):String(v); return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCsv(report) {
  const rows=[['record_type','timestamp','label','status','details']];
  const j=report.journey||{};
  rows.push(['journey',j.created_at||'',j.title||'',j.status||'',{reference:j.reference,client:j.client_name,convoy:j.convoy_name,origin:j.origin_label,destination:j.destination_label,purpose:j.purpose}]);
  for(const s of report.stops||[]) rows.push(['stop',s.confirmed_at||s.planned_arrival_at||'',s.name||'',s.stop_status||'',{sequence:s.sequence,stop_type:s.stop_type,planned_arrival_at:s.planned_arrival_at,actual_lat:s.actual_lat,actual_lng:s.actual_lng,confirmation_source:s.confirmation_source}]);
  for(const e of report.events||[]) rows.push(['event',e.created_at||'',e.event_type||'',e.source||'',e.detail||{}]);
  for(const d of report.telemetry_snapshot?.devices||[]) rows.push(['telemetry',d.observed_at||'',d.device_name||'',d.freshness||'UNAVAILABLE',{lat:d.lat,lng:d.lng,speed_kph:d.speed_kph,accuracy_m:d.accuracy_m,source:d.source}]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
async function journeyById(db,org,id) {
  const r=await db('SELECT j.*, c.name AS client_name, c.company AS client_company, v.name AS convoy_name FROM sjm_journeys j LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL WHERE j.id=$1 AND j.org_id=$2 AND j.deleted_at IS NULL LIMIT 1',[id,org]);
  return r.rows[0]||null;
}
async function stopsFor(db,org,id) {
  const r=await db('SELECT id,sequence,name,stop_type,lat,lng,planned_arrival_at,planned_departure_at,duration_minutes,instructions,stop_status,confirmed_at,actual_lat,actual_lng,confirmation_source FROM sjm_journey_stops WHERE org_id=$1 AND journey_id=$2 ORDER BY sequence',[org,id]);
  return r.rows;
}
async function eventsFor(db,org,id,limit=200) {
  const r=await db('SELECT id,actor_id,event_type,summary,detail,source,created_at FROM sjm_journey_events WHERE org_id=$1 AND journey_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3',[org,id,limit]);
  return r.rows;
}
async function event(db,j,actor,type,summary,detail={},source='operator') {
  return db('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at',[j.org_id,j.id,actor||null,type,txt(summary,500),JSON.stringify(detail||{}),source]);
}
async function telemetryFor(db,org,j) {
  if(!j.convoy_id)return {status:'UNAVAILABLE',reason:'No convoy linked to this journey; live fleet evidence is unavailable.',observed_at:null,devices:[]};
  const r=await db('SELECT d.id AS device_id,d.name AS device_name,fo.name AS officer_name,fix.lat,fix.lng,fix.speed AS speed_kph,fix.heading,fix.accuracy AS accuracy_m,fix.observed_at,fix.source FROM convoy_cfos cc JOIN guardian_devices d ON d.id=cc.guardian_device_id LEFT JOIN field_officers fo ON fo.device_id=d.id LEFT JOIN LATERAL (SELECT lat,lng,speed,heading,accuracy,timestamp AS observed_at,\'device_locations\'::text AS source FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC,id DESC LIMIT 1) fix ON true WHERE cc.org_id=$1 AND cc.convoy_id=$2 AND d.deleted_at IS NULL ORDER BY d.name',[org,j.convoy_id]);
  const now=Date.now();
  const devices=r.rows.map(d=>{const age=d.observed_at?now-new Date(d.observed_at).getTime():null; const freshness=age==null||!Number.isFinite(age)?'UNAVAILABLE':age<=45000?'LIVE':age<=300000?'DELAYED':'STALE'; return {...d,freshness,age_seconds:age==null||!Number.isFinite(age)?null:Math.max(0,Math.round(age/1000)),evidence_class:'OBSERVED'};});
  const status=devices.some(d=>d.freshness==='LIVE')?'LIVE':devices.some(d=>d.freshness==='DELAYED')?'DELAYED':devices.some(d=>d.freshness==='STALE')?'STALE':'UNAVAILABLE';
  return {status,observed_at:devices.map(d=>d.observed_at).filter(Boolean).sort().slice(-1)[0]||null,devices,reason:devices.length?null:'No linked devices with a location record were returned.'};
}
async function reportSnapshot(db,org,j,type,date) {
  const [stops,events,profile,telemetry]=await Promise.all([
    stopsFor(db,org,j.id),eventsFor(db,org,j.id,500),
    j.client_id?db('SELECT report_timezone,report_template FROM sjm_client_profiles WHERE org_id=$1 AND client_id=$2 LIMIT 1',[org,j.client_id]):Promise.resolve({rows:[]}),
    telemetryFor(db,org,j),
  ]);
  const p=profile.rows[0]||{},template={...DEFAULT_TEMPLATE,...parseJson(p.report_template,{})},assessment=parseJson(j.route_assessment,null);
  return {
    schema_version:'sonalit.sjm.report.v1',report_type:type,report_date:date,generated_at:new Date().toISOString(),
    timezone:p.report_timezone||j.timezone||'Africa/Nairobi',
    client_profile:{client_id:j.client_id,client_name:j.client_name||null,template_title:template.title||DEFAULT_TEMPLATE.title,enabled_sections:Array.isArray(template.sections)?template.sections.filter(x=>SECTIONS.includes(x)):SECTIONS},
    journey:{id:j.id,reference:j.reference,title:j.title,purpose:j.purpose,status:j.status,transport_mode:j.transport_mode,origin_label:j.origin_label,origin_lat:j.origin_lat,origin_lng:j.origin_lng,destination_label:j.destination_label,destination_lat:j.destination_lat,destination_lng:j.destination_lng,planned_departure_at:j.planned_departure_at,planned_arrival_at:j.planned_arrival_at,client_name:j.client_name||null,convoy_name:j.convoy_name||null,created_at:j.created_at,approved_at:j.approved_at,started_at:j.started_at,completed_at:j.completed_at},
    summary:{stop_count:stops.length,reached_stops:stops.filter(s=>s.stop_status==='reached').length,pending_stops:stops.filter(s=>s.stop_status==='planned').length,event_count:events.length,route_assessment_available:Boolean(assessment),safety_gate:assessment?.safety_gate||'UNAVAILABLE',telemetry_status:telemetry.status},
    itinerary:parseJson(j.planned_route,[]),stops,events,route_assessment:assessment,telemetry_snapshot:telemetry,
    provenance:{planned_itinerary:'SJM journey and ordered stop records',route_assessment:assessment?'Stored Sonalit Route Safety assessment':'UNAVAILABLE',telemetry:'Latest device_locations fixes associated with linked convoy; not a route prediction',stop_confirmation:'Operator confirmation is not represented as GPS-derived proof',fabricated_data_used:false},
  };
}
function renderPdf(doc,r) {
  const j=r.journey||{},profile=r.client_profile||{};
  doc.rect(0,0,595,88).fill('#0b132b');
  doc.fillColor('#39ff88').font('Helvetica-Bold').fontSize(9).text('SONALIT  /  XD LIVE SURVEILLANCE',42,25);
  doc.fillColor('#ffffff').fontSize(19).text(profile.template_title||DEFAULT_TEMPLATE.title,42,42,{width:500});
  doc.fillColor('#64748b').font('Helvetica').fontSize(9);
  doc.text('Reference: '+(j.reference||'—')+'   |   Type: '+String(r.report_type||'daily').toUpperCase(),42,105);
  doc.text('Reporting date: '+(r.report_date||'—')+'   |   Timezone: '+(r.timezone||'Africa/Nairobi'),42,119);
  doc.moveDown(3);
  const section=(title,body)=>{if(doc.y>710)doc.addPage();doc.fillColor('#0b132b').font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(),42,doc.y);doc.moveDown(.45);doc.fillColor('#334155').font('Helvetica').fontSize(9).text(body||'No recorded data.',{width:510,lineGap:3});doc.moveDown(.9);};
  const enabled=profile.enabled_sections||SECTIONS;
  if(enabled.includes('summary'))section('Mission summary',['Title: '+(j.title||'—'),'Purpose: '+(j.purpose||'—'),'Status: '+(j.status||'—'),'Client: '+(j.client_name||'Not linked'),'Convoy: '+(j.convoy_name||'Not linked'),'Origin: '+(j.origin_label||'—'),'Destination: '+(j.destination_label||'—'),'Planned departure: '+(j.planned_departure_at||'Not recorded'),'Planned arrival: '+(j.planned_arrival_at||'Not recorded'),'Safety gate: '+(r.summary?.safety_gate||'UNAVAILABLE'),'Telemetry: '+(r.summary?.telemetry_status||'UNAVAILABLE')].join('\n'));
  if(enabled.includes('itinerary'))section('Planned itinerary',(r.itinerary||[]).map((p,i)=>(i+1)+'. '+(p.name||p.label||'Route point')+' ['+p.lat+', '+p.lng+']').join('\n')||'No routed road geometry recorded. Endpoints are not presented as a road-following route.');
  if(enabled.includes('stops'))section('Journey stops',(r.stops||[]).map(s=>s.sequence+'. '+s.name+' — '+s.stop_status+' — planned '+(s.planned_arrival_at||'time not recorded')+(s.confirmed_at?' — confirmed '+s.confirmed_at+' ('+(s.confirmation_source||'unknown')+')':'')).join('\n')||'No stops defined.');
  if(enabled.includes('route_assessment'))section('Route safety assessment',r.route_assessment?['Route status: '+(r.route_assessment.route_status||'unknown'),'Safety gate: '+(r.route_assessment.safety_gate||'unknown'),'Risk score: '+(r.route_assessment.overall_risk_score??'not returned'),'Provider: '+(r.route_assessment.routing_provider||'not returned'),'Assessment: '+(r.route_assessment.ai_summary||'No assessment narrative returned')].join('\n'):'Route assessment unavailable; no verdict is inferred.');
  if(enabled.includes('operational_events'))section('Operational events',(r.events||[]).slice(0,60).map(e=>e.created_at+' — '+e.event_type+' — '+e.summary+' ['+e.source+']').join('\n')||'No operational events recorded.');
  if(enabled.includes('telemetry_snapshot'))section('Observed telemetry',['Snapshot state: '+(r.telemetry_snapshot?.status||'UNAVAILABLE'),...(r.telemetry_snapshot?.devices||[]).map(d=>d.device_name+' — '+d.freshness+' — observed '+(d.observed_at||'not recorded')+' — '+(d.lat==null?'coordinates unavailable':Number(d.lat)+', '+Number(d.lng))+' — source '+(d.source||'none')),r.telemetry_snapshot?.reason||''].filter(Boolean).join('\n')||'No live telemetry available.');
  if(doc.y>700)doc.addPage();
  doc.moveDown(.5);doc.fillColor('#64748b').fontSize(7).text('Evidence note: PLANNED, ANALYSED, OBSERVED and OPERATOR_CONFIRMED data are separated. Operator confirmation is not GPS proof.',42,doc.y,{width:510});doc.end();
}
router.use(authenticate);
router.use((req,res,next)=>{if(!req.user?.org_id||!req.db||!req.dbTx)return res.status(403).json({error:'tenant_scope_required'});next();});

router.get('/clients',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{const r=await req.db('SELECT id,name,company FROM cargo_clients WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT 500',[req.user.org_id]);res.json({data:r.rows});}));
router.get('/convoys',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{const r=await req.db('SELECT id,name,status,route_origin,route_destination FROM convoys WHERE org_id=$1 AND deleted_at IS NULL AND status IN (\'planned\',\'active\') ORDER BY updated_at DESC NULLS LAST,name LIMIT 200',[req.user.org_id]);res.json({data:r.rows});}));

router.get('/client-profiles/:clientId',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const c=await req.db('SELECT id,name,company FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[req.params.clientId,req.user.org_id]);
  if(!c.rows.length)return res.status(404).json({error:'client_not_found'});
  const p=await req.db('SELECT client_id,report_timezone,report_template,daily_reports_enabled,daily_report_local_time,updated_at FROM sjm_client_profiles WHERE org_id=$1 AND client_id=$2 LIMIT 1',[req.user.org_id,req.params.clientId]);
  res.json({data:{...(p.rows[0]||{client_id:req.params.clientId,report_timezone:'Africa/Nairobi',report_template:DEFAULT_TEMPLATE,daily_reports_enabled:false,daily_report_local_time:'18:00:00',updated_at:null}),daily_report_scheduler_available:dailyReportSchedulerAvailable(req.user.org_id),client:c.rows[0]}});
}));
router.put('/client-profiles/:clientId',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const timezone=txt(req.body?.report_timezone,100)||'Africa/Nairobi';
  if(!tzValid(timezone))return res.status(400).json({error:'invalid_reporting_timezone'});
  const enabled=req.body?.daily_reports_enabled===true;
  const rawTime=typeof req.body?.daily_report_local_time==='string'?req.body.daily_report_local_time:'18:00';
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rawTime))return res.status(400).json({error:'invalid_daily_report_local_time',message:'Use a local 24-hour time in HH:MM format.'});
  if(enabled&&!dailyReportSchedulerAvailable(req.user.org_id))return res.status(409).json({error:'daily_report_scheduler_not_configured',message:'Scheduled report generation is not enabled for this organisation on the current runtime. An authorised platform operator must configure SJM_REPORT_SCHEDULER_ORG_IDS first.'});
  const wanted=req.body?.report_template,title=txt(wanted?.title,160)||DEFAULT_TEMPLATE.title,sections=wanted?.sections==null?SECTIONS:wanted.sections;
  if(!Array.isArray(sections)||sections.some(s=>!SECTIONS.includes(s))||new Set(sections).size!==sections.length)return res.status(400).json({error:'invalid_report_sections',allowed:SECTIONS});
  const c=await req.db('SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[req.params.clientId,req.user.org_id]);
  if(!c.rows.length)return res.status(404).json({error:'client_not_found'});
  const p=await req.db('INSERT INTO sjm_client_profiles (org_id,client_id,report_timezone,report_template,daily_reports_enabled,daily_report_local_time,updated_by) VALUES ($1,$2,$3,$4,$5,$6::time,$7) ON CONFLICT (org_id,client_id) DO UPDATE SET report_timezone=EXCLUDED.report_timezone,report_template=EXCLUDED.report_template,daily_reports_enabled=EXCLUDED.daily_reports_enabled,daily_report_local_time=EXCLUDED.daily_report_local_time,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING client_id,report_timezone,report_template,daily_reports_enabled,daily_report_local_time,updated_at',[req.user.org_id,req.params.clientId,timezone,JSON.stringify({title,sections}),enabled,rawTime,req.user.id]);
  res.json({data:{...p.rows[0],daily_report_scheduler_available:dailyReportSchedulerAvailable(req.user.org_id)}});
}));

router.get('/journeys',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const status=req.query.status?String(req.query.status):null;
  if(status&&!STATUSES.includes(status))return res.status(400).json({error:'invalid_journey_status'});
  const clientId=req.query.client_id?String(req.query.client_id):null,limit=Math.max(1,Math.min(100,Number.parseInt(req.query.limit,10)||50));
  const r=await req.db('SELECT j.id,j.reference,j.title,j.purpose,j.status,j.transport_mode,j.origin_label,j.destination_label,j.planned_departure_at,j.planned_arrival_at,j.client_id,c.name AS client_name,j.convoy_id,v.name AS convoy_name,j.created_at,j.updated_at,j.timezone,j.planned_route,j.planned_distance_km,j.planned_duration_minutes,j.route_assessment,j.route_assessment IS NOT NULL AS has_route_assessment FROM sjm_journeys j LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL WHERE j.org_id=$1 AND j.deleted_at IS NULL AND ($2::text IS NULL OR j.status=$2) AND ($3::uuid IS NULL OR j.client_id=$3) ORDER BY j.planned_departure_at DESC NULLS LAST,j.created_at DESC LIMIT $4',[req.user.org_id,status,clientId,limit]);
  res.json({data:r.rows});
}));
router.post('/journeys',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const invalid=validateJourney(req.body);if(invalid)return res.status(400).json({error:'invalid_journey',message:invalid});
  const org=req.user.org_id,b=req.body;
  if(b.client_id){const c=await req.db('SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[b.client_id,org]);if(!c.rows.length)return res.status(404).json({error:'client_not_found_in_organisation'});}
  if(b.convoy_id){const c=await req.db('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[b.convoy_id,org]);if(!c.rows.length)return res.status(404).json({error:'convoy_not_found_in_organisation'});}
  const reference='SJM-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const created=await req.dbTx(async c=>{
    const x=await c.query('INSERT INTO sjm_journeys (org_id,reference,title,purpose,client_id,convoy_id,transport_mode,origin_label,origin_lat,origin_lng,destination_label,destination_lat,destination_lng,planned_departure_at,planned_arrival_at,timezone,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,\'requested\',$17,$17) RETURNING id,org_id,reference',[org,reference,txt(b.title,180),txt(b.purpose,1200),b.client_id||null,b.convoy_id||null,b.transport_mode||'road',txt(b.origin_label,180),b.origin_lat,b.origin_lng,txt(b.destination_label,180),b.destination_lat,b.destination_lng,b.planned_departure_at||null,b.planned_arrival_at||null,tzValid(b.timezone)?b.timezone:'Africa/Nairobi',req.user.id]);
    const j=x.rows[0];
    for(let i=0;i<(b.stops||[]).length;i++){const s=b.stops[i];await c.query('INSERT INTO sjm_journey_stops (org_id,journey_id,sequence,name,stop_type,lat,lng,planned_arrival_at,planned_departure_at,duration_minutes,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[org,j.id,i+1,txt(s.name,160),s.stop_type||'checkpoint',s.lat??null,s.lng??null,s.planned_arrival_at||null,s.planned_departure_at||null,s.duration_minutes??null,txt(s.instructions,1200)||null]);}
    await c.query('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,\'journey_requested\',$4,$5,\'operator\')',[org,j.id,req.user.id,'Journey requested for planning',JSON.stringify({reference,stop_count:(b.stops||[]).length})]);
    return j;
  });
  const j=await journeyById(req.db,org,created.id);res.status(201).json({data:{...j,stops:await stopsFor(req.db,org,created.id)}});
}));
router.get('/journeys/:id',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const j=await journeyById(req.db,req.user.org_id,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  const [stops,events]=await Promise.all([stopsFor(req.db,req.user.org_id,j.id),eventsFor(req.db,req.user.org_id,j.id)]);
  res.json({data:{...j,stops,events}});
}));
router.patch('/journeys/:id',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(!['requested','planning'].includes(j.status))return res.status(409).json({error:'journey_not_editable'});
  const b=req.body||{},stops=b.stops===undefined?await stopsFor(req.db,org,j.id):b.stops;
  const candidate={title:b.title??j.title,purpose:b.purpose??j.purpose,origin_label:b.origin_label??j.origin_label,origin_lat:b.origin_lat==null?Number(j.origin_lat):b.origin_lat,origin_lng:b.origin_lng==null?Number(j.origin_lng):b.origin_lng,destination_label:b.destination_label??j.destination_label,destination_lat:b.destination_lat==null?Number(j.destination_lat):b.destination_lat,destination_lng:b.destination_lng==null?Number(j.destination_lng):b.destination_lng,planned_departure_at:b.planned_departure_at??j.planned_departure_at,planned_arrival_at:b.planned_arrival_at??j.planned_arrival_at,timezone:b.timezone??j.timezone,stops};
  if(!Array.isArray(stops))return res.status(400).json({error:'invalid_journey',message:'Stops must be an array.'});
  const normalized=stops.map(s=>({...s,lat:s.lat==null?null:Number(s.lat),lng:s.lng==null?null:Number(s.lng)}));
  const invalid=validateJourney({...candidate,stops:normalized,transport_mode:b.transport_mode??j.transport_mode});if(invalid)return res.status(400).json({error:'invalid_journey',message:invalid});
  const clientId=b.client_id===undefined?j.client_id:(b.client_id||null),convoyId=b.convoy_id===undefined?j.convoy_id:(b.convoy_id||null);
  if(clientId){const r=await req.db('SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[clientId,org]);if(!r.rows.length)return res.status(404).json({error:'client_not_found_in_organisation'});}
  if(convoyId){const r=await req.db('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[convoyId,org]);if(!r.rows.length)return res.status(404).json({error:'convoy_not_found_in_organisation'});}
  await req.dbTx(async c=>{
    const x=await c.query('UPDATE sjm_journeys SET title=$1,purpose=$2,client_id=$3,convoy_id=$4,transport_mode=$5,origin_label=$6,origin_lat=$7,origin_lng=$8,destination_label=$9,destination_lat=$10,destination_lng=$11,planned_departure_at=$12,planned_arrival_at=$13,timezone=$14,status=\'requested\',planned_route=\'[]\'::jsonb,route_assessment=NULL,planning_started_at=NULL,assessment_pending_at=NULL,ready_for_review_at=NULL,human_review_decision=NULL,human_review_rationale=NULL,reviewed_by=NULL,reviewed_at=NULL,risk_acknowledgement=NULL,departure_readiness_acknowledgement=NULL,approved_by=NULL,approved_at=NULL,ready_to_depart_at=NULL,updated_by=$15,updated_at=NOW() WHERE id=$16 AND org_id=$17 RETURNING id',[txt(candidate.title,180),txt(candidate.purpose,1200),clientId,convoyId,b.transport_mode||j.transport_mode,txt(candidate.origin_label,180),candidate.origin_lat,candidate.origin_lng,txt(candidate.destination_label,180),candidate.destination_lat,candidate.destination_lng,candidate.planned_departure_at||null,candidate.planned_arrival_at||null,tzValid(b.timezone||j.timezone)?(b.timezone||j.timezone):'Africa/Nairobi',req.user.id,j.id,org]);
    if(!x.rows.length)throw new Error('journey_update_lost');
    if(b.stops!==undefined){await c.query('DELETE FROM sjm_journey_stops WHERE org_id=$1 AND journey_id=$2',[org,j.id]);for(let i=0;i<b.stops.length;i++){const s=b.stops[i];await c.query('INSERT INTO sjm_journey_stops (org_id,journey_id,sequence,name,stop_type,lat,lng,planned_arrival_at,planned_departure_at,duration_minutes,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[org,j.id,i+1,txt(s.name,160),s.stop_type||'checkpoint',s.lat??null,s.lng??null,s.planned_arrival_at||null,s.planned_departure_at||null,s.duration_minutes??null,txt(s.instructions,1200)||null]);}}
    await c.query('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,\'journey_revised\',$4,$5,\'operator\')',[org,j.id,req.user.id,'Journey revised; previous route assessment invalidated',JSON.stringify({revised_at:new Date().toISOString()})]);
  });
  const latest=await journeyById(req.db,org,j.id);res.json({data:{...latest,stops:await stopsFor(req.db,org,j.id)}});
}));
router.post('/journeys/:id/plan',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(!['requested','planning'].includes(j.status))return res.status(409).json({error:'journey_not_plannable',message:'This journey is not in a claimable planning state. Replan after resolving the current assessment attempt.'});
  if(j.transport_mode!=='road')return res.status(409).json({error:'transport_mode_route_safety_unavailable',message:'The current Route Safety provider supports road routing only. This journey cannot be assessed or approved until a mode-specific route provider is configured.'});
  const routeStops=await stopsFor(req.db,org,j.id);
  if(routeStops.length>23)return res.status(422).json({error:'route_stop_limit_exceeded',message:'The configured road-routing providers support at most 23 intermediate stops per assessed journey.'});
  const claimed=await req.dbTx(async c=>{
    const first=await c.query("UPDATE sjm_journeys SET status='planning',planning_started_at=COALESCE(planning_started_at,NOW()),updated_by=$1,updated_at=NOW() WHERE id=$2 AND org_id=$3 AND status=$4 RETURNING id",[req.user.id,j.id,org,j.status]);
    if(!first.rows.length)return false;
    await c.query("INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,'journey_planning_started',$4,$5,'system')",[org,j.id,req.user.id,'Journey planning started',JSON.stringify({previous_status:j.status,stop_count:routeStops.length})]);
    const second=await c.query("UPDATE sjm_journeys SET status='assessment_pending',assessment_pending_at=NOW(),updated_at=NOW() WHERE id=$1 AND org_id=$2 AND status='planning' RETURNING id",[j.id,org]);
    if(!second.rows.length)throw new Error('journey_assessment_claim_lost');
    await c.query("INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,'route_assessment_started',$4,$5,'system')",[org,j.id,req.user.id,'Route Safety assessment requested',JSON.stringify({via_stop_count:routeStops.length})]);
    return true;
  });
  if(!claimed)return res.status(409).json({error:'journey_state_changed',message:'Another request changed this journey. Refresh before retrying.'});
  const viaPoints=routeStops.map(stop=>({lat:Number(stop.lat),lng:Number(stop.lng)}));
  const a=await analyseRoute({origin:{lat:Number(j.origin_lat),lng:Number(j.origin_lng)},destination:{lat:Number(j.destination_lat),lng:Number(j.destination_lng)},viaPoints,convoyId:j.convoy_id||undefined,requestedBy:req.user.id,departureTime:j.planned_departure_at||undefined,avoidNightTravel:req.body?.avoid_night_travel===true,maxRiskScore:req.body?.max_risk_score==null?undefined:Number(req.body.max_risk_score),orgId:org});
  if(!a||!Number.isFinite(Number(a.overall_risk_score))||!a.safety_gate)return res.status(503).json({error:'route_assessment_unavailable'});
  const route=Array.isArray(a.recommended_route?.waypoints)?a.recommended_route.waypoints:[];
  const gateKnown=['GO','CONDITIONAL','HUMAN_REVIEW'].includes(a.safety_gate);
  const blocked=a.route_status==='blocked'||a.recommended_route?.blocked===true||a.safety_gate==='NO_GO';
  const nextStatus=a.route_status==='routed'&&gateKnown&&!blocked?'ready_for_review':'exception';
  const saved=await req.db('UPDATE sjm_journeys SET planned_route=$1,route_assessment=$2,status=$3,planned_distance_km=$4,planned_duration_minutes=$5,ready_for_review_at=CASE WHEN $3=\'ready_for_review\' THEN NOW() ELSE NULL END,exception_at=CASE WHEN $3=\'exception\' THEN NOW() ELSE NULL END,updated_by=$6,updated_at=NOW() WHERE id=$7 AND org_id=$8 AND status=\'assessment_pending\' RETURNING id',[JSON.stringify(route),JSON.stringify(a),nextStatus,a.recommended_route?.distance_km??null,a.recommended_route?.estimated_duration_minutes??null,req.user.id,j.id,org]);
  if(!saved.rows.length)return res.status(409).json({error:'journey_state_changed',message:'The journey changed while Route Safety was evaluating it; assessment evidence was not attached to a different state.'});
  await event(req.db,j,req.user.id,'route_assessed',nextStatus==='ready_for_review'?'Route assessment ready for authorised review':'Route assessment raised an exception; replan required',{safety_gate:a.safety_gate,route_status:a.route_status,risk_score:a.overall_risk_score,provider:a.routing_provider,waypoint_count:route.length,via_stop_count:routeStops.length,next_status:nextStatus},'system');
  const latest=await journeyById(req.db,org,j.id);res.json({data:{...latest,route_assessment:a,planned_route:route}});
}));
router.post('/journeys/:id/review',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(j.status!=='ready_for_review')return res.status(409).json({error:'journey_not_ready_for_review'});
  const a=parseJson(j.route_assessment,null);if(!a)return res.status(409).json({error:'route_assessment_required'});
  if(a.route_status==='blocked'||a.recommended_route?.blocked===true||a.safety_gate==='NO_GO')return res.status(409).json({error:'route_blocked',message:'A blocked/NO_GO route cannot be overridden through SJM.'});
  if(a.safety_gate!=='HUMAN_REVIEW')return res.status(409).json({error:'human_review_not_required'});
  const decision=req.body?.decision,rationale=txt(req.body?.rationale,1200);
  if(!['approve_with_controls','reject'].includes(decision)||rationale.length<30)return res.status(400).json({error:'review_rationale_required',message:'Choose a review decision and provide at least 30 characters of rationale.'});
  const nextStatus=decision==='reject'?'exception':'ready_for_review';
  await req.db('UPDATE sjm_journeys SET human_review_decision=$1,human_review_rationale=$2,reviewed_by=$3,reviewed_at=NOW(),status=$4,exception_at=CASE WHEN $4=\'exception\' THEN NOW() ELSE exception_at END,updated_by=$3,updated_at=NOW() WHERE id=$5 AND org_id=$6 AND status=\'ready_for_review\'',[decision,rationale,req.user.id,nextStatus,j.id,org]);
  await event(req.db,j,req.user.id,'human_route_review',decision==='reject'?'Route review rejected; replan required':'Route review accepted with controls',{decision,rationale,safety_gate:a.safety_gate,risk_score:a.overall_risk_score,next_status:nextStatus},'operator');
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.post('/journeys/:id/approve',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(j.status!=='ready_for_review')return res.status(409).json({error:'journey_not_ready_for_review'});
  const a=parseJson(j.route_assessment,null),gate=approvalGate(a,j.human_review_decision,req.body?.risk_acknowledgement);
  if(!gate.ok)return res.status(409).json({error:gate.code,message:gate.message});
  if(j.human_review_decision==='reject')return res.status(409).json({error:'route_review_rejected'});
  const ack=txt(req.body?.risk_acknowledgement,1200)||null;
  const r=await req.db('UPDATE sjm_journeys SET status=\'approved\',approved_by=$1,approved_at=NOW(),risk_acknowledgement=$2,updated_by=$1,updated_at=NOW() WHERE id=$3 AND org_id=$4 AND status=\'ready_for_review\' RETURNING id',[req.user.id,ack,j.id,org]);
  if(!r.rows.length)return res.status(409).json({error:'journey_state_changed'});
  await event(req.db,j,req.user.id,'journey_approved','Journey approved by authorised dispatcher',{safety_gate:a.safety_gate,risk_acknowledgement_recorded:Boolean(ack),human_review_decision:j.human_review_decision||null},'operator');
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.post('/journeys/:id/lifecycle',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  const action=req.body?.action;
  if(action==='close'){
    if(j.status!=='arrival_pending_verification')return res.status(409).json({error:'arrival_verification_not_pending'});
    if(!['admin','dispatcher'].includes(String(req.user.role||'').toLowerCase()))return res.status(403).json({error:'supervisor_attestation_required',message:'Only an authorised admin or dispatcher may close a journey after recording an arrival attestation.'});
    const note=txt(req.body?.reason,1200);
    if(note.length<30)return res.status(400).json({error:'arrival_attestation_required',message:'Record at least 30 characters explaining how arrival was verified. This is a supervisor attestation, not GPS proof.'});
    const r=await req.db('UPDATE sjm_journeys SET status=\'closed\',closed_at=NOW(),completed_at=NOW(),arrival_confirmed_at=NOW(),arrival_verification_source=\'supervisor_attestation\',arrival_verification_note=$1,updated_by=$2,updated_at=NOW() WHERE id=$3 AND org_id=$4 AND status=\'arrival_pending_verification\' RETURNING id',[note,req.user.id,j.id,org]);
    if(!r.rows.length)return res.status(409).json({error:'journey_state_changed'});
    await event(req.db,j,req.user.id,'journey_closed','Journey closed after authorised arrival attestation',{verification_source:'supervisor_attestation',gps_verified:false,rationale:note},'operator');
    return res.json({data:await journeyById(req.db,org,j.id),arrival_evidence_class:'SUPERVISOR_ATTESTED_NOT_GPS'});
  }
  const step=lifecycleTransition(j.status,action);
  if(!step)return res.status(409).json({error:'invalid_lifecycle_transition',current_status:j.status,requested_action:action,allowed_actions:Object.entries(LIFECYCLE_TRANSITIONS).filter(([,v])=>v.from.includes(j.status)).map(([k])=>k).concat(j.status==='arrival_pending_verification'?['close']:[])});
  const reason=txt(req.body?.reason,1200);
  if(step.reasonRequired&&reason.length<10)return res.status(400).json({error:'lifecycle_reason_required',message:'Record at least 10 characters explaining this operational decision.'});
  let readiness='';
  if(action==='ready_to_depart'){
    readiness=txt(req.body?.readiness_acknowledgement,1200);
    if(readiness.length<15)return res.status(400).json({error:'departure_readiness_acknowledgement_required',message:'Record at least 15 characters confirming departure readiness checks.'});
  }
  if(action==='arrive'){
    const stops=await stopsFor(req.db,org,j.id),pending=stops.filter(s=>s.stop_status==='planned');
    if(pending.length&&req.body?.confirm_outstanding_stops!==true)return res.status(409).json({error:'stops_outstanding',outstanding_count:pending.length,message:'Explicitly acknowledge outstanding stops before requesting arrival verification.'});
  }
  const params=[step.to,req.user.id,j.id,org,step.from];
  let sql='UPDATE sjm_journeys SET status=$1,updated_by=$2,updated_at=NOW()';
  if(step.timestamp&&!step.clearPlan)sql+=','+step.timestamp+'=NOW()';
  if(action==='ready_to_depart'){sql+=',departure_readiness_acknowledgement=$6';params.push(readiness);}
  if(step.clearPlan){
    sql+=",planned_route='[]'::jsonb,route_assessment=NULL,planned_distance_km=NULL,planned_duration_minutes=NULL,planning_started_at=NOW(),assessment_pending_at=NULL,ready_for_review_at=NULL,human_review_decision=NULL,human_review_rationale=NULL,reviewed_by=NULL,reviewed_at=NULL,risk_acknowledgement=NULL,departure_readiness_acknowledgement=NULL,approved_by=NULL,approved_at=NULL,ready_to_depart_at=NULL,paused_at=NULL,exception_at=NULL,arrival_pending_verification_at=NULL,arrival_confirmed_at=NULL,arrival_verification_source=NULL,arrival_verification_note=NULL,closed_at=NULL,completed_at=NULL,on_hold_at=NULL";
  }
  sql+=' WHERE id=$3 AND org_id=$4 AND status=ANY($5::text[]) RETURNING id';
  const updated=await req.db(sql,params);
  if(!updated.rows.length)return res.status(409).json({error:'journey_state_changed'});
  const summaries={
    ready_to_depart:'Journey marked ready to depart',
    start:'Journey started',
    pause:'Journey paused',
    resume:'Journey resumed',
    raise_exception:'Operational exception raised',
    arrive:'Arrival pending verification',
    hold:'Journey placed on hold',
    cancel:'Journey cancelled',
    abort:'Journey aborted',
    replan:'Journey returned to planning; prior route and approvals invalidated',
  };
  await event(req.db,j,req.user.id,'journey_'+action,summaries[action]||'Journey lifecycle updated',{reason:reason||null,previous_status:j.status,next_status:step.to,readiness_acknowledgement:action==='ready_to_depart'?readiness:null,confirmed_outstanding_stops:req.body?.confirm_outstanding_stops===true,route_and_approval_invalidated:step.clearPlan===true},'operator');
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.patch('/journeys/:id/stops/:stopId/status',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(!['in_progress','paused','arrival_pending_verification'].includes(j.status))return res.status(409).json({error:'journey_not_active_for_stop_confirmation'});
  const status=req.body?.status;if(!['reached','skipped'].includes(status))return res.status(400).json({error:'invalid_stop_status'});
  const hasLat=req.body?.actual_lat!=null,hasLng=req.body?.actual_lng!=null;if(hasLat!==hasLng||(hasLat&&!validCoordinate(req.body.actual_lat,req.body.actual_lng)))return res.status(400).json({error:'invalid_actual_coordinates'});
  const r=await req.db('UPDATE sjm_journey_stops SET stop_status=$1,confirmed_at=NOW(),actual_lat=$2,actual_lng=$3,confirmation_source=\'operator_confirmed\' WHERE id=$4 AND journey_id=$5 AND org_id=$6 AND stop_status=\'planned\' RETURNING id,sequence,name,stop_status,confirmed_at,actual_lat,actual_lng,confirmation_source',[status,hasLat?req.body.actual_lat:null,hasLng?req.body.actual_lng:null,req.params.stopId,j.id,org]);
  if(!r.rows.length)return res.status(404).json({error:'stop_not_found_or_already_resolved'});
  await event(req.db,j,req.user.id,'stop_'+status,'Stop '+status+': '+r.rows[0].name,{stop_id:r.rows[0].id,sequence:r.rows[0].sequence,actual_coordinates_supplied:hasLat},'operator');
  res.json({data:r.rows[0],evidence_class:'OPERATOR_CONFIRMED'});
}));
router.post('/journeys/:id/events',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(TERMINAL_STATUSES.includes(j.status))return res.status(409).json({error:'journey_closed'});
  const type=req.body?.event_type,summary=txt(req.body?.summary,500);if(!EVENT_TYPES.includes(type)||summary.length<4)return res.status(400).json({error:'invalid_operational_event',allowed_event_types:EVENT_TYPES});
  const detail={note:txt(req.body?.detail,2000),severity:['low','medium','high','critical'].includes(req.body?.severity)?req.body.severity:null};
  const r=await event(req.db,j,req.user.id,type,summary,detail,'operator');res.status(201).json({data:{id:r.rows[0].id,created_at:r.rows[0].created_at,event_type:type,summary,detail,source:'operator'}});
}));
router.post('/journeys/:id/reports',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  const type=req.body?.report_type||'daily';if(!REPORT_TYPES.includes(type))return res.status(400).json({error:'invalid_report_type',allowed:REPORT_TYPES});
  const p=j.client_id?await req.db('SELECT report_timezone FROM sjm_client_profiles WHERE org_id=$1 AND client_id=$2 LIMIT 1',[org,j.client_id]):{rows:[]};
  const timezone=p.rows[0]?.report_timezone||j.timezone||'Africa/Nairobi',date=typeof req.body?.report_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.body.report_date)?req.body.report_date:dateInTimezone(new Date(),timezone);
  const snapshot=await reportSnapshot(req.db,org,j,type,date);
  const r=await req.db('INSERT INTO sjm_reports (org_id,journey_id,report_type,report_date,schema_version,data,generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,journey_id,report_type,report_date,generated_at',[org,j.id,type,date,snapshot.schema_version,JSON.stringify(snapshot),req.user.id]);
  await event(req.db,j,req.user.id,'report_generated','SJM '+type+' report generated',{report_id:r.rows[0].id,report_date:date,schema_version:snapshot.schema_version},'system');
  res.status(201).json({data:r.rows[0],snapshot});
}));
router.get('/reports/:reportId',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const r=await req.db('SELECT id,journey_id,report_type,report_date,schema_version,data,generated_at FROM sjm_reports WHERE id=$1 AND org_id=$2 LIMIT 1',[req.params.reportId,req.user.org_id]);
  if(!r.rows.length)return res.status(404).json({error:'report_not_found'});res.json({data:{...r.rows[0],data:parseJson(r.rows[0].data,{})}});
}));
router.get('/reports/:reportId/download',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const r=await req.db('SELECT id,data,report_type,report_date FROM sjm_reports WHERE id=$1 AND org_id=$2 LIMIT 1',[req.params.reportId,req.user.org_id]);
  if(!r.rows.length)return res.status(404).json({error:'report_not_found'});
  const report=parseJson(r.rows[0].data,{}),format=String(req.query.format||'PDF').toUpperCase(),name=('sonalit-sjm-'+(report.journey?.reference||r.rows[0].id)+'-'+(r.rows[0].report_date||'report')).replace(/[^a-z0-9-]/gi,'-');
  res.setHeader('Cache-Control','no-store');
  if(format==='CSV'){res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="'+name+'.csv"');return res.send('\uFEFF'+toCsv(report));}
  if(format!=='PDF')return res.status(400).json({error:'unsupported_report_format',allowed:['PDF','CSV']});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="'+name+'.pdf"');
  const doc=new PDFDocument({size:'A4',margin:42});doc.pipe(res);renderPdf(doc,report);
}));
module.exports=router;
module.exports.__scheduler={reportSnapshot,dateInTimezone};
module.exports.__test={validCoordinate,validateStop,validateJourney,approvalGate,dateInTimezone,toCsv,lifecycleTransition,DEFAULT_TEMPLATE,SECTIONS,dailyReportSchedulerAvailable};
