'use strict';

const crypto=require('crypto');
const {getRedis}=require('../config/redis');

const API_BASE='https://opensky-network.org/api';
const TOKEN_URL='https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const LEASE_KEY='sonalit:sjm:airspace:opensky:ingest-lease:v1';
const SNAPSHOT_KEY='sonalit:sjm:airspace:opensky:snapshot:v1';
const LEASE_MS=30_000;
const SNAPSHOT_TTL_SECONDS=15*60;
const MAX_AIRCRAFT=4_000;
const MAX_TRAIL=36;
const RETENTION_MS=10*60*1000;
const LIVE_MS=45_000;
const DELAYED_MS=180_000;
const UNAVAILABLE_MS=RETENTION_MS;
const RENEW_SCRIPT="if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end";
const RELEASE_SCRIPT="if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
const POSITION_SOURCE={0:'ADSB',1:'ASTERIX',2:'MLAT',3:'FLARM'};
const CATEGORY={
  0:'UNKNOWN',1:'NO_INFORMATION',2:'LIGHT',3:'SMALL',4:'LARGE',5:'HIGH_VORTEX_LARGE',
  6:'HEAVY',7:'HIGH_PERFORMANCE',8:'ROTORCRAFT',9:'GLIDER',10:'LIGHTER_THAN_AIR',
  11:'SKYDIVING',12:'ULTRALIGHT',14:'UAV',15:'SPACE',16:'EMERGENCY_SURFACE',
  17:'SERVICE_SURFACE',18:'POINT_OBSTACLE',19:'CLUSTER_OBSTACLE',20:'LINE_OBSTACLE',
};

let accessToken=null,accessTokenExpiresAt=0;
let ownerToken=null,workerConfig=null,pollTimer=null,leaseTimer=null,pollInFlight=null;
let aircraft=new Map();
let lastSuccessfulPollAt=null,lastPositionAt=null,lastProviderTime=null;
let messageCount=0,positionCount=0,rejectedCount=0,rateLimitRemaining=null;
let lastErrorCode=null,nextPollAt=0,rateLimitRetrySeconds=null;

function parseBounds(raw) {
  if(typeof raw!=='string'||!raw.trim())return null;
  const values=raw.trim().split(/[ ,]+/).map(Number);
  if(values.length!==4||values.some(value=>!Number.isFinite(value)))return null;
  const [south,west,north,east]=values;
  if(south < -90||north > 90||west < -180||east > 180||south>=north||west>=east)return null;
  const area=(north-south)*(east-west);
  if(area<=0||area>500)return null;
  return {south,west,north,east,area_sq_degrees:area};
}

function creditsForBounds(bounds) {
  if(!bounds)return 4;
  const area=bounds.area_sq_degrees??(bounds.north-bounds.south)*(bounds.east-bounds.west);
  if(area<=25)return 1;
  if(area<=100)return 2;
  if(area<=400)return 3;
  return 4;
}

function getConfig(env=process.env) {
  const enabled=env.SJM_AIRSPACE_FEED_ENABLED==='true';
  const licence=env.SJM_AIRSPACE_LICENSE_CONFIRMED==='true';
  const clientId=String(env.OPENSKY_CLIENT_ID||'').trim();
  const clientSecret=String(env.OPENSKY_CLIENT_SECRET||'').trim();
  const bounds=parseBounds(env.SJM_AIRSPACE_BOUNDS);
  const requestedBudget=Number(env.OPENSKY_DAILY_CREDIT_BUDGET||3000);
  const dailyCreditBudget=Number.isFinite(requestedBudget)?Math.max(500,Math.min(4000,Math.floor(requestedBudget))):3000;
  const desiredInterval=Number(env.OPENSKY_POLL_INTERVAL_SECONDS||120);
  const basePollSeconds=Number.isFinite(desiredInterval)?Math.max(60,Math.min(900,Math.floor(desiredInterval))):120;
  const creditsPerRequest=creditsForBounds(bounds);
  const budgetFloorSeconds=Math.ceil(86_400*creditsPerRequest/dailyCreditBudget);
  const pollIntervalSeconds=Math.max(basePollSeconds,budgetFloorSeconds,60);
  let reason=null;
  if(!enabled)reason='feed_disabled';
  else if(!licence)reason='provider_written_operational_and_commercial_license_not_confirmed';
  else if(!clientId||!clientSecret||/[\r\n]/.test(clientId)||/[\r\n]/.test(clientSecret))reason='provider_oauth_credentials_missing_or_invalid';
  else if(!bounds)reason='operational_bounds_missing_or_invalid';
  return {
    configured:!reason,reason,provider:'opensky_rest',providerName:'OpenSky Network',
    clientId:!reason?clientId:null,clientSecret:!reason?clientSecret:null,bounds:!reason?bounds:null,
    dailyCreditBudget,creditsPerRequest,pollIntervalSeconds,
    projectedDailyCredits:Math.ceil(86_400/pollIntervalSeconds)*creditsPerRequest,
  };
}

