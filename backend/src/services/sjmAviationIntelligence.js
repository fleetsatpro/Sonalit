'use strict';

const crypto=require('crypto');
const {getRedis}=require('../config/redis');

const AIRWEATHER_BASE='https://aviationweather.gov/api/data';
const ADSBLOL_BASE='https://api.adsb.lol';
const FLYITALYADSB_BASE='https://api.flyitalyadsb.com/v2';
const FLYITALYADSB_RADIUS_KM=500;
const FLYITALYADSB_MAX_POSITION_AGE_SECONDS=60;
const FLYITALYADSB_CACHE_TTL_MS=60*1000;
const FLYITALYADSB_SHARED_CACHE_TTL_MS=FLYITALYADSB_CACHE_TTL_MS;
const FLYITALYADSB_SHARED_LOCK_TTL_MS=15_000;
const FLYITALYADSB_REQUESTS_PER_MINUTE=25;
const FLYITALYADSB_REQUESTS_PER_MONTH=270_000;
const FLYITALYADSB_REDIS_PREFIX='sonalit:sjm:airspace:flyitalyadsb:v1';
const FLYITALYADSB_USE_RESTRICTIONS=Object.freeze(['NOT_FOR_SAFETY_OF_LIFE','NOT_FOR_AIR_TRAFFIC_CONTROL','NOT_FOR_NAVIGATION','NOT_FOR_PERSON_TRACKING_OR_HARASSMENT']);
const FLYITALYADSB_RELEASE_LOCK_SCRIPT="if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
const FLYITALYADSB_RATE_LIMIT_SCRIPT="local now=tonumber(ARGV[1]); local window=tonumber(ARGV[2]); local limit=tonumber(ARGV[3]); local member=ARGV[4]; redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-window); local count=redis.call('ZCARD',KEYS[1]); if count >= limit then return 0 end; redis.call('ZADD',KEYS[1],now,member); redis.call('EXPIRE',KEYS[1],math.ceil(window/1000)+5); return count+1";
const KCAA_AIM_URL='https://aim.kcaa.or.ke/';
const EAD_URL='https://www.eurocontrol.int/service/european-ais-database';

const responseCache=new Map();
const CACHE_LIMIT=300;
const DEFAULT_WEATHER_TTL_MS=5*60*1000;
const DEFAULT_LOOKUP_TTL_MS=30*1000;
const ADSBLOL_AREA_RADIUS_NM=250;
const ADSBLOL_MAX_POSITION_AGE_SECONDS=10*60;
const areaLoadPromises=new Map();

let airportReferenceIndex=null;
let airportReferenceExpiresAt=0;
let airportReferenceLoadPromise=null;
let airportReferenceFailure=null;
let airportReferenceFailureExpiresAt=0;
const AIRPORT_REFERENCE_FAILURE_TTL_MS=15*60*1000;
const AIRPORT_REFERENCE_URL='https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const AIRPORT_REFERENCE_TTL_MS=24*60*60*1000;
const MAX_AIRPORT_REFERENCE_BYTES=24*1024*1024;

let flyItalyRedisReadyPromise=null;

async function readyFlyItalyRedis(redis) {
  if(!redis)throw new Error('FlyItalyADSB shared quota store is disabled.');
  if(redis.status==='end')throw new Error('FlyItalyADSB shared quota store is closed.');
  if(redis.status==='wait'){
    if(!flyItalyRedisReadyPromise)flyItalyRedisReadyPromise=redis.connect().catch(error=>{flyItalyRedisReadyPromise=null;throw error;});
    await Promise.race([
      flyItalyRedisReadyPromise,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('FlyItalyADSB shared Redis connection timed out.')),3_000)),
    ]);
  }
  if(redis.status!=='ready'){
    await Promise.race([
      redis.ping(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('FlyItalyADSB shared Redis readiness check timed out.')),3_000)),
    ]);
  }
  return redis;
}

function flyItalySharedKeys(icao,now=Date.now()) {
  const month=new Date(now).toISOString().slice(0,7).replace('-','');
  return {
    cache:FLYITALYADSB_REDIS_PREFIX+':cache:'+icao,
    lock:FLYITALYADSB_REDIS_PREFIX+':lock:'+icao,
    minute:FLYITALYADSB_REDIS_PREFIX+':requests:rolling-minute',
    month:FLYITALYADSB_REDIS_PREFIX+':requests:month:'+month,
    monthExpirySeconds:Math.max(60,Math.ceil((Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth()+1,1)-now)/1000)+86400),
  };
}

async function readFlyItalySharedCache(redis,key,localKey,now=Date.now()) {
  const raw=await redis.get(key);
  if(!raw)return null;
  let envelope;
  try{envelope=JSON.parse(raw);}catch{return null;}
  const remaining=Number(envelope?.expires_at)-now;
  if(!envelope?.value||!Number.isFinite(remaining)||remaining<=0)return null;
  const value={...envelope.value,cache_state:'SHARED_HIT'};
  cacheSet(localKey,value,remaining,now);
  return value;
}

async function writeFlyItalySharedCache(redis,key,localKey,value,ttlMs,now=Date.now()) {
  cacheSet(localKey,value,ttlMs,now);
  await redis.set(key,JSON.stringify({expires_at:now+ttlMs,value}),'PX',Math.max(1,Math.floor(ttlMs)));
  return value;
}

function flyItalyQuotaResponse({status='RATE_LIMITED',reason,centre,retryAfterSeconds,now=Date.now()}={}) {
  return {
    status,configured:true,reason,retry_after_seconds:retryAfterSeconds||null,
    records:[],record_count:0,radius_km:FLYITALYADSB_RADIUS_KM,
    coverage:{complete:false,query_scope:'airport_centred_radius',centre,radius_km:FLYITALYADSB_RADIUS_KM},
    source:'FlyItalyADSB',license:'CC-BY-SA-4.0',
    commercial_use_permitted:true,attribution_required:true,share_alike_required:true,
    service_level:'BEST_EFFORT',maximum_radius_km:FLYITALYADSB_RADIUS_KM,
    requests_per_minute:FLYITALYADSB_REQUESTS_PER_MINUTE,
    requests_per_month:FLYITALYADSB_REQUESTS_PER_MONTH,
    quota_scope:'shared_product_key',
    provenance:{provider:'flyitalyadsb',data_license:'CC-BY-SA-4.0',fabricated_data_used:false},
    checked_at:new Date(now).toISOString(),
  };
}

