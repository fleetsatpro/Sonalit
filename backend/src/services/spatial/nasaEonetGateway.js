'use strict';
const {BoundedTtlCache,CircuitBreaker,RequestBudget,fetchJsonWithTimeout,clampInt,isValidBbox,bboxKey,runBudgeted}=require('./externalProviderUtils');
const URL='https://eonet.gsfc.nasa.gov/api/v3/events';
const cache=new BoundedTtlCache(300000,64),inflight=new Map(),circuit=new CircuitBreaker(5,60000),budget=new RequestBudget(12,2);
const health={providerId:'nasa-eonet',status:'UNKNOWN',lastSuccessAt:null,lastAttemptAt:null,lastErrorClass:null,lastErrorMessage:null,recordCount:0,acceptedCount:0,rejectedCount:0,requestCount:0,cacheHits:0,dedupeHits:0};
function iso(v){if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function collectPoints(value,out){
 if(Array.isArray(value)){if(value.length>=2&&Number.isFinite(Number(value[0]))&&Number.isFinite(Number(value[1]))&&Math.abs(Number(value[0]))<=180&&Math.abs(Number(value[1]))<=90){out.push({lng:Number(value[0]),lat:Number(value[1])});return;}for(const v of value)collectPoints(v,out);}
}
function representativePoint(geometry){
 const points=[];if(geometry)collectPoints(geometry.coordinates,points);if(!points.length)return null;
 return {lat:points.reduce((a,p)=>a+p.lat,0)/points.length,lng:points.reduce((a,p)=>a+p.lng,0)/points.length,derived:!(geometry&&geometry.type==='Point')};
}
function normalizeEvent(event,receivedAt){
 const geometry=Array.isArray(event&&event.geometry)?event.geometry[event.geometry.length-1]:null;const point=representativePoint(geometry);if(!point)return null;
 const category=(event.categories&&event.categories[0])||{};const ref=String(event.id||'');if(!ref)return null;
 const observedAt=iso(geometry&&geometry.date);const title=String(event.title||'Natural event');
 const key=String(category.id||category.title||'other').toLowerCase().replace(/[^a-z0-9_-]+/g,'_');
 const severity=/wildfire|fire|severe storm|flood|landslide|volcano|earthquake|dust/i.test(title+' '+String(category.title||''))?'high':'medium';
 return {id:'nasa:eonet:'+ref,entityType:'natural_hazard',source:'nasa-eonet',sourceReference:ref,latitude:point.lat,longitude:point.lng,altitudeM:null,observedAt,receivedAt,freshnessMs:observedAt?Math.max(0,Date.parse(receivedAt)-Date.parse(observedAt)):null,observationConfidence:0.9,interpretationConfidence:point.derived?0.72:0.92,operationalConfidence:point.derived?0.62:0.76,accuracyM:null,confidence:0.9,headingDeg:null,speedMps:null,status:event.closed?'closed':'open',attributes:{title,description:event.description||null,categoryId:category.id||null,categoryTitle:category.title||null,eventLink:event.link||null,closedAt:iso(event.closed),geometryType:geometry&&geometry.type||null,representativePointDerived:point.derived,severity,key},provenance:{sourceName:'NASA EONET',sourceUrl:URL,observationType:'external_natural_event',sourceReference:ref},coverage:{complete:false,bounded:true,queryScope:'open NASA EONET events intersecting requested bbox'},quality:{state:observedAt?'good':'degraded',freshnessClass:observedAt?((Date.parse(receivedAt)-Date.parse(observedAt))<=300000?'LIVE':'STALE'):'UNKNOWN',reason:point.derived?'Representative point is centroid-like average of provider geometry.':observedAt?undefined:'EONET geometry timestamp unavailable'}};
}
async function queryProvider(bbox,signal){
 const u=new URL(URL);u.searchParams.set('status','open');u.searchParams.set('days','7');u.searchParams.set('limit','200');u.searchParams.set('bbox',[bbox[0],bbox[3],bbox[2],bbox[1]].join(','));
 const r=await fetchJsonWithTimeout(u.toString(),{method:'GET',headers:{Accept:'application/json'},signal},8000);
 if(!r.data||!Array.isArray(r.data.events)){const e=new Error('NASA EONET returned malformed event data');e.failureClass='malformed';throw e;}
 const receivedAt=new Date().toISOString();return r.data.events.map(e=>normalizeEvent(e,receivedAt)).filter(Boolean);
}
async function getNaturalHazards({bbox,maxRecords=100,signal}){
 if(!isValidBbox(bbox)){const e=new Error('Invalid natural hazard bbox');e.failureClass='malformed';throw e;}
 const key=bboxKey(bbox);const fresh=cache.get(key);if(fresh){health.cacheHits++;return {observations:fresh.value,coverage:{complete:true,queryScope:'NASA EONET open events within bbox'},health:getProviderHealth(),cache:{hit:true,ageMs:Date.now()-fresh.createdAt}};}
 if(inflight.has(key)){health.dedupeHits++;return Object.assign({},await inflight.get(key),{health:getProviderHealth(),cache:{hit:true}});}
 const task=(async()=>{health.lastAttemptAt=new Date().toISOString();health.requestCount++;try{const observations=await runBudgeted(budget,circuit,()=>queryProvider(bbox,signal));health.status=observations.length?'LIVE':'PARTIAL';health.lastSuccessAt=new Date().toISOString();health.lastErrorClass=null;health.lastErrorMessage=null;health.recordCount=observations.length;health.acceptedCount=observations.length;const value=observations.slice(0,clampInt(maxRecords,1,250,100));cache.set(key,value);return value;}catch(error){health.status=error.failureClass==='rate_limited'?'RATE_LIMITED':'UNAVAILABLE';health.lastErrorClass=error.failureClass||'unknown';health.lastErrorMessage=error.message;const stale=cache.getStale(key);if(stale&&Date.now()-stale.createdAt<=900000){health.status='STALE';return stale.value;}throw error;}})();
 inflight.set(key,task);try{const observations=await task;return {observations,coverage:{complete:true,queryScope:'NASA EONET open events within bbox'},health:getProviderHealth(),cache:{hit:false}};}finally{inflight.delete(key);}
}
function getProviderHealth(){return Object.assign({},health,{status:health.lastErrorClass?'UNAVAILABLE':health.status,rateLimitRemaining:budget.remaining(),activeRequests:budget.active,circuitState:circuit.state,circuitFailures:circuit.failures});}
module.exports={getNaturalHazards,getProviderHealth,normalizeEvent};