function epochIso(value,now=Date.now()) {
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0||number>Math.floor(now/1000)+30)return null;
  return new Date(number*1000).toISOString();
}

function classifyFreshness(observedAt,now=Date.now()) {
  const observed=Date.parse(observedAt||'');
  if(!Number.isFinite(observed)||observed>now+30_000)return 'UNAVAILABLE';
  const age=Math.max(0,now-observed);
  if(age<=LIVE_MS)return 'LIVE';
  if(age<=DELAYED_MS)return 'DELAYED';
  if(age<=UNAVAILABLE_MS)return 'STALE';
  return 'UNAVAILABLE';
}

function normaliseStateVector(state,now=Date.now()) {
  if(!Array.isArray(state)||state.length<17)return null;
  const icao24=String(state[0]||'').trim().toLowerCase();
  const latitude=state[6]==null?NaN:Number(state[6]);
  const longitude=state[5]==null?NaN:Number(state[5]);
  if(!/^[0-9a-f]{6}$/.test(icao24)||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude > 90||longitude < -180||longitude > 180)return null;
  // OpenSky explicitly sets time_position=null when no position report was
  // received within the preceding 15 seconds. Do not create a fresh map fix.
  const positionTime=epochIso(state[3],now);
  if(!positionTime)return null;
  const lastContact=epochIso(state[4],now);
  if(!lastContact)return null;
  const barometricAltitude=state[7]==null?null:Number(state[7]);
  const geometricAltitude=state[13]==null?null:Number(state[13]);
  const altitude=Number.isFinite(geometricAltitude)?geometricAltitude:
    Number.isFinite(barometricAltitude)?barometricAltitude:null;
  const positionSource=state[16]==null?null:Number(state[16]);
  // ADS-B geometric altitude is GNSS height above the WGS-84 ellipsoid. For
  // other REST position sources, retain the provider's geometric label but
  // do not assume an ellipsoid datum for 3D projection.
  const altitudeReference=Number.isFinite(geometricAltitude)&&positionSource===0?'WGS84_ELLIPSOID':
    Number.isFinite(geometricAltitude)?'GEOMETRIC':
    Number.isFinite(barometricAltitude)?'BAROMETRIC_PRESSURE':null;
  const velocity=state[9]==null?null:Number(state[9]);
  const track=state[10]==null?null:Number(state[10]);
  const verticalRate=state[11]==null?null:Number(state[11]);
  const category=state[17]==null?null:Number(state[17]);
  const ident=String(state[1]||'').trim().replace(/\s+/g,' ')||icao24.toUpperCase();
  const ageSeconds=Math.max(0,Math.floor((now-Date.parse(positionTime))/1000));
  return {
    id:icao24,provider:'opensky_rest',ident,registration:null,
    origin:null,destination:null,origin_country:state[2]||null,
    latitude,longitude,altitude_m:altitude,altitude_reference:altitudeReference,
    barometric_altitude_m:Number.isFinite(barometricAltitude)?barometricAltitude:null,
    geometric_altitude_m:Number.isFinite(geometricAltitude)?geometricAltitude:null,
    ground_speed_mps:Number.isFinite(velocity)?velocity:null,
    heading_deg:Number.isFinite(track)&&track>=0&&track<=360?track:null,
    vertical_rate_mps:Number.isFinite(verticalRate)?verticalRate:null,
    on_ground:typeof state[8]==='boolean'?state[8]:null,
    squawk:state[14]==null?null:String(state[14]),
    position_source:state[16]==null?null:Number(state[16]),
    position_source_label:POSITION_SOURCE[Number(state[16])]||'UNKNOWN',
    category:Number.isInteger(category)?category:null,
    category_label:CATEGORY[category]||'UNKNOWN',
    observed_at:positionTime,last_contact_at:lastContact,
    age_seconds:ageSeconds,freshness:classifyFreshness(positionTime,now),
    evidence_class:'OBSERVED',trail:[],
  };
}

