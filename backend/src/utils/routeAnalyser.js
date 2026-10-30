'use strict';

const logger = require('./logger');
const { query } = require('../config/database');
const { mapboxToken, osrmUrl } = require('../services/geo/providerEnv');
const { planRouteAlternatives } = require('../services/geo/routePlan');
const { rankRoutes } = require('../services/geo/routeRisk');
const { runSwarm } = require('../services/geo/routeSafetySwarm');

const ROUTE_ANALYSIS_VERSION = 'route-safety-v3';
const ROUTE_CACHE_MINUTES = 15;

function clamp(n, min=0, max=100){ return Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : min)); }
function riskBand(score){ if(score>=70)return 'critical'; if(score>=40)return 'elevated'; if(score>=20)return 'guarded'; return 'low'; }
function riskFactorsFromExposures(exposures=[]){
  const out=new Set();
  for(const e of exposures){
    const type=String(e.zone_type||'').toLowerCase(); const level=String(e.risk_level||'').toLowerCase();
    if(['armed_robbery','banditry','carjacking','security'].some(x=>type.includes(x))||['high','critical','no_go'].includes(level)) out.add(type.includes('carjack')?'carjacking':'armed_robbery');
    else if(['weather','flood','storm','landslide'].some(x=>type.includes(x))) out.add('weather');
    else if(['protest','civil_unrest','riot','demonstration'].some(x=>type.includes(x))) out.add('civil_unrest');
    else if(['road','construction','closure','condition'].some(x=>type.includes(x))) out.add('road_condition');
    else out.add('other');
  }
  return [...out].slice(0,6);
}
async function fetchNearbyRiskZones(orgId,waypoints){
  const points=Array.isArray(waypoints)?waypoints.filter(p=>p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))):[];
  if(!points.length)return {rows:[]};
  const pad=1.75;
  const minLat=Math.max(-90,Math.min(...points.map(p=>Number(p.lat)))-pad), maxLat=Math.min(90,Math.max(...points.map(p=>Number(p.lat)))+pad);
  const minLng=Math.max(-180,Math.min(...points.map(p=>Number(p.lng)))-pad), maxLng=Math.min(180,Math.max(...points.map(p=>Number(p.lng)))+pad);
  const result=await query(`SELECT id,name,why,risk_level,zone_type,lat,lng,radius_km,confidence,velocity,active,is_active,level_source
    FROM risk_zones WHERE org_id=$1 AND COALESCE(is_active,active,true)=true
    AND lat BETWEEN $2 AND $3 AND lng BETWEEN $4 AND $5
    ORDER BY CASE LOWER(COALESCE(risk_level,'medium')) WHEN 'no_go' THEN 1 WHEN 'critical' THEN 2 WHEN 'high' THEN 3 WHEN 'medium' THEN 4 ELSE 5 END LIMIT 200`,
    [orgId,minLat,maxLat,minLng,maxLng]);
  return Array.isArray(result)?result:(Array.isArray(result?.rows)?result.rows:[]);
}
function makeFallbackRoute(waypoints){ return {route:Array.isArray(waypoints)?waypoints:[],provider:'direct-fallback',distance_km:null,duration_min:null,routed:false}; }
function toRouteOption(candidate,label){
  const routed=candidate.routed!==false,exposures=routed?(candidate.exposures||[]):[];
  const riskScore=routed?clamp(candidate.blocked?100:candidate.score):null;
  const blocked=routed&&Boolean(candidate.blocked);
  const notes=!routed?'Road routing unavailable. No routed geometry, road distance, duration or route risk score is available. Do not release this journey until Route Safety produces a routed assessment.':blocked?'This route intersects a no-go risk zone and is blocked from normal selection.':exposures.length?`${exposures.length} mapped risk zone exposure(s); see route evidence for detail.`:'No mapped active risk-zone exposure detected.';
  return {label,waypoints:candidate.route,distance_km:routed?Number(candidate.distance_km??0):null,estimated_duration_minutes:routed?Math.max(0,Math.round(candidate.duration_min??0)):null,risk_score:riskScore,risk_factors:riskFactorsFromExposures(exposures),blocked,risk_exposures:exposures,notes};
}

