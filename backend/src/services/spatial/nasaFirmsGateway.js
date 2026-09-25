'use strict';

const {
  BoundedTtlCache,
  CircuitBreaker,
  RequestBudget,
  clampInt,
  isValidBbox,
  bboxKey,
  runBudgeted
} = require('./externalProviderUtils');

const BASE_URL='https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const DEFAULT_SOURCE='VIIRS_SNPP_NRT';
const cache=new BoundedTtlCache(120_000,64);
const circuit=new CircuitBreaker(5,60_000);
const budget=new RequestBudget(20,2);
const inflight=new Map();

const health={
  providerId:'nasa-firms',status:'UNKNOWN',lastSuccessAt:null,lastAttemptAt:null,
  lastErrorClass:null,lastErrorMessage:null,recordCount:0,acceptedCount:0,rejectedCount:0,
  requestCount:0,cacheHits:0,dedupeHits:0
};

function iso(v){
  if(!v)return null;
  const d=new Date(v);
  return Number.isFinite(d.getTime())?d.toISOString():null;
}

function parseCsvLine(line){
  const fields=[];let field='',quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(quoted && line[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(c===','&&!quoted){fields.push(field);field='';}
    else field+=c;
  }
  fields.push(field);
  return fields;
}

function parseCsv(text){
  const lines=String(text||'').split(/\r?\n/).filter(Boolean);
  if(!lines.length)return [];
  const headers=parseCsvLine(lines[0]).map(h=>h.trim());
  const rows=[];
  for(const line of lines.slice(1)){
    const values=parseCsvLine(line);
    if(values.length!==headers.length)continue;
    const row={};
    headers.forEach((h,i)=>{row[h]=values[i];});
    rows.push(row);
  }
  return rows;
}

function normalizeDetection(row,receivedAt){
  const lat=Number(row.latitude),lon=Number(row.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
  const date=String(row.acq_date||'');
  const time=String(row.acq_time||'').padStart(4,'0');
  const hh=time.slice(0,2),mm=time.slice(2,4);
  const observedAt=iso(date && hh && mm ? date+'T'+hh+':'+mm+':00Z' : null);
  const sat=String(row.satellite||'unknown');
  const instrument=String(row.instrument||'VIIRS');
  const sourceReference=[lat.toFixed(5),lon.toFixed(5),date,time,sat,instrument].join(':');
  const conf=String(row.confidence||'').toLowerCase();
  return {
    id:'nasa-firms:'+sourceReference,
    entityType:'natural_hazard',
    source:'nasa-firms',
    sourceReference,
    latitude:lat,
    longitude:lon,
    observedAt,
    receivedAt,
    freshnessMs:observedAt?Math.max(0,Date.parse(receivedAt)-Date.parse(observedAt)):null,
    observationConfidence:conf==='high'?0.92:conf==='nominal'?0.85:0.7,
    interpretationConfidence:0.94,
    operationalConfidence:0.2,
    confidence:conf==='high'?0.92:conf==='nominal'?0.85:0.7,
    status:'detected',
    attributes:{
      hazardType:'fire_hotspot',
      sensorSource:row,
      satellite:sat,
      instrument,
      acquisitionDate:date||null,
      acquisitionTime:time||null,
      confidence:row.confidence||null,
      frp:row.frp==null?null:Number(row.frp),
      daynight:row.daynight||null,
      brightTi4:row.bright_ti4==null?null:Number(row.bright_ti4),
      brightTi5:row.bright_ti5==null?null:Number(row.bright_ti5),
      scan:row.scan==null?null:Number(row.scan),
      track:row.track==null?null:Number(row.track)
    },
    provenance:{
      sourceName:'NASA FIRMS',
      sourceUrl:BASE_URL,
      observationType:'viirs_active_fire_hotspot',
      sourceReference
    },
    coverage:{complete:false,bounded:true,queryScope:'NASA FIRMS VIIRS hotspot detections within requested bbox'},
    quality:{
      state:observedAt?'good':'unknown',
      freshnessClass:observedAt?'LIVE':'UNKNOWN',
      reason:'FIRMS is a satellite hotspot detection; it does not by itself establish a confirmed fire, road closure, damage or operational impact.'
    },
    uncertainty:[
      'A hotspot is a remote-sensing detection and may have false positives, false negatives or geolocation uncertainty.',
      'Operational impact requires independent Sonalit evidence or corroborating operational sources.'
    ]
  };
}

async function fetchProvider(bbox,signal){
  const key=String(process.env.NASA_FIRMS_MAP_KEY||'').trim();
  if(!key){
    const e=new Error('NASA FIRMS MAP_KEY is not configured');
    e.failureClass='auth_required';
    throw e;
  }
  const source=encodeURIComponent(String(process.env.NASA_FIRMS_SOURCE||DEFAULT_SOURCE).trim());
  const area=bbox.join(',');
  const url=BASE_URL+'/'+encodeURIComponent(key)+'/'+source+'/'+encodeURIComponent(area)+'/1';

  const controller=new AbortController();
  let timedOut=false;
  const onAbort=()=>{
    controller.abort(signal?.reason || new Error('cancelled'));
  };
  if(signal){
    if(signal.aborted) onAbort();
    else signal.addEventListener('abort',onAbort,{once:true});
  }
  const timer=setTimeout(()=>{
    timedOut=true;
    controller.abort(new Error('provider timeout'));
  },10_000);

  let response;
  try{
    response=await fetch(url,{
      method:'GET',
      headers:{Accept:'text/csv'},
      signal:controller.signal
    });
  }catch(error){
    if(timedOut){
      const e=new Error('NASA FIRMS request timed out');
      e.failureClass='timeout';
      throw e;
    }
    if(signal?.aborted){
      const e=new Error('NASA FIRMS request cancelled');
      e.failureClass='cancelled';
      throw e;
    }
    throw error;
  }finally{
    clearTimeout(timer);
    if(signal) signal.removeEventListener('abort',onAbort);
  }

  if(!response.ok){
    const e=new Error('NASA FIRMS HTTP '+response.status);
    e.failureClass=response.status===429?'rate_limited':(response.status===401||response.status===403?'auth_required':'http_error');
    throw e;
  }
  const text=await response.text();
  const rows=parseCsv(text);
  if(!rows.length)return {observations:[],rejected:0};
  const receivedAt=new Date().toISOString();
  const observations=rows.map(row=>normalizeDetection(row,receivedAt)).filter(Boolean);
  return {observations,rejected:rows.length-observations.length};
}

async function getFireDetections({bbox,maxRecords=100,signal}={}){
  if(!isValidBbox(bbox)){
    const e=new Error('Invalid FIRMS bbox');
    e.failureClass='malformed';
    throw e;
  }
  const key=bboxKey(bbox);
  const fresh=cache.get(key);
  if(fresh){
    health.cacheHits++;
    return {observations:fresh.value.slice(0,clampInt(maxRecords,1,250,100)),health:getProviderHealth(),coverage:{complete:false,bounded:true,queryScope:'NASA FIRMS cached hotspot detections'},cache:{hit:true,ageMs:Date.now()-fresh.createdAt}};
  }
  if(inflight.has(key)){health.dedupeHits++;return inflight.get(key);}
  const task=(async()=>{
    health.requestCount++;health.lastAttemptAt=new Date().toISOString();
    try{
      const result=await runBudgeted(budget,circuit,()=>fetchProvider(bbox,signal));
      const limit=clampInt(maxRecords,1,250,100);
      const observations=result.observations.slice(0,limit);
      health.status=observations.length?'LIVE':'PARTIAL';
      health.lastSuccessAt=new Date().toISOString();
      health.lastErrorClass=null;health.lastErrorMessage=null;
      health.recordCount=result.observations.length;health.acceptedCount=observations.length;health.rejectedCount=result.rejected;
      cache.set(key,observations);
      return {observations,health:getProviderHealth(),coverage:{complete:result.observations.length<limit,bounded:true,queryScope:'NASA FIRMS VIIRS hotspot detections within requested bbox'}};
    }catch(error){
      health.status=error.failureClass==='auth_required'?'AUTH_REQUIRED':error.failureClass==='rate_limited'?'RATE_LIMITED':'UNAVAILABLE';
      health.lastErrorClass=error.failureClass||'unknown';health.lastErrorMessage=error.message;
      const stale=cache.getStale(key);
      if(stale&&Date.now()-stale.createdAt<=300000){
        health.status='STALE';
        return {observations:stale.value.map(o=>({...o,quality:{...o.quality,state:'stale',freshnessClass:'STALE',reason:'NASA FIRMS unavailable; bounded stale cache served.'}})),health:getProviderHealth(),coverage:{complete:false,bounded:true,queryScope:'NASA FIRMS stale cache'},warnings:['nasa_firms_provider_failed_serving_stale_cache']};
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

module.exports={getFireDetections,getProviderHealth,normalizeDetection,parseCsvLine,parseCsv};
