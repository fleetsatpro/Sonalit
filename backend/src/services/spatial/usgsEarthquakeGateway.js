'use strict';

const {
  BoundedTtlCache,
  CircuitBreaker,
  RequestBudget,
  fetchJsonWithTimeout,
  clampInt,
  isValidBbox,
  bboxKey,
  runBudgeted
} = require('./externalProviderUtils');

const BASE_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const CACHE_TTL_MS = 45_000;
const STALE_MAX_MS = 300_000;
const MAX_CONCURRENT = 2;
const MAX_PER_MINUTE = 30;
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_MIN_MAGNITUDE = 2.5;

const cache = new BoundedTtlCache(STALE_MAX_MS, 64);
const inflight = new Map();
const circuit = new CircuitBreaker(5, 60_000);
const budget = new RequestBudget(MAX_PER_MINUTE, MAX_CONCURRENT);

const health = {
  providerId:'usgs-earthquake',
  status:'UNKNOWN',
  lastSuccessAt:null,
  lastAttemptAt:null,
  lastErrorClass:null,
  lastErrorMessage:null,
  recordCount:0,
  acceptedCount:0,
  rejectedCount:0,
  requestCount:0,
  cacheHits:0,
  dedupeHits:0
};

function iso(v){
  if(v == null) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function freshness(observedAt, receivedAt){
  if(!observedAt) return 'UNKNOWN';
  const age = Math.max(0, Date.parse(receivedAt) - Date.parse(observedAt));
  if(age <= 120_000) return 'LIVE';
  if(age <= 1_800_000) return 'DELAYED';
  return 'STALE';
}

function severityClass(magnitude){
  if(magnitude >= 6) return 'high';
  if(magnitude >= 5) return 'moderate';
  return 'low';
}

function normalizeFeature(feature, receivedAt){
  const coords = feature && feature.geometry && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates : [];
  const lon = Number(coords[0]), lat = Number(coords[1]), depthKm = Number(coords[2]);
  if(!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const p = feature.properties || {};
  const id = String(feature.id || p.ids || '');
  if(!id) return null;

  const observedAt = iso(p.time || p.updated);
  const updatedAt = iso(p.updated);
  const magnitude = Number(p.mag);
  const mag = Number.isFinite(magnitude) ? magnitude : null;
  const f = freshness(observedAt, receivedAt);

  return {
    id:'usgs:eq:' + id,
    entityType:'natural_hazard',
    source:'usgs-earthquake',
    sourceReference:id,
    latitude:lat,
    longitude:lon,
    altitudeM:Number.isFinite(depthKm) ? -depthKm * 1000 : null,
    observedAt,
    receivedAt,
    freshnessMs:observedAt ? Math.max(0, Date.parse(receivedAt)-Date.parse(observedAt)) : null,
    observationConfidence:0.98,
    interpretationConfidence:0.98,
    // Detection is not impact assessment. Keep the operational score low.
    operationalConfidence:0.22,
    confidence:0.98,
    status:p.status || 'review',
    attributes:{
      hazardType:'earthquake',
      magnitude:mag,
      magnitudeType:p.magType || null,
      place:p.place || null,
      felt:p.felt == null ? null : Number(p.felt),
      cdi:p.cdi == null ? null : Number(p.cdi),
      mmi:p.mmi == null ? null : Number(p.mmi),
      alert:p.alert || null,
      significance:p.sig == null ? null : Number(p.sig),
      eventType:p.type || 'earthquake',
      sourceUrl:p.url || null,
      detailUrl:p.detail || null,
      updatedAt,
      severity:severityClass(mag == null ? 0 : mag)
    },
    provenance:{
      sourceName:'USGS Earthquake Hazards Program',
      sourceUrl:BASE_URL,
      observationType:'earthquake_catalog_geojson',
      sourceReference:id
    },
    coverage:{complete:result.observations.length < limit,bounded:true,queryScope:'USGS earthquake events within requested bbox/time window'},
    quality:{
      state:f === 'LIVE' ? 'good' : f === 'DELAYED' ? 'degraded' : f === 'STALE' ? 'stale' : 'unknown',
      freshnessClass:f,
      reason:'Earthquake detection does not establish operational impact to the convoy, route or infrastructure.'
    },
    uncertainty:[
      'Detection confirms an earthquake event in the source catalogue, not damage, road closure, route disruption or fleet exposure.',
      'Operational impact requires independent Sonalit evidence or corroborating operational sources.'
    ]
  };
}

function queryUrl(bbox){
  const hours=clampInt(process.env.USGS_EARTHQUAKE_LOOKBACK_HOURS,1,720,DEFAULT_LOOKBACK_HOURS);
  const minMag=Number(process.env.USGS_EARTHQUAKE_MIN_MAGNITUDE);
  const start=new Date(Date.now()-hours*3600000).toISOString();
  const end=new Date().toISOString();
  const u=new URL(BASE_URL);
  u.searchParams.set('format','geojson');
  u.searchParams.set('eventtype','earthquake');
  u.searchParams.set('starttime',start);
  u.searchParams.set('endtime',end);
  u.searchParams.set('minmagnitude',String(Number.isFinite(minMag) ? minMag : DEFAULT_MIN_MAGNITUDE));
  u.searchParams.set('orderby','time');
  u.searchParams.set('limit',String(clampInt(process.env.USGS_EARTHQUAKE_MAX_QUERY,50,2000,500)));
  u.searchParams.set('minlongitude',String(bbox[0]));
  u.searchParams.set('minlatitude',String(bbox[1]));
  u.searchParams.set('maxlongitude',String(bbox[2]));
  u.searchParams.set('maxlatitude',String(bbox[3]));
  return u.toString();
}

async function fetchProvider(bbox, signal){
  const response=await fetchJsonWithTimeout(queryUrl(bbox),{
    method:'GET',
    headers:{Accept:'application/geo+json,application/json'},
    signal
  },10_000);
  const body=response.data;
  if(!body || body.type!=='FeatureCollection' || !Array.isArray(body.features)){
    const e=new Error('USGS earthquake response was malformed');
    e.failureClass='malformed';
    throw e;
  }
  const receivedAt=new Date().toISOString();
  let rejected=0;
  const observations=body.features.map(feature=>normalizeFeature(feature,receivedAt)).filter(Boolean);
  rejected=body.features.length-observations.length;
  return {observations,rejected};
}

async function getEarthquakes({bbox,maxRecords=100,signal}={}){
  if(!isValidBbox(bbox)){
    const e=new Error('Invalid earthquake bbox');
    e.failureClass='malformed';
    throw e;
  }

  const key=bboxKey(bbox);
  const fresh=cache.get(key);
  if(fresh){
    health.cacheHits++;
    return {
      observations:fresh.value,
      health:getProviderHealth(),
      coverage:{complete:fresh.value.length < clampInt(maxRecords,1,250,100),bounded:true,queryScope:'USGS earthquake events within requested bbox/time window'},
      cache:{hit:true,ageMs:Date.now()-fresh.createdAt}
    };
  }

  if(inflight.has(key)){
    health.dedupeHits++;
    return inflight.get(key);
  }

  const task=(async()=>{
    health.requestCount++;
    health.lastAttemptAt=new Date().toISOString();
    try{
      const result=await runBudgeted(budget,circuit,()=>fetchProvider(bbox,signal));
      const limit=clampInt(maxRecords,1,250,100);
      const observations=result.observations.slice(0,limit);
      health.status=observations.length?'LIVE':'PARTIAL';
      health.lastSuccessAt=new Date().toISOString();
      health.lastErrorClass=null;
      health.lastErrorMessage=null;
      health.recordCount=result.observations.length;
      health.acceptedCount=observations.length;
      health.rejectedCount=result.rejected;
      cache.set(key,observations);
      return {
        observations,
        health:getProviderHealth(),
        coverage:{complete:result.observations.length < limit,bounded:true,omittedCount:Math.max(0,result.observations.length-observations.length),queryScope:'USGS earthquake events within requested bbox/time window'}
      };
    }catch(error){
      health.status=error.failureClass==='rate_limited'?'RATE_LIMITED':'UNAVAILABLE';
      health.lastErrorClass=error.failureClass||'unknown';
      health.lastErrorMessage=error.message;
      const stale=cache.getStale(key);
      if(stale && Date.now()-stale.createdAt<=STALE_MAX_MS){
        health.status='STALE';
        return {
          observations:stale.value.map(o=>({...o,quality:{...o.quality,state:'stale',freshnessClass:'STALE',reason:'USGS provider failed; bounded stale cache served.'}})),
          health:getProviderHealth(),
          coverage:{complete:false,bounded:true,queryScope:'USGS earthquake stale cache'},
          warnings:['usgs_provider_failed_serving_stale_cache']
        };
      }
      throw error;
    }
  })();

  inflight.set(key,task);
  try{return await task;}finally{inflight.delete(key);}
}

function getProviderHealth(){
  return {...health,rateLimitRemaining:budget.remaining(),activeRequests:budget.active,circuitState:circuit.state,circuitFailures:circuit.failures};
}

module.exports={getEarthquakes,getProviderHealth,normalizeFeature};