function buildStatesUrl(bounds) {
  if(!bounds)throw new Error('A contracted OpenSky coverage rectangle is required.');
  const url=new URL('/api/states/all',API_BASE);
  url.searchParams.set('lamin',String(bounds.south));
  url.searchParams.set('lomin',String(bounds.west));
  url.searchParams.set('lamax',String(bounds.north));
  url.searchParams.set('lomax',String(bounds.east));
  url.searchParams.set('extended','1');
  return url.toString();
}

async function getAccessToken(config,{fetcher=global.fetch,now=Date.now(),force=false}={}) {
  if(!config?.clientId||!config?.clientSecret)throw new Error('OpenSky OAuth client credentials are not configured.');
  if(!force&&accessToken&&accessTokenExpiresAt>now+60_000)return accessToken;
  if(typeof fetcher!=='function')throw new Error('Global fetch is unavailable.');
  const body=new URLSearchParams({
    grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret,
  });
  const response=await fetcher(TOKEN_URL,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:body.toString(),signal:AbortSignal.timeout(12_000),
  });
  if(!response.ok){
    const error=new Error('OpenSky OAuth token request failed.');
    error.code=response.status===401?'oauth_rejected':'oauth_unavailable';
    error.status=response.status;
    throw error;
  }
  const payload=await response.json();
  if(typeof payload?.access_token!=='string'||!payload.access_token)throw new Error('OpenSky OAuth response did not contain an access token.');
  const expiresIn=Number(payload.expires_in||1800);
  accessToken=payload.access_token;
  accessTokenExpiresAt=now+Math.max(60,expiresIn-60)*1000;
  return accessToken;
}

async function fetchStates(config,{fetcher=global.fetch,now=Date.now()}={}) {
  const url=buildStatesUrl(config.bounds);
  let token=await getAccessToken(config,{fetcher,now});
  let response;
  for(let attempt=0;attempt<2;attempt++){
    response=await fetcher(url,{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(15_000),
    });
    if(response.status===401&&attempt===0){
      accessToken=null;accessTokenExpiresAt=0;
      token=await getAccessToken(config,{fetcher,now,force:true});
      continue;
    }
    break;
  }
  const remainingHeader=response.headers?.get?.('x-rate-limit-remaining');
  const remaining=remainingHeader==null?null:Number(remainingHeader);
  if(response.status===429){
    const retryHeader=response.headers?.get?.('x-rate-limit-retry-after-seconds');
    const retryAfter=Number(retryHeader);
    const error=new Error('OpenSky API credit limit reached.');
    error.code='rate_limited';
    error.retryAfterSeconds=Number.isFinite(retryAfter)?Math.max(1,Math.min(86_400,retryAfter)):900;
    error.rateLimitRemaining=Number.isFinite(remaining)?remaining:null;
    throw error;
  }
  if(!response.ok){
    const error=new Error('OpenSky state-vector request failed.');
    error.code=response.status>=500?'provider_unavailable':'provider_request_rejected';
    error.status=response.status;
    throw error;
  }
  const payload=await response.json();
  if(!payload||!Array.isArray(payload.states))throw new Error('OpenSky returned an invalid state-vector response.');
  return {
    states:payload.states,providerTime:epochIso(payload.time,now),
    rateLimitRemaining:Number.isFinite(remaining)?remaining:null,
    receivedAt:new Date(now).toISOString(),
  };
}

