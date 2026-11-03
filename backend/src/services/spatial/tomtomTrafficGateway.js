'use strict';
const {BoundedTtlCache,CircuitBreaker,RequestBudget,clampInt,fetchJsonWithTimeout,runBudgeted,isValidBbox,bboxKey}=require('./externalProviderUtils');
const URL='https://api.tomtom.com/maps/orbis/traffic/incidents/details?apiVersion=2';
const cache=new BoundedTtlCache(60000,64), inflight=new Map(), circuit=new CircuitBreaker(5,30000), budget=new RequestBudget(30,3);
const health={providerId:'tomtom-traffic-incidents',status:'AUTH_REQUIRED',lastSuccessAt:null,lastAttemptAt:null,lastErrorClass:null,lastErrorMessage:null,recordCount:0,acceptedCount:0,rejectedCount:0,requestCount:0,cacheHits:0,dedupeHits:0};
const HAZARDS=new Set(['flooding','fog','dangerousConditions','rain','ice','wind']);
function iso(v){if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function pointFromGeometry(g){const c=g&&g.coordinates;if(!Array.isArray(c)||!c.length)return null;if(g.type==='Point'&&c.length>=2)return {lng:Number(c[0]),lat:Number(c[1])};if(g.type==='LineString'){const p=c[Math.floor(c.length/2)];if(Array.isArray(p)&&p.length>=2)return {lng:Number(p[0]),lat:Number(p[1])};}return null;}
function normalizeIncident(feature,receivedAt){
 const pt=pointFromGeometry(feature&&feature.geometry); if(!pt||!Number.isFinite(pt.lat)||!Number.isFinite(pt.lng))return null;
 const p=feature&&feature.properties||{},ref=String(p.id||feature.id||(pt.lat.toFixed(5)+':'+pt.lng.toFixed(5)));
 const category=String(p.iconCategory||'unknown'),rawMagnitude=p.magnitudeOfDelay,magnitudeNumber=Number.isFinite(Number(rawMagnitude))?Number(rawMagnitude):null,magnitudeLabel=rawMagnitude==null?'unknown':String(rawMagnitude),observedAt=iso(p.lastReportTime||p.endTime||p.startTime);
 const severity=category==='roadClosed'||magnitudeNumber>=4?'critical':(magnitudeNumber>=3||magnitudeLabel==='major'?'high':(magnitudeNumber>=2||magnitudeLabel==='moderate'||HAZARDS.has(category)?'medium':'low'));
 const hazard=HAZARDS.has(category);
 return {id:'tomtom:traffic-incident:'+ref,entityType:hazard?'traffic_hazard':'traffic_incident',source:'tomtom-traffic',sourceReference:ref,latitude:pt.lat,longitude:pt.lng,altitudeM:null,geometry:feature?.geometry||null,observedAt,receivedAt,freshnessMs:observedAt?Math.max(0,Date.parse(receivedAt)-Date.parse(observedAt)):null,observationConfidence:0.9,interpretationConfidence:0.94,operationalConfidence:hazard?0.78:0.84,accuracyM:100,confidence:0.9,headingDeg:null,speedMps:null,status:category,attributes:{category,magnitudeOfDelay:magnitudeNumber==null?magnitudeLabel:magnitudeNumber,magnitudeOfDelayRaw:rawMagnitude??null,description:Array.isArray(p.events)?p.events.map(e=>e.description).filter(Boolean).join(' · '):null,startTime:iso(p.startTime),endTime:iso(p.endTime),delaySeconds:Number.isFinite(Number(p.delayInSeconds))?Number(p.delayInSeconds):null,roadNumbers:Array.isArray(p.roadNumbers)?p.roadNumbers:[],probabilityOfOccurrence:p.probabilityOfOccurrence||null,numberOfReports:Number.isFinite(Number(p.numberOfReports))?Number(p.numberOfReports):null},provenance:{sourceName:'TomTom Traffic',sourceUrl:'https://api.tomtom.com/',observationType:hazard?'external_traffic_hazard':'external_traffic_incident',sourceReference:ref},coverage:{complete:false,bounded:true,queryScope:'TomTom Orbis present incidents within requested bbox'},quality:{state:observedAt?(Date.parse(receivedAt)-Date.parse(observedAt)<=60000?'good':'degraded'):'degraded',freshnessClass:observedAt?(Date.parse(receivedAt)-Date.parse(observedAt)<=60000?'LIVE':(Date.parse(receivedAt)-Date.parse(observedAt)<=300000?'DELAYED':'STALE')):'UNKNOWN',reason:observedAt?undefined:'Traffic incident source timestamp unavailable'}};
}
async function queryProvider(bbox,maxRecords,signal){
 const token=String(process.env.TOMTOM_API_KEY||'').trim(); if(!token){const e=new Error('TOMTOM_API_KEY is not configured');e.failureClass='auth_required';throw e;}
 const u=new URL(URL);u.searchParams.set('bbox',bbox.join(','));u.searchParams.set('timeValidity','present');u.searchParams.set('iconCategories','accident,fog,dangerousConditions,rain,ice,jam,laneClosed,roadClosed,roadWorks,wind,flooding,brokenDownVehicle');
 const attrs='incidents(type,geometry(type,coordinates),properties(id,iconCategory,magnitudeOfDelay,events,startTime,endTime,lastReportTime,delayInSeconds,roadNumbers,probabilityOfOccurrence,numberOfReports))';
 const r=await fetchJsonWithTimeout(u.toString(),{method:'GET',headers:{'TomTom-Api-Key':token,'TomTom-Api-Version':'2','Attributes':attrs,Accept:'application/json'},signal},8000);
 if(!r.data||!Array.isArray(r.data.incidents)){const e=new Error('TomTom returned malformed incident data');e.failureClass='malformed';throw e;}
 const receivedAt=new Date().toISOString();return {observations:r.data.incidents.map(f=>normalizeIncident(f,receivedAt)).filter(Boolean),partial:false};
}
async function getTrafficFlowAtPoints({ points, zoom = 10, maxRecords = 100, signal }) {
  const usable = (Array.isArray(points) ? points : [])
    .map(p => ({ latitude: Number(p.latitude), longitude: Number(p.longitude) }))
    .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.latitude >= -90 && p.latitude <= 90 && p.longitude >= -180 && p.longitude <= 180)
    .slice(0, 16);
  if (!usable.length) return { observations: [], coverage: { complete: false, queryScope: 'no traffic flow sample points' }, health: getProviderHealth() };
  if (!String(process.env.TOMTOM_API_KEY || '').trim()) return { observations: [], coverage: { complete: false, queryScope: 'tomtom traffic flow not configured' }, health: getProviderHealth() };
  const keys = usable.map(p => p.latitude.toFixed(5) + ',' + p.longitude.toFixed(5) + ':' + Math.round(zoom));
  const results = new Array(keys.length), pending = [];
  for (let i = 0; i < keys.length; i++) {
    const cached = cache.get('flow:' + keys[i]);
    if (cached) { health.cacheHits += 1; results[i] = cached.value; }
    else pending.push({ index: i, point: usable[i], key: keys[i] });
  }
  const worker = async item => {
    const cacheKey = 'flow:' + item.key;
    if (inflight.has(cacheKey)) { health.dedupeHits += 1; return inflight.get(cacheKey); }
    const task = runBudgeted(budget, circuit, async () => {
      health.lastAttemptAt = new Date().toISOString(); health.requestCount += 1;
      const token = String(process.env.TOMTOM_API_KEY || '').trim();
      const url = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/' + clampInt(zoom, 0, 22, 10) + '/json');
      url.searchParams.set('key', token);
      url.searchParams.set('point', item.point.latitude + ',' + item.point.longitude);
      const { data } = await fetchJsonWithTimeout(url.toString(), { method: 'GET', headers: { Accept: 'application/json' }, signal }, 8000);
      const flow = data?.flowSegmentData;
      if (!flow) { const e = new Error('TomTom returned malformed flow data'); e.failureClass = 'malformed'; throw e; }
      const currentSpeedKmh = Number(flow.currentSpeed);
      const freeFlowSpeedKmh = Number(flow.freeFlowSpeed);
      const currentTravelTimeS = Number(flow.currentTravelTime);
      const freeFlowTravelTimeS = Number(flow.freeFlowTravelTime);
      if (![currentSpeedKmh, freeFlowSpeedKmh, currentTravelTimeS, freeFlowTravelTimeS].some(Number.isFinite)) { const e = new Error('TomTom flow segment contains no usable metrics'); e.failureClass = 'empty'; throw e; }
      const delayRatio = Number.isFinite(currentTravelTimeS) && freeFlowTravelTimeS > 0 ? Math.max(0, currentTravelTimeS / freeFlowTravelTimeS - 1) : null;
      const coords = Array.isArray(flow.coordinates?.coordinate) ? flow.coordinates.coordinate : [];
      const line = coords.map(c => [Number(c.longitude), Number(c.latitude)]).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      const midpoint = line.length ? line[Math.floor(line.length / 2)] : [item.point.longitude, item.point.latitude];
      const receivedAt = new Date().toISOString();
      return {
        id: 'tomtom:traffic-flow:' + item.key,
        entityType: 'traffic_flow_segment',
        source: 'tomtom-traffic',
        sourceReference: item.key,
        latitude: midpoint[1],
        longitude: midpoint[0],
        altitudeM: null,
        geometry: line.length >= 2 ? { type: 'LineString', coordinates: line } : { type: 'Point', coordinates: midpoint },
        observedAt: null,
        receivedAt,
        freshnessMs: undefined,
        observationConfidence: Number.isFinite(Number(flow.confidence)) ? Math.max(0, Math.min(1, Number(flow.confidence))) : 0.82,
        interpretationConfidence: 0.95,
        operationalConfidence: 0.84,
        accuracyM: null,
        confidence: Number.isFinite(Number(flow.confidence)) ? Math.max(0, Math.min(1, Number(flow.confidence))) : 0.82,
        headingDeg: null,
        speedMps: Number.isFinite(currentSpeedKmh) ? currentSpeedKmh / 3.6 : null,
        status: delayRatio != null && delayRatio >= 0.5 ? 'severe' : delayRatio != null && delayRatio >= 0.25 ? 'heavy' : delayRatio != null && delayRatio >= 0.1 ? 'moderate' : 'free_flow',
        attributes: { currentSpeedKmh: Number.isFinite(currentSpeedKmh) ? currentSpeedKmh : null, freeFlowSpeedKmh: Number.isFinite(freeFlowSpeedKmh) ? freeFlowSpeedKmh : null, currentTravelTimeS: Number.isFinite(currentTravelTimeS) ? currentTravelTimeS : null, freeFlowTravelTimeS: Number.isFinite(freeFlowTravelTimeS) ? freeFlowTravelTimeS : null, delayRatio, roadClosure: flow.roadClosure ?? null, confidence: flow.confidence ?? null, samplePoint: item.point },
        provenance: { sourceName: 'TomTom Traffic Flow', sourceUrl: 'https://developer.tomtom.com/traffic-api/documentation/traffic-flow/flow-segment-data', observationType: 'traffic_flow_segment', sourceReference: item.key },
        coverage: { complete: false, bounded: true, queryScope: 'TomTom Flow Segment Data at route sample point' },
        quality: { state: 'good', freshnessClass: 'UNKNOWN', reason: 'TomTom flow response does not provide a per-response observation timestamp in this integration.' },
      };
    }).then(value => { cache.set(cacheKey, value); return value; }).catch(error => { health.lastErrorClass = error.failureClass || 'unknown'; health.lastErrorMessage = error.message; throw error; }).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, task);
    return task;
  };
  for (let i = 0; i < pending.length; i += 3) {
    const batch = await Promise.allSettled(pending.slice(i, i + 3).map(worker));
    batch.forEach((result, offset) => { if (result.status === 'fulfilled') results[pending[i + offset].index] = result.value; });
  }
  const observations = results.filter(Boolean).slice(0, clampInt(maxRecords, 1, 250, 100));
  health.recordCount = observations.length; health.acceptedCount = observations.length; health.rejectedCount = 0;
  if (observations.length) { health.status = 'LIVE'; health.lastSuccessAt = new Date().toISOString(); } else if (pending.length) health.status = 'UNAVAILABLE';
  return { observations, coverage: { complete: pending.every(item => results[item.index]), omittedCount: pending.filter(item => !results[item.index]).length, queryScope: 'TomTom Flow Segment Data at bounded mission route sample points' }, health: getProviderHealth() };
}
async function getTrafficIncidents({bbox,maxRecords=100,signal}){
 if(!isValidBbox(bbox)){const e=new Error('Invalid traffic incident bbox');e.failureClass='malformed';throw e;}
 if(!String(process.env.TOMTOM_API_KEY||'').trim())return {observations:[],coverage:{complete:false,queryScope:'tomtom traffic incidents not configured'},health:getProviderHealth()};
 const key=bboxKey(bbox)+':'+clampInt(maxRecords,1,250,100),fresh=cache.get(key);
 if(fresh){health.cacheHits++;return {observations:fresh.value.observations,coverage:fresh.value.coverage,health:getProviderHealth(),cache:{hit:true,ageMs:Date.now()-fresh.createdAt}};}
 if(inflight.has(key)){health.dedupeHits++;const v=await inflight.get(key);return Object.assign({},v,{health:getProviderHealth(),cache:{hit:true}});}
 const task=(async()=>{
  health.lastAttemptAt=new Date().toISOString();health.requestCount++;
  try{const result=await runBudgeted(budget,circuit,()=>queryProvider(bbox,maxRecords,signal));health.status=result.observations.length?'LIVE':'PARTIAL';health.lastSuccessAt=new Date().toISOString();health.lastErrorClass=null;health.lastErrorMessage=null;health.recordCount=result.observations.length;health.acceptedCount=result.observations.length;const value={observations:result.observations.slice(0,clampInt(maxRecords,1,250,100)),coverage:{complete:!result.partial,queryScope:'TomTom Orbis present traffic incidents within bbox'}};cache.set(key,value);return value;}
  catch(error){health.status=error.failureClass==='rate_limited'?'RATE_LIMITED':error.failureClass==='auth_required'?'AUTH_REQUIRED':'UNAVAILABLE';health.lastErrorClass=error.failureClass||'unknown';health.lastErrorMessage=error.message;const stale=cache.getStale(key);if(stale&&Date.now()-stale.createdAt<=300000){health.status='STALE';return {observations:stale.value.observations,coverage:Object.assign({},stale.value.coverage,{queryScope:stale.value.coverage.queryScope+' (stale cache fallback)'})};}throw error;}
 })();
 inflight.set(key,task);try{const v=await task;return Object.assign({},v,{health:getProviderHealth(),cache:{hit:false}});}finally{inflight.delete(key);}
}
function getProviderHealth(){return Object.assign({},health,{status:String(process.env.TOMTOM_API_KEY||'').trim()?health.status:'AUTH_REQUIRED',rateLimitRemaining:budget.remaining(),activeRequests:budget.active,circuitState:circuit.state,circuitFailures:circuit.failures});}
module.exports={getTrafficIncidents,getProviderHealth,normalizeIncident};