async function readFlyItalyCacheDuringLock(redis,sharedCacheKey,localCacheKey,now=Date.now()) {
  for(let attempt=0;attempt<10;attempt++){
    const cached=await readFlyItalySharedCache(redis,sharedCacheKey,localCacheKey,now);
    if(cached)return cached;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  return null;
}

function parseCsvRows(input) {
  const rows=[];
  let row=[],field='',quoted=false;
  const text=String(input||'');
  for(let i=0;i<text.length;i++){
    const character=text[i];
    if(quoted){
      if(character==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(character==='"')quoted=false;
      else field+=character;
    }else if(character==='"')quoted=true;
    else if(character===','){row.push(field);field='';}
    else if(character==='\n'){
      row.push(field.replace(/\r$/,''));
      if(row.some(value=>value!==''))rows.push(row);
      row=[];field='';
    }else field+=character;
  }
  row.push(field.replace(/\r$/,''));
  if(row.some(value=>value!==''))rows.push(row);
  if(quoted)throw new Error('Airport reference CSV contains an unterminated quoted field.');
  return rows;
}

function buildAirportReferenceIndex(csv) {
  const rows=parseCsvRows(csv);
  if(rows.length<2)throw new Error('Airport reference dataset is empty.');
  const headers=rows[0].map(value=>String(value||'').trim());
  const column=name=>headers.indexOf(name);
  const indexes={
    ident:column('ident'),gps:column('gps_code'),iata:column('iata_code'),
    name:column('name'),municipality:column('municipality'),country:column('iso_country'),
    latitude:column('latitude_deg'),longitude:column('longitude_deg'),
    elevation:column('elevation_ft'),type:column('type'),scheduled:column('scheduled_service'),
  };
  if(indexes.ident<0||indexes.iata<0||indexes.name<0)throw new Error('Airport reference CSV is missing required identifier columns.');
  const byIata=Object.create(null),byIcao=Object.create(null);
  let airports=0;
  for(const row of rows.slice(1)){
    const rawIata=String(row[indexes.iata]||'').trim().toUpperCase();
    const iata=/^[A-Z]{3}$/.test(rawIata)?rawIata:null;
    const ident=String(row[indexes.ident]||'').trim().toUpperCase();
    const gps=indexes.gps>=0?String(row[indexes.gps]||'').trim().toUpperCase():'';
    const icao=/^[A-Z]{4}$/.test(ident)?ident:/^[A-Z]{4}$/.test(gps)?gps:null;
    if(!icao)continue;
    const latitude=numberOrNull(row[indexes.latitude]);
    const longitude=numberOrNull(row[indexes.longitude]);
    const record={
      iata,icao,
      name:String(row[indexes.name]||'').trim()||null,
      municipality:indexes.municipality>=0?String(row[indexes.municipality]||'').trim()||null:null,
      country_code:indexes.country>=0?String(row[indexes.country]||'').trim().toUpperCase()||null:null,
      latitude,longitude,
      elevation_ft:indexes.elevation>=0?numberOrNull(row[indexes.elevation]):null,
      airport_type:indexes.type>=0?String(row[indexes.type]||'').trim()||null:null,
      scheduled_service:indexes.scheduled>=0?String(row[indexes.scheduled]||'').trim().toLowerCase()==='yes':null,
      source:'OurAirports',
      source_license:'Public Domain',
    };
    if(iata){
      if(!byIata[iata])byIata[iata]=[];
      byIata[iata].push(record);
    }
    if(!byIcao[icao])byIcao[icao]=[];
    byIcao[icao].push(record);airports++;
  }
  if(airports===0)throw new Error('Airport reference dataset contains no usable IATA/ICAO mappings.');
  return {byIata,byIcao,airport_record_count:airports,source:'OurAirports',license:'Public Domain'};
}

function resolveAirportCode(code,index) {
  const value=String(code||'').trim().toUpperCase();
  if(!/^[A-Z]{3,4}$/.test(value))return {
    status:'NOT_REQUESTED',reason:'airport_code_must_be_three_letter_iata_or_four_letter_icao',
    supplied_code:value||null,airport:null,source:'OurAirports',
  };
  if(!index||!index.byIata||!index.byIcao)return {
    status:'UNAVAILABLE',reason:'airport_reference_dataset_unavailable',
    supplied_code:value,airport:null,source:'OurAirports',
  };
  const records=(value.length===4?index.byIcao[value]:index.byIata[value])||[];
  const unique=new Map(records.map(record=>[record.icao,record]));
  const candidates=[...unique.values()];
  if(candidates.length===0)return {
    status:'NOT_FOUND',reason:'no_exact_iata_icao_reference_match',
    supplied_code:value,airport:null,candidate_count:0,source:'OurAirports',
  };
  if(candidates.length>1)return {
    status:'AMBIGUOUS',reason:'multiple_airports_share_the_supplied_identifier',
    supplied_code:value,airport:null,candidate_count:candidates.length,
    candidates:candidates.slice(0,10),source:'OurAirports',
  };
  return {
    status:'RESOLVED',reason:null,supplied_code:value,
    supplied_code_type:value.length===3?'IATA':'ICAO',
    airport:candidates[0],candidate_count:1,source:'OurAirports',license:'Public Domain',
  };
}

async function loadAirportReferenceIndex({fetcher=global.fetch,now=Date.now()}={}) {
  if(airportReferenceIndex&&airportReferenceExpiresAt>now)return airportReferenceIndex;
  if(airportReferenceFailure&&airportReferenceFailureExpiresAt>now)throw new Error(airportReferenceFailure);
  if(airportReferenceLoadPromise)return airportReferenceLoadPromise;
  airportReferenceLoadPromise=(async()=>{
    if(typeof fetcher!=='function')throw new Error('Global fetch is unavailable.');
    const response=await fetcher(AIRPORT_REFERENCE_URL,{
      method:'GET',
      headers:{Accept:'text/csv','User-Agent':'Sonalit-SJM/1.0 (airport reference data)'},
      redirect:'error',
      signal:AbortSignal.timeout(20_000),
    });
    if(!response.ok)throw new Error('OurAirports reference download failed with HTTP '+response.status+'.');
    const length=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(length)&&length>MAX_AIRPORT_REFERENCE_BYTES)throw new Error('OurAirports reference CSV exceeds the configured size limit.');
    const csv=await response.text();
    if(csv.length>MAX_AIRPORT_REFERENCE_BYTES)throw new Error('OurAirports reference CSV exceeds the configured size limit.');
    const index=buildAirportReferenceIndex(csv);
    airportReferenceIndex=index;
    airportReferenceExpiresAt=now+AIRPORT_REFERENCE_TTL_MS;
    airportReferenceFailure=null;airportReferenceFailureExpiresAt=0;
    return index;
  })();
  try{return await airportReferenceLoadPromise;}
  catch(error){
    airportReferenceFailure=error?.message||'airport_reference_provider_unavailable';
    airportReferenceFailureExpiresAt=Date.now()+AIRPORT_REFERENCE_FAILURE_TTL_MS;
    throw error;
  }finally{airportReferenceLoadPromise=null;}
}

function cleanCode(value,max=16) {
  const code=String(value||'').trim().toUpperCase();
  return /^[A-Z0-9-]+$/.test(code)&&code.length<=max?code:null;
}

function validBaseUrl(value,allowedHosts) {
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    if(!allowedHosts.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return null;
    if(url.search||url.hash)return null;
    let pathname=url.pathname;
    while(pathname.endsWith('/'))pathname=pathname.slice(0,-1);
    return url.origin+pathname;
  }catch{return null;}
}

function getAdsbLolConfig(env=process.env) {
  const enabled=env.SJM_ADSBLOL_ENABLED==='true';
  const odblCompliance=env.SJM_ADSBLOL_ODBL_COMPLIANCE_CONFIRMED==='true';
  let reason=null;
  if(!enabled)reason='disabled';
  else if(!odblCompliance)reason='odbl_database_obligations_not_reviewed';
  return {
    enabled:!reason,reason,baseUrl:ADSBLOL_BASE,
    license:'ODbL-1.0',commercial_use_permitted:true,
    attribution_required:true,service_level:'BEST_EFFORT',
    production_contact_recommended:true,
  };
}

function getFlyItalyAdsbConfig(env=process.env) {
  const enabled=env.SJM_FLYITALYADSB_ENABLED==='true';
  const compliance=env.SJM_FLYITALYADSB_CC_BY_SA_COMPLIANCE_CONFIRMED==='true';
  const informationalUse=env.SJM_FLYITALYADSB_INFORMATIONAL_USE_CONFIRMED==='true';
  const apiKey=String(env.FLYITALYADSB_API_KEY||'').trim();
  let reason=null;
  if(!enabled)reason='disabled';
  else if(!compliance)reason='cc_by_sa_share_alike_obligations_not_reviewed';
  else if(!informationalUse)reason='non_safety_informational_use_not_confirmed';
  else if(!apiKey||/[\r\n]/.test(apiKey))reason='api_key_missing_or_invalid';
  return {
    enabled:!reason,reason,baseUrl:FLYITALYADSB_BASE,apiKey:!reason?apiKey:null,
    license:'CC-BY-SA-4.0',commercial_use_permitted:true,
    attribution_required:true,share_alike_required:true,
    service_level:'BEST_EFFORT',production_contact_recommended:false,
    requests_per_minute:30,requests_per_month:300000,
    maximum_radius_km:FLYITALYADSB_RADIUS_KM,
    use_restrictions:FLYITALYADSB_USE_RESTRICTIONS,
  };
}

function getAeroDataBoxConfig(env=process.env) {
  const enabled=env.SJM_AERODATABOX_ENABLED==='true';
  const commercial=env.SJM_AERODATABOX_COMMERCIAL_LICENSE_CONFIRMED==='true';
  const derivedWork=env.SJM_AERODATABOX_DERIVED_WORK_LICENSE_CONFIRMED==='true';
  const apiKey=String(env.AERODATABOX_API_KEY||'').trim();
  const baseUrl=validBaseUrl(env.AERODATABOX_API_BASE_URL||'',[
    'aerodatabox.com','rapidapi.com','api.market',
  ]);
  const header=String(env.AERODATABOX_API_KEY_HEADER||'X-API-Key').trim();
  let reason=null;
  if(!enabled)reason='disabled';
  else if(!commercial)reason='commercial_api_license_not_confirmed';
  else if(!derivedWork)reason='downstream_derived_work_rights_not_confirmed';
  else if(!apiKey)reason='api_credentials_missing';
  else if(!baseUrl)reason='subscription_base_url_missing_or_untrusted';
  else if(!/^[A-Za-z0-9-]{2,64}$/.test(header))reason='api_key_header_invalid';
  return {enabled:!reason,reason,apiKey:!reason?apiKey:null,baseUrl:!reason?baseUrl:null,header};
}

function cacheGet(key,now=Date.now()) {
  const item=responseCache.get(key);
  if(!item)return null;
  if(item.expiresAt<=now){responseCache.delete(key);return null;}
  return item.value;
}

function cacheSet(key,value,ttl,now=Date.now()) {
  if(responseCache.size>=CACHE_LIMIT){
    const oldest=responseCache.keys().next().value;
    if(oldest)responseCache.delete(oldest);
  }
  responseCache.set(key,{value,expiresAt:now+ttl});
  return value;
}

function refreshCachedAircraftArea(value,now,{maxAgeSeconds,liveSeconds,delayedSeconds}={}) {
  if(!value||!Array.isArray(value.records)||!value.records.length)return value;
  const records=[];
  let expiredCount=0;
  for(const record of value.records){
    const observedAt=Date.parse(record?.observed_at||'');
    if(!Number.isFinite(observedAt)){
      expiredCount++;
      continue;
    }
    const ageSeconds=Math.max(0,Math.floor((now-observedAt)/1000));
    if(!Number.isFinite(ageSeconds)||ageSeconds>maxAgeSeconds){
      expiredCount++;
      continue;
    }
    records.push({
      ...record,
      age_seconds:ageSeconds,
      freshness:ageSeconds<=liveSeconds?'LIVE':ageSeconds<=delayedSeconds?'DELAYED':'STALE',
    });
  }
  const result={...value,records,record_count:records.length};
  if(expiredCount){
    result.rejected_count=(Number(value.rejected_count)||0)+expiredCount;
    result.expired_cache_record_count=expiredCount;
    if(!records.length){
      result.status='UNAVAILABLE';
      result.reason='cached_positions_expired';
    }
  }
  return result;
}

async function requestJson(url,{headers={},fetcher=global.fetch,timeoutMs=10_000}={}) {
  if(typeof fetcher!=='function')throw new Error('Global fetch is unavailable.');
  const response=await fetcher(url,{
    method:'GET',headers:{Accept:'application/json',...headers},
    redirect:'error',
    signal:AbortSignal.timeout(timeoutMs),
  });
  if(response.status===204)return null;
  if(!response.ok){
    const error=new Error('Aviation data provider returned HTTP '+response.status+'.');
    error.code=response.status===429?'rate_limited':response.status>=500?'provider_unavailable':'provider_rejected';
    error.status=response.status;
    const retryAfter=Number(response.headers?.get?.('retry-after')||response.headers?.get?.('x-ratelimit-reset-after'));
    error.retryAfterSeconds=Number.isFinite(retryAfter)?Math.max(1,Math.min(3600,Math.floor(retryAfter))):response.status===429?60:null;
    throw error;
  }
  return response.json();
}

function isoTime(value) {
  if(value==null||value==='')return null;
  const numeric=Number(value);
  const date=Number.isFinite(numeric)&&String(value).trim()!==''
    ?new Date(numeric>10_000_000_000?numeric:numeric*1000)
    :new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}

function numberOrNull(value) {
  if(value==null||value==='')return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

function normaliseWeatherRecords(records,type,now=Date.now()) {
  const list=Array.isArray(records)?records:[];
  return list.slice(0,100).map(item=>{
    const observed=item?.obsTime??item?.issueTime??item?.issueTimeUTC??null;
    const observedAt=isoTime(observed);
    return {
      kind:type,
      station_icao:item?.icaoId||item?.stationId||null,
      station_name:item?.name||item?.stationName||null,
      observed_at:observedAt,
      valid_from:isoTime(item?.validTimeFrom),
      valid_to:isoTime(item?.validTimeTo),
      raw:item?.rawOb||item?.rawTAF||item?.rawAirSigmet||item?.rawSigmet||null,
      wind_direction_deg:numberOrNull(item?.wdir),
      wind_speed_kt:numberOrNull(item?.wspd),
      wind_gust_kt:numberOrNull(item?.wgst),
      visibility_sm:item?.visib==null?null:item.visib,
      temperature_c:numberOrNull(item?.temp),
      dewpoint_c:numberOrNull(item?.dewp),
      altimeter_inhg:numberOrNull(item?.altim),
      provider:'aviationweather_gov',
      evidence_class:'OBSERVED',
    };
  });
}

async function loadInternationalSigmets({fetcher=global.fetch,now=Date.now(),headers={}}={}) {
  const key='weather:sigmets:international';
  const cached=cacheGet(key,now);
  if(cached)return {...refreshCachedAircraftArea(cached,now,{maxAgeSeconds:ADSBLOL_MAX_POSITION_AGE_SECONDS,liveSeconds:45,delayedSeconds:180}),cache_state:'HIT'};
  try{
    const payload=await requestJson(AIRWEATHER_BASE+'/isigmet?format=json',{headers,fetcher});
    const records=normaliseWeatherRecords(payload,'SIGMET',now);
    return cacheSet(key,{
      status:records.length?'AVAILABLE':'NO_DATA',records,reason:null,
      source:'AviationWeather.gov Data API',
      source_scope:'worldwide international SIGMET response; not route-filtered',
      checked_at:new Date(now).toISOString(),cache_state:'MISS',
      provenance:{provider:'aviationweather_gov',fabricated_data_used:false},
    },DEFAULT_WEATHER_TTL_MS,now);
  }catch(error){
    return cacheSet(key,{
      status:'UNAVAILABLE',records:[],reason:error?.code||'provider_error',
      source:'AviationWeather.gov Data API',
      source_scope:'worldwide international SIGMET response; not route-filtered',
      checked_at:new Date(now).toISOString(),cache_state:'MISS',
      provenance:{provider:'aviationweather_gov',fabricated_data_used:false},
    },DEFAULT_WEATHER_TTL_MS,now);
  }
}

async function loadWeather({airportIcao,fetcher=global.fetch,now=Date.now()}={}) {
  const icao=cleanCode(airportIcao,4);
  if(!icao||icao.length!==4)return {
    status:'NOT_REQUESTED',reason:'journey_airport_icao_required',
    station_icao:null,metar:[],taf:[],international_sigmets:[],
  };
  const key='weather:'+icao;
  const cached=cacheGet(key,now);
  if(cached)return {...cached,cache_state:'HIT'};
  const userAgent=String(process.env.SJM_AVIATION_WEATHER_USER_AGENT||'Sonalit-SJM/1.0 (aviation data integration)').slice(0,160);
  const headers={'User-Agent':userAgent};
  const params=new URLSearchParams({ids:icao,format:'json'});
  const [metarResult,tafResult,sigmetResult]=await Promise.allSettled([
    requestJson(AIRWEATHER_BASE+'/metar?'+params,{headers,fetcher}),
    requestJson(AIRWEATHER_BASE+'/taf?'+params,{headers,fetcher}),
    loadInternationalSigmets({headers,fetcher,now}),
  ]);
  const metar=metarResult.status==='fulfilled'?normaliseWeatherRecords(metarResult.value,'METAR',now):[];
  const taf=tafResult.status==='fulfilled'?normaliseWeatherRecords(tafResult.value,'TAF',now):[];
  const sigmets=sigmetResult.status==='fulfilled'?(sigmetResult.value?.records||[]):[];
  const failures=[metarResult,tafResult,sigmetResult].filter(result=>
    result.status==='rejected'||result.value?.status==='UNAVAILABLE',
  );
  const hasRecords=Boolean(metar.length||taf.length||sigmets.length);
  const data={
    status:failures.length===3?'UNAVAILABLE':failures.length?'PARTIAL':hasRecords?'AVAILABLE':'NO_DATA',
    reason:failures.length?failures.map(result=>result.reason?.code||result.value?.reason||'provider_error').join(','):null,
    station_icao:icao,metar,taf,
    international_sigmets:sigmets,
    last_checked_at:new Date(now).toISOString(),
    source:'AviationWeather.gov Data API',
    source_scope:'worldwide METAR / TAF / international SIGMET',
    cache_state:'MISS',
    provenance:{provider:'aviationweather_gov',fabricated_data_used:false},
  };
  return cacheSet(key,data,DEFAULT_WEATHER_TTL_MS,now);
}

function normaliseAdsbLolRecord(item,now=Date.now()) {
  if(!item||typeof item!=='object')return null;
  const hex=String(item.hex||item.icao24||'').trim().toLowerCase();
  const flight=String(item.flight||item.callsign||'').trim();
  const lat=numberOrNull(item.lat),lon=numberOrNull(item.lon);
  if(!/^[0-9a-f]{6}$/.test(hex)||!flight||!Number.isFinite(lat)||!Number.isFinite(lon)||
    lat < -90||lat > 90||lon < -180||lon > 180)return null;
  const seenPosition=numberOrNull(item.seen_pos);
  if(Number.isFinite(seenPosition)&&(seenPosition<0||seenPosition>ADSBLOL_MAX_POSITION_AGE_SECONDS))return null;
  const observedAt=Number.isFinite(seenPosition)
    ?new Date(now-seenPosition*1000).toISOString():null;
  const geometric=numberOrNull(item.alt_geom);
  const barometric=numberOrNull(item.alt_baro);
  return {
    id:hex,ident:flight.replace(/\s+/g,' ').trim(),
    registration:item.r||null,latitude:lat,longitude:lon,
    geometric_altitude_m:Number.isFinite(geometric)?geometric*0.3048:null,
    barometric_altitude_ft:Number.isFinite(barometric)?barometric:null,
    ground_speed_kt:numberOrNull(item.gs),
    heading_deg:numberOrNull(item.track),
    on_ground:item.alt_baro==='ground'?true:numberOrNull(item.alt_baro)!==null?false:null,
    provider:'adsb_lol',observed_at:observedAt,
    age_seconds:Number.isFinite(seenPosition)?seenPosition:null,
    evidence_class:'OBSERVED',timestamp_basis:'derived_from_provider_seen_pos',
  };
}


function normaliseAdsbLolAreaRecord(item,now=Date.now()) {
  if(!item||typeof item!=='object')return null;
  const hex=String(item.hex||item.icao24||'').trim().toLowerCase();
  const latitude=numberOrNull(item.lat),longitude=numberOrNull(item.lon);
  const seenPosition=numberOrNull(item.seen_pos);
  if(!/^[0-9a-f]{6}$/.test(hex)||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude > 90||longitude < -180||longitude > 180||
    !Number.isFinite(seenPosition)||seenPosition<0||seenPosition>ADSBLOL_MAX_POSITION_AGE_SECONDS)return null;
  const ageSeconds=Math.max(0,Math.floor(seenPosition));
  const geometricFeet=numberOrNull(item.alt_geom);
  const barometricFeet=item.alt_baro==='ground'?null:numberOrNull(item.alt_baro);
  // readsb alt_geom is geometric GNSS/INS altitude in feet referenced to the WGS-84 ellipsoid.
  // Cesium.fromDegrees expects ellipsoid height; barometric altitude remains display-only.
  const geometricMetres=Number.isFinite(geometricFeet)?geometricFeet*0.3048:null;
  const barometricMetres=Number.isFinite(barometricFeet)?barometricFeet*0.3048:null;
  const speedKnots=numberOrNull(item.gs);
  const heading=numberOrNull(item.track);
  const callsign=String(item.flight||item.callsign||'').trim().replace(/\s+/g,' ');
  return {
    id:hex,map_key:'adsb_lol:'+hex,ident:callsign||hex.toUpperCase(),
    registration:textOrNull(item.r),aircraft_type:textOrNull(item.t),latitude,longitude,
    altitude_m:geometricMetres??barometricMetres,
    altitude_reference:geometricMetres!==null?'WGS84_ELLIPSOID':barometricMetres!==null?'BAROMETRIC_PRESSURE':null,
    geometric_altitude_m:geometricMetres,barometric_altitude_m:barometricMetres,
    ground_speed_mps:Number.isFinite(speedKnots)?speedKnots*0.514444:null,
    heading_deg:Number.isFinite(heading)&&heading>=0&&heading<=360?heading:null,
    vertical_rate_mps:null,
    on_ground:item.alt_baro==='ground'?true:barometricMetres!==null?false:null,
    origin_country:null,origin:null,destination:null,
    provider:'adsb_lol',position_provider:'adsb_lol',
    position_source_label:'ADSB.lol ADS-B network',
    observed_at:new Date(now-ageSeconds*1000).toISOString(),
    age_seconds:ageSeconds,
    freshness:ageSeconds<=45?'LIVE':ageSeconds<=180?'DELAYED':'STALE',
    timestamp_basis:'derived_from_provider_seen_pos',
    evidence_class:'OBSERVED',trail:[],
  };
}

function normaliseFlyItalyAdsbRecord(item,now=Date.now()) {
  if(!item||typeof item!=='object')return null;
  const hex=String(item.hex||item.icao24||'').trim().toLowerCase();
  const latitude=numberOrNull(item.lat),longitude=numberOrNull(item.lon);
  const seenPosition=numberOrNull(item.seen_pos);
  if(!/^[0-9a-f]{6}$/.test(hex)||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude > 90||longitude < -180||longitude > 180||
    !Number.isFinite(seenPosition)||seenPosition<0||seenPosition>FLYITALYADSB_MAX_POSITION_AGE_SECONDS)return null;
  const ageSeconds=Math.max(0,Math.floor(seenPosition));
  const geometricFeet=numberOrNull(item.alt_geom);
  const barometricFeet=item.alt_baro==='ground'?null:numberOrNull(item.alt_baro);
  // readsb alt_geom is geometric GNSS/INS altitude in feet referenced to the WGS-84 ellipsoid.
  // Cesium.fromDegrees expects ellipsoid height; barometric altitude remains display-only.
  const geometricMetres=Number.isFinite(geometricFeet)?geometricFeet*0.3048:null;
  const barometricMetres=Number.isFinite(barometricFeet)?barometricFeet*0.3048:null;
  const speedKnots=numberOrNull(item.gs);
  const heading=numberOrNull(item.track);
  const callsign=String(item.flight||item.callsign||'').trim().replace(/\s+/g,' ');
  const positionSource=String(item.type||'').trim().toLowerCase()||null;
  const positionSourceLabel=positionSource==='mlat'?'MLAT':
    positionSource==='adsb_icao'||positionSource==='adsb_other'?'ADS-B':
    positionSource==='tisb_icao'||positionSource==='tisb_other'?'TIS-B':
    positionSource==='adsr_icao'?'ADS-R':null;
  return {
    id:hex,map_key:'flyitalyadsb:'+hex,ident:callsign||hex.toUpperCase(),
    registration:textOrNull(item.r),aircraft_type:textOrNull(item.t),latitude,longitude,
    altitude_m:geometricMetres??barometricMetres,
    altitude_reference:geometricMetres!==null?'WGS84_ELLIPSOID':barometricMetres!==null?'BAROMETRIC_PRESSURE':null,
    geometric_altitude_m:geometricMetres,barometric_altitude_m:barometricMetres,
    ground_speed_mps:Number.isFinite(speedKnots)?speedKnots*0.514444:null,
    heading_deg:Number.isFinite(heading)&&heading>=0&&heading<=360?heading:null,
    vertical_rate_mps:numberOrNull(item.baro_rate)==null?null:numberOrNull(item.baro_rate)*0.00508,
    on_ground:item.alt_baro==='ground'?true:barometricMetres!==null?false:null,
    origin_country:null,origin:null,destination:null,
    provider:'flyitalyadsb',position_provider:'flyitalyadsb',
    position_source:positionSource,position_source_label:positionSourceLabel?'FlyItalyADSB '+positionSourceLabel:'FlyItalyADSB source not supplied',
    observed_at:new Date(now-ageSeconds*1000).toISOString(),
    age_seconds:ageSeconds,
    freshness:ageSeconds<=15?'LIVE':ageSeconds<=45?'DELAYED':'STALE',
    timestamp_basis:'derived_from_provider_seen_pos',
    evidence_class:'OBSERVED',trail:[],
  };
}

async function loadFlyItalyAdsbArea({airport,env=process.env,fetcher=global.fetch,now=Date.now(),redisClient}={}) {
  const config=getFlyItalyAdsbConfig(env);
  if(!config.enabled)return {
    status:'NOT_CONFIGURED',configured:false,reason:config.reason,records:[],
    radius_km:FLYITALYADSB_RADIUS_KM,source:'FlyItalyADSB',license:config.license,
    commercial_use_permitted:config.commercial_use_permitted,
    attribution_required:config.attribution_required,share_alike_required:config.share_alike_required,
    service_level:config.service_level,maximum_radius_km:config.maximum_radius_km,
    requests_per_minute:config.requests_per_minute,requests_per_month:config.requests_per_month,
    use_restrictions:config.use_restrictions,
  };
  const icao=cleanCode(airport?.icao,4);
  const latitude=numberOrNull(airport?.latitude),longitude=numberOrNull(airport?.longitude);
  if(!icao||icao.length!==4||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude > 90||longitude < -180||longitude > 180)return {
      status:'NOT_REQUESTED',configured:true,reason:'uniquely_resolved_airport_coordinates_required',
      records:[],radius_km:FLYITALYADSB_RADIUS_KM,source:'FlyItalyADSB',license:config.license,
      attribution_required:true,share_alike_required:true,
      requests_per_minute:config.requests_per_minute,requests_per_month:config.requests_per_month,
    };
  const localKey='flyitalyadsb-area:'+icao+':'+FLYITALYADSB_RADIUS_KM;
  const cached=cacheGet(localKey,now);
  if(cached)return {...refreshCachedAircraftArea(cached,now,{maxAgeSeconds:FLYITALYADSB_MAX_POSITION_AGE_SECONDS,liveSeconds:15,delayedSeconds:45}),cache_state:'HIT'};
  const pending=areaLoadPromises.get(localKey);
  if(pending)return pending;
  const request=(async()=>{
    const centre={icao,latitude,longitude};
    const unavailable=(reason)=>flyItalyQuotaResponse({
      status:'UNAVAILABLE',reason,centre,now,
    });
    let redis;
    try{
      redis=await readyFlyItalyRedis(redisClient===undefined?getRedis():redisClient);
    }catch{
      return unavailable('shared_product_quota_store_unavailable');
    }
    const keys=flyItalySharedKeys(icao,now);
    try{
      const shared=await readFlyItalySharedCache(redis,keys.cache,localKey,now);
      if(shared)return refreshCachedAircraftArea(shared,now,{maxAgeSeconds:FLYITALYADSB_MAX_POSITION_AGE_SECONDS,liveSeconds:15,delayedSeconds:45});
      const lockToken=crypto.randomUUID();
      const lockResult=await redis.set(keys.lock,lockToken,'PX',FLYITALYADSB_SHARED_LOCK_TTL_MS,'NX');
      if(lockResult!=='OK'){
        const refreshed=await readFlyItalyCacheDuringLock(redis,keys.cache,localKey,now).catch(()=>null);
        return refreshed?refreshCachedAircraftArea(refreshed,now,{maxAgeSeconds:FLYITALYADSB_MAX_POSITION_AGE_SECONDS,liveSeconds:15,delayedSeconds:45}):flyItalyQuotaResponse({
          status:'REFRESHING',reason:'shared_airport_snapshot_refresh_in_progress',
          centre,retryAfterSeconds:2,now,
        });
      }
      try{
        const requestId=crypto.randomUUID();
        const rateAllowed=Number(await redis.eval(
          FLYITALYADSB_RATE_LIMIT_SCRIPT,1,keys.minute,
          now,60_000,FLYITALYADSB_REQUESTS_PER_MINUTE,requestId,
        ));
        if(rateAllowed<1){
          const limited=flyItalyQuotaResponse({
            reason:'shared_product_per_minute_budget_reached',centre,
            retryAfterSeconds:60,now,
          });
          return await writeFlyItalySharedCache(redis,keys.cache,localKey,limited,15_000,now);
        }
        const monthlyCount=Number(await redis.incr(keys.month));
        if(monthlyCount===1)await redis.expire(keys.month,keys.monthExpirySeconds);
        if(monthlyCount>FLYITALYADSB_REQUESTS_PER_MONTH){
          const limited=flyItalyQuotaResponse({
            reason:'shared_product_monthly_budget_reached',centre,
            retryAfterSeconds:keys.monthExpirySeconds,now,
          });
          return await writeFlyItalySharedCache(redis,keys.cache,localKey,limited,60_000,now);
        }
        const url=config.baseUrl+'/lat/'+latitude.toFixed(4)+'/lon/'+longitude.toFixed(4)+'/dist/'+FLYITALYADSB_RADIUS_KM;
        const payload=await requestJson(url,{
          fetcher,headers:{'X-Api-Key':config.apiKey,'User-Agent':'Sonalit-SJM/1.0 (regional aviation observations)'},
        });
        const providerNowSeconds=Number(payload?.now);
        const providerNowMs=providerNowSeconds*1000;
        if(!Number.isFinite(providerNowMs)||providerNowMs<=0||Math.abs(providerNowMs-now)>120_000){
          const error=new Error('FlyItalyADSB response timestamp is missing or outside the trusted clock window.');
          error.code='provider_timestamp_untrusted';
          throw error;
        }
        const rows=Array.isArray(payload?.ac)?payload.ac:[];
        // Validate the provider snapshot clock above, but anchor seen_pos to Sonalit's receive clock.
        const records=rows.map(record=>normaliseFlyItalyAdsbRecord(record,now)).filter(Boolean);
        const value={
          status:records.length?'AVAILABLE':'NO_DATA',configured:true,reason:null,
          records,record_count:records.length,rejected_count:Math.max(0,rows.length-records.length),
          radius_km:FLYITALYADSB_RADIUS_KM,
          coverage:{complete:false,query_scope:'airport_centred_radius',centre,radius_km:FLYITALYADSB_RADIUS_KM},
          source:'FlyItalyADSB',license:config.license,
          commercial_use_permitted:config.commercial_use_permitted,
          attribution_required:config.attribution_required,share_alike_required:config.share_alike_required,
          service_level:config.service_level,maximum_radius_km:config.maximum_radius_km,
          requests_per_minute:config.requests_per_minute,requests_per_month:config.requests_per_month,
          quota_scope:'shared_product_key',
          checked_at:new Date(now).toISOString(),cache_state:'MISS',
          provenance:{provider:'flyitalyadsb',data_license:config.license,
            timestamp_basis:'provider_seen_pos_relative_age',provider_snapshot_at:new Date(providerNowMs).toISOString(),
            fabricated_data_used:false,permitted_use:'informational_aircraft_observation_only',
            prohibited_uses:config.use_restrictions},
        };
        const stored=await writeFlyItalySharedCache(redis,keys.cache,localKey,value,FLYITALYADSB_SHARED_CACHE_TTL_MS,now);
        return refreshCachedAircraftArea(stored,now,{maxAgeSeconds:FLYITALYADSB_MAX_POSITION_AGE_SECONDS,liveSeconds:15,delayedSeconds:45});
      }catch(error){
        const limited=error?.code==='rate_limited';
        const ttl=limited?Math.max(15,(error.retryAfterSeconds||60))*1000:15_000;
        const value=flyItalyQuotaResponse({
          status:limited?'RATE_LIMITED':'UNAVAILABLE',reason:error?.code||'provider_error',
          centre,retryAfterSeconds:error?.retryAfterSeconds||null,now,
        });
        return await writeFlyItalySharedCache(redis,keys.cache,localKey,value,ttl,now);
      }finally{
        await redis.eval(FLYITALYADSB_RELEASE_LOCK_SCRIPT,1,keys.lock,lockToken).catch(()=>{});
      }
    }catch{
      return unavailable('shared_product_quota_store_unavailable');
    }
  })();
  areaLoadPromises.set(localKey,request);
  try{return await request;}
  finally{if(areaLoadPromises.get(localKey)===request)areaLoadPromises.delete(localKey);}
}


async function loadAdsbLolArea({airport,env=process.env,fetcher=global.fetch,now=Date.now()}={}) {
  const config=getAdsbLolConfig(env);
  if(!config.enabled)return {
    status:'NOT_CONFIGURED',configured:false,reason:config.reason,records:[],
    radius_nm:ADSBLOL_AREA_RADIUS_NM,source:'ADSB.lol',license:config.license,
    commercial_use_permitted:config.commercial_use_permitted,
    attribution_required:config.attribution_required,service_level:config.service_level,
    production_contact_recommended:config.production_contact_recommended,
  };
  const icao=cleanCode(airport?.icao,4);
  const latitude=numberOrNull(airport?.latitude),longitude=numberOrNull(airport?.longitude);
  if(!icao||icao.length!==4||!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude > 90||longitude < -180||longitude > 180){
    return {
      status:'NOT_REQUESTED',configured:true,reason:'uniquely_resolved_airport_coordinates_required',
      records:[],radius_nm:ADSBLOL_AREA_RADIUS_NM,source:'ADSB.lol',license:'ODbL-1.0',
    };
  }
  const key='adsblol-area:'+icao+':'+ADSBLOL_AREA_RADIUS_NM;
  const cached=cacheGet(key,now);
  if(cached)return {...cached,cache_state:'HIT'};
  const pending=areaLoadPromises.get(key);
  if(pending)return pending;
  const request=(async()=>{
    const centre={icao,latitude,longitude};
    try{
      const url=config.baseUrl+'/v2/lat/'+latitude.toFixed(4)+'/lon/'+longitude.toFixed(4)+'/dist/'+ADSBLOL_AREA_RADIUS_NM;
      const payload=await requestJson(url,{
        fetcher,headers:{'User-Agent':'Sonalit-SJM/1.0 (regional aviation observations)'},
      });
      const rows=Array.isArray(payload)?payload:
        Array.isArray(payload?.ac)?payload.ac:
        Array.isArray(payload?.aircraft)?payload.aircraft:[];
      const records=rows.map(record=>normaliseAdsbLolAreaRecord(record,now)).filter(Boolean);
      return cacheSet(key,{
        status:records.length?'AVAILABLE':'NO_DATA',configured:true,reason:null,
        records,record_count:records.length,rejected_count:Math.max(0,rows.length-records.length),
        radius_nm:ADSBLOL_AREA_RADIUS_NM,
        coverage:{complete:false,query_scope:'airport_centred_radius',centre,radius_nm:ADSBLOL_AREA_RADIUS_NM},
        source:'ADSB.lol',license:config.license,
        commercial_use_permitted:config.commercial_use_permitted,
        attribution_required:config.attribution_required,service_level:config.service_level,
        production_contact_recommended:config.production_contact_recommended,
        checked_at:new Date(now).toISOString(),cache_state:'MISS',
        provenance:{provider:'adsb_lol',database_license:config.license,
          timestamp_basis:'provider_seen_pos_relative_age',fabricated_data_used:false},
      },DEFAULT_LOOKUP_TTL_MS,now);
    }catch(error){
      const limited=error?.code==='rate_limited';
      const value={
        status:limited?'RATE_LIMITED':'UNAVAILABLE',configured:true,
        reason:error?.code||'provider_error',retry_after_seconds:error?.retryAfterSeconds||null,
        records:[],record_count:0,radius_nm:ADSBLOL_AREA_RADIUS_NM,
        coverage:{complete:false,query_scope:'airport_centred_radius',centre,radius_nm:ADSBLOL_AREA_RADIUS_NM},
        source:'ADSB.lol',license:config.license,
        commercial_use_permitted:config.commercial_use_permitted,
        attribution_required:config.attribution_required,service_level:config.service_level,
        production_contact_recommended:config.production_contact_recommended,
        provenance:{provider:'adsb_lol',database_license:config.license,fabricated_data_used:false},
      };
      return cacheSet(key,value,limited?(error.retryAfterSeconds||60)*1000:15_000,now);
    }
  })();
  areaLoadPromises.set(key,request);
  try{return await request;}
  finally{if(areaLoadPromises.get(key)===request)areaLoadPromises.delete(key);}
}

async function loadAdsbLolCallsign({callsign,env=process.env,fetcher=global.fetch,now=Date.now()}={}) {
  const config=getAdsbLolConfig(env);
  const ident=normaliseCallsign(callsign);
  if(!config.enabled)return {
    status:'NOT_CONFIGURED',reason:config.reason,records:[],source:'adsb.lol',
    license:config.license,commercial_use_permitted:config.commercial_use_permitted,
    attribution_required:config.attribution_required,service_level:config.service_level,
    production_contact_recommended:config.production_contact_recommended,
  };
  if(!ident||ident.length>16||!/^[A-Z0-9 -]+$/.test(ident))return {status:'NOT_REQUESTED',reason:'valid_callsign_required',records:[],source:'adsb.lol'};
  const key='adsblol:'+ident;
  const cached=cacheGet(key,now);
  if(cached)return {...cached,cache_state:'HIT'};
  try{
    const url=config.baseUrl+'/v2/callsign/'+encodeURIComponent(ident);
    const payload=await requestJson(url,{fetcher});
    const records=Array.isArray(payload)?payload:
      Array.isArray(payload?.ac)?payload.ac:
      Array.isArray(payload?.aircraft)?payload.aircraft:[];
    const normalised=records.map(record=>normaliseAdsbLolRecord(record,now)).filter(Boolean);
    const value={
      status:normalised.length?'AVAILABLE':'NO_MATCH',
      reason:null,records:normalised,source:'adsb.lol',
      licence:config.license,license:config.license,
      commercial_use_permitted:config.commercial_use_permitted,
      attribution_required:config.attribution_required,service_level:config.service_level,
      production_contact_recommended:config.production_contact_recommended,
      cache_state:'MISS',checked_at:new Date(now).toISOString(),
      provenance:{provider:'adsb.lol',database_license:'ODbL-1.0',fabricated_data_used:false},
    };
    return cacheSet(key,value,DEFAULT_LOOKUP_TTL_MS,now);
  }catch(error){
    const limited=error?.code==='rate_limited';
    const value={status:limited?'RATE_LIMITED':'UNAVAILABLE',reason:error?.code||'provider_error',
      retry_after_seconds:error?.retryAfterSeconds||null,records:[],source:'adsb.lol',
      provenance:{provider:'adsb.lol',database_license:'ODbL-1.0',fabricated_data_used:false}};
    return cacheSet(key,value,limited?(error.retryAfterSeconds||60)*1000:15_000,now);
  }
}

function textOrNull(value) {
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const text=String(value).trim();
  return text?text:null;
}

function movementTime(movement,key) {
  const value=movement?.[key];
  if(typeof value==='string'||typeof value==='number')return isoTime(value);
  return isoTime(value?.utc??value?.timestamp??null);
}

function movementLocalTime(movement,key) {
  const value=movement?.[key];
  return textOrNull(value&&typeof value==='object'?value.local:null);
}

function normaliseCommercialMovement(movement) {
  const airport=movement?.airport||{};
  return {
    airport_name:textOrNull(airport.name),
    airport_iata:textOrNull(airport.iata),
    airport_icao:textOrNull(airport.icao),
    country_code:textOrNull(airport.countryCode),
    terminal:textOrNull(movement?.terminal),
    gate:textOrNull(movement?.gate),
    baggage_belt:textOrNull(movement?.baggageBelt),
    scheduled_at:movementTime(movement,'scheduledTime'),
    scheduled_local:movementLocalTime(movement,'scheduledTime'),
    revised_at:movementTime(movement,'revisedTime'),
    revised_local:movementLocalTime(movement,'revisedTime'),
    estimated_at:movementTime(movement,'estimatedTime'),
    estimated_local:movementLocalTime(movement,'estimatedTime'),
    actual_at:movementTime(movement,'actualTime'),
    actual_local:movementLocalTime(movement,'actualTime'),
    runway_at:movementTime(movement,'runwayTime'),
    runway_local:movementLocalTime(movement,'runwayTime'),
    delay_minutes:numberOrNull(movement?.delayMinutes),
  };
}

function normaliseCommercialFlight(record) {
  if(!record||typeof record!=='object')return null;
  const number=textOrNull(record.number??record.flightNumber??record.ident);
  if(!number)return null;
  const airline=record.airline||record.operator||{};
  const aircraft=record.aircraft||{};
  return {
    flight_number:number,
    status:textOrNull(record.status??record.statusText),
    airline_name:textOrNull(airline.name),
    airline_iata:textOrNull(airline.iata),
    airline_icao:textOrNull(airline.icao),
    codeshare_status:textOrNull(record.codeshareStatus),
    aircraft_registration:textOrNull(aircraft.reg??aircraft.registration??record.reg),
    aircraft_type:textOrNull(aircraft.model??aircraft.modelCode??aircraft.type),
    is_cargo:typeof record.isCargo==='boolean'?record.isCargo:null,
    departure:normaliseCommercialMovement(record.departure),
    arrival:normaliseCommercialMovement(record.arrival),
    provider_updated_at:isoTime(record.lastUpdatedUtc??record.lastUpdated??record.updatedAt),
    quality:Array.isArray(record.quality)?record.quality.map(textOrNull).filter(Boolean).slice(0,20):[],
    evidence_class:'COMMERCIAL_PROVIDER_FLIGHT_INFORMATION',
    provenance:{provider:'aerodatabox',provider_record_id:textOrNull(record.id),fabricated_data_used:false},
  };
}

async function loadCommercialFlight({flightNumber,env=process.env,fetcher=global.fetch,now=Date.now()}={}) {
  const config=getAeroDataBoxConfig(env);
  const number=String(flightNumber||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!config.enabled)return {status:'NOT_CONFIGURED',reason:config.reason,flight_number:number||null,flights:[],source:'AeroDataBox'};
  if(!number||number.length>10||!/^[A-Z0-9-]+$/.test(number))return {status:'NOT_REQUESTED',reason:'valid_flight_number_required',flight_number:null,flights:[],source:'AeroDataBox'};
  const key='aerodatabox:'+number;
  const cached=cacheGet(key,now);
  if(cached)return {...cached,cache_state:'HIT'};
  try{
    const url=config.baseUrl+'/flights/number/'+encodeURIComponent(number)+'?dateLocalRole=Both';
    const payload=await requestJson(url,{fetcher,headers:{[config.header]:config.apiKey}});
    const sourceFlights=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.flights)?payload.flights:[];
    const flights=sourceFlights.map(normaliseCommercialFlight).filter(Boolean).slice(0,20);
    const value={
      status:flights.length?'AVAILABLE':'NO_MATCH',
      reason:null,flight_number:number,flights,
      source:'AeroDataBox',cache_state:'MISS',checked_at:new Date(now).toISOString(),
      commercial_data:true,derived_work_rights_confirmed:true,
      provenance:{provider:'aerodatabox',evidence_class:'COMMERCIAL_PROVIDER_FLIGHT_INFORMATION',fabricated_data_used:false},
    };
    return cacheSet(key,value,60_000,now);
  }catch(error){
    const limited=error?.code==='rate_limited';
    const value={status:limited?'RATE_LIMITED':'UNAVAILABLE',reason:error?.code||'provider_error',
      retry_after_seconds:error?.retryAfterSeconds||null,flight_number:number,flights:[],source:'AeroDataBox',
      provenance:{provider:'aerodatabox',fabricated_data_used:false}};
    return cacheSet(key,value,limited?(error.retryAfterSeconds||60)*1000:15_000,now);
  }
}

function normaliseCallsign(value) {
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}

function haversineKm(a,b) {
  const toRad=value=>value*Math.PI/180;
  const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);
  const lat1=toRad(a.latitude),lat2=toRad(b.latitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}

function compareAircraftSources({flightNumber,opensky,adsbLol}={}) {
  const reference=normaliseCallsign(flightNumber);
  if(!reference)return {status:'NOT_REQUESTED',primary_count:0,secondary_count:0,note:'No journey flight reference was supplied.'};
  const primary=(opensky?.aircraft||[]).filter(item=>normaliseCallsign(item.ident)===reference);
  const secondary=(adsbLol?.records||[]).filter(item=>normaliseCallsign(item.ident)===reference);
  if(!opensky?.configured||!['LIVE','DELAYED','CONNECTED'].includes(opensky?.status)||['UNAVAILABLE','RATE_LIMITED','NOT_CONFIGURED'].includes(adsbLol?.status)){
    return {status:'INSUFFICIENT_DATA',flight_number:flightNumber,primary_count:primary.length,secondary_count:secondary.length,
      note:'Both provider observations are required for an independent comparison. A missing result is not evidence that the flight or aircraft is absent.'};
  }
  if(primary.length>1||secondary.length>1)return {status:'AMBIGUOUS',flight_number:flightNumber,primary_count:primary.length,secondary_count:secondary.length,
    note:'At least one provider returned multiple callsign matches; no record has been selected automatically.'};
  if(primary.length===0&&secondary.length===0)return {status:'NO_MATCH',flight_number:flightNumber,primary_count:0,secondary_count:0,
    note:'Neither provider returned an exact callsign match in its current query scope.'};
  if(primary.length===0||secondary.length===0)return {status:'SINGLE_SOURCE_ONLY',flight_number:flightNumber,primary_count:primary.length,secondary_count:secondary.length,
    note:'Only one provider returned a matching callsign. Independent corroboration has not been established.'};
  const left=primary[0],right=secondary[0];
  if(String(left.id||'').toLowerCase()!==String(right.id||'').toLowerCase())return {
    status:'AIRCRAFT_ID_DISAGREEMENT',flight_number:flightNumber,primary_count:1,secondary_count:1,
    opensky_icao24:left.id||null,adsb_lol_icao24:right.id||null,
    note:'The providers associate this callsign with different ICAO24 addresses. Neither record is selected automatically.'};
  const leftTime=Date.parse(left.observed_at||'');
  const rightTime=Date.parse(right.observed_at||'');
  const distanceKm=haversineKm(left,right);
  const timeDifferenceSeconds=Number.isFinite(leftTime)&&Number.isFinite(rightTime)
    ?Math.abs(leftTime-rightTime)/1000:null;
  if(timeDifferenceSeconds===null||!Number.isFinite(distanceKm))return {
    status:'IDENTITY_ONLY',flight_number:flightNumber,primary_count:1,secondary_count:1,
    opensky_icao24:left.id||null,adsb_lol_icao24:right.id||null,
    note:'The providers returned the same ICAO24/callsign candidate, but timestamps or coordinates are incomplete. Spatial/temporal corroboration is not established.'};
  const withinWindow=timeDifferenceSeconds<=120;
  const withinPositionTolerance=distanceKm<=5;
  return {
    status:withinWindow&&withinPositionTolerance?'CORROBORATED':'POSITION_DISAGREEMENT',
    flight_number:flightNumber,primary_count:1,secondary_count:1,
    opensky_icao24:left.id||null,adsb_lol_icao24:right.id||null,
    time_difference_seconds:timeDifferenceSeconds,distance_km:Number.isFinite(distanceKm)?Number(distanceKm.toFixed(2)):null,
    note:withinWindow&&withinPositionTolerance
      ?'The two independent provider samples share the ICAO24 address and are within the comparison time/distance tolerances. This corroborates an aircraft observation, not a commercial flight schedule or passenger arrival.'
      :'The provider samples share a callsign/ICAO24 candidate but fall outside the configured comparison tolerances. Keep both source records visible; do not auto-select one.',
  };
}

function buildSourceRegistry({opensky,weather,adsbLol,adsbArea,flyItalyArea,commercial,airportReference}={}) {
  return [
    {id:'opensky',name:'OpenSky Network',capability:'aircraft_positions',status:opensky?.status||'UNKNOWN',
      role:'Primary bounded aircraft state vectors',commercial_data:false,authority:'aircraft_state_only'},
    {id:'adsb_lol',name:'ADSB.lol',capability:'regional_aircraft_positions_and_cross_check',status:adsbArea?.status==='AVAILABLE'||adsbLol?.status==='AVAILABLE'?'AVAILABLE':adsbArea?.status==='RATE_LIMITED'||adsbLol?.status==='RATE_LIMITED'?'RATE_LIMITED':adsbArea?.status==='UNAVAILABLE'||adsbLol?.status==='UNAVAILABLE'?'UNAVAILABLE':adsbArea?.status==='NO_DATA'||adsbLol?.status==='NO_MATCH'?'NO_DATA':adsbArea?.status==='NOT_CONFIGURED'||adsbLol?.status==='NOT_CONFIGURED'?'NOT_CONFIGURED':adsbArea?.status==='NOT_REQUESTED'?(adsbLol?.status||'NOT_CONFIGURED'):(adsbArea?.status||adsbLol?.status||'NOT_CONFIGURED'),
      role:'Open airport-centred aircraft observations and targeted callsign cross-check',coverage_radius_nm:ADSBLOL_AREA_RADIUS_NM,
      license:'ODbL-1.0',commercial_use_permitted:true,attribution_required:true,
      service_level:'BEST_EFFORT',production_contact_recommended:true},
    {id:'flyitalyadsb',name:'FlyItalyADSB',capability:'regional_aircraft_positions',status:flyItalyArea?.status||'NOT_CONFIGURED',
      role:'Independent commercial-permitted aircraft position observations; informational display only',
      coverage_radius_km:FLYITALYADSB_RADIUS_KM,license:'CC-BY-SA-4.0',
      commercial_use_permitted:true,attribution_required:true,share_alike_required:true,
      service_level:'BEST_EFFORT',maximum_radius_km:FLYITALYADSB_RADIUS_KM,
      requests_per_minute:FLYITALYADSB_REQUESTS_PER_MINUTE,requests_per_month:FLYITALYADSB_REQUESTS_PER_MONTH,
      provider_plan_requests_per_minute:30,provider_plan_requests_per_month:300000,
      quota_scope:'shared_product_key',use_restrictions:FLYITALYADSB_USE_RESTRICTIONS,
      quality_limit:'No SLA; receiver coverage is uneven and Africa is sparsely served. Not for safety-of-life, air traffic control, navigation, identifying passengers, following people or harassment.'},
    {id:'aerodatabox',name:'AeroDataBox',capability:'flight_schedules_and_status',status:commercial?.status||'NOT_CONFIGURED',
      role:'Commercial flight schedule and operational status',commercial_license_required:true,derived_work_rights_required:true},
    {id:'aviationweather_gov',name:'AviationWeather.gov',capability:'metar_taf_sigmet',status:weather?.status||'NOT_REQUESTED',
      role:'Worldwide METAR, TAF and international SIGMET observations/advisories',refresh_seconds:300},
    {id:'kcaa_aim',name:'KCAA AIM / Nairobi FIR',capability:'notam_and_preflight_briefing',status:'ACCESS_REQUIRED',
      role:'National official NOTAM and flight briefing source',url:KCAA_AIM_URL,operational_authority:true},
    {id:'eurocontrol_ead',name:'EUROCONTROL MyEAD',capability:'global_notam_and_aeronautical_data',status:'AGREEMENT_REQUIRED',
      role:'System-to-system aeronautical data and worldwide NOTAM exchange',url:EAD_URL,operational_authority:true},
    {id:'ourairports',name:'OurAirports',capability:'airport_reference_data',status:airportReference?.status||'NOT_REQUESTED',
      role:'Airport IATA/ICAO resolution and supplemental reference metadata',license:'Public Domain',quality_limit:'No accuracy or fitness-for-use warranty'},
    {id:'openflightmaps',name:'open flightmaps',capability:'supplemental_aeronautical_reference',status:'OPTIONAL_NOT_SYNCED',
      role:'Supplemental VFR aeronautical database where regional coverage exists',license:'OFMA General Users License',
      quality_limit:'Not certified; never use as primary navigation data'},
  ];
}

async function getSnapshot({flightNumber,airportIcao,airportCode,baseSnapshot,env=process.env,fetcher=global.fetch,now=Date.now(),redisClient}={}) {
  const suppliedAirportCode=String(airportCode||airportIcao||'').trim().toUpperCase();
  let airportReference={
    status:'NOT_REQUESTED',reason:'journey_airport_code_not_supplied',
    supplied_code:null,airport:null,source:'OurAirports',
  };
  if(suppliedAirportCode){
    try{
      const index=await loadAirportReferenceIndex({fetcher,now});
      airportReference=resolveAirportCode(suppliedAirportCode,index);
    }catch(error){
      airportReference={
        status:'UNAVAILABLE',reason:error?.code||'airport_reference_provider_unavailable',
        supplied_code:suppliedAirportCode,airport:null,source:'OurAirports',
      };
    }
  }
  const resolvedIcao=airportReference.status==='RESOLVED'?airportReference.airport.icao:null;
  const weatherRequest=resolvedIcao
    ?loadWeather({airportIcao:resolvedIcao,fetcher,now})
    :Promise.resolve({
      status:'NOT_REQUESTED',reason:airportReference.reason||'verified_icao_station_required',
      station_icao:null,metar:[],taf:[],international_sigmets:[],
    });
  const areaRequest=airportReference.status==='RESOLVED'
    ?loadAdsbLolArea({airport:airportReference.airport,env,fetcher,now})
    :Promise.resolve({
      status:'NOT_REQUESTED',configured:false,reason:'uniquely_resolved_airport_coordinates_required',
      records:[],radius_nm:ADSBLOL_AREA_RADIUS_NM,source:'ADSB.lol',license:'ODbL-1.0',
    });
  const flyItalyAreaRequest=airportReference.status==='RESOLVED'
    ?loadFlyItalyAdsbArea({airport:airportReference.airport,env,fetcher,now,redisClient})
    :Promise.resolve({
      status:'NOT_REQUESTED',configured:false,reason:'uniquely_resolved_airport_coordinates_required',
      records:[],radius_km:FLYITALYADSB_RADIUS_KM,source:'FlyItalyADSB',license:'CC-BY-SA-4.0',
    });
  const [weatherResult,adsbAreaResult,flyItalyAreaResult,adsbResult,flightResult]=await Promise.all([
    weatherRequest.catch(error=>({status:'UNAVAILABLE',reason:error?.code||'provider_error',metar:[],taf:[],international_sigmets:[]})),
    areaRequest.catch(error=>({status:'UNAVAILABLE',reason:error?.code||'provider_error',records:[],radius_nm:ADSBLOL_AREA_RADIUS_NM,source:'ADSB.lol'})),
    flyItalyAreaRequest.catch(error=>({status:'UNAVAILABLE',reason:error?.code||'provider_error',records:[],radius_km:FLYITALYADSB_RADIUS_KM,source:'FlyItalyADSB'})),
    loadAdsbLolCallsign({callsign:flightNumber,env,fetcher,now}),
    loadCommercialFlight({flightNumber,env,fetcher,now}),
  ]);
  const weather=weatherResult||{status:'NOT_REQUESTED',metar:[],taf:[],international_sigmets:[]};
  const aircraftArea=adsbAreaResult||{status:'NOT_REQUESTED',records:[],radius_nm:ADSBLOL_AREA_RADIUS_NM,source:'ADSB.lol'};
  const flyItalyArea=flyItalyAreaResult||{status:'NOT_REQUESTED',records:[],radius_km:FLYITALYADSB_RADIUS_KM,source:'FlyItalyADSB'};
  const adsbLol=adsbResult||{status:'NOT_REQUESTED',records:[]};
  const commercial=flightResult||{status:'NOT_REQUESTED',flights:[]};
  const comparison=compareAircraftSources({flightNumber,opensky:baseSnapshot,adsbLol});
  const activeProviderCount=[
    ['opensky',['LIVE','DELAYED','CONNECTED'].includes(baseSnapshot?.status)&&(baseSnapshot?.aircraft||[]).length>0],
    ['adsb_lol',(adsbLol.status==='AVAILABLE'&&(adsbLol.records||[]).length>0)||(aircraftArea.status==='AVAILABLE'&&(aircraftArea.records||[]).length>0)],
    ['flyitalyadsb',flyItalyArea.status==='AVAILABLE'&&(flyItalyArea.records||[]).length>0],
    ['aerodatabox',commercial.status==='AVAILABLE'&&(commercial.flights||[]).length>0],
    ['aviationweather_gov',Boolean(weather.metar?.length||weather.taf?.length||weather.international_sigmets?.length)],
  ].filter(([,active])=>active).length;
  const activeReferenceSourceCount=airportReference.status==='RESOLVED'?1:0;
  return {
    ...(baseSnapshot||{}),
    intelligence:{
      generated_at:new Date(now).toISOString(),
      providers:buildSourceRegistry({opensky:baseSnapshot,weather,adsbLol,adsbArea:aircraftArea,flyItalyArea,commercial,airportReference}),
      flight_status:commercial,
      aircraft_cross_check:adsbLol,
      aircraft_area:aircraftArea,
      flyitaly_area:flyItalyArea,
      aircraft_comparison:comparison,
      aviation_weather:weather,
      notams:{
        status:'ACCESS_REQUIRED',source:'KCAA AIM / Nairobi FIR',
        message:'Official NOTAM and pre-flight briefing access requires an authorised account. No unofficial scraping or inferred NOTAMs are used.',
        url:KCAA_AIM_URL,
        global_source:'EUROCONTROL MyEAD requires system-to-system agreement; EAD Basic is not for operational use.',
      },
      airport_reference:{
        ...airportReference,
        sources:['OurAirports Public Domain','open flightmaps OFMA General Users License'],
        warning:'Reference datasets are supplementary and must not be used as certified navigation data or operational NOTAM authority.',
      },
      provenance:{multi_provider:activeProviderCount>=2,active_provider_count:activeProviderCount,
        active_reference_source_count:activeReferenceSourceCount,
        provider_registry_present:true,fabricated_data_used:false,providers_are_not_equivalent_authorities:true},
    },
  };
}

function resetCacheForTests(){responseCache.clear();areaLoadPromises.clear();airportReferenceIndex=null;airportReferenceExpiresAt=0;airportReferenceLoadPromise=null;airportReferenceFailure=null;airportReferenceFailureExpiresAt=0;}

module.exports={
  cleanCode,validBaseUrl,getAdsbLolConfig,getFlyItalyAdsbConfig,getAeroDataBoxConfig,numberOrNull,isoTime,
  normaliseWeatherRecords,normaliseAdsbLolRecord,normaliseAdsbLolAreaRecord,normaliseFlyItalyAdsbRecord,normaliseCallsign,haversineKm,compareAircraftSources,
  loadInternationalSigmets,loadWeather,loadAdsbLolCallsign,loadAdsbLolArea,loadFlyItalyAdsbArea,normaliseCommercialMovement,normaliseCommercialFlight,loadCommercialFlight,
  parseCsvRows,buildAirportReferenceIndex,resolveAirportCode,loadAirportReferenceIndex,
  buildSourceRegistry,getSnapshot,resetCacheForTests,
};