function rememberPosition(item) {
  const previous=aircraft.get(item.id);
  if(previous&&Date.parse(item.observed_at)<=Date.parse(previous.observed_at)){
    aircraft.set(item.id,{...previous,last_contact_at:item.last_contact_at});
    return false;
  }
  const trail=previous?(previous.trail||[]).slice(-(MAX_TRAIL-1)):[];
  trail.push({latitude:item.latitude,longitude:item.longitude,altitude_m:item.altitude_m,
    altitude_reference:item.altitude_reference,observed_at:item.observed_at});
  aircraft.set(item.id,{...item,trail});
  return true;
}

function purgeExpired(now=Date.now()) {
  for(const [id,item] of aircraft){
    if(now-Date.parse(item.observed_at)>RETENTION_MS)aircraft.delete(id);
  }
  if(aircraft.size>MAX_AIRCRAFT){
    const oldest=[...aircraft.entries()].sort((a,b)=>Date.parse(a[1].observed_at)-Date.parse(b[1].observed_at));
    for(const [id] of oldest.slice(0,aircraft.size-MAX_AIRCRAFT))aircraft.delete(id);
  }
}

function snapshot(now=Date.now(),config=getConfig(),statusOverride=null) {
  purgeExpired(now);
  const items=[...aircraft.values()].map(item=>({
    ...item,age_seconds:Math.max(0,Math.floor((now-Date.parse(item.observed_at))/1000)),
    freshness:classifyFreshness(item.observed_at,now),
  })).filter(item=>item.freshness!=='UNAVAILABLE')
    .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));
  const lastSuccess=Date.parse(lastSuccessfulPollAt||'');
  const pollFresh=Number.isFinite(lastSuccess)&&now-lastSuccess<=Math.max(config.pollIntervalSeconds*3000,180_000);
  const status=statusOverride||(!pollFresh?'UNAVAILABLE':
    items.some(item=>item.freshness==='LIVE')?'LIVE':
    items.length?'DELAYED':'CONNECTED');
  return {
    provider:'opensky_rest',provider_name:'OpenSky Network',status,
    configured:config.configured,connected:pollFresh,
    last_connected_at:lastSuccessfulPollAt,last_received_at:lastSuccessfulPollAt,
    last_position_at:lastPositionAt,last_provider_time:lastProviderTime,
    message_count:messageCount,position_count:positionCount,rejected_count:rejectedCount,
    rate_limit_remaining:rateLimitRemaining,rate_limit_retry_after_seconds:rateLimitRetrySeconds,
    last_error_code:lastErrorCode,next_poll_at:nextPollAt?new Date(nextPollAt).toISOString():null,
    poll_interval_seconds:config.pollIntervalSeconds,
    credit_cost_per_request:config.creditsPerRequest,
    projected_daily_credits:config.projectedDailyCredits,
    daily_credit_budget:config.dailyCreditBudget,
    coverage:{complete:false,bounds:config.bounds,query_scope:'contracted_operational_bounds'},
    aircraft:items,recent_events:[],
    provenance:{
      source:'OpenSky Network REST API',source_endpoint:'/states/all',
      position_type:'provider-observed state-vector position',
      feed_mode:'bounded_rest_polling_snapshot',
      poll_interval_seconds:config.pollIntervalSeconds,
      commercial_flight_information:false,
      mlat_available_via_rest:false,
      fabricated_data_used:false,
    },
  };
}

