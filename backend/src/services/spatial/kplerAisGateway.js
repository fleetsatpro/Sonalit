'use strict';
const {BoundedTtlCache,CircuitBreaker,RequestBudget,clampInt,fetchJsonWithTimeout,isValidBbox,bboxKey,runBudgeted}=require('./externalProviderUtils');
const URL='https://api.sml.kpler.com/graphql';
const cache=new BoundedTtlCache(30000,96), inflight=new Map(), circuit=new CircuitBreaker(5,30000), budget=new RequestBudget(6,2);
const health={providerId:'kpler-ais',status:'AUTH_REQUIRED',lastSuccessAt:null,lastAttemptAt:null,lastErrorClass:null,lastErrorMessage:null,recordCount:0,acceptedCount:0,rejectedCount:0,requestCount:0,cacheHits:0,dedupeHits:0};
function c01(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
function iso(v){if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function normalizeVessel(node,receivedAt){
  const p=node&&node.lastPositionUpdate||{}, s=node&&node.staticData||{};
  const lat=Number(p.latitude), lng=Number(p.longitude);
  if (p.latitude == null || p.longitude == null || p.latitude === '' || p.longitude === '') return null;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;
  const ref=String(s.mmsi||s.imo||(node&&node.id)||'').trim(); if(!ref)return null;
  const observedAt=iso(p.timestamp), age=observedAt?Math.max(0,Date.parse(receivedAt)-Date.parse(observedAt)):null;
  const quality=observedAt?(age<=45000?'LIVE':age<=180000?'DELAYED':'STALE'):'UNKNOWN';
  const conf=p.accuracy===1?0.95:0.82;
  return {id:'kpler:vessel:'+ref,entityType:'vessel',source:'kpler-ais',sourceReference:ref,latitude:lat,longitude:lng,altitudeM:null,observedAt,receivedAt,freshnessMs:age,observationConfidence:conf,interpretationConfidence:0.96,operationalConfidence:c01(conf*0.92),accuracyM:p.accuracy===1?10:null,confidence:conf,headingDeg:Number.isFinite(Number(p.heading))?Number(p.heading):null,speedMps:Number.isFinite(Number(p.speed))?Number(p.speed)*0.514444:null,status:p.navigationalStatus||null,attributes:{name:s.name||null,mmsi:s.mmsi||null,imo:s.imo||null,shipType:s.shipType||null,flag:s.flag||null,callsign:s.callsign||null,course:Number.isFinite(Number(p.course))?Number(p.course):null,collectionType:p.collectionType||null,navigationalStatus:p.navigationalStatus||null,rot:Number.isFinite(Number(p.rot))?Number(p.rot):null,maneuver:p.maneuver||null,providerUpdateAt:iso(p.updateTimestamp),destination:node?.currentVoyage?.destination||null,eta:iso(node?.currentVoyage?.eta),voyageUpdatedAt:iso(node?.currentVoyage?.updateTimestamp),matchedPortMatchScore:Number.isFinite(Number(node?.currentVoyage?.matchedPort?.matchScore))?Number(node.currentVoyage.matchedPort.matchScore):null,matchedPortName:node?.currentVoyage?.matchedPort?.port?.name||null,matchedPortUnlocode:node?.currentVoyage?.matchedPort?.port?.unlocode||null,matchedPortLatitude:Number.isFinite(Number(node?.currentVoyage?.matchedPort?.port?.centerPoint?.latitude))?Number(node.currentVoyage.matchedPort.port.centerPoint.latitude):null,matchedPortLongitude:Number.isFinite(Number(node?.currentVoyage?.matchedPort?.port?.centerPoint?.longitude))?Number(node.currentVoyage.matchedPort.port.centerPoint.longitude):null},provenance:{sourceName:'Kpler AIS',sourceUrl:URL,observationType:'ais_vessel_position',sourceReference:ref},coverage:{complete:false,bounded:true,queryScope:'organisation-requested spatial AOI'},quality:{state:quality==='LIVE'?'good':quality==='DELAYED'?'degraded':quality==='STALE'?'stale':'unknown',freshnessClass:quality,reason:observedAt?undefined:'AIS position timestamp unavailable'}};
}
function polygon(b){return {polygon:{type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]}};}
async function queryProvider(bbox,maxRecords,signal){
  const token=String(process.env.KPLER_AIS_TOKEN||'').trim(); if(!token){const e=new Error('KPLER_AIS_TOKEN is not configured');e.failureClass='auth_required';throw e;}
  const query='query SonalitVessels($first:Int,$aoi:AreaOfInterest,$window:TimeRange){ vessels(first:$first,areaOfInterest:$aoi,lastPositionUpdate:$window){ pageInfo{hasNextPage endCursor} nodes{ id staticData{name mmsi imo shipType flag callsign} lastPositionUpdate{timestamp updateTimestamp latitude longitude heading speed accuracy course collectionType navigationalStatus rot maneuver} } currentVoyage{destination eta timestamp updateTimestamp matchedPort{matchScore port{name unlocode centerPoint{latitude longitude}}}} } } }';
  const end=new Date(), start=new Date(end.getTime()-600000);
  const body=JSON.stringify({query,variables:{first:clampInt(maxRecords,1,250,100),aoi:polygon(bbox),window:{startTime:start.toISOString(),endTime:end.toISOString()}}});
  const res=await fetchJsonWithTimeout(URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body,signal},8000);
  if(Array.isArray(res.data&&res.data.errors)&&res.data.errors.length){const e=new Error(String(res.data.errors[0].message||'Kpler GraphQL error'));e.failureClass='http_error';throw e;}
  const collection=res.data&&res.data.data&&res.data.data.vessels; if(!collection||!Array.isArray(collection.nodes)){const e=new Error('Kpler returned malformed vessel data');e.failureClass='malformed';throw e;}
  const receivedAt=new Date().toISOString(); return {observations:collection.nodes.map(n=>normalizeVessel(n,receivedAt)).filter(Boolean),partial:Boolean(collection.pageInfo&&collection.pageInfo.hasNextPage)};
}
async function getVesselsInBbox({bbox,maxRecords=100,signal}){
  if(!isValidBbox(bbox)){const e=new Error('Invalid AIS bbox');e.failureClass='malformed';throw e;}
  if(!String(process.env.KPLER_AIS_TOKEN||'').trim())return {observations:[],coverage:{complete:false,queryScope:'kpler AIS not configured'},health:getProviderHealth()};
  const key=bboxKey(bbox)+':'+clampInt(maxRecords,1,250,100), fresh=cache.get(key);
  if(fresh){health.cacheHits++;return {observations:fresh.value.observations,coverage:fresh.value.coverage,health:getProviderHealth(),cache:{hit:true,ageMs:Date.now()-fresh.createdAt}};}
  if(inflight.has(key)){health.dedupeHits++;const v=await inflight.get(key);return Object.assign({},v,{health:getProviderHealth(),cache:{hit:true}});}
  const task=(async()=>{
    health.lastAttemptAt=new Date().toISOString();health.requestCount++;
    try{
      const result=await runBudgeted(budget,circuit,()=>queryProvider(bbox,maxRecords,signal));
      health.status=result.observations.length?'LIVE':'PARTIAL';health.lastSuccessAt=new Date().toISOString();health.lastErrorClass=null;health.lastErrorMessage=null;health.recordCount=result.observations.length;health.acceptedCount=result.observations.length;health.rejectedCount=0;
      const value={observations:result.observations,coverage:{complete:!result.partial,omittedCount:result.partial?1:0,queryScope:'Kpler AIS vessel positions within bbox and 10-minute update window'}};cache.set(key,value);return value;
    }catch(error){
      health.status=error.failureClass==='rate_limited'?'RATE_LIMITED':error.failureClass==='auth_required'?'AUTH_REQUIRED':'UNAVAILABLE';health.lastErrorClass=error.failureClass||'unknown';health.lastErrorMessage=error.message;
      const stale=cache.getStale(key);if(stale&&Date.now()-stale.createdAt<=300000){health.status='STALE';return {observations:stale.value.observations,coverage:Object.assign({},stale.value.coverage,{queryScope:stale.value.coverage.queryScope+' (stale cache fallback)'}),cache:{hit:true,ageMs:Date.now()-stale.createdAt}};}throw error;
    }
  })();
  inflight.set(key,task);try{const v=await task;return Object.assign({},v,{health:getProviderHealth(),cache:{hit:false}});}finally{inflight.delete(key);}
}
function getProviderHealth(){return Object.assign({},health,{status:String(process.env.KPLER_AIS_TOKEN||'').trim()?health.status:'AUTH_REQUIRED',rateLimitRemaining:budget.remaining(),activeRequests:budget.active,circuitState:circuit.state,circuitFailures:circuit.failures});}
module.exports={getVesselsInBbox,getProviderHealth,normalizeVessel};