async function analyseRoute({origin,destination,viaPoints=[],convoyId,requestedBy,departureTime,avoidNightTravel,maxRiskScore,orgId}){
  const waypoints=[origin,...(Array.isArray(viaPoints)?viaPoints:[]),destination];
  const hasViaPoints=Array.isArray(viaPoints)&&viaPoints.length>0;
  const constrained=Boolean(departureTime)||Boolean(avoidNightTravel)||maxRiskScore!=null;
  if(!constrained&&!hasViaPoints){
    const cachedResult=await query(`SELECT * FROM route_analyses WHERE org_id=$1 AND (($2::uuid IS NULL AND convoy_id IS NULL) OR convoy_id=$2) AND origin_lat=$3 AND origin_lng=$4 AND destination_lat=$5 AND destination_lng=$6 AND analysed_at>NOW()-make_interval(mins=>$7) ORDER BY analysed_at DESC LIMIT 1`,[orgId,convoyId??null,origin.lat,origin.lng,destination.lat,destination.lng,ROUTE_CACHE_MINUTES]);
    const cachedRows=Array.isArray(cachedResult)?cachedResult:(Array.isArray(cachedResult?.rows)?cachedResult.rows:[]);
    if(cachedRows[0])return {...cachedRows[0],cache_hit:true};
  }

  const zones=await fetchNearbyRiskZones(orgId,waypoints);
  const routing=await planRouteAlternatives(waypoints,{mapboxToken:mapboxToken(),osrmUrl:osrmUrl(),maxPoints:300});
  const routedCandidates=(Array.isArray(routing)?routing:[]).filter(candidate=>candidate&&candidate.routed!==false&&Array.isArray(candidate.route)&&candidate.route.length>=2);
  const hasRoutedAlternative=routedCandidates.length>0;
  const candidates=hasRoutedAlternative?routedCandidates:[makeFallbackRoute(waypoints)];
  // Do not score or ask the AI selector to judge a straight-line waypoint preview as if it were a road route.
  const ranked=hasRoutedAlternative?rankRoutes(candidates,zones):{ranked:candidates,all_blocked:false};
  const constrainedRoutes=!hasRoutedAlternative?ranked.ranked:(maxRiskScore==null?ranked.ranked:ranked.ranked.filter(c=>!c.blocked&&Number(c.score)<=Number(maxRiskScore)));
  const selected=constrainedRoutes.length?constrainedRoutes:ranked.ranked;
  const primary=selected[0];
  const options=selected.slice(0,3).map((c,i)=>toRouteOption(c,!hasRoutedAlternative?'Unrouted waypoint reference':i===0?'Recommended safety route':`Alternative ${i}`));
  const best=options[0];
  const allRoutesBlocked=Boolean(ranked.all_blocked);
  const maxRiskExceeded=maxRiskScore!=null&&(best?.risk_score==null||Number(best.risk_score)>Number(maxRiskScore));

  let swarm=null;
  if(hasRoutedAlternative)try{ swarm=await runSwarm({origin,destination,departureTime,avoidNightTravel,maxRiskScore:maxRiskScore==null?null:Number(maxRiskScore),candidates:options,zones:zones.slice(0,100)}); }
  catch(err){ logger.warn({err},'Route Safety swarm unavailable; deterministic result retained'); }

  const swarmLevel=swarm?.arbiter?.risk_level||null;
  const hardStop=!hasRoutedAlternative||allRoutesBlocked||maxRiskExceeded||swarm?.consensus?.hard_block||swarmLevel==='CRITICAL';
  const safetyGate=hardStop?'HUMAN_REVIEW':(swarm?.arbiter?.go_no_go||'CONDITIONAL');
  return {
    org_id:orgId,convoy_id:convoyId??null,origin_lat:origin.lat,origin_lng:origin.lng,destination_lat:destination.lat,destination_lng:destination.lng,
    overall_risk_score:best.risk_score,primary_risk_factors:riskFactorsFromExposures(primary?.exposures??[]),recommended_route:best,alternate_routes:options.slice(1),
    ai_summary:!hasRoutedAlternative?'Road-routing providers returned no route. Route risk is UNAVAILABLE; the displayed waypoints are not road geometry and this journey is not approved for release.':swarm?.arbiter?.route_selection_reason||`Deterministic route assessment: ${riskBand(best.risk_score)} risk based on current mapped route exposure and road-routing evidence.`,
    safety_gate:safetyGate,
    swarm:swarm?{version:swarm.version,agent_count:swarm.agent_count,providers:[...new Set((swarm.reports||[]).map(r=>r.provider).filter(Boolean).concat([swarm.arbiter?.provider,swarm.critic?.provider].filter(Boolean)))],confidence:swarm.consensus?.confidence??0,hard_block:Boolean(swarm.consensus?.hard_block),aggregated_risks:swarm.aggregated_risks||[],arbiter:swarm.arbiter||null,critic:swarm.critic?{provider:swarm.critic.provider,status:swarm.critic.status,finding:swarm.critic.finding,contradictions:swarm.critic.contradictions,evidence_gaps:swarm.critic.evidence_gaps}:null}:null,
    requested_by:requestedBy??null,analysis_version:ROUTE_ANALYSIS_VERSION,routing_provider:primary?.provider||'unknown',route_status:!hasRoutedAlternative?'unrouted':primary?.blocked?'blocked':(primary?.routed===false?'unrouted':'routed'),risk_zone_count:zones.length,cache_hit:false,
    constraint_status:{max_risk_score:maxRiskScore==null?null:Number(maxRiskScore),max_risk_exceeded:maxRiskExceeded,all_routes_blocked:allRoutesBlocked,risk_score_available:best?.risk_score!=null},
  };
}
module.exports={analyseRoute,ROUTE_ANALYSIS_VERSION};