function inactiveSnapshot(reason='feed_disabled') {
  return {
    provider:'opensky_rest',provider_name:'OpenSky Network',status:'NOT_CONFIGURED',
    configured:false,connected:false,last_connected_at:null,last_received_at:null,last_position_at:null,
    last_provider_time:null,message_count:0,position_count:0,rejected_count:0,
    rate_limit_remaining:null,rate_limit_retry_after_seconds:null,last_error_code:reason,
    next_poll_at:null,poll_interval_seconds:null,credit_cost_per_request:null,
    projected_daily_credits:null,daily_credit_budget:null,
    coverage:{complete:false,bounds:null,query_scope:'unavailable'},
    aircraft:[],recent_events:[],
    provenance:{source:'OpenSky Network REST API',feed_mode:'bounded_rest_polling_snapshot',
      commercial_flight_information:false,mlat_available_via_rest:false,fabricated_data_used:false},
  };
}

async function readyRedis() {
  const redis=getRedis();
  if(!redis)throw new Error('SJM airspace shared Redis store is disabled.');
  if(redis.status==='wait')await redis.connect();
  if(redis.status==='end')throw new Error('SJM airspace shared Redis store is closed.');
  await redis.ping();
  return redis;
}

async function saveSharedSnapshot(redis,config,statusOverride=null) {
  const data=snapshot(Date.now(),config,statusOverride);
  await redis.set(SNAPSHOT_KEY,JSON.stringify(data),'EX',SNAPSHOT_TTL_SECONDS);
  return data;
}

async function pollOnce(redis,config,token) {
  if(!ownerToken||ownerToken!==token||pollInFlight)return;
  pollInFlight=(async()=>{
    const owner=await redis.get(LEASE_KEY);
    if(owner!==token)return stopWorker(false);
    if(Date.now()<nextPollAt)return;
    try{
      const result=await fetchStates(config);
      let validPositions=0,invalidPositions=0;
      messageCount=result.states.length;
      for(const state of result.states){
        const item=normaliseStateVector(state,Date.now());
        if(!item){invalidPositions++;continue;}
        if(rememberPosition(item))validPositions++;
      }
      const now=Date.now();
      purgeExpired(now);
      positionCount=validPositions;
      rejectedCount=invalidPositions;
      rateLimitRemaining=result.rateLimitRemaining;
      lastSuccessfulPollAt=result.receivedAt;
      lastProviderTime=result.providerTime;
      const positions=[...aircraft.values()].map(item=>Date.parse(item.observed_at)).filter(Number.isFinite);
      lastPositionAt=positions.length?new Date(Math.max(...positions)).toISOString():null;
      lastErrorCode=null;rateLimitRetrySeconds=null;nextPollAt=now+config.pollIntervalSeconds*1000;
      await saveSharedSnapshot(redis,config);
    }catch(error){
      if(error?.code==='rate_limited'){
        rateLimitRetrySeconds=error.retryAfterSeconds;
        rateLimitRemaining=error.rateLimitRemaining??rateLimitRemaining;
        nextPollAt=Date.now()+error.retryAfterSeconds*1000;
        lastErrorCode='provider_rate_limited';
        await saveSharedSnapshot(redis,config,'RATE_LIMITED');
      }else{
        lastErrorCode=error?.code||'provider_request_failed';
        nextPollAt=Date.now()+config.pollIntervalSeconds*1000;
        await saveSharedSnapshot(redis,config);
      }
    }
  })();
  try{await pollInFlight;}finally{pollInFlight=null;}
}

async function stopWorker(release=true) {
  if(pollTimer)clearInterval(pollTimer);
  if(leaseTimer)clearInterval(leaseTimer);
  pollTimer=null;leaseTimer=null;
  const token=ownerToken;ownerToken=null;workerConfig=null;
  if(release&&token){
    try{
      const redis=await readyRedis();
      await redis.eval(RELEASE_SCRIPT,1,LEASE_KEY,token);
    }catch(_){}
  }
}

