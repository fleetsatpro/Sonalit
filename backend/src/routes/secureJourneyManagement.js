'use strict';
const crypto = require('crypto');
const router = require('express').Router();
const PDFDocument = require('pdfkit');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { analyseRoute } = require('../utils/routeAnalyser');
const { unsubscribeUserFromChannel, publish } = require('../realtime/centrifugo');
const { sjmChannelName } = require('../realtime/sjmChannel');

const STATUSES = ['requested','planning','assessment_pending','ready_for_review','approved','ready_to_depart','in_progress','paused','exception','arrival_pending_verification','closed','cancelled','aborted','on_hold'];
const JOURNEY_REGISTER_FILTER_SQL = Object.freeze({
  all: 'TRUE',
  active: "j.status IN ('in_progress','paused','exception','arrival_pending_verification')",
  attention: "(j.status IN ('paused','exception','on_hold','arrival_pending_verification') OR COALESCE(j.route_assessment->>'safety_gate','') IN ('HUMAN_REVIEW','NO_GO'))",
  review: "j.status='ready_for_review'",
  planning: "j.status IN ('requested','planning','assessment_pending')",
  overdue: "((j.status IN ('approved','ready_to_depart') AND j.planned_departure_at IS NOT NULL AND j.planned_departure_at < NOW()) OR (j.status IN ('in_progress','paused','exception') AND j.planned_arrival_at IS NOT NULL AND j.planned_arrival_at < NOW()))",
  departure_due_30m: "(j.status IN ('approved','ready_to_depart') AND j.planned_departure_at >= NOW() AND j.planned_departure_at <= NOW() + INTERVAL '30 minutes')",
  closed: "j.status IN ('closed','cancelled','aborted')",
});
const JOURNEY_REGISTER_ORDER_SQL = Object.freeze({
  priority: "CASE WHEN j.status NOT IN ('closed','cancelled','aborted') AND COALESCE(j.route_assessment->>'safety_gate','')='NO_GO' THEN 0 WHEN j.status='exception' THEN 1 WHEN j.status='paused' THEN 2 WHEN j.status='arrival_pending_verification' THEN 3 WHEN j.status NOT IN ('closed','cancelled','aborted') AND COALESCE(j.route_assessment->>'safety_gate','')='HUMAN_REVIEW' THEN 4 WHEN j.status IN ('approved','ready_to_depart') AND j.planned_departure_at < NOW() THEN 5 WHEN j.status='in_progress' AND j.planned_arrival_at < NOW() THEN 6 WHEN j.status IN ('approved','ready_to_depart') AND j.planned_departure_at >= NOW() AND j.planned_departure_at <= NOW() + INTERVAL '30 minutes' THEN 7 WHEN j.status='on_hold' THEN 8 WHEN j.status='in_progress' THEN 9 WHEN j.status='ready_for_review' THEN 10 WHEN j.status='ready_to_depart' THEN 11 WHEN j.status='approved' THEN 12 WHEN j.status='assessment_pending' THEN 13 WHEN j.status='planning' THEN 14 WHEN j.status='requested' THEN 15 WHEN j.status='closed' THEN 20 WHEN j.status='cancelled' THEN 21 WHEN j.status='aborted' THEN 22 ELSE 16 END ASC, j.planned_departure_at ASC NULLS LAST, j.updated_at DESC, j.id ASC",
  departure_asc: "j.planned_departure_at ASC NULLS LAST, j.updated_at DESC, j.id ASC",
  departure_desc: "j.planned_departure_at DESC NULLS LAST, j.updated_at DESC, j.id ASC",
  updated_desc: "j.updated_at DESC NULLS LAST, j.planned_departure_at ASC NULLS LAST, j.id ASC",
});
const TERMINAL_STATUSES = ['closed','cancelled','aborted'];
const STOP_TYPES = ['checkpoint','rest','refuelling','border','meeting','overnight','destination','other'];
const SERVICE_TYPES=['airport_arrival','airport_departure','meet_and_greet','close_protection','security_escort','executive_transfer','other'];
const FLIGHT_STATUSES=['unknown','scheduled','delayed','landed','departed','cancelled','diverted'];
const DUTY_ROLES=['driver','backup_driver','cpo','meet_greet','security_escort','dispatcher'];
const MOBILITY_MANAGER_ROLES=new Set(['admin','dispatcher']);
const DUTY_EVENT_RULES={driver:['driver_en_route','driver_at_pickup','principal_on_board','destination_reached','vehicle_issue','delay','safety_check_in'],backup_driver:['driver_en_route','driver_at_pickup','principal_on_board','destination_reached','vehicle_issue','delay','safety_check_in'],cpo:['cpo_en_route','meet_point_confirmed','principal_met','security_check_in','security_concern','delay','incident','handover_completed'],meet_greet:['meet_greet_positioned','flight_status_observed','principal_contact_established','principal_received','handover_to_cpo','delay','incident','safety_check_in'],security_escort:['escort_started','security_check_in','security_concern','delay','incident','handover_completed'],dispatcher:['delay','incident','safety_check_in']};
const DUTY_EVENT_SUMMARIES={driver_en_route:'Driver reported en route',driver_at_pickup:'Driver reported arrival at pickup',principal_on_board:'Driver reported principal on board',destination_reached:'Driver reported destination reached',vehicle_issue:'Driver reported a vehicle issue',delay:'Delay reported by field team',safety_check_in:'Field safety check-in recorded',cpo_en_route:'CPO reported en route',meet_point_confirmed:'CPO confirmed meet point',principal_met:'CPO reported principal met',security_check_in:'Security team check-in recorded',security_concern:'Security concern reported',incident:'Field incident reported',handover_completed:'CPO reported handover completed',meet_greet_positioned:'Meet-and-greet operator reported positioned',flight_status_observed:'Meet-and-greet operator reported flight information observed',principal_contact_established:'Meet-and-greet operator reported contact established',principal_received:'Meet-and-greet operator reported principal received',handover_to_cpo:'Meet-and-greet operator reported handover to CPO',escort_started:'Security escort reported started'};
const REPORT_TYPES = ['itinerary','pre_trip_brief','daily','sitrep','change_notice','closeout','final'];
const REPORT_TITLES = {itinerary:'Journey Itinerary',pre_trip_brief:'Pre-Trip Operational Brief',daily:'Daily Travel Report',sitrep:'Situation Report (SITREP)',change_notice:'Journey Change Notice',closeout:'Journey Closeout Report',final:'Final Journey Report',management_summary:'Secure Journey Management — Portfolio Summary'};
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
const SJM_ORG_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function dailyReportSchedulerAvailable(orgId){return SJM_SCHEDULER_ORG_IDS.length>0&&SJM_SCHEDULER_ORG_IDS.every(v=>SJM_ORG_UUID.test(v))&&SJM_ORG_UUID.test(String(orgId||'').toLowerCase())&&SJM_SCHEDULER_ORG_IDS.includes(String(orgId).toLowerCase());}

