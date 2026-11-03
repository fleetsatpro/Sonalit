'use strict';
const {BoundedTtlCache,CircuitBreaker,RequestBudget,clampInt,fetchJsonWithTimeout,runBudgeted}=require('./externalProviderUtils');
const BASE='https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/tilequery';
const cache=new BoundedTtlCache(90000,256), inflight=new Map(), circuit=new CircuitBreaker(5,30000), budget=new RequestBudget(60,4);
const health={providerId:'mapbox-traffic',status:'AUTH_REQUIRED',lastSuccessAt:null,lastAttemptAt:null,lastErrorClass:null,lastErrorMessage:null,recordCount:0,acceptedCount:0,rejectedCount:0,requestCount:0,cacheHits:0,dedupeHits:0};
function normalizeTrafficFeature(feature,receivedAt,queryPoint){
 const geometry=feature&&feature.geometry,p=feature&&feature.properties||{};
 const c=geometry&&geometry.coordinates;
 let lng=null,lat=null;
 if(geometry&&geometry.type==='Point'&&Array.isArray(c)&&c.length>=2){lng=Number(c[0]);lat=Number(c[1]);}
 else if(geometry&&geometry.type==='LineString'&&Array.isArray(c)&&c.length){const mid=c[Math.floor(c.length/2)];if(Array.isArray(mid)&&mid.length>=2){lng=Number(mid[0]);lat=Number(mid[1]);}}
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;
 const congestion=p.congestion||p.traffic_congestion||null,closed=p.closed==='yes'||p.closed===true;
 const ref=String(feature.id||(lat.toFixed(5)+':'+lng.toFixed(5)));
 const severity=closed?'critical':(congestion==='severe'||congestion==='heavy'?'high':congestion==='moderate'?'medium':'low');
 return {id:'mapbox:traffic:'+ref,entityType:'traffic_segment',source:'mapbox-traffic',sourceReference:ref,latitude:lat,longitude:lng,altitudeM:null,observedAt:null,receivedAt,observationConfidence:congestion||closed?0.78:0.55,interpretationConfidence:0.88,operationalConfidence:closed?0.72:(congestion?0.68:0.55),accuracyM:null,confidence:congestion||closed?0.78:0.55,headingDeg:null,speedMps:null,status:closed?'closed':(congestion||'unknown'),attributes:{congestion,closed,roadClass:p.class||null,queryPoint,providerUpdateCadenceMs:480000},provenance:{sourceName:'Mapbox Traffic',sourceUrl:'https://api.mapbox.com/',observationType:'traffic_segment',sourceReference:ref},coverage:{complete:false,bounded:true,queryScope:'nearest traffic segment to sampled Sonalit spatial point'},quality:{state:congestion||closed?'degraded':'unknown',freshnessClass:'UNKNOWN',reason:'Mapbox Traffic does not expose a per-feature source timestamp; dataset cadence is approximately 8 minutes'}};
}
async function queryPoint({latitude,longitude,radiusM,signal}){
 const token=String(process.env.MAPBOX_ACCESS_TOKEN||'').trim(); if(!token){const e=new Error('MAPBOX_ACCESS_TOKEN is not configured');e.failureClass='auth_required';throw e;}
 const u=new URL(BASE+'/'+encodeURIComponent(longitude)+','+encodeURIComponent(latitude)+'.json');
 u.searchParams.set('access_token',token);u.searchParams.set('radius',String(clampInt(radiusM,25,5000,750)));u.searchParams.set('limit','5');u.searchParams.set('geometry','linestring');u.searchParams.set('layers','traffic');
 const r=await fetchJsonWithTimeout(u.toString(),{method:'GET',signal},7000);
 if(!r.data||r.data.type!=='FeatureCollection'||!Array.isArray(r.data.features)){const e=new Error('Mapbox returned malformed traffic data');e.failureClass='malformed';throw e;}
 const receivedAt=new Date().toISOString(); return r.data.features.map(f=>normalizeTrafficFeature(f,receivedAt,{latitude,longitude})).filter(Boolean);
}
async function getTrafficAtPoints({points,radiusM=750,maxRecords=100,signal}){
 const usable=(Array.isArray(points)?points:[]).map(p=>({latitude:Number(p.latitude),longitude:Number(p.longitude)})).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&p.latitude>=-90&&p.latitude<=90&&p.longitude>=-180&&p.longitude<=180).slice(0,16);
 if(!usable.length)return {observations:[],coverage:{complete:false,queryScope:'no traffic sample points'},health:getProviderHealth()};
 if(!String(process.env.MAPBOX_ACCESS_TOKEN||'').trim())return {observations:[],coverage:{complete:false,queryScope:'mapbox traffic not configured'},health:getProviderHealth()};
 const results=new Array(usable.length),pending=[];
 for(let i=0;i<usable.length;i++){const key=usable[i].latitude.toFixed(5)+','+usable[i].longitude.toFixed(5)+':'+Math.round(radiusM),e=cache.get(key);if(e){health.cacheHits++;results[i]=e.value;}else pending.push({index:i,point:usable[i],key});}
 const worker=async item=>{
   if(inflight.has(item.key)){health.dedupeHits++;return inflight.get(item.key);}
   const task=runBudgeted(budget,circuit,()=>{health.lastAttemptAt=new Date().toISOString();health.requestCount++;return queryPoint({latitude:item.point.latitude,longitude:item.point.longitude,radiusM,signal});}).then(v=>{cache.set(item.key,v);return v;}).catch(e=>{health.lastErrorClass=e.failureClass||'unknown';health.lastErrorMessage=e.message;throw e;}).finally(()=>inflight.delete(item.key));
   inflight.set(item.key,task);return task;
 };
 for(let i=0;i<pending.length;i+=4){const batch=await Promise.allSettled(pending.slice(i,i+4).map(worker));batch.forEach((r,o)=>{if(r.status==='fulfilled')results[pending[i+o].index]=r.value;});}
 const observations=[],seen=new Set(); for(const list of results)for(const o of list||[]){if(seen.has(o.id))continue;seen.add(o.id);observations.push(o);}
 health.recordCount=observations.length;health.acceptedCount=observations.length;health.rejectedCount=0;health.status=observations.length?'PARTIAL':'UNAVAILABLE';if(observations.length)health.lastSuccessAt=new Date().toISOString();health.circuitState=circuit.state;health.circuitFailures=circuit.failures;
 return {observations:observations.slice(0,clampInt(maxRecords,1,250,100)),coverage:{complete:pending.every(i=>results[i.index]),omittedCount:pending.filter(i=>!results[i.index]).length,queryScope:'nearest live traffic segments around mission center and route samples'},health:getProviderHealth()};
}
function getProviderHealth(){return Object.assign({},health,{status:String(process.env.MAPBOX_ACCESS_TOKEN||'').trim()?health.status:'AUTH_REQUIRED',rateLimitRemaining:budget.remaining(),activeRequests:budget.active,circuitState:circuit.state,circuitFailures:circuit.failures});}
module.exports={getTrafficAtPoints,getProviderHealth,normalizeTrafficFeature};