async function acquireIngestLease(config) {
  const redis=await readyRedis();
  if(ownerToken)return redis;
  const token=crypto.randomUUID();
  const acquired=await redis.set(LEASE_KEY,token,'PX',LEASE_MS,'NX');
  if(acquired!=='OK')return redis;
  ownerToken=token;workerConfig=config;
  try{
    const previous=await redis.get(SNAPSHOT_KEY);
    if(previous){
      const restored=JSON.parse(previous);
      if(restored?.provider==='opensky_rest'&&Array.isArray(restored.aircraft)){
        aircraft=new Map(restored.aircraft.map(item=>[item.id,item]));
        lastSuccessfulPollAt=restored.last_connected_at||null;
        lastPositionAt=restored.last_position_at||null;
        lastProviderTime=restored.last_provider_time||null;
        messageCount=Number(restored.message_count)||0;
        positionCount=Number(restored.position_count)||0;
        rejectedCount=Number(restored.rejected_count)||0;
        rateLimitRemaining=restored.rate_limit_remaining??null;
      }
    }
  }catch(_){}
  const leaderToken=token;
  pollTimer=setInterval(()=>{void pollOnce(redis,config,leaderToken).catch(()=>{});},config.pollIntervalSeconds*1000);
  pollTimer.unref?.();
  leaseTimer=setInterval(async()=>{
    try{
      const renewed=await redis.eval(RENEW_SCRIPT,1,LEASE_KEY,leaderToken,LEASE_MS);
      if(Number(renewed)!==1)await stopWorker(false);
    }catch(_){await stopWorker(false);}
  },Math.floor(LEASE_MS/3));
  leaseTimer.unref?.();
  void pollOnce(redis,config,leaderToken).catch(()=>{});
  return redis;
}

async function getSnapshot({start=true}={}) {
  const config=getConfig();
  if(!config.configured)return inactiveSnapshot(config.reason);
  let redis;
  try{
    redis=await readyRedis();
    if(start)await acquireIngestLease(config);
    const shared=await redis.get(SNAPSHOT_KEY);
    if(shared){
      const data=JSON.parse(shared);
      if(data?.provider==='opensky_rest'&&Array.isArray(data.aircraft))return data;
    }
    return {
      ...inactiveSnapshot('awaiting_first_provider_snapshot'),
      status:'UNAVAILABLE',configured:true,provider:'opensky_rest',provider_name:'OpenSky Network',
      coverage:{complete:false,bounds:config.bounds,query_scope:'contracted_operational_bounds'},
      poll_interval_seconds:config.pollIntervalSeconds,credit_cost_per_request:config.creditsPerRequest,
      projected_daily_credits:config.projectedDailyCredits,daily_credit_budget:config.dailyCreditBudget,
    };
  }catch(_){
    return {
      ...inactiveSnapshot('shared_store_unavailable'),
      status:'UNAVAILABLE',configured:true,provider:'opensky_rest',provider_name:'OpenSky Network',
      coverage:{complete:false,bounds:config.bounds,query_scope:'contracted_operational_bounds'},
      last_error_code:'shared_store_unavailable',
      provenance:{source:'OpenSky Network REST API',feed_mode:'bounded_rest_polling_snapshot',
        shared_store_required:true,fabricated_data_used:false},
    };
  }
}

function resetForTests() {
  if(pollTimer)clearInterval(pollTimer);
  if(leaseTimer)clearInterval(leaseTimer);
  pollTimer=null;leaseTimer=null;pollInFlight=null;
  ownerToken=null;workerConfig=null;aircraft=new Map();
  accessToken=null;accessTokenExpiresAt=0;
  lastSuccessfulPollAt=null;lastPositionAt=null;lastProviderTime=null;
  messageCount=0;positionCount=0;rejectedCount=0;rateLimitRemaining=null;
  lastErrorCode=null;nextPollAt=0;rateLimitRetrySeconds=null;
}

module.exports={
  parseBounds,creditsForBounds,getConfig,epochIso,classifyFreshness,normaliseStateVector,
  buildStatesUrl,getAccessToken,fetchStates,rememberPosition,purgeExpired,snapshot,
  getSnapshot,stopWorker,resetForTests,
};