function planRequestPolicyError(body) {
  if(body&&Object.prototype.hasOwnProperty.call(body,'max_risk_score')) {
    return 'SJM does not accept a caller-supplied maximum risk threshold. Configure an authorised trusted client policy before applying threshold overrides.';
  }
  return null;
}
function lifecycleTransition(status, action) { const t=LIFECYCLE_TRANSITIONS[action]; return t && t.from.includes(status) ? t : null; }
function txt(v, max=500) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function journeyRegisterFilterSql(value) {
  const filter=txt(value,40)||'all';
  if(Object.prototype.hasOwnProperty.call(JOURNEY_REGISTER_FILTER_SQL,filter))return JOURNEY_REGISTER_FILTER_SQL[filter];
  if(STATUSES.includes(filter))return 'j.status=$4';
  return null;
}
function journeyRegisterOrderSql(value) {
  const sort=txt(value,40)||'priority';
  return Object.prototype.hasOwnProperty.call(JOURNEY_REGISTER_ORDER_SQL,sort)?JOURNEY_REGISTER_ORDER_SQL[sort]:null;
}
function validCoordinate(lat,lng) { return typeof lat==='number' && Number.isFinite(lat) && lat>=-90 && lat<=90 && typeof lng==='number' && Number.isFinite(lng) && lng>=-180 && lng<=180 && !(Math.abs(lat)<0.000001 && Math.abs(lng)<0.000001); }
function validDate(v) { if(v==null)return true; if(v instanceof Date)return Number.isFinite(v.getTime()); return typeof v==='string'&&Number.isFinite(Date.parse(v)); }
function validDateOnly(v) { if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false; const d=new Date(v+'T00:00:00.000Z'); return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v; }
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
function validateServiceDetails(b){
 const st=b.service_type==null||b.service_type===''?'executive_transfer':b.service_type;
 if(!SERVICE_TYPES.includes(st))return 'Service type is not supported.';
 if(b.principal_reference!=null&&(typeof b.principal_reference!=='string'||b.principal_reference.trim().length>120))return 'Principal reference must be text no longer than 120 characters.';
 if(b.airport_code!=null&&b.airport_code!==''&&(typeof b.airport_code!=='string'||!/^[A-Za-z0-9]{3,4}$/.test(b.airport_code.trim())))return 'Airport code must be a three-letter IATA or four-character ICAO code.';
 if(b.terminal!=null&&(typeof b.terminal!=='string'||b.terminal.trim().length>80))return 'Terminal must be text no longer than 80 characters.';
 if(b.airline!=null&&(typeof b.airline!=='string'||b.airline.trim().length>100))return 'Airline must be text no longer than 100 characters.';
 if(b.flight_number!=null&&(typeof b.flight_number!=='string'||b.flight_number.trim().length>24||(b.flight_number.trim()&&!/^[A-Za-z0-9][A-Za-z0-9 -]{0,23}$/.test(b.flight_number.trim()))))return 'Flight number must be a short alphanumeric reference.';
 if(!validDate(b.flight_scheduled_at))return 'Scheduled flight time must be a valid date/time.';
 if(b.meet_greet_instructions!=null&&(typeof b.meet_greet_instructions!=='string'||b.meet_greet_instructions.trim().length>2000))return 'Meet-and-greet instructions must be text no longer than 2000 characters.';
 if(b.flight_status!=null&&b.flight_status!=='unknown')return 'Flight status must be recorded through the operator-status endpoint so provenance is preserved.';
 return null;
}
function isMobilityManager(user){return !!user&&MOBILITY_MANAGER_ROLES.has(String(user.role||'').toLowerCase());}
function canAccessJourney(user,dutyRoles){return isMobilityManager(user)||(Array.isArray(dutyRoles)&&dutyRoles.length>0);}
function canAccessReport(user,report,dutyRoles){if(!report)return false;if(!report.journey_id)return isMobilityManager(user);return canAccessJourney(user,dutyRoles);}
function lifecycleAuthorityError(user,dutyRoles,action){
 if(isMobilityManager(user))return null;
 const roles=new Set(Array.isArray(dutyRoles)?dutyRoles:[]);
 if(['hold','cancel','replan','ready_to_depart'].includes(action))return {error:'dispatcher_authority_required',message:'Only an authorised admin or dispatcher may perform this lifecycle action.'};
 if(action==='start'&&!['driver','backup_driver'].some(role=>roles.has(role)))return {error:'driver_authority_required',message:'Only the assigned driver or backup driver may start a movement.'};
 if(['pause','resume','raise_exception','arrive','abort'].includes(action)&&!['driver','backup_driver','cpo','security_escort','dispatcher'].some(role=>roles.has(role)))return {error:'field_duty_required',message:'This action requires an assigned driver, CPO, security escort or dispatcher duty.'};
 return null;
}
async function requireJourneyAccess(req,res,journey){if(!journey){res.status(404).json({error:'journey_not_found'});return null;}const roles=await activeDutyRoles(req.db,req.user.org_id,journey.id,req.user.id);if(!canAccessJourney(req.user,roles)){res.status(404).json({error:'journey_not_found'});return null;}return roles;}
function dutyEventAllowed(roles,eventType){return Array.isArray(roles)&&roles.some(role=>(DUTY_EVENT_RULES[role]||[]).includes(eventType));}
function isInternalOperationalEvent(e){return parseJson(e?.detail, {})?.classification==='INTERNAL_OPERATIONS';}
function isClientSafeEvent(e){return parseJson(e?.detail, {})?.classification==='CLIENT_SAFE';}
function classificationForGenericEvent(type){return type==='client_update'?'CLIENT_SAFE':'INTERNAL_OPERATIONS';}
function journeyForViewer(journey,events,canSeeInternal){
 const visibleJourney=canSeeInternal?journey:{...journey,principal_reference:null,flight_status_note:null,meet_greet_instructions:null};
 const visibleEvents=canSeeInternal?(events||[]):(events||[]).filter(isClientSafeEvent);
 return {...visibleJourney,events:visibleEvents};
}
function eventVisibleToDuty(e,user,dutyRoles){
 if(isMobilityManager(user))return true;
 const detail=parseJson(e?.detail,{});
 if(detail.classification==='CLIENT_SAFE')return true;
 if(detail.classification!=='INTERNAL_OPERATIONS')return false;
 const eventRoles=Array.isArray(detail.duty_roles)?detail.duty_roles:[];
 return eventRoles.some(role=>Array.isArray(dutyRoles)&&dutyRoles.includes(role));
}
function journeyForDutyViewer(journey,events,user,dutyRoles){
 const roles=new Set(Array.isArray(dutyRoles)?dutyRoles:[]),manager=isMobilityManager(user),visible={...journey};
 if(!manager){
  const canSeePrincipal=['driver','backup_driver','cpo','meet_greet','security_escort','dispatcher'].some(role=>roles.has(role));
  const canSeeFlight=['driver','backup_driver','cpo','meet_greet','security_escort','dispatcher'].some(role=>roles.has(role));
  const canSeeMeetInstructions=['meet_greet','cpo','dispatcher'].some(role=>roles.has(role));
  if(!canSeePrincipal)visible.principal_reference=null;
  if(!canSeeFlight){for(const key of ['airport_code','terminal','airline','flight_number','flight_scheduled_at','flight_status','flight_status_source','flight_status_observed_at','flight_status_note'])visible[key]=null;}
  else if(!roles.has('meet_greet')&&!roles.has('cpo')&&!roles.has('dispatcher'))visible.flight_status_note=null;
  if(!canSeeMeetInstructions)visible.meet_greet_instructions=null;
 }
 return {...visible,events:(events||[]).filter(e=>eventVisibleToDuty(e,user,dutyRoles))};
}
async function lockJourneyForMobility(db,org,journeyId){const r=await db('SELECT id,status,flight_number,flight_status,comms_epoch FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE',[journeyId,org]);return r.rows[0]||null;}
async function lockJourneyForMobilityRead(db,org,journeyId){const r=await db('SELECT id FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR SHARE',[journeyId,org]);return r.rows[0]||null;}
async function readLockedAssignmentRows(db,org,initialLockRows,listSql,listParams){
 const held=new Set((initialLockRows?.rows||[]).map(row=>String(row.id)));
 for(let attempt=0;attempt<5;attempt++){
  const listed=await db(listSql,listParams);
  const unlocked=[...new Set(listed.rows.map(row=>String(row.id)).filter(id=>!held.has(id)))];
  if(!unlocked.length)return {rows:listed.rows};
  const locks=await db('SELECT id FROM sjm_journeys WHERE org_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE',[org,unlocked]);
  for(const row of locks.rows)held.add(String(row.id));
 }
 return {error:'assignment_roster_changed'};
}
async function activeDutyRoles(db,org,journeyId,userId){const r=await db('SELECT duty_role FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL ORDER BY duty_role',[org,journeyId,userId]);return r.rows.map(row=>row.duty_role);}
async function syncJourneyCommsChannel(db,org,journey,actorId,actorIsManager=true,previousEpoch=null){
 const slug='sjm-'+String(journey.id).replace(/-/g,'').slice(0,20).toLowerCase(),name=txt(journey.reference,40)+' · Mission team';
 const r=await db("INSERT INTO channels (org_id,name,slug,type,category,created_by,sjm_journey_id) VALUES ($1,$2,$3,'private','operations',$4,$5) ON CONFLICT (org_id,sjm_journey_id) WHERE sjm_journey_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id",[org,name,slug,actorId||null,journey.id]);
 const channelId=r.rows[0]?.id;if(!channelId)throw new Error('sjm_comms_channel_unavailable');
 const priorMembers=await db('SELECT user_id FROM channel_members WHERE org_id=$1 AND channel_id=$2',[org,channelId]);
 const priorMemberIds=new Set((priorMembers.rows||[]).map(row=>String(row.user_id)));
 if(actorId)await db('INSERT INTO channel_members (channel_id,user_id,org_id,is_channel_admin) VALUES ($1,$2,$3,$4) ON CONFLICT (channel_id,user_id) DO UPDATE SET is_channel_admin=EXCLUDED.is_channel_admin',[channelId,actorId,org,actorIsManager===true]);
 await db("INSERT INTO channel_members (channel_id,user_id,org_id,is_channel_admin) SELECT $1,p.user_id,$2,false FROM sjm_journey_participants p JOIN users u ON u.id=p.user_id AND u.org_id=p.org_id AND u.deleted_at IS NULL AND u.status='active' WHERE p.org_id=$2 AND p.journey_id=$3 AND p.removed_at IS NULL ON CONFLICT (channel_id,user_id) DO NOTHING",[channelId,org,journey.id]);
 await db("UPDATE channel_members cm SET is_channel_admin=EXISTS (SELECT 1 FROM users u WHERE u.id=cm.user_id AND u.org_id=$1 AND u.deleted_at IS NULL AND u.status='active' AND lower(u.role) IN ('admin','dispatcher')) WHERE cm.org_id=$1 AND cm.channel_id=$2",[org,channelId]);
 const staleMembers=await db("SELECT cm.user_id FROM channel_members cm WHERE cm.org_id=$1 AND cm.channel_id=$2 AND NOT EXISTS (SELECT 1 FROM sjm_journey_participants p JOIN users pu ON pu.id=p.user_id AND pu.org_id=p.org_id AND pu.deleted_at IS NULL AND pu.status='active' WHERE p.org_id=$1 AND p.journey_id=$3 AND p.user_id=cm.user_id AND p.removed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=cm.user_id AND u.org_id=$1 AND u.deleted_at IS NULL AND u.status='active' AND lower(u.role) IN ('admin','dispatcher'))",[org,channelId,journey.id]);
 let commsEpoch=Number(journey.comms_epoch||0),oldEpoch=previousEpoch==null?null:Number(previousEpoch),rotated=oldEpoch!==null;
 if(!rotated&&staleMembers.rows.length){
  const bumped=await db('UPDATE sjm_journeys SET comms_epoch=comms_epoch+1 WHERE id=$1 AND org_id=$2 RETURNING comms_epoch',[journey.id,org]);
  if(!bumped.rows.length)throw new Error('sjm_comms_epoch_rotation_failed');
  oldEpoch=commsEpoch;commsEpoch=Number(bumped.rows[0].comms_epoch);rotated=true;
 }
 if(rotated){
  if(!Number.isSafeInteger(commsEpoch)||commsEpoch<=oldEpoch)throw new Error('sjm_comms_epoch_rotation_invalid');
  const channelName=sjmChannelName(org,channelId,oldEpoch);
  const revokeUsers=new Set([...priorMemberIds,...staleMembers.rows.map(row=>String(row.user_id))]);
  if(revokeUsers.size){
   const legacyRevoked=await unsubscribeUserFromChannel(org,channelName);
   if(!legacyRevoked)throw Object.assign(new Error('SJM channel subscription revocation is unavailable; roster change rolled back'),{status:503});
   for(const userId of revokeUsers){
    const revoked=await unsubscribeUserFromChannel(userId,channelName);
    if(!revoked)throw Object.assign(new Error('SJM channel subscription revocation is unavailable; roster change rolled back'),{status:503});
   }
  }
 }
 await db("DELETE FROM channel_members cm WHERE cm.org_id=$1 AND cm.channel_id=$2 AND NOT EXISTS (SELECT 1 FROM sjm_journey_participants p JOIN users pu ON pu.id=p.user_id AND pu.org_id=p.org_id AND pu.deleted_at IS NULL AND pu.status='active' WHERE p.org_id=$1 AND p.journey_id=$3 AND p.user_id=cm.user_id AND p.removed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=cm.user_id AND u.org_id=$1 AND u.deleted_at IS NULL AND u.status='active' AND lower(u.role) IN ('admin','dispatcher'))",[org,channelId,journey.id]);
 return {channelId,commsEpoch,realtimeChannel:sjmChannelName(org,channelId,commsEpoch),rotated};
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
  const serviceError=validateServiceDetails(b);if(serviceError)return serviceError;
  return null;
}
function routeAssessmentUsable(a) {
  if(!a||typeof a.route_status!=='string'||!a.route_status.trim()||typeof a.safety_gate!=='string'||!a.safety_gate.trim())return false;
  const score=a.overall_risk_score;
  const finiteScore=score!=null&&!(typeof score==='string'&&score.trim()==='')&&Number.isFinite(Number(score));
  const explicitUnrouted=a.route_status==='unrouted'&&a.safety_gate==='HUMAN_REVIEW'&&score==null&&a.constraint_status?.risk_score_available===false&&a.recommended_route?.risk_score==null&&a.recommended_route?.distance_km==null&&a.recommended_route?.estimated_duration_minutes==null&&Array.isArray(a.recommended_route?.waypoints);
  return a.route_status==='unrouted'?explicitUnrouted:finiteScore;
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
function canonicalJson(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
}
function sameRouteReviewSnapshot(current,expected) {
  if(!current||!expected||current.status!=='ready_for_review'||expected.status!=='ready_for_review')return false;
  const currentUpdatedAt=new Date(current.updated_at).getTime(),expectedUpdatedAt=new Date(expected.updated_at).getTime();
  if(!Number.isFinite(currentUpdatedAt)||!Number.isFinite(expectedUpdatedAt)||currentUpdatedAt!==expectedUpdatedAt)return false;
  if(canonicalJson(parseJson(current.route_assessment,null))!==canonicalJson(parseJson(expected.route_assessment,null)))return false;
  return (current.human_review_decision||null)===(expected.human_review_decision||null);
}
async function readLockedRouteReviewSnapshot(db,org,expected) {
  const result=await db('SELECT status,route_assessment,human_review_decision,updated_at FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[expected.id,org]);
  const current=result.rows[0]||null;
  return {current,matches:sameRouteReviewSnapshot(current,expected)};
}
function tzValid(tz) { try { new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(new Date()); return typeof tz==='string'&&tz.length>0&&tz.length<=100; } catch(_){return false} }
function dateInTimezone(d,tz) { const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d); const f=(k)=>p.find(x=>x.type===k)?.value||''; return f('year')+'-'+f('month')+'-'+f('day'); }
function csvCell(v) {
  if(v==null)return '';
  let s=typeof v==='object'?JSON.stringify(v):String(v);
  if(typeof v==='string'&&/^[\t\r ]*[=+\-@]/.test(s)&&!/^[\t\r ]*-\d+(?:\.\d+)?$/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function toCsv(report) {
  const rows=[['record_type','timestamp','label','status','details']];
  if(report?.report_type==='management_summary') {
    rows.push(['portfolio_summary',report.generated_at||'',report.report_title||'Management summary','',report.summary||{}]);
    for(const j of report.journeys||[])rows.push(['journey',j.updated_at||j.created_at||'',j.reference||'',j.status||'',{title:j.title,client:j.client_name,convoy:j.convoy_name,origin:j.origin_label,destination:j.destination_label,planned_departure_at:j.planned_departure_at,planned_arrival_at:j.planned_arrival_at,route_status:j.route_status,safety_gate:j.safety_gate,overdue:j.overdue,telemetry_status:j.telemetry_status}]);
    for(const e of report.recent_events||[])rows.push(['event',e.created_at||'',e.event_type||'',e.source||'',{journey_reference:e.journey_reference,journey_title:e.journey_title,summary:e.summary,detail:e.detail}]);
    return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  const j=report.journey||{},profile=report.client_profile||{};
  const enabled=new Set(Array.isArray(profile.enabled_sections)?profile.enabled_sections.filter(x=>SECTIONS.includes(x)):SECTIONS);
  rows.push(['report',report.generated_at||'',report.report_title||'Journey report',report.report_type||'',{report_date:report.report_date,timezone:report.timezone,schema_version:report.schema_version}]);
  rows.push(['journey',j.created_at||'',j.reference||'Journey',j.status||'',{id:j.id||null}]);
  if(enabled.has('summary'))rows.push(['journey_summary',j.created_at||'',j.title||'',j.status||'',{purpose:j.purpose,client:j.client_name,convoy:j.convoy_name,origin:j.origin_label,destination:j.destination_label,planned_departure_at:j.planned_departure_at,planned_arrival_at:j.planned_arrival_at,transport_mode:j.transport_mode}]);
  if(enabled.has('itinerary'))for(const [i,p] of (report.itinerary||[]).entries())rows.push(['route_point',report.generated_at||'',p.name||p.label||('Route point '+(i+1)),'PLANNED',{sequence:i+1,lat:p.lat,lng:p.lng,geometry_source:report.provenance?.planned_itinerary||'UNAVAILABLE'}]);
  if(enabled.has('stops'))for(const s of report.stops||[])rows.push(['stop',s.confirmed_at||s.planned_arrival_at||'',s.name||'',s.stop_status||'',{sequence:s.sequence,stop_type:s.stop_type,planned_arrival_at:s.planned_arrival_at,actual_lat:s.actual_lat,actual_lng:s.actual_lng,confirmation_source:s.confirmation_source,instructions:s.instructions}]);
  if(enabled.has('route_assessment')&&report.route_assessment)rows.push(['route_assessment',report.generated_at||'',report.route_assessment.routing_provider||'Route Safety','ANALYSED',{route_status:report.route_assessment.route_status,safety_gate:report.route_assessment.safety_gate,risk_score:report.route_assessment.overall_risk_score,summary:report.route_assessment.ai_summary,risk_factors:report.route_assessment.risk_factors}]);
  if(enabled.has('operational_events'))for(const e of report.events||[])rows.push(['event',e.created_at||'',e.event_type||'',e.source||'',{summary:e.summary,detail:e.detail}]);
  if(report.report_type==='pre_trip_brief')for(const x of report.pre_trip_readiness||[])rows.push(['readiness',report.generated_at||'',x.item||'',x.status||'',x.detail||'']);
  if(report.report_type==='change_notice') {
    rows.push(['change_event_register',report.generated_at||'','Recorded change activity',report.summary?.change_events_truncated?'TRUNCATED':'COMPLETE',{total:report.summary?.change_event_count??0,included:report.summary?.change_event_count_included??(report.change_events||[]).length}]);
    for(const e of report.change_events||[])rows.push(['change_event',e.created_at||'',e.event_type||'',e.source||'',{summary:e.summary,detail:e.detail}]);
  }
  if(['closeout','final'].includes(report.report_type)&&report.closeout_evidence)rows.push(['closeout_evidence',report.closeout_evidence.closed_at||'',report.closeout_evidence.arrival_verification_source||'arrival source unavailable',report.closeout_evidence.evidence_class||'UNAVAILABLE',report.closeout_evidence]);
  if(enabled.has('telemetry_snapshot'))for(const d of report.telemetry_snapshot?.devices||[])rows.push(['telemetry',d.observed_at||'',d.device_name||'',d.freshness||'UNAVAILABLE',{lat:d.lat,lng:d.lng,speed_kph:d.speed_kph,accuracy_m:d.accuracy_m,source:d.source,freshness_reason:d.freshness_reason}]);
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
async function eventsFor(db,org,id,limit=200,user=null,dutyRoles=[]) {
  const manager=isMobilityManager(user);
  const r=await db("SELECT id,actor_id,event_type,summary,detail,source,created_at FROM sjm_journey_events WHERE org_id=$1 AND journey_id=$2 AND ($4::boolean OR detail->>'classification'='CLIENT_SAFE' OR (detail->>'classification'='INTERNAL_OPERATIONS' AND COALESCE(detail->'duty_roles','[]'::jsonb) ?| $5::text[])) ORDER BY created_at DESC,id DESC LIMIT $3",[org,id,limit,manager,Array.isArray(dutyRoles)?dutyRoles:[]]);
  return r.rows.filter(e=>eventVisibleToDuty(e,user,dutyRoles));
}

async function eventsForReport(db,org,id,limit=500) {
  const r=await db("SELECT id,actor_id,event_type,summary,detail,source,created_at,COUNT(*) OVER()::int AS total_count,COUNT(*) FILTER (WHERE left(event_type,8)='journey_' OR left(event_type,5)='stop_' OR event_type IN ('route_assessed','human_route_review')) OVER()::int AS total_change_count FROM sjm_journey_events WHERE org_id=$1 AND journey_id=$2 AND detail->>'classification'='CLIENT_SAFE' ORDER BY created_at DESC,id DESC LIMIT $3",[org,id,limit]);
  const total=Number(r.rows[0]?.total_count||0),totalChanges=Number(r.rows[0]?.total_change_count||0);
  const rows=r.rows.map(({total_count,total_change_count,...row})=>row);
  return {rows,total,totalChanges,limit};
}
async function event(db,j,actor,type,summary,detail={},source='operator') {
  return db('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at',[j.org_id,j.id,actor||null,type,txt(summary,500),JSON.stringify(detail||{}),source]);
}

async function mutateWithEvent(req,j,actor,type,summary,detail={},source='operator',mutation,guard=null) {
  if(typeof mutation!=='function') throw new TypeError('mutation callback is required');
  return req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    const locked=await lockJourneyForMobility(db,req.user.org_id,j.id);
    if(!locked)return {changed:false,error:'journey_not_found'};
    if(typeof guard==='function'){
      const rejected=await guard(db,locked);
      if(rejected?.error)return {...rejected,changed:false};
    }
    const result=await mutation(db,locked);
    if(!result?.rows?.length)return {changed:false,result};
    const row=result.rows[0];
    const resolvedSummary=typeof summary==='function'?summary(row):summary;
    const resolvedDetail=typeof detail==='function'?detail(row):detail;
    await event(db,j,actor,type,resolvedSummary,resolvedDetail,source);
    return {changed:true,result};
  });
}

async function recordRouteAssessmentFailure(req,j,actor,reason) {
  const failureReason=reason==='provider_error'?'provider_error':'invalid_provider_response';
  return mutateWithEvent(req,j,actor,'route_assessment_failed',
    'Route Safety assessment unavailable; journey moved to exception',
    {failure_reason:failureReason,route_status:'UNAVAILABLE',safety_gate:'UNAVAILABLE',approval_allowed:false},
    'system',
    db=>db("UPDATE sjm_journeys SET status='exception',planned_route='[]'::jsonb,route_assessment=NULL,planned_distance_km=NULL,planned_duration_minutes=NULL,ready_for_review_at=NULL,human_review_decision=NULL,human_review_rationale=NULL,reviewed_by=NULL,reviewed_at=NULL,risk_acknowledgement=NULL,approved_by=NULL,approved_at=NULL,departure_readiness_acknowledgement=NULL,ready_to_depart_at=NULL,exception_at=NOW(),updated_by=$1,updated_at=NOW() WHERE id=$2 AND org_id=$3 AND status='assessment_pending' RETURNING id",[actor,j.id,req.user.org_id])
  );
}

function freshnessFor(observedAt,nowMs=Date.now()) {
  if(!observedAt)return 'UNAVAILABLE';
  const observedMs=new Date(observedAt).getTime(),age=nowMs-observedMs;
  if(!Number.isFinite(observedMs)||!Number.isFinite(age)||age<0)return 'UNAVAILABLE';
  return age<=45000?'LIVE':age<=300000?'DELAYED':'STALE';
}
// PostgreSQL timestamps arrive as Date objects; default Array.sort() compares their strings,
// not their instants, and can select an older observation across weekday boundaries.
function latestObservedAt(values) {
  return (values || []).reduce((latest, value) => {
    if (value == null) return latest;
    const candidateMs = new Date(value).getTime();
    if (!Number.isFinite(candidateMs)) return latest;
    const latestMs = latest == null ? NaN : new Date(latest).getTime();
    return !Number.isFinite(latestMs) || candidateMs > latestMs ? value : latest;
  }, null);
}

function telemetryStatus(devices) {
  if((devices||[]).some(d=>d.freshness==='LIVE'))return 'LIVE';
  if((devices||[]).some(d=>d.freshness==='DELAYED'))return 'DELAYED';
  if((devices||[]).some(d=>d.freshness==='STALE'))return 'STALE';
  return 'UNAVAILABLE';
}
async function telemetryFor(db,org,j) {
  if(!j.convoy_id)return {status:'UNAVAILABLE',reason:'No convoy linked to this journey; live fleet evidence is unavailable.',observed_at:null,devices:[]};
  const r=await db('SELECT d.id AS device_id,d.name AS device_name,fo.name AS officer_name,fix.lat,fix.lng,fix.speed AS speed_kph,fix.heading,fix.accuracy AS accuracy_m,fix.observed_at,fix.source FROM convoy_cfos cc JOIN guardian_devices d ON d.id=cc.guardian_device_id LEFT JOIN field_officers fo ON fo.device_id=d.id LEFT JOIN LATERAL (SELECT lat,lng,speed,heading,accuracy,timestamp AS observed_at,\'device_locations\'::text AS source FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC,id DESC LIMIT 1) fix ON true WHERE cc.org_id=$1 AND cc.convoy_id=$2 AND d.deleted_at IS NULL ORDER BY d.name',[org,j.convoy_id]);
  const now=Date.now();
  const devices=r.rows.map(d=>{
    const observedMs=d.observed_at?new Date(d.observed_at).getTime():NaN;
    const age=d.observed_at?now-observedMs:null;
    const timestampFreshness=freshnessFor(d.observed_at,now);
    const hasUsableCoordinates=d.lat!=null&&d.lng!=null&&validCoordinate(Number(d.lat),Number(d.lng));
    // A fresh database timestamp without a usable coordinate is not a live location fix.
    const freshness=hasUsableCoordinates?timestampFreshness:'UNAVAILABLE';
    let freshness_reason=null;
    if(d.observed_at&&Number.isFinite(observedMs)&&observedMs>now)freshness_reason='future_timestamp_not_accepted_as_live';
    else if(!d.observed_at)freshness_reason='no_location_record';
    else if(!hasUsableCoordinates)freshness_reason='latest_record_has_no_usable_coordinates';
    else if(timestampFreshness==='UNAVAILABLE')freshness_reason='observation_timestamp_invalid';
    return {...d,freshness,age_seconds:age==null||!Number.isFinite(age)||age<0?null:Math.round(age/1000),freshness_reason,position_available:hasUsableCoordinates,evidence_class:'OBSERVED'};
  });
  return {status:telemetryStatus(devices),observed_at:latestObservedAt(devices.map(d=>d.observed_at))||null,devices,reason:devices.length?null:'No linked devices with a location record were returned.'};
}

function changeEventsFor(events) {
  return (events||[]).filter(e=>String(e.event_type||'').startsWith('journey_')||String(e.event_type||'').startsWith('stop_')||['route_assessed','human_route_review'].includes(e.event_type));
}
function readinessChecklist(j,stops,assessment,telemetry) {
  const gate=assessment?.safety_gate||'UNAVAILABLE';
  let review='UNAVAILABLE';
  if(assessment?.route_status==='blocked'||gate==='NO_GO')review='BLOCKED';
  else if(gate==='HUMAN_REVIEW')review=j.human_review_decision==='approve_with_controls'?'RECORDED_WITH_CONTROLS':j.human_review_decision==='reject'?'REJECTED':'PENDING';
  else if(assessment?.route_status==='routed'&&['GO','CONDITIONAL'].includes(gate))review='NOT_REQUIRED_BY_CURRENT_GATE';
  const located=(stops||[]).length?(stops.every(s=>s.lat!=null&&s.lng!=null&&validCoordinate(Number(s.lat),Number(s.lng)))?'COMPLETE':'INCOMPLETE'):'NO_STOPS_DEFINED';
  return [
    {item:'Stored Route Safety assessment',status:assessment?.route_status==='routed'?gate:assessment?.route_status==='blocked'?'BLOCKED':'UNAVAILABLE',detail:assessment?'Route status: '+String(assessment.route_status||'UNKNOWN'):'No stored assessment record.'},
    {item:'Human route review',status:review,detail:j.human_review_rationale||'No human-review rationale recorded.'},
    {item:'Journey approval',status:j.approved_at?'RECORDED':'PENDING',detail:j.approved_at?'Approval timestamp: '+String(j.approved_at):'No approval timestamp recorded.'},
    {item:'Departure-readiness acknowledgement',status:txt(j.departure_readiness_acknowledgement,1200)?'RECORDED':'PENDING',detail:txt(j.departure_readiness_acknowledgement,1200)||'No departure-readiness acknowledgement recorded.'},
    {item:'Convoy linkage',status:j.convoy_id?'LINKED':'NOT_LINKED',detail:j.convoy_id?'A Sonalit convoy is linked.':'No convoy is linked to this journey.'},
    {item:'Convoy device telemetry',status:telemetry?.status||'UNAVAILABLE',detail:telemetry?.reason||'Freshness is derived from recorded device_locations timestamps.'},
    {item:'Ordered stop coordinates',status:located,detail:(stops||[]).length+' stop record(s); operator confirmation is not GPS proof.'}
  ];
}
function enabledReportSections(profile) {
  const configured=profile?.enabled_sections;
  return Array.isArray(configured)?[...new Set(configured.filter(section=>SECTIONS.includes(section)))]:[...SECTIONS];
}
function reportFocusSections(report) {
  const j=report.journey||{},s=report.summary||{},type=report.report_type;
  const enabled=new Set(enabledReportSections(report.client_profile||{}));
  if(type==='pre_trip_brief')return [{title:'Pre-trip readiness evidence',body:(report.pre_trip_readiness||[]).map(x=>x.item+': '+x.status+' — '+x.detail).join('\n')||'No readiness evidence was returned.'}];
  if(type==='daily') {
    const lines=[];
    if(enabled.has('summary'))lines.push('Lifecycle status: '+(j.status||'UNAVAILABLE'),'Generated at: '+(report.generated_at||'not recorded'));
    if(enabled.has('stops'))lines.push('Recorded stops: '+(s.stop_count??0),'Reached stops: '+(s.reached_stops??0),'Outstanding planned stops: '+(s.pending_stops??0));
    if(enabled.has('operational_events'))lines.push('Operational events in snapshot: '+(s.event_count??0));
    if(enabled.has('route_assessment'))lines.push('Route Safety gate: '+(s.safety_gate||'UNAVAILABLE'));
    if(enabled.has('telemetry_snapshot'))lines.push('Live device-evidence status: '+(s.telemetry_status||'UNAVAILABLE'));
    return lines.length?[{title:'Daily movement summary',body:lines.join('\n')}]:[];
  }
  if(type==='sitrep') {
    const lines=[],e=report.situation?.last_event||(report.events||[])[0];
    if(enabled.has('summary'))lines.push('Current lifecycle state: '+(j.status||'UNAVAILABLE'));
    if(enabled.has('route_assessment'))lines.push('Route status / safety gate: '+((report.route_assessment||{}).route_status||'UNAVAILABLE')+' / '+(s.safety_gate||'UNAVAILABLE'));
    if(enabled.has('telemetry_snapshot'))lines.push('Telemetry state: '+(report.telemetry_snapshot?.status||'UNAVAILABLE')+'; latest observed timestamp: '+(report.telemetry_snapshot?.observed_at||'not recorded'));
    if(enabled.has('stops'))lines.push('Outstanding planned stops: '+(s.pending_stops??0));
    if(enabled.has('operational_events'))lines.push('Most recent recorded event: '+(e?(e.created_at||'time not recorded')+' — '+(e.event_type||'event')+' — '+(e.summary||'no summary')+' ['+(e.source||'source unknown')+']':'No journey event is recorded in the snapshot'));
    return lines.length?[{title:'Current situation',body:lines.join('\n')}]:[];
  }
  if(type==='change_notice') {
    const changes=report.change_events||[];
    return [{title:'Recorded change activity',body:['Total recorded change events: '+(report.summary?.change_event_count??0),'Change events included in this snapshot: '+(report.summary?.change_event_count_included??changes.length),'Change-event list truncated: '+(report.summary?.change_events_truncated?'YES':'NO'),...(changes.length?changes.slice(0,80).map(e=>(e.created_at||'time not recorded')+' — '+e.event_type+' — '+e.summary+' ['+(e.source||'source unknown')+']'):['No route, approval, lifecycle or stop-change event was found in the stored journey event window.']),'','This notice reports recorded event activity only. It does not infer an unrecorded before/after route difference.'].join('\n')}];
  }
  if(type==='closeout'||type==='final') {
    const c=report.closeout_evidence||{};
    return [{title:'Completion and closeout evidence',body:['Lifecycle status: '+(j.status||'UNAVAILABLE'),'Closeout state: '+(j.status==='closed'?'CLOSED':'NOT CLOSED'),'Closed at: '+(c.closed_at||'not recorded'),'Arrival verification source: '+(c.arrival_verification_source||'UNAVAILABLE'),'Evidence class: '+(c.evidence_class||'UNAVAILABLE'),'GPS proof: '+(c.gps_verified?'EXPLICITLY RECORDED':'NOT CLAIMED'),'Supervisor arrival note: '+(c.arrival_verification_note||'not recorded'),'Reached stops: '+(s.reached_stops??0),'Skipped stops: '+(s.skipped_stops??0),'Outstanding planned stops: '+(s.pending_stops??0)].join('\n')}];
  }
  if(type==='itinerary') {
    const lines=[];
    if(enabled.has('route_assessment')) {
      lines.push('Route status: '+((report.route_assessment||{}).route_status||'UNAVAILABLE'));
      lines.push('Route Safety gate: '+(s.safety_gate||'UNAVAILABLE'));
    }
    if(enabled.has('itinerary')) {
      lines.push('Stored route points: '+((report.itinerary||[]).length));
      lines.push('Geometry source: '+(report.provenance?.planned_itinerary||'UNAVAILABLE'));
    }
    if(enabled.has('stops'))lines.push('Ordered stops: '+((report.stops||[]).length));
    return lines.length?[{title:'Itinerary evidence status',body:lines.join('\n')}]:[];
  }
  return [];
}
function managementSummaryCounts(journeys,aggregate,statusCounts,recentEventCount,recentEventsIncluded=recentEventCount) {
  const telemetryCounts={LIVE:0,DELAYED:0,STALE:0,UNAVAILABLE:0};
  (journeys||[]).forEach(j=>{const k=telemetryCounts[j.telemetry_status]!=null?j.telemetry_status:'UNAVAILABLE';telemetryCounts[k]++;});
  const a=aggregate||{};
  return {total_journeys:Number(a.total_journeys||0),open_journeys:Number(a.open_journeys||0),active_controlled_journeys:Number(a.active_controlled_journeys||0),planning_queue:Number(a.planning_queue||0),approval_queue:Number(a.approval_queue||0),paused_exception_or_hold:Number(a.paused_exception_or_hold||0),arrival_pending_verification:Number(a.arrival_pending_verification||0),overdue_journeys:Number(a.overdue_journeys||0),route_review_required:Number(a.route_review_required||0),status_counts:statusCounts||{},recent_events_last_24h:Number(recentEventCount||0),recent_events_included:Number(recentEventsIncluded||0),recent_events_truncated:Number(recentEventsIncluded||0)<Number(recentEventCount||0),telemetry_status_counts:telemetryCounts,telemetry_journey_sample_count:(journeys||[]).length};
}
async function reportSnapshot(db,org,j,type,date) {
  const [stops,eventRecords,profile,telemetry]=await Promise.all([
    stopsFor(db,org,j.id),eventsForReport(db,org,j.id,500),
    j.client_id?db('SELECT report_timezone,report_template FROM sjm_client_profiles WHERE org_id=$1 AND client_id=$2 LIMIT 1',[org,j.client_id]):Promise.resolve({rows:[]}),
    telemetryFor(db,org,j),
  ]);
  const p=profile.rows[0]||{},template={...DEFAULT_TEMPLATE,...parseJson(p.report_template,{})},assessment=parseJson(j.route_assessment,null),events=eventRecords.rows,changes=changeEventsFor(events);
  const pendingStops=stops.filter(s=>s.stop_status==='planned').length,reachedStops=stops.filter(s=>s.stop_status==='reached').length,skippedStops=stops.filter(s=>s.stop_status==='skipped').length;
  const title=REPORT_TITLES[type]||'Secure Journey Management Report';
  const closeoutEvidence={closed_at:j.closed_at||null,arrival_verification_source:j.arrival_verification_source||null,arrival_verification_note:j.arrival_verification_note||null,gps_verified:j.arrival_verification_source==='gps',evidence_class:j.arrival_verification_source==='supervisor_attestation'?'SUPERVISOR_ATTESTED_NOT_GPS':j.arrival_verification_source?'SOURCE_RECORDED':'UNAVAILABLE'};
  return {
    schema_version:'sonalit.sjm.report.v2',report_type:type,report_title:title,report_date:date,generated_at:new Date().toISOString(),
    timezone:p.report_timezone||j.timezone||'Africa/Nairobi',
    client_profile:{client_id:j.client_id,client_name:j.client_name||null,template_title:template.title||DEFAULT_TEMPLATE.title,enabled_sections:Array.isArray(template.sections)?template.sections.filter(x=>SECTIONS.includes(x)):SECTIONS},
    journey:{id:j.id,reference:j.reference,title:j.title,purpose:j.purpose,status:j.status,transport_mode:j.transport_mode,service_type:j.service_type||'executive_transfer',airport_code:j.airport_code||null,terminal:j.terminal||null,airline:j.airline||null,flight_number:j.flight_number||null,flight_scheduled_at:j.flight_scheduled_at||null,flight_status:j.flight_status||'unknown',flight_status_source:j.flight_status_source||'not_recorded',flight_status_observed_at:j.flight_status_observed_at||null,client_id:j.client_id,convoy_id:j.convoy_id,origin_label:j.origin_label,origin_lat:j.origin_lat,origin_lng:j.origin_lng,destination_label:j.destination_label,destination_lat:j.destination_lat,destination_lng:j.destination_lng,planned_departure_at:j.planned_departure_at,planned_arrival_at:j.planned_arrival_at,client_name:j.client_name||null,convoy_name:j.convoy_name||null,created_at:j.created_at,approved_at:j.approved_at,started_at:j.started_at,completed_at:j.completed_at,closed_at:j.closed_at,paused_at:j.paused_at,exception_at:j.exception_at,departure_readiness_acknowledgement:j.departure_readiness_acknowledgement||null,human_review_decision:j.human_review_decision||null,human_review_rationale:j.human_review_rationale||null,risk_acknowledgement:j.risk_acknowledgement||null,arrival_verification_source:j.arrival_verification_source||null,arrival_verification_note:j.arrival_verification_note||null},
    summary:{stop_count:stops.length,reached_stops:reachedStops,skipped_stops:skippedStops,pending_stops:pendingStops,event_count:eventRecords.total,event_count_included:events.length,events_truncated:eventRecords.total>events.length,change_event_count:eventRecords.totalChanges,change_event_count_included:changes.length,change_events_truncated:eventRecords.totalChanges>changes.length,route_assessment_available:Boolean(assessment),safety_gate:assessment?.safety_gate||'UNAVAILABLE',telemetry_status:telemetry.status},
    itinerary:parseJson(j.planned_route,[]),stops,events,change_events:changes,route_assessment:assessment,telemetry_snapshot:telemetry,
    pre_trip_readiness:readinessChecklist(j,stops,assessment,telemetry),
    situation:{last_event:events[0]||null,open_stops:pendingStops,telemetry_status:telemetry.status},
    closeout_evidence:closeoutEvidence,
    provenance:{planned_itinerary:'SJM journey and ordered stop records',route_assessment:assessment?'Stored Sonalit Route Safety assessment':'UNAVAILABLE',telemetry:'Latest device_locations fixes associated with linked convoy; not a route prediction',stop_confirmation:'Operator confirmation is not represented as GPS-derived proof',future_telemetry_timestamps:'Future-dated fixes are UNAVAILABLE and never treated as LIVE',fabricated_data_used:false},
  };
}

function renderPdf(doc,r) {
  const j=r.journey||{},profile=r.client_profile||{},type=r.report_type||'daily',title=r.report_title||REPORT_TITLES[type]||profile.template_title||DEFAULT_TEMPLATE.title;
  doc.rect(0,0,595,88).fill('#0b132b');
  doc.fillColor('#39ff88').font('Helvetica-Bold').fontSize(9).text('SONALIT  /  XD LIVE SURVEILLANCE',42,19);
  doc.fillColor('#ffffff').fontSize(16).text(title,42,35,{width:510});
  doc.fillColor('#cbd5e1').font('Helvetica').fontSize(7).text('Client template: '+(profile.template_title||DEFAULT_TEMPLATE.title),42,67,{width:510});
  doc.fillColor('#64748b').font('Helvetica').fontSize(9).text('Reference: '+(j.reference||(type==='management_summary'?'TENANT PORTFOLIO':'—'))+'   |   Type: '+String(type).toUpperCase(),42,105);
  doc.text('Reporting date: '+(r.report_date||'—')+'   |   Timezone: '+(r.timezone||'Africa/Nairobi'),42,119);
  doc.moveDown(3);
  const section=(name,body)=>{if(doc.y>710)doc.addPage();doc.fillColor('#0b132b').font('Helvetica-Bold').fontSize(11).text(name.toUpperCase(),42,doc.y);doc.moveDown(.45);doc.fillColor('#334155').font('Helvetica').fontSize(9).text(body||'No recorded data.',{width:510,lineGap:3});doc.moveDown(.9);};
  const evidenceNote=()=>{if(doc.y>700)doc.addPage();doc.moveDown(.5);doc.fillColor('#64748b').font('Helvetica').fontSize(7).text('Evidence note: PLANNED, ANALYSED, OBSERVED and OPERATOR_CONFIRMED data are separated. Operator confirmation is not GPS proof. Future-dated device fixes are not treated as LIVE.',42,doc.y,{width:510});};
  if(type==='management_summary') {
    const s=r.summary||{},counts=s.status_counts||{},scope=r.data_scope||{};
    section('Portfolio overview',['Tenant-scoped journeys: '+(s.total_journeys??0),'Open journeys: '+(s.open_journeys??0),'Active / controlled movements: '+(s.active_controlled_journeys??0),'Planning queue: '+(s.planning_queue??0),'Awaiting approval: '+(s.approval_queue??0),'Paused / exception / on hold: '+(s.paused_exception_or_hold??0),'Awaiting arrival verification: '+(s.arrival_pending_verification??0),'Overdue planned arrivals: '+(s.overdue_journeys??0),'Route review required: '+(s.route_review_required??0),'Recorded events in preceding 24 hours: '+(s.recent_events_last_24h??0),'Event rows included in snapshot: '+(s.recent_events_included??0),'Event list truncated: '+(s.recent_events_truncated?'YES — capped at 250 rows':'NO')].join('\n'));
    section('Journey status distribution',Object.entries(counts).filter(([,n])=>Number(n)>0).map(([k,n])=>k+': '+n).join('\n')||'No journeys are recorded in this tenant.');
    const attention=(r.journeys||[]).filter(x=>x.overdue||x.route_review_required||['paused','exception','on_hold','arrival_pending_verification'].includes(x.status));
    section('Attention queue',attention.slice(0,100).map(x=>x.reference+' — '+x.status+' — '+x.origin_label+' to '+x.destination_label+' — client '+(x.client_name||'not linked')+' — route gate '+x.safety_gate+' — telemetry '+x.telemetry_status+(x.overdue?' — OVERDUE':'')).join('\n')||'No attention items were found in the included journey register.');
    section('Journey register',['Showing '+(r.journeys||[]).length+' of '+(scope.total_journeys??(r.journeys||[]).length)+' tenant journeys.',(r.journeys||[]).slice(0,100).map(x=>x.reference+' — '+x.status+' — '+x.origin_label+' to '+x.destination_label+' — client '+(x.client_name||'not linked')+' — convoy '+(x.convoy_name||'not linked')+' — planned arrival '+(x.planned_arrival_at||'not recorded')+' — route '+x.route_status+'/'+x.safety_gate+' — telemetry '+x.telemetry_status).join('\n'),scope.journey_register_complete?'Journey register is complete.':'Journey register is capped; the snapshot records exact tenant totals and exportable rows.'].filter(Boolean).join('\n'));
    section('Recent operational events — preceding 24 hours',(r.recent_events||[]).slice(0,100).map(e=>(e.created_at||'time not recorded')+' — '+(e.journey_reference||'journey')+' — '+e.event_type+' — '+e.summary+' ['+(e.source||'unknown')+']').join('\n')||'No recorded journey events in the preceding 24 hours.');
    section('Evidence provenance',['All counts are scoped to the authenticated tenant.','Status aggregates cover all non-deleted journeys; the register is separately bounded and its completeness is recorded.','Telemetry freshness comes from device_locations timestamps and covers the included journey register.','No ETA, route, risk score, event or location is fabricated.','Data scope: '+JSON.stringify(scope)].join('\n'));
    evidenceNote();doc.end();return;
  }
  for(const focus of reportFocusSections(r))section(focus.title,focus.body);
  const enabled=new Set(enabledReportSections(profile));
  if(enabled.has('summary'))section('Mission summary',['Title: '+(j.title||'—'),'Purpose: '+(j.purpose||'—'),'Status: '+(j.status||'—'),'Client: '+(j.client_name||'Not linked'),'Convoy: '+(j.convoy_name||'Not linked'),'Origin: '+(j.origin_label||'—'),'Destination: '+(j.destination_label||'—'),'Planned departure: '+(j.planned_departure_at||'Not recorded'),'Planned arrival: '+(j.planned_arrival_at||'Not recorded')].join('\n'));
  if(enabled.has('itinerary'))section('Planned itinerary',(r.itinerary||[]).map((p,i)=>(i+1)+'. '+(p.name||p.label||'Route point')+' ['+p.lat+', '+p.lng+']').join('\n')||'No routed road geometry recorded. Endpoints are not presented as a road-following route.');
  if(enabled.has('stops'))section('Journey stops',(r.stops||[]).map(s=>s.sequence+'. '+s.name+' — '+s.stop_status+' — planned '+(s.planned_arrival_at||'time not recorded')+(s.confirmed_at?' — confirmed '+s.confirmed_at+' ('+(s.confirmation_source||'unknown')+')':'')).join('\n')||'No stops defined.');
  if(enabled.has('route_assessment'))section('Route safety assessment',r.route_assessment?['Route status: '+(r.route_assessment.route_status||'unknown'),'Safety gate: '+(r.route_assessment.safety_gate||'unknown'),'Risk score: '+(r.route_assessment.overall_risk_score??'not returned'),'Provider: '+(r.route_assessment.routing_provider||'not returned'),'Assessment: '+(r.route_assessment.ai_summary||'No assessment narrative returned')].join('\n'):'Route assessment unavailable; no verdict is inferred.');
  if(enabled.has('operational_events'))section('Operational events',(r.events||[]).slice(0,60).map(e=>e.created_at+' — '+e.event_type+' — '+e.summary+' ['+e.source+']').join('\n')||'No operational events recorded.');
  if(enabled.has('telemetry_snapshot'))section('Observed telemetry',['Snapshot state: '+(r.telemetry_snapshot?.status||'UNAVAILABLE'),...(r.telemetry_snapshot?.devices||[]).map(d=>d.device_name+' — '+d.freshness+' — observed '+(d.observed_at||'not recorded')+' — '+(d.lat==null?'coordinates unavailable':Number(d.lat)+', '+Number(d.lng))+' — source '+(d.source||'none')+(d.freshness_reason?' — '+d.freshness_reason:'')),r.telemetry_snapshot?.reason||''].filter(Boolean).join('\n')||'No live telemetry available.');
  evidenceNote();doc.end();
}

router.use(authenticate);
router.use((req,res,next)=>{if(!req.user?.org_id||!req.db||!req.dbTx)return res.status(403).json({error:'tenant_scope_required'});next();});

async function managementSnapshot(db,org,timezone) {
  const clock=await db('SELECT NOW() AS db_now',[]);
  const now=new Date(clock.rows[0]?.db_now||Date.now()),nowMs=now.getTime(),generatedAt=now.toISOString(),date=dateInTimezone(now,timezone);
  const aggregateResult=await db("SELECT COUNT(*)::int AS total_journeys,COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled','aborted'))::int AS open_journeys,COUNT(*) FILTER (WHERE status IN ('in_progress','paused','exception','arrival_pending_verification'))::int AS active_controlled_journeys,COUNT(*) FILTER (WHERE status IN ('requested','planning','assessment_pending'))::int AS planning_queue,COUNT(*) FILTER (WHERE status='ready_for_review')::int AS approval_queue,COUNT(*) FILTER (WHERE status IN ('paused','exception','on_hold'))::int AS paused_exception_or_hold,COUNT(*) FILTER (WHERE status='arrival_pending_verification')::int AS arrival_pending_verification,COUNT(*) FILTER (WHERE planned_arrival_at IS NOT NULL AND planned_arrival_at<NOW() AND status NOT IN ('closed','cancelled','aborted'))::int AS overdue_journeys,COUNT(*) FILTER (WHERE CASE WHEN jsonb_typeof(route_assessment)='object' THEN (route_assessment->>'safety_gate' IN ('HUMAN_REVIEW','NO_GO') OR route_assessment->>'route_status'='blocked') ELSE FALSE END)::int AS route_review_required FROM sjm_journeys WHERE org_id=$1 AND deleted_at IS NULL",[org]);
  const statusResult=await db('SELECT status,COUNT(*)::int AS count FROM sjm_journeys WHERE org_id=$1 AND deleted_at IS NULL GROUP BY status',[org]);
  const journeyResult=await db('SELECT j.id,j.reference,j.title,j.status,j.client_id,j.convoy_id,j.origin_label,j.destination_label,j.planned_departure_at,j.planned_arrival_at,j.approved_at,j.started_at,j.closed_at,j.updated_at,j.created_at,j.route_assessment,c.name AS client_name,v.name AS convoy_name FROM sjm_journeys j LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL WHERE j.org_id=$1 AND j.deleted_at IS NULL ORDER BY COALESCE(j.updated_at,j.created_at) DESC LIMIT 500',[org]);
  const eventResult=await db("SELECT e.id,e.journey_id,e.event_type,e.summary,e.detail,e.source,e.created_at,j.reference AS journey_reference,j.title AS journey_title,COUNT(*) OVER()::int AS total_count FROM sjm_journey_events e JOIN sjm_journeys j ON j.id=e.journey_id AND j.org_id=e.org_id WHERE e.org_id=$1 AND e.created_at>=NOW()-INTERVAL '24 hours' AND j.deleted_at IS NULL ORDER BY e.created_at DESC,e.id DESC LIMIT 250",[org]);
  const telemetryResult=await db("SELECT cc.convoy_id,d.id AS device_id,d.name AS device_name,fo.name AS officer_name,fix.lat,fix.lng,fix.speed AS speed_kph,fix.accuracy AS accuracy_m,fix.observed_at,fix.source FROM convoy_cfos cc JOIN guardian_devices d ON d.id=cc.guardian_device_id LEFT JOIN field_officers fo ON fo.device_id=d.id LEFT JOIN LATERAL (SELECT lat,lng,speed,accuracy,timestamp AS observed_at,'device_locations'::text AS source FROM device_locations WHERE device_id=d.id ORDER BY timestamp DESC,id DESC LIMIT 1) fix ON true WHERE cc.org_id=$1 AND cc.convoy_id IN (SELECT DISTINCT convoy_id FROM sjm_journeys WHERE org_id=$1 AND deleted_at IS NULL AND convoy_id IS NOT NULL) AND d.deleted_at IS NULL ORDER BY cc.convoy_id,d.name",[org]);
  const telemetryByConvoy=new Map();
  for(const d of telemetryResult.rows) {
    const observedMs=d.observed_at?new Date(d.observed_at).getTime():NaN,age=d.observed_at?nowMs-observedMs:null;
    const dev={...d,freshness:freshnessFor(d.observed_at,nowMs),age_seconds:age==null||!Number.isFinite(age)||age<0?null:Math.round(age/1000),freshness_reason:d.observed_at&&Number.isFinite(observedMs)&&observedMs>nowMs?'future_timestamp_not_accepted_as_live':null,evidence_class:'OBSERVED'};
    const key=String(d.convoy_id),list=telemetryByConvoy.get(key)||[];list.push(dev);telemetryByConvoy.set(key,list);
  }
  const journeys=journeyResult.rows.map(j=>{
    const assessment=parseJson(j.route_assessment,null),devices=telemetryByConvoy.get(String(j.convoy_id))||[],routeGate=assessment?.safety_gate||'UNAVAILABLE',routeStatus=assessment?.route_status||'UNAVAILABLE';
    const due=j.planned_arrival_at?new Date(j.planned_arrival_at).getTime():NaN;
    return {id:j.id,reference:j.reference,title:j.title,status:j.status,client_id:j.client_id,client_name:j.client_name||null,convoy_id:j.convoy_id,convoy_name:j.convoy_name||null,origin_label:j.origin_label,destination_label:j.destination_label,planned_departure_at:j.planned_departure_at,planned_arrival_at:j.planned_arrival_at,approved_at:j.approved_at,started_at:j.started_at,closed_at:j.closed_at,updated_at:j.updated_at,route_status:routeStatus,safety_gate:routeGate,route_review_required:routeGate==='HUMAN_REVIEW'||routeGate==='NO_GO'||routeStatus==='blocked',overdue:Number.isFinite(due)&&due<nowMs&&!TERMINAL_STATUSES.includes(j.status),telemetry_status:telemetryStatus(devices),telemetry_devices:devices};
  });
  const statusCounts=Object.fromEntries(STATUSES.map(s=>[s,0]));
  for(const row of statusResult.rows)statusCounts[row.status]=Number(row.count||0);
  const aggregate=aggregateResult.rows[0]||{},recentEvents=eventResult.rows.map(({total_count,...e})=>({...e,detail:parseJson(e.detail,{})})),recentEventTotal=Number(eventResult.rows[0]?.total_count||0);
  const summary=managementSummaryCounts(journeys,aggregate,statusCounts,recentEventTotal,recentEvents.length);
  return {schema_version:'sonalit.sjm.management-report.v1',report_type:'management_summary',report_title:REPORT_TITLES.management_summary,report_date:date,generated_at:generatedAt,timezone,client_profile:{client_id:null,client_name:null,template_title:REPORT_TITLES.management_summary,enabled_sections:SECTIONS},journey:null,summary,journeys,recent_events:recentEvents,data_scope:{tenant_scoped:true,total_journeys:Number(aggregate.total_journeys||0),journey_records_included:journeys.length,journey_register_complete:Number(aggregate.total_journeys||0)<=journeys.length,journey_register_limit:500,recent_events_window:'last_24_hours',recent_events_limit:250,telemetry_scope:'Included journey register only; each fix comes from device_locations.'},provenance:{journeys:'Tenant-scoped sjm_journeys joined to same-tenant cargo_clients and convoys',recent_events:'Tenant-scoped sjm_journey_events from the preceding 24 hours',telemetry:'Latest device_locations fixes for devices linked to convoys referenced by SJM journeys',eta_inferred:false,fabricated_data_used:false}};
}

router.post('/management-summary',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,timezone=txt(req.body?.timezone,100)||'Africa/Nairobi';
  if(!tzValid(timezone))return res.status(400).json({error:'invalid_reporting_timezone',message:'Provide a valid IANA timezone.'});
  const saved=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    const snapshot=await managementSnapshot(db,org,timezone);
    const row=await db('INSERT INTO sjm_reports (org_id,journey_id,report_type,report_date,schema_version,data,generated_by) VALUES ($1,NULL,$2,$3,$4,$5,$6) RETURNING id,journey_id,report_type,report_date,generated_at',[org,'management_summary',snapshot.report_date,snapshot.schema_version,JSON.stringify(snapshot),req.user.id]);
    return {data:row.rows[0],snapshot};
  });
  res.status(201).json(saved);
}));
router.get('/clients',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{const r=await req.db('SELECT id,name,company FROM cargo_clients WHERE org_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT 500',[req.user.org_id]);res.json({data:r.rows});}));
router.get('/convoys',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{const r=await req.db('SELECT id,name,status,route_origin,route_destination FROM convoys WHERE org_id=$1 AND deleted_at IS NULL AND status IN (\'planned\',\'active\') ORDER BY updated_at DESC NULLS LAST,name LIMIT 200',[req.user.org_id]);res.json({data:r.rows});}));

router.get('/client-profiles/:clientId',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const c=await req.db('SELECT id,name,company FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[req.params.clientId,req.user.org_id]);
  if(!c.rows.length)return res.status(404).json({error:'client_not_found'});
  if(!isMobilityManager(req.user)){const assignment=await req.db('SELECT 1 FROM sjm_journeys j JOIN sjm_journey_participants p ON p.org_id=j.org_id AND p.journey_id=j.id WHERE j.org_id=$1 AND j.client_id=$2 AND j.deleted_at IS NULL AND p.user_id=$3 AND p.removed_at IS NULL LIMIT 1',[req.user.org_id,req.params.clientId,req.user.id]);if(!assignment.rows.length)return res.status(404).json({error:'client_not_found'});}
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
  const clientId=req.query.client_id?String(req.query.client_id):null;
  if(clientId&&!SJM_ORG_UUID.test(clientId))return res.status(400).json({error:'invalid_client_id'});
  const limit=Math.max(1,Math.min(100,Number.parseInt(req.query.limit,10)||50));
  const parsedOffset=Number.parseInt(req.query.offset,10);
  const offset=Number.isInteger(parsedOffset)&&parsedOffset>=0?Math.min(100000,parsedOffset):0;
  const filter=txt(req.query.filter,40)||'all';
  const filterSql=journeyRegisterFilterSql(filter);
  if(!filterSql)return res.status(400).json({error:'invalid_journey_filter',allowed:[...Object.keys(JOURNEY_REGISTER_FILTER_SQL),...STATUSES]});
  const sort=txt(req.query.sort,40)||'priority';
  const orderSql=journeyRegisterOrderSql(sort);
  if(!orderSql)return res.status(400).json({error:'invalid_journey_sort',allowed:Object.keys(JOURNEY_REGISTER_ORDER_SQL)});
  const search=txt(req.query.search,160);
  const rows=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    // Lock the authorised candidate page before returning it. The reader helper
    // re-reads the page after any lock wait to observe committed roster changes.
    const initialLocks=!isMobilityManager(req.user)?await db(
        `SELECT j.id
           FROM sjm_journeys j
           LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL
           LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL
          WHERE j.org_id=$1 AND j.deleted_at IS NULL
            AND ($2::text IS NULL OR j.status=$2)
            AND ($3::uuid IS NULL OR j.client_id=$3)
            AND ${filterSql}
            AND ($5::text='' OR concat_ws(' ',j.reference,j.title,c.name,j.origin_label,j.destination_label,v.name) ILIKE '%'||$5||'%')
            AND EXISTS (
              SELECT 1 FROM sjm_journey_participants p
               WHERE p.org_id=j.org_id AND p.journey_id=j.id
                 AND p.user_id=$8 AND p.removed_at IS NULL
            )
          ORDER BY ${orderSql}
          LIMIT $6 OFFSET $7
          FOR SHARE OF j`,
        [req.user.org_id,status,clientId,filter,search,limit,offset,req.user.id],
      ): {rows:[]};
    const listSql=`SELECT j.id,j.reference,j.title,j.purpose,j.status,j.transport_mode,j.service_type,j.airport_code,j.terminal,j.airline,j.flight_number,j.flight_scheduled_at,j.flight_status,j.flight_status_source,j.flight_status_observed_at,j.flight_status_note,j.meet_greet_instructions,j.principal_reference,j.origin_label,j.destination_label,j.planned_departure_at,j.planned_arrival_at,CASE WHEN j.status IN ('approved','ready_to_depart') AND j.planned_departure_at IS NOT NULL AND j.planned_departure_at<NOW() THEN 'DEPARTURE_OVERDUE' WHEN j.status IN ('in_progress','paused','exception') AND j.planned_arrival_at IS NOT NULL AND j.planned_arrival_at<NOW() THEN 'ARRIVAL_OVERDUE' WHEN j.status IN ('approved','ready_to_depart') AND j.planned_departure_at>=NOW() AND j.planned_departure_at<=NOW()+INTERVAL '30 minutes' THEN 'DEPARTURE_DUE_30M' ELSE NULL END AS schedule_urgency,j.client_id,c.name AS client_name,j.convoy_id,v.name AS convoy_name,j.created_at,j.updated_at,j.timezone,j.planned_route,j.planned_distance_km,j.planned_duration_minutes,j.route_assessment,j.route_assessment IS NOT NULL AS has_route_assessment,ARRAY(SELECT DISTINCT p.duty_role FROM sjm_journey_participants p WHERE p.org_id=j.org_id AND p.journey_id=j.id AND p.user_id=$9 AND p.removed_at IS NULL ORDER BY p.duty_role) AS duty_roles
      FROM sjm_journeys j
      LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL
      LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL
      WHERE j.org_id=$1 AND j.deleted_at IS NULL
        AND ($2::text IS NULL OR j.status=$2)
        AND ($3::uuid IS NULL OR j.client_id=$3)
        AND ${filterSql}
        AND ($5::text='' OR concat_ws(' ',j.reference,j.title,c.name,j.origin_label,j.destination_label,v.name) ILIKE '%'||$5||'%')
        AND ($8::boolean OR EXISTS (
          SELECT 1 FROM sjm_journey_participants p
           WHERE p.org_id=j.org_id AND p.journey_id=j.id
             AND p.user_id=$9 AND p.removed_at IS NULL
        ))
      ORDER BY ${orderSql}
      LIMIT $6 OFFSET $7`;
    const guarded=await readLockedAssignmentRows(db,req.user.org_id,initialLocks,listSql,[req.user.org_id,status,clientId,filter,search,limit,offset,isMobilityManager(req.user),req.user.id]);
    if(guarded.error)return guarded;
    const countSql=`SELECT COUNT(*)::int AS total_count
      FROM sjm_journeys j
      LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL
      LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL
      WHERE j.org_id=$1 AND j.deleted_at IS NULL
        AND ($2::text IS NULL OR j.status=$2)
        AND ($3::uuid IS NULL OR j.client_id=$3)
        AND ${filterSql}
        AND ($5::text='' OR concat_ws(' ',j.reference,j.title,c.name,j.origin_label,j.destination_label,v.name) ILIKE '%'||$5||'%')
        AND ($6::boolean OR EXISTS (
          SELECT 1 FROM sjm_journey_participants p
           WHERE p.org_id=j.org_id AND p.journey_id=j.id
             AND p.user_id=$7 AND p.removed_at IS NULL
        ))`;
    const counts=await db(countSql,[req.user.org_id,status,clientId,filter,search,isMobilityManager(req.user),req.user.id]);
    const summaryResult=await db(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE j.status IN ('in_progress','paused','exception','arrival_pending_verification'))::int AS active,
      COUNT(*) FILTER (WHERE j.status IN ('requested','planning','assessment_pending','ready_for_review'))::int AS queue,
      COUNT(*) FILTER (WHERE j.status IN ('paused','exception','on_hold','arrival_pending_verification') OR COALESCE(j.route_assessment->>'safety_gate','') IN ('HUMAN_REVIEW','NO_GO'))::int AS review,
      COUNT(*) FILTER (WHERE j.status='ready_for_review')::int AS awaiting_review,
      COUNT(*) FILTER (WHERE j.status='arrival_pending_verification')::int AS arrival_verification,
      COUNT(*) FILTER (WHERE (j.status IN ('approved','ready_to_depart') AND j.planned_departure_at IS NOT NULL AND j.planned_departure_at<NOW()) OR (j.status IN ('in_progress','paused','exception') AND j.planned_arrival_at IS NOT NULL AND j.planned_arrival_at<NOW()))::int AS overdue,
      COUNT(*) FILTER (WHERE j.status IN ('approved','ready_to_depart') AND j.planned_departure_at>=NOW() AND j.planned_departure_at<=NOW()+INTERVAL '30 minutes')::int AS departures_due_30m
      FROM sjm_journeys j
      WHERE j.org_id=$1 AND j.deleted_at IS NULL
        AND ($2::boolean OR EXISTS (
          SELECT 1 FROM sjm_journey_participants p
           WHERE p.org_id=j.org_id AND p.journey_id=j.id
             AND p.user_id=$3 AND p.removed_at IS NULL
        ))`,
      [req.user.org_id,isMobilityManager(req.user),req.user.id]);
    return {rows:guarded.rows,totalCount:Number(counts.rows[0]?.total_count||0),summary:summaryResult.rows[0]||{total:0,active:0,queue:0,review:0,awaiting_review:0,arrival_verification:0,overdue:0,departures_due_30m:0}};
  });
  if(rows.error)return res.status(409).json({error:'assignment_roster_changed',message:'The assignment roster changed repeatedly while loading this list. Refresh and retry.'});
  const data=rows.rows.map(row=>journeyForDutyViewer(row,[],req.user,row.duty_roles));
  res.setHeader('Cache-Control','no-store');
  res.json({data,pagination:{limit,offset,total_count:rows.totalCount,has_more:offset+data.length<rows.totalCount},summary:rows.summary});
}));
router.post('/journeys',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const invalid=validateJourney(req.body);if(invalid)return res.status(400).json({error:'invalid_journey',message:invalid});
  const org=req.user.org_id,b=req.body;
  if(b.client_id){const c=await req.db('SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[b.client_id,org]);if(!c.rows.length)return res.status(404).json({error:'client_not_found_in_organisation'});}
  if(b.convoy_id){const c=await req.db('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1',[b.convoy_id,org]);if(!c.rows.length)return res.status(404).json({error:'convoy_not_found_in_organisation'});}
  const reference='SJM-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const created=await req.dbTx(async c=>{
    const x=await c.query('INSERT INTO sjm_journeys (org_id,reference,title,purpose,client_id,convoy_id,transport_mode,origin_label,origin_lat,origin_lng,destination_label,destination_lat,destination_lng,planned_departure_at,planned_arrival_at,timezone,status,created_by,updated_by,service_type,principal_reference,airport_code,terminal,airline,flight_number,flight_scheduled_at,meet_greet_instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,\'requested\',$17,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id,org_id,reference',[org,reference,txt(b.title,180),txt(b.purpose,1200),b.client_id||null,b.convoy_id||null,b.transport_mode||'road',txt(b.origin_label,180),b.origin_lat,b.origin_lng,txt(b.destination_label,180),b.destination_lat,b.destination_lng,b.planned_departure_at||null,b.planned_arrival_at||null,tzValid(b.timezone)?b.timezone:'Africa/Nairobi',req.user.id,b.service_type||'executive_transfer',txt(b.principal_reference,120)||null,txt(b.airport_code,4).toUpperCase()||null,txt(b.terminal,80)||null,txt(b.airline,100)||null,txt(b.flight_number,24).toUpperCase()||null,b.flight_scheduled_at||null,txt(b.meet_greet_instructions,2000)||null]);
    const j=x.rows[0];
    for(let i=0;i<(b.stops||[]).length;i++){const s=b.stops[i];await c.query('INSERT INTO sjm_journey_stops (org_id,journey_id,sequence,name,stop_type,lat,lng,planned_arrival_at,planned_departure_at,duration_minutes,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[org,j.id,i+1,txt(s.name,160),s.stop_type||'checkpoint',s.lat??null,s.lng??null,s.planned_arrival_at||null,s.planned_departure_at||null,s.duration_minutes??null,txt(s.instructions,1200)||null]);}
    await c.query('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,\'journey_requested\',$4,$5,\'operator\')',[org,j.id,req.user.id,'Journey requested for planning',JSON.stringify({reference,stop_count:(b.stops||[]).length})]);
    return j;
  });
  const j=await journeyById(req.db,org,created.id);res.status(201).json({data:{...j,stops:await stopsFor(req.db,org,created.id)}});
}));

router.get('/my-assignments',asyncHandler(async(req,res)=>{
 const rows=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params);
  // The list exposes VIP, flight and location details. Serialize its access
  // check with roster changes and re-read under a fresh statement snapshot.
  const initialLocks=await db(
    `SELECT j.id
       FROM sjm_journeys j
      WHERE j.org_id=$1 AND j.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM sjm_journey_participants p
           WHERE p.org_id=j.org_id AND p.journey_id=j.id
             AND p.user_id=$2 AND p.removed_at IS NULL
        )
      ORDER BY j.planned_departure_at DESC NULLS LAST,j.created_at DESC
      LIMIT 100
      FOR SHARE OF j`,
    [req.user.org_id,req.user.id],
  );
  const guarded=await readLockedAssignmentRows(db,req.user.org_id,initialLocks,"SELECT j.id,j.reference,j.title,j.purpose,j.service_type,j.status,j.transport_mode,j.origin_label,j.origin_lat,j.origin_lng,j.destination_label,j.destination_lat,j.destination_lng,j.planned_departure_at,j.planned_arrival_at,j.timezone,j.client_id,c.name AS client_name,j.convoy_id,v.name AS convoy_name,j.principal_reference,j.airport_code,j.terminal,j.airline,j.flight_number,j.flight_scheduled_at,j.flight_status,j.flight_status_source,j.flight_status_observed_at,j.flight_status_note,j.meet_greet_instructions,ARRAY(SELECT DISTINCT p2.duty_role FROM sjm_journey_participants p2 WHERE p2.org_id=j.org_id AND p2.journey_id=j.id AND p2.user_id=$2 AND p2.removed_at IS NULL ORDER BY p2.duty_role) AS duty_roles FROM sjm_journeys j LEFT JOIN cargo_clients c ON c.id=j.client_id AND c.org_id=j.org_id AND c.deleted_at IS NULL LEFT JOIN convoys v ON v.id=j.convoy_id AND v.org_id=j.org_id AND v.deleted_at IS NULL WHERE j.org_id=$1 AND j.deleted_at IS NULL AND EXISTS (SELECT 1 FROM sjm_journey_participants p WHERE p.org_id=j.org_id AND p.journey_id=j.id AND p.user_id=$2 AND p.removed_at IS NULL) ORDER BY j.planned_departure_at DESC NULLS LAST,j.created_at DESC LIMIT 100",[req.user.org_id,req.user.id]);
  if(guarded.error)return guarded;
  return guarded.rows;
 });
 if(rows.error)return res.status(409).json({error:'assignment_roster_changed',message:'The assignment roster changed repeatedly while loading this list. Refresh and retry.'});
 res.setHeader('Cache-Control','no-store');res.json({data:rows.map(row=>journeyForDutyViewer(row,[],req.user,row.duty_roles))});
}));
router.get('/journeys/:id/participants',asyncHandler(async(req,res)=>{
 const org=req.user.org_id;
 const outcome=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params);
  const locked=await lockJourneyForMobilityRead(db,org,req.params.id);
  if(!locked)return {error:'journey_not_found'};
  const j=await journeyById(db,org,req.params.id);
  if(!j)return {error:'journey_not_found'};
  const roles=await activeDutyRoles(db,org,j.id,req.user.id);
  if(!canAccessJourney(req.user,roles))return {error:'journey_not_found'};
  const r=await db("SELECT p.id,p.user_id,p.duty_role,p.is_primary,p.assigned_at,p.removed_at,u.name AS user_name,u.role AS account_role FROM sjm_journey_participants p JOIN users u ON u.id=p.user_id WHERE p.org_id=$1 AND p.journey_id=$2 AND ($3::boolean OR p.removed_at IS NULL) ORDER BY p.removed_at NULLS FIRST,p.is_primary DESC,p.duty_role,u.name LIMIT 100",[org,j.id,isMobilityManager(req.user)]);
  return {data:r.rows};
 });
 if(outcome?.error)return res.status(404).json({error:'journey_not_found'});
 res.setHeader('Cache-Control','no-store');res.json({data:outcome.data});
}));

router.put('/journeys/:id/participants',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
 const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
 const submitted=req.body?.participants;if(!Array.isArray(submitted)||submitted.length>20)return res.status(400).json({error:'invalid_participants',message:'Provide an array of no more than 20 team assignments.'});
 const seen=new Set(),primaryRoles=new Set();
 for(const p of submitted){
  if(!p||typeof p!=='object'||!SJM_ORG_UUID.test(String(p.user_id||'')))return res.status(400).json({error:'invalid_participants',message:'Every assignment needs a valid user UUID.'});
  if(!DUTY_ROLES.includes(p.duty_role))return res.status(400).json({error:'invalid_participants',message:'A duty role is not supported.'});
  if(p.is_primary!=null&&typeof p.is_primary!=='boolean')return res.status(400).json({error:'invalid_participants',message:'is_primary must be a boolean when supplied.'});
  const key=String(p.user_id).toLowerCase()+'|'+p.duty_role;if(seen.has(key))return res.status(400).json({error:'duplicate_participant_role'});seen.add(key);
  if(p.is_primary===true){if(primaryRoles.has(p.duty_role))return res.status(400).json({error:'duplicate_primary_duty_role',message:'Only one primary assignee may be set for each duty role.'});primaryRoles.add(p.duty_role);}
 }
 const ids=[...new Set(submitted.map(p=>String(p.user_id)))],keys=submitted.map(p=>String(p.user_id).toLowerCase()+'|'+p.duty_role);
 const assignedResult=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params),locked=await lockJourneyForMobility(db,org,j.id);
  if(!locked)return {error:'journey_not_found'};
  if(TERMINAL_STATUSES.includes(locked.status))return {error:'journey_terminal'};
  if(ids.length){const users=await db("SELECT id FROM users WHERE org_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL AND status='active'",[org,ids]);if(users.rows.length!==ids.length)return {error:'participant_outside_organisation_or_inactive'};}
  const activeRoster=await db('SELECT user_id,duty_role,is_primary FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND removed_at IS NULL ORDER BY user_id,duty_role FOR UPDATE',[org,j.id]);
  const beforeRoster=activeRoster.rows.map(p=>String(p.user_id).toLowerCase()+'|'+p.duty_role+'|'+(p.is_primary===true)).sort();
  const afterRoster=submitted.map(p=>String(p.user_id).toLowerCase()+'|'+p.duty_role+'|'+(p.is_primary===true)).sort();
  const rosterChanged=beforeRoster.length!==afterRoster.length||beforeRoster.some((value,index)=>value!==afterRoster[index]);
  const previousEpoch=rosterChanged?Number(locked.comms_epoch||0):null;
  let commsEpoch=Number(locked.comms_epoch||0);
  if(rosterChanged){
   const bumped=await db('UPDATE sjm_journeys SET comms_epoch=comms_epoch+1 WHERE id=$1 AND org_id=$2 RETURNING comms_epoch',[j.id,org]);
   if(!bumped.rows.length)return {error:'journey_not_found'};
   commsEpoch=Number(bumped.rows[0].comms_epoch);
  }
  await db("UPDATE sjm_journey_participants SET removed_at=NOW(),is_primary=false WHERE org_id=$1 AND journey_id=$2 AND removed_at IS NULL AND NOT ((user_id::text || '|' || duty_role)=ANY($3::text[]))",[org,j.id,keys]);
  await db("UPDATE sjm_journey_participants SET is_primary=false WHERE org_id=$1 AND journey_id=$2 AND removed_at IS NULL",[org,j.id]);
  for(const p of submitted)await db("INSERT INTO sjm_journey_participants (org_id,journey_id,user_id,duty_role,is_primary,assigned_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (org_id,journey_id,user_id,duty_role) WHERE removed_at IS NULL DO UPDATE SET is_primary=EXCLUDED.is_primary",[org,j.id,p.user_id,p.duty_role,p.is_primary===true,req.user.id]);
  const synced=await syncJourneyCommsChannel(db,org,{...j,comms_epoch:commsEpoch},req.user.id,true,previousEpoch);
  await db("INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,'team_assignment_changed',$4,$5,'operator')",[org,j.id,req.user.id,'Mission team assignments updated',JSON.stringify({assignment_count:submitted.length,assignments:submitted.map(p=>({user_id:p.user_id,duty_role:p.duty_role,is_primary:p.is_primary===true})),communications_channel_id:synced.channelId,comms_epoch:synced.commsEpoch,classification:'INTERNAL_OPERATIONS'})]);
  return synced;
 });
 if(assignedResult?.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
 if(assignedResult?.error==='journey_terminal')return res.status(409).json({error:'journey_terminal',message:'Closed, cancelled and aborted journeys cannot be reassigned.'});
 if(assignedResult?.error==='participant_outside_organisation_or_inactive')return res.status(422).json({error:'participant_outside_organisation_or_inactive',message:'Every assigned user must be an active account in this organisation.'});
 if(assignedResult.rotated)void Promise.resolve(publish('org#'+org,{type:'comms.sjm.roster_changed',channel_id:assignedResult.channelId})).catch(()=>{});
 const assigned=await req.db("SELECT p.id,p.user_id,p.duty_role,p.is_primary,p.assigned_at,p.removed_at,u.name AS user_name,u.role AS account_role FROM sjm_journey_participants p JOIN users u ON u.id=p.user_id WHERE p.org_id=$1 AND p.journey_id=$2 ORDER BY p.removed_at NULLS FIRST,p.is_primary DESC,p.duty_role,u.name LIMIT 100",[org,j.id]);
 res.setHeader('Cache-Control','no-store');res.json({data:assigned.rows,communications:{channel_id:assignedResult.channelId,realtime_channel:assignedResult.realtimeChannel,comms_epoch:assignedResult.commsEpoch}});
}));
router.get('/journeys/:id/communications',asyncHandler(async(req,res)=>{
 const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
 const outcome=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params),locked=await lockJourneyForMobility(db,org,j.id);
  if(!locked)return {error:'journey_not_found'};
  const roles=await activeDutyRoles(db,org,j.id,req.user.id);
  if(!isMobilityManager(req.user)&&!roles.length)return {error:'journey_not_found'};
  return syncJourneyCommsChannel(db,org,{...j,comms_epoch:Number(locked.comms_epoch||0)},req.user.id,isMobilityManager(req.user));
 });
 if(outcome?.error)return res.status(404).json({error:'journey_not_found'});
 if(outcome.rotated)void Promise.resolve(publish('org#'+org,{type:'comms.sjm.roster_changed',channel_id:outcome.channelId})).catch(()=>{});
 res.setHeader('Cache-Control','no-store');res.json({data:{channel_id:outcome.channelId,realtime_channel:outcome.realtimeChannel,comms_epoch:outcome.commsEpoch,transport:'Ops Comms',membership_policy:'active mission team or mission manager',messages_endpoint:'/api/v1/messages/channels/'+outcome.channelId+'/messages'}});
}));
router.get('/journeys/:id/field-events',asyncHandler(async(req,res)=>{
 const org=req.user.org_id,manager=isMobilityManager(req.user);
 const outcome=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params);
  const locked=await lockJourneyForMobilityRead(db,org,req.params.id);
  if(!locked)return {error:'journey_not_found'};
  const j=await journeyById(db,org,req.params.id);
  if(!j)return {error:'journey_not_found'};
  const roles=await activeDutyRoles(db,org,j.id,req.user.id);
  if(!canAccessJourney(req.user,roles))return {error:'journey_not_found'};
  const r=await db("SELECT id,actor_id,event_type,summary,detail,source,created_at FROM sjm_journey_events WHERE org_id=$1 AND journey_id=$2 AND event_type=ANY($3::text[]) AND ($4::boolean OR detail->>'classification'='CLIENT_SAFE' OR (detail->>'classification'='INTERNAL_OPERATIONS' AND COALESCE(detail->'duty_roles','[]'::jsonb) ?| $5::text[])) ORDER BY created_at DESC,id DESC LIMIT 60",[org,j.id,Object.keys(DUTY_EVENT_SUMMARIES),manager,roles]);
  return {data:r.rows.filter(e=>eventVisibleToDuty(e,req.user,roles))};
 });
 if(outcome?.error)return res.status(404).json({error:'journey_not_found'});
 res.setHeader('Cache-Control','no-store');res.json({data:outcome.data});
}));

router.post('/journeys/:id/field-events',asyncHandler(async(req,res)=>{
 const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
 const type=String(req.body?.event_type||''),note=req.body?.note;
 if(!DUTY_EVENT_SUMMARIES[type])return res.status(403).json({error:'duty_action_not_permitted',message:'This action is not available for this assigned duty role.'});
 if(note!=null&&(typeof note!=='string'||note.trim().length>1200))return res.status(400).json({error:'invalid_note'});
 const clean=txt(note,1200);if(['delay','vehicle_issue','incident','security_concern'].includes(type)&&clean.length<5)return res.status(400).json({error:'note_required',message:'Provide at least five characters about the issue.'});
 const outcome=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params),locked=await lockJourneyForMobility(db,org,j.id);
  if(!locked)return {error:'journey_not_found'};
  if(TERMINAL_STATUSES.includes(locked.status))return {error:'journey_terminal'};
  const roles=await activeDutyRoles(db,org,j.id,req.user.id);
  if(!roles.length)return {error:'journey_not_found'};
  if(!dutyEventAllowed(roles,type))return {error:'duty_action_not_permitted'};
  const saved=await db("INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,$4,$5,$6,'operator') RETURNING id,event_type,summary,detail,source,created_at",[org,j.id,req.user.id,type,DUTY_EVENT_SUMMARIES[type],JSON.stringify({duty_roles:roles,event_class:'FIELD_REPORTED_CHECK_IN',evidence_class:'OPERATOR_REPORTED_NOT_AUTOMATIC_GPS_PROOF',classification:'INTERNAL_OPERATIONS',note:clean||null})]);
  return {data:saved.rows[0]};
 });
 if(outcome?.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
 if(outcome?.error==='journey_terminal')return res.status(409).json({error:'journey_terminal',message:'Field updates cannot be added after journey closure, cancellation or abort.'});
 if(outcome?.error==='duty_action_not_permitted')return res.status(403).json({error:'duty_action_not_permitted',message:'This action is not available for this assigned duty role.'});
 res.status(201).json({data:outcome.data});
}));
router.patch('/journeys/:id/flight-status',asyncHandler(async(req,res)=>{
 const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
 const flight=String(req.body?.flight_status||'');if(!FLIGHT_STATUSES.includes(flight))return res.status(400).json({error:'invalid_flight_status',allowed:FLIGHT_STATUSES});
 const note=req.body?.note;if(note!=null&&(typeof note!=='string'||note.trim().length>1200))return res.status(400).json({error:'invalid_note'});
 const clean=txt(note,1200);if(['delayed','cancelled','diverted'].includes(flight)&&clean.length<5)return res.status(400).json({error:'flight_status_note_required',message:'Add context for a delayed, cancelled or diverted flight.'});
 const outcome=await req.dbTx(async c=>{
  const db=(sql,params)=>c.query(sql,params),locked=await lockJourneyForMobility(db,org,j.id);
  if(!locked)return {error:'journey_not_found'};
  if(TERMINAL_STATUSES.includes(locked.status))return {error:'journey_terminal'};
  if(!locked.flight_number)return {error:'flight_reference_required'};
  const roles=await activeDutyRoles(db,org,j.id,req.user.id);
  if(!isMobilityManager(req.user)&&!roles.some(r=>['cpo','meet_greet','dispatcher'].includes(r)))return {error:'journey_not_found'};
  const up=await db("UPDATE sjm_journeys SET flight_status=$1,flight_status_source='operator_entered',flight_status_observed_at=NOW(),flight_status_note=$2,updated_by=$3,updated_at=NOW() WHERE id=$4 AND org_id=$5 AND deleted_at IS NULL AND status NOT IN ('closed','cancelled','aborted') RETURNING id,flight_status,flight_status_source,flight_status_observed_at",[flight,clean||null,req.user.id,j.id,org]);
  if(!up.rows.length)return {error:'journey_terminal'};
  await db("INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,'flight_status_operator_update',$4,$5,'operator')",[org,j.id,req.user.id,'Flight status entered by field operator',JSON.stringify({previous_status:locked.flight_status||'unknown',flight_status:flight,evidence_class:'OPERATOR_ENTERED_UNVERIFIED',classification:'INTERNAL_OPERATIONS',note:clean||null,source:'operator_entered'})]);
  return {data:up.rows[0]};
 });
 if(outcome?.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
 if(outcome?.error==='journey_terminal')return res.status(409).json({error:'journey_terminal'});
 if(outcome?.error==='flight_reference_required')return res.status(409).json({error:'flight_reference_required',message:'Record a flight number before entering status.'});
 res.setHeader('Cache-Control','no-store');res.json({data:outcome.data,provenance:{source:'operator_entered',evidence_class:'OPERATOR_ENTERED_UNVERIFIED',provider_feed_connected:false}});
}));
router.get('/journeys/:id',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id;
  const outcome=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    const locked=await lockJourneyForMobilityRead(db,org,req.params.id);
    if(!locked)return {error:'journey_not_found'};
    const j=await journeyById(db,org,req.params.id);
    if(!j)return {error:'journey_not_found'};
    const dutyRoles=await activeDutyRoles(db,org,j.id,req.user.id);
    if(!canAccessJourney(req.user,dutyRoles))return {error:'journey_not_found'};
    const [stops,events,telemetry]=await Promise.all([
      stopsFor(db,org,j.id),
      eventsFor(db,org,j.id,200,req.user,dutyRoles),
      telemetryFor(db,org,j)
    ]);
    const assessment=parseJson(j.route_assessment,null);
    const safe=journeyForDutyViewer(j,events,req.user,dutyRoles);
    return {data:{...safe,stops,duty_roles:dutyRoles,telemetry_snapshot:telemetry,readiness_checklist:readinessChecklist(j,stops,assessment,telemetry)}};
  });
  if(outcome?.error)return res.status(404).json({error:'journey_not_found'});
  res.setHeader('Cache-Control','no-store');
  res.json({data:outcome.data});
}));

router.patch('/journeys/:id',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(!['requested','planning'].includes(j.status))return res.status(409).json({error:'journey_not_editable'});
  const b=req.body||{},stops=b.stops===undefined?await stopsFor(req.db,org,j.id):b.stops;
  const candidate={title:b.title??j.title,purpose:b.purpose??j.purpose,origin_label:b.origin_label??j.origin_label,origin_lat:b.origin_lat==null?Number(j.origin_lat):b.origin_lat,origin_lng:b.origin_lng==null?Number(j.origin_lng):b.origin_lng,destination_label:b.destination_label??j.destination_label,destination_lat:b.destination_lat==null?Number(j.destination_lat):b.destination_lat,destination_lng:b.destination_lng==null?Number(j.destination_lng):b.destination_lng,planned_departure_at:b.planned_departure_at??j.planned_departure_at,planned_arrival_at:b.planned_arrival_at??j.planned_arrival_at,timezone:b.timezone??j.timezone,service_type:b.service_type??j.service_type??'executive_transfer',principal_reference:b.principal_reference===undefined?j.principal_reference:b.principal_reference,airport_code:b.airport_code===undefined?j.airport_code:b.airport_code,terminal:b.terminal===undefined?j.terminal:b.terminal,airline:b.airline===undefined?j.airline:b.airline,flight_number:b.flight_number===undefined?j.flight_number:b.flight_number,flight_scheduled_at:b.flight_scheduled_at===undefined?j.flight_scheduled_at:b.flight_scheduled_at,meet_greet_instructions:b.meet_greet_instructions===undefined?j.meet_greet_instructions:b.meet_greet_instructions,stops};
  if(!Array.isArray(stops))return res.status(400).json({error:'invalid_journey',message:'Stops must be an array.'});
  const normalized=stops.map(s=>({...s,lat:s.lat==null?null:Number(s.lat),lng:s.lng==null?null:Number(s.lng)}));
  const invalid=validateJourney({...candidate,stops:normalized,transport_mode:b.transport_mode??j.transport_mode});if(invalid)return res.status(400).json({error:'invalid_journey',message:invalid});
  const clientId=b.client_id===undefined?j.client_id:(b.client_id||null),convoyId=b.convoy_id===undefined?j.convoy_id:(b.convoy_id||null);
  if(clientId){const r=await req.db('SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[clientId,org]);if(!r.rows.length)return res.status(404).json({error:'client_not_found_in_organisation'});}
  if(convoyId){const r=await req.db('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[convoyId,org]);if(!r.rows.length)return res.status(404).json({error:'convoy_not_found_in_organisation'});}
  const editResult=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params),locked=await lockJourneyForMobility(db,org,j.id);
    if(!locked)return {error:'journey_not_found'};
    if(!['requested','planning'].includes(locked.status))return {error:'journey_not_editable'};
    if(locked.status!==j.status)return {error:'journey_state_changed'};
    const x=await c.query('UPDATE sjm_journeys SET title=$1,purpose=$2,client_id=$3,convoy_id=$4,transport_mode=$5,origin_label=$6,origin_lat=$7,origin_lng=$8,destination_label=$9,destination_lat=$10,destination_lng=$11,planned_departure_at=$12,planned_arrival_at=$13,timezone=$14,status=\'requested\',planned_route=\'[]\'::jsonb,route_assessment=NULL,planning_started_at=NULL,assessment_pending_at=NULL,ready_for_review_at=NULL,human_review_decision=NULL,human_review_rationale=NULL,reviewed_by=NULL,reviewed_at=NULL,risk_acknowledgement=NULL,departure_readiness_acknowledgement=NULL,approved_by=NULL,approved_at=NULL,ready_to_depart_at=NULL,updated_by=$15,service_type=$18,principal_reference=$19,airport_code=$20,terminal=$21,airline=$22,flight_number=$23,flight_scheduled_at=$24,flight_status=\'unknown\',flight_status_source=\'not_recorded\',flight_status_observed_at=NULL,flight_status_note=NULL,meet_greet_instructions=$25,updated_at=NOW() WHERE id=$16 AND org_id=$17 AND status IN ($26,$27) RETURNING id',[txt(candidate.title,180),txt(candidate.purpose,1200),clientId,convoyId,b.transport_mode||j.transport_mode,txt(candidate.origin_label,180),candidate.origin_lat,candidate.origin_lng,txt(candidate.destination_label,180),candidate.destination_lat,candidate.destination_lng,candidate.planned_departure_at||null,candidate.planned_arrival_at||null,tzValid(b.timezone||j.timezone)?(b.timezone||j.timezone):'Africa/Nairobi',req.user.id,j.id,org,candidate.service_type||'executive_transfer',txt(candidate.principal_reference,120)||null,txt(candidate.airport_code,4).toUpperCase()||null,txt(candidate.terminal,80)||null,txt(candidate.airline,100)||null,txt(candidate.flight_number,24).toUpperCase()||null,candidate.flight_scheduled_at||null,txt(candidate.meet_greet_instructions,2000)||null,'requested','planning']);
    if(!x.rows.length)return {error:'journey_state_changed'};
    if(b.stops!==undefined){await c.query('DELETE FROM sjm_journey_stops WHERE org_id=$1 AND journey_id=$2',[org,j.id]);for(let i=0;i<b.stops.length;i++){const s=b.stops[i];await c.query('INSERT INTO sjm_journey_stops (org_id,journey_id,sequence,name,stop_type,lat,lng,planned_arrival_at,planned_departure_at,duration_minutes,instructions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[org,j.id,i+1,txt(s.name,160),s.stop_type||'checkpoint',s.lat??null,s.lng??null,s.planned_arrival_at||null,s.planned_departure_at||null,s.duration_minutes??null,txt(s.instructions,1200)||null]);}}
    await c.query('INSERT INTO sjm_journey_events (org_id,journey_id,actor_id,event_type,summary,detail,source) VALUES ($1,$2,$3,\'journey_revised\',$4,$5,\'operator\')',[org,j.id,req.user.id,'Journey revised; previous route assessment invalidated',JSON.stringify({revised_at:new Date().toISOString()})]);
    return {ok:true};
  });
  if(editResult?.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
  if(editResult?.error==='journey_not_editable')return res.status(409).json({error:'journey_not_editable'});
  if(editResult?.error==='journey_state_changed')return res.status(409).json({error:'journey_state_changed',message:'Another request changed this journey. Refresh before editing again.'});
  const latest=await journeyById(req.db,org,j.id);res.json({data:{...latest,stops:await stopsFor(req.db,org,j.id)}});
}));
router.post('/journeys/:id/plan',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const policyError=planRequestPolicyError(req.body);
  if(policyError)return res.status(400).json({error:'client_risk_threshold_not_authorized',message:policyError});
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
  let a;
  try {
    a=await analyseRoute({origin:{lat:Number(j.origin_lat),lng:Number(j.origin_lng)},destination:{lat:Number(j.destination_lat),lng:Number(j.destination_lng)},viaPoints,convoyId:j.convoy_id||undefined,requestedBy:req.user.id,departureTime:j.planned_departure_at||undefined,avoidNightTravel:req.body?.avoid_night_travel===true,orgId:org});
  } catch(error) {
    const errorName=error instanceof Error&&/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(error.name)?error.name:'UnknownError';
    console.error('[SJM] Route Safety analysis failed',{journeyId:j.id,errorName});
    const failure=await recordRouteAssessmentFailure(req,j,req.user.id,'provider_error');
    if(!failure.changed)return res.status(409).json({error:'journey_state_changed',message:'The journey changed while Route Safety was evaluating it; failure state was not applied.'});
    return res.status(503).json({error:'route_assessment_unavailable',message:'Route Safety did not return a usable assessment. The journey is now in exception and must be replanned after the provider issue is resolved.'});
  }
  const assessmentUsable=routeAssessmentUsable(a);
  if(!assessmentUsable) {
    const failure=await recordRouteAssessmentFailure(req,j,req.user.id,'invalid_provider_response');
    if(!failure.changed)return res.status(409).json({error:'journey_state_changed',message:'The journey changed while Route Safety was evaluating it; failure state was not applied.'});
    return res.status(503).json({error:'route_assessment_unavailable',message:'Route Safety returned an incomplete assessment. The journey is now in exception and must be replanned after the provider issue is resolved.'});
  }
  const route=Array.isArray(a.recommended_route?.waypoints)?a.recommended_route.waypoints:[];
  const gateKnown=['GO','CONDITIONAL','HUMAN_REVIEW'].includes(a.safety_gate);
  const blocked=a.route_status==='blocked'||a.recommended_route?.blocked===true||a.safety_gate==='NO_GO';
  const nextStatus=a.route_status==='routed'&&gateKnown&&!blocked?'ready_for_review':'exception';
  const save=await mutateWithEvent(req,j,req.user.id,'route_assessed',nextStatus==='ready_for_review'?'Route assessment ready for authorised review':'Route assessment raised an exception; replan required',{safety_gate:a.safety_gate,route_status:a.route_status,risk_score:a.overall_risk_score,provider:a.routing_provider,waypoint_count:route.length,via_stop_count:routeStops.length,next_status:nextStatus},'system',
    db=>db("UPDATE sjm_journeys SET planned_route=$1,route_assessment=$2,status=$3,planned_distance_km=$4,planned_duration_minutes=$5,ready_for_review_at=CASE WHEN $3='ready_for_review' THEN NOW() ELSE NULL END,exception_at=CASE WHEN $3='exception' THEN NOW() ELSE NULL END,updated_by=$6,updated_at=NOW() WHERE id=$7 AND org_id=$8 AND status='assessment_pending' RETURNING id",[JSON.stringify(route),JSON.stringify(a),nextStatus,a.recommended_route?.distance_km??null,a.recommended_route?.estimated_duration_minutes??null,req.user.id,j.id,org]));
  if(!save.changed)return res.status(409).json({error:'journey_state_changed',message:'The journey changed while Route Safety was evaluating it; assessment evidence was not attached to a different state.'});
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
  if(j.human_review_decision)return res.status(409).json({error:'route_review_already_recorded',message:'A route review decision is already recorded. Replan the journey before issuing a replacement decision.'});
  const nextStatus=decision==='reject'?'exception':'ready_for_review';
  const transition=await mutateWithEvent(req,j,req.user.id,'human_route_review',decision==='reject'?'Route review rejected; replan required':'Route review accepted with controls',{decision,rationale,safety_gate:a.safety_gate,risk_score:a.overall_risk_score,next_status:nextStatus},'operator',
    db=>db("UPDATE sjm_journeys SET human_review_decision=$1,human_review_rationale=$2,reviewed_by=$3,reviewed_at=NOW(),status=$4,exception_at=CASE WHEN $4='exception' THEN NOW() ELSE exception_at END,updated_by=$3,updated_at=NOW() WHERE id=$5 AND org_id=$6 AND status='ready_for_review' RETURNING id",[decision,rationale,req.user.id,nextStatus,j.id,org]),
    async(db,locked)=>{
      if(locked.status!==j.status||locked.status!=='ready_for_review')return {error:'journey_state_changed'};
      const snapshot=await readLockedRouteReviewSnapshot(db,org,j);
      if(!snapshot.matches||snapshot.current?.human_review_decision)return {error:'journey_state_changed'};
      const currentAssessment=parseJson(snapshot.current?.route_assessment,null);
      if(!currentAssessment||currentAssessment.route_status!=='routed'||currentAssessment.route_status==='blocked'||currentAssessment.recommended_route?.blocked===true||currentAssessment.safety_gate!=='HUMAN_REVIEW'||currentAssessment.safety_gate==='NO_GO')return {error:'journey_state_changed'};
      return null;
    });
  if(!transition.changed)return res.status(409).json({error:transition.error||'journey_state_changed'});
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.post('/journeys/:id/approve',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);if(!j)return res.status(404).json({error:'journey_not_found'});
  if(j.status!=='ready_for_review')return res.status(409).json({error:'journey_not_ready_for_review'});
  const a=parseJson(j.route_assessment,null),gate=approvalGate(a,j.human_review_decision,req.body?.risk_acknowledgement);
  if(!gate.ok)return res.status(409).json({error:gate.code,message:gate.message});
  if(j.human_review_decision==='reject')return res.status(409).json({error:'route_review_rejected'});
  const ack=txt(req.body?.risk_acknowledgement,1200)||null;
  const transition=await mutateWithEvent(req,j,req.user.id,'journey_approved','Journey approved by authorised dispatcher',{safety_gate:a.safety_gate,risk_acknowledgement_recorded:Boolean(ack),human_review_decision:j.human_review_decision||null},'operator',
    db=>db("UPDATE sjm_journeys SET status='approved',approved_by=$1,approved_at=NOW(),risk_acknowledgement=$2,updated_by=$1,updated_at=NOW() WHERE id=$3 AND org_id=$4 AND status='ready_for_review' RETURNING id",[req.user.id,ack,j.id,org]),
    async(db,locked)=>{
      if(locked.status!==j.status||locked.status!=='ready_for_review')return {error:'journey_state_changed'};
      const snapshot=await readLockedRouteReviewSnapshot(db,org,j);
      if(!snapshot.matches)return {error:'journey_state_changed'};
      const currentDecision=snapshot.current?.human_review_decision||null;
      const currentGate=approvalGate(parseJson(snapshot.current?.route_assessment,null),currentDecision,ack);
      if(!currentGate.ok||currentDecision==='reject')return {error:'journey_state_changed'};
      return null;
    });
  if(!transition.changed)return res.status(409).json({error:transition.error||'journey_state_changed'});
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.post('/journeys/:id/lifecycle',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);const dutyRoles=await requireJourneyAccess(req,res,j);if(!dutyRoles)return;
  const action=req.body?.action;
  const authorityError=lifecycleAuthorityError(req.user,dutyRoles,action);if(authorityError)return res.status(403).json(authorityError);
  if(action==='close'){
    if(j.status!=='arrival_pending_verification')return res.status(409).json({error:'arrival_verification_not_pending'});
    if(!['admin','dispatcher'].includes(String(req.user.role||'').toLowerCase()))return res.status(403).json({error:'supervisor_attestation_required',message:'Only an authorised admin or dispatcher may close a journey after recording an arrival attestation.'});
    const note=txt(req.body?.reason,1200);
    if(note.length<30)return res.status(400).json({error:'arrival_attestation_required',message:'Record at least 30 characters explaining how arrival was verified. This is a supervisor attestation, not GPS proof.'});
    const transition=await mutateWithEvent(req,j,req.user.id,'journey_closed','Journey closed after authorised arrival attestation',{verification_source:'supervisor_attestation',gps_verified:false,rationale:note},'operator',
      db=>db("UPDATE sjm_journeys SET status='closed',closed_at=NOW(),completed_at=NOW(),arrival_confirmed_at=NOW(),arrival_verification_source='supervisor_attestation',arrival_verification_note=$1,updated_by=$2,updated_at=NOW() WHERE id=$3 AND org_id=$4 AND status='arrival_pending_verification' RETURNING id",[note,req.user.id,j.id,org]),async(db,locked)=>{
        if(locked.status!==j.status)return {error:'journey_state_changed'};
        const roles=await activeDutyRoles(db,org,j.id,req.user.id);
        if(!canAccessJourney(req.user,roles))return {error:'journey_not_found'};
        if(!isMobilityManager(req.user))return {error:'lifecycle_authority_revoked',details:{error:'supervisor_attestation_required',message:'Only an authorised admin or dispatcher may close this journey.'}};
        return null;
      });
    if(transition.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
    if(transition.error==='lifecycle_authority_revoked')return res.status(403).json(transition.details);
    if(!transition.changed)return res.status(409).json({error:'journey_state_changed'});
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
  const transition=await mutateWithEvent(req,j,req.user.id,'journey_'+action,summaries[action]||'Journey lifecycle updated',{reason:reason||null,previous_status:j.status,next_status:step.to,readiness_acknowledgement:action==='ready_to_depart'?readiness:null,confirmed_outstanding_stops:req.body?.confirm_outstanding_stops===true,route_and_approval_invalidated:step.clearPlan===true},'operator',db=>db(sql,params),async(db,locked)=>{
    if(locked.status!==j.status)return {error:'journey_state_changed'};
    const roles=await activeDutyRoles(db,org,j.id,req.user.id);
    if(!canAccessJourney(req.user,roles))return {error:'journey_not_found'};
    const currentAuthority=lifecycleAuthorityError(req.user,roles,action);
    if(currentAuthority)return {error:'lifecycle_authority_revoked',details:currentAuthority};
    return null;
  });
  if(transition.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
  if(transition.error==='lifecycle_authority_revoked')return res.status(403).json(transition.details);
  if(!transition.changed)return res.status(409).json({error:'journey_state_changed'});
  res.json({data:await journeyById(req.db,org,j.id)});
}));
router.patch('/journeys/:id/stops/:stopId/status',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);const dutyRoles=await requireJourneyAccess(req,res,j);if(!dutyRoles)return;
  if(!isMobilityManager(req.user)&&!dutyRoles.some(role=>['driver','backup_driver'].includes(role)))return res.status(403).json({error:'driver_authority_required',message:'Stop completion is a driver duty. CPOs and security escorts should submit their duty-specific field check-ins.'});
  if(!['in_progress','paused','arrival_pending_verification'].includes(j.status))return res.status(409).json({error:'journey_not_active_for_stop_confirmation'});
  const status=req.body?.status;if(!['reached','skipped'].includes(status))return res.status(400).json({error:'invalid_stop_status'});
  const hasLat=req.body?.actual_lat!=null,hasLng=req.body?.actual_lng!=null;if(hasLat!==hasLng||(hasLat&&!validCoordinate(req.body.actual_lat,req.body.actual_lng)))return res.status(400).json({error:'invalid_actual_coordinates'});
  const write=await mutateWithEvent(req,j,req.user.id,'stop_'+status,row=>'Stop '+status+': '+row.name,row=>({stop_id:row.id,sequence:row.sequence,actual_coordinates_supplied:hasLat}),'operator',
    db=>db("UPDATE sjm_journey_stops SET stop_status=$1,confirmed_at=NOW(),actual_lat=$2,actual_lng=$3,confirmation_source='operator_confirmed' WHERE id=$4 AND journey_id=$5 AND org_id=$6 AND stop_status='planned' RETURNING id,sequence,name,stop_status,confirmed_at,actual_lat,actual_lng,confirmation_source",[status,hasLat?req.body.actual_lat:null,hasLng?req.body.actual_lng:null,req.params.stopId,j.id,org]),async(db,locked)=>{
      if(locked.status!==j.status)return {error:'journey_state_changed'};
      if(!['in_progress','paused','arrival_pending_verification'].includes(locked.status))return {error:'journey_not_active_for_stop_confirmation'};
      const roles=await activeDutyRoles(db,org,j.id,req.user.id);
      if(!canAccessJourney(req.user,roles))return {error:'journey_not_found'};
      if(!isMobilityManager(req.user)&&!roles.some(role=>['driver','backup_driver'].includes(role)))return {error:'driver_authority_required',details:{error:'driver_authority_required',message:'Stop completion is a driver duty. CPOs and security escorts should submit their duty-specific field check-ins.'}};
      return null;
    });
  if(write.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
  if(write.error==='journey_not_active_for_stop_confirmation')return res.status(409).json({error:'journey_not_active_for_stop_confirmation'});
  if(write.error==='driver_authority_required')return res.status(403).json(write.details);
  if(write.error==='journey_state_changed')return res.status(409).json({error:'journey_state_changed'});
  if(!write.changed)return res.status(404).json({error:'stop_not_found_or_already_resolved'});
  return res.json({data:write.result.rows[0],evidence_class:'OPERATOR_CONFIRMED'});
}));
router.post('/journeys/:id/events',authorize('admin','dispatcher'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,j=await journeyById(req.db,org,req.params.id);const dutyRoles=await requireJourneyAccess(req,res,j);if(!dutyRoles)return;
  if(TERMINAL_STATUSES.includes(j.status))return res.status(409).json({error:'journey_closed'});
  const type=req.body?.event_type,summary=txt(req.body?.summary,500);if(!EVENT_TYPES.includes(type)||summary.length<4)return res.status(400).json({error:'invalid_operational_event',allowed_event_types:EVENT_TYPES});
  const detail={note:txt(req.body?.detail,2000),severity:['low','medium','high','critical'].includes(req.body?.severity)?req.body.severity:null,classification:classificationForGenericEvent(type),publication_authority:type==='client_update'?'admin_or_dispatcher':null};
  const r=await event(req.db,j,req.user.id,type,summary,detail,'operator');res.status(201).json({data:{id:r.rows[0].id,created_at:r.rows[0].created_at,event_type:type,summary,detail,source:'operator'}});
}));
router.post('/journeys/:id/reports',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id,jid=req.params.id,type=req.body?.report_type||'daily';
  if(!/^[0-9a-f-]{36}$/i.test(String(jid)))return res.status(400).json({error:'invalid_journey_id'});
  if(!REPORT_TYPES.includes(type))return res.status(400).json({error:'invalid_report_type',allowed:REPORT_TYPES});
  if(req.body?.report_date!=null&&!validDateOnly(req.body.report_date))return res.status(400).json({error:'invalid_report_date',message:'report_date must be a real calendar date in YYYY-MM-DD format.'});
  const result=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    await db('SELECT id FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE',[jid,org]);
    const j=await journeyById(db,org,jid);
    if(!j)return {error:'journey_not_found'};
    const dutyRoles=await activeDutyRoles(db,org,j.id,req.user.id);if(!canAccessJourney(req.user,dutyRoles))return {error:'journey_not_found'};
    if(type==='closeout'&&j.status!=='closed')return {error:'closeout_requires_closed_journey'};
    await db('SELECT id FROM sjm_journey_stops WHERE org_id=$1 AND journey_id=$2 FOR SHARE',[org,j.id]);
    const p=j.client_id?await db('SELECT report_timezone FROM sjm_client_profiles WHERE org_id=$1 AND client_id=$2 LIMIT 1',[org,j.client_id]):{rows:[]};
    const timezone=p.rows[0]?.report_timezone||j.timezone||'Africa/Nairobi';
    const date=req.body?.report_date||dateInTimezone(new Date(),timezone);
    const snapshot=await reportSnapshot(db,org,j,type,date);
    const write=await db('INSERT INTO sjm_reports (org_id,journey_id,report_type,report_date,schema_version,data,generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,journey_id,report_type,report_date,generated_at',[org,j.id,type,date,snapshot.schema_version,JSON.stringify(snapshot),req.user.id]);
    const row=write.rows[0];
    await event(db,j,req.user.id,'report_generated','SJM '+type+' report generated',{report_id:row.id,report_date:date,schema_version:snapshot.schema_version},'operator');
    return {data:row,snapshot};
  });
  if(result.error==='journey_not_found')return res.status(404).json({error:'journey_not_found'});
  if(result.error==='closeout_requires_closed_journey')return res.status(409).json({error:result.error,message:'Generate a closeout report only after the journey has been closed with its required arrival attestation.'});
  res.status(201).json({data:result.data,snapshot:result.snapshot});
}));
router.get('/reports/:reportId',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id;
  const outcome=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    const r=await db('SELECT id,journey_id,report_type,report_date,schema_version,data,generated_at FROM sjm_reports WHERE id=$1 AND org_id=$2 LIMIT 1',[req.params.reportId,org]);
    if(!r.rows.length)return {error:'report_not_found'};
    const reportRow=r.rows[0];
    if(reportRow.journey_id){
      const locked=await lockJourneyForMobilityRead(db,org,reportRow.journey_id);
      if(!locked)return {error:'report_not_found'};
    }
    const dutyRoles=reportRow.journey_id?await activeDutyRoles(db,org,reportRow.journey_id,req.user.id):[];
    if(!canAccessReport(req.user,reportRow,dutyRoles))return {error:'report_not_found'};
    return {data:{...reportRow,data:parseJson(reportRow.data,{})}};
  });
  if(outcome?.error)return res.status(404).json({error:'report_not_found'});
  res.setHeader('Cache-Control','no-store');res.json({data:outcome.data});
}));
router.get('/reports/:reportId/download',authorize('admin','dispatcher','operator','analyst'),asyncHandler(async(req,res)=>{
  const org=req.user.org_id;
  const outcome=await req.dbTx(async c=>{
    const db=(sql,params)=>c.query(sql,params);
    const r=await db('SELECT id,journey_id,data,report_type,report_date FROM sjm_reports WHERE id=$1 AND org_id=$2 LIMIT 1',[req.params.reportId,org]);
    if(!r.rows.length)return {error:'report_not_found'};
    const reportRow=r.rows[0];
    if(reportRow.journey_id){
      const locked=await lockJourneyForMobilityRead(db,org,reportRow.journey_id);
      if(!locked)return {error:'report_not_found'};
    }
    const dutyRoles=reportRow.journey_id?await activeDutyRoles(db,org,reportRow.journey_id,req.user.id):[];
    if(!canAccessReport(req.user,reportRow,dutyRoles))return {error:'report_not_found'};
    return {data:{...reportRow,data:parseJson(reportRow.data,{})}};
  });
  if(outcome?.error)return res.status(404).json({error:'report_not_found'});
  const reportRow=outcome.data,report=reportRow.data,format=String(req.query.format||'PDF').toUpperCase(),name=('sonalit-sjm-'+(report.journey?.reference||reportRow.id)+'-'+(reportRow.report_date||'report')).replace(/[^a-z0-9-]/gi,'-');
  res.setHeader('Cache-Control','no-store');
  if(format==='CSV'){res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="'+name+'.csv"');return res.send('\uFEFF'+toCsv(report));}
  if(format!=='PDF')return res.status(400).json({error:'unsupported_report_format',allowed:['PDF','CSV']});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="'+name+'.pdf"');
  const doc=new PDFDocument({size:'A4',margin:42});doc.pipe(res);renderPdf(doc,report);
}));

module.exports=router;
module.exports.__scheduler={reportSnapshot,dateInTimezone};
module.exports.__test={validCoordinate,validateStop,validateJourney,validateServiceDetails,dutyEventAllowed,isMobilityManager,canAccessJourney,canAccessReport,lifecycleAuthorityError,isInternalOperationalEvent,isClientSafeEvent,classificationForGenericEvent,eventVisibleToDuty,journeyForViewer,journeyForDutyViewer,approvalGate,dateInTimezone,validDateOnly,csvCell,toCsv,lifecycleTransition,DEFAULT_TEMPLATE,SECTIONS,REPORT_TYPES,REPORT_TITLES,dailyReportSchedulerAvailable,mutateWithEvent,recordRouteAssessmentFailure,freshnessFor,latestObservedAt,telemetryFor,readinessChecklist,changeEventsFor,managementSummaryCounts,eventsForReport,planRequestPolicyError,enabledReportSections,reportFocusSections,journeyRegisterFilterSql,journeyRegisterOrderSql,sameRouteReviewSnapshot,readLockedRouteReviewSnapshot,lockJourneyForMobility,lockJourneyForMobilityRead,readLockedAssignmentRows,routeAssessmentUsable,syncJourneyCommsChannel};
