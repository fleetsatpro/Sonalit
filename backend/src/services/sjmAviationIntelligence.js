'use strict';

const AIRWEATHER_BASE='https://aviationweather.gov/api/data';
const ADSBLOL_BASE='https://api.adsb.lol';
const KCAA_AIM_URL='https://aim.kcaa.or.ke/';
const EAD_URL='https://www.eurocontrol.int/service/european-ais-database';

const responseCache=new Map();
const CACHE_LIMIT=300;
const DEFAULT_WEATHER_TTL_MS=5*60*1000;
const DEFAULT_LOOKUP_TTL_MS=30*1000;

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
  const productionApproved=env.SJM_ADSBLOL_PRODUCTION_APPROVED==='true';
  const odblCompliance=env.SJM_ADSBLOL_ODBL_COMPLIANCE_CONFIRMED==='true';
  let reason=null;
  if(!enabled)reason='disabled';
  else if(!productionApproved)reason='production_access_not_confirmed_with_provider';
  else if(!odblCompliance)reason='odbl_database_obligations_not_reviewed';
  return {enabled:!reason,reason,baseUrl:ADSBLOL_BASE};
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

async function requestJson(url,{headers={},fetcher=global.fetch,timeoutMs=10_000}={}) {
  if(typeof fetcher!=='function')throw new Error('Global fetch is unavailable.');
  const response=await fetcher(url,{
    method:'GET',headers:{Accept:'application/json',...headers},
    signal:AbortSignal.timeout(timeoutMs),
  });
  if(response.status===204)return null;
  if(!response.ok){
    const error=new Error('Aviation data provider returned HTTP '+response.status+'.');
    error.code=response.status===429?'rate_limited':response.status>=500?'provider_unavailable':'provider_rejected';
    error.status=response.status;
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
      altimeter_hpa:numberOrNull(item?.altim),
      provider:'aviationweather_gov',
      evidence_class:'OBSERVED',
    };
  });
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
    requestJson(AIRWEATHER_BASE+'/isigmet?format=json',{headers,fetcher}),
  ]);
  const metar=metarResult.status==='fulfilled'?normaliseWeatherRecords(metarResult.value,'METAR',now):[];
  const taf=tafResult.status==='fulfilled'?normaliseWeatherRecords(tafResult.value,'TAF',now):[];
  const sigmets=sigmetResult.status==='fulfilled'?normaliseWeatherRecords(sigmetResult.value,'SIGMET',now):[];
  const failures=[metarResult,tafResult,sigmetResult].filter(result=>result.status==='rejected');
  const data={
    status:failures.length===3?'UNAVAILABLE':failures.length?'PARTIAL':'AVAILABLE',
    reason:failures.length?failures.map(result=>result.reason?.code||'provider_error').join(','):null,
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
  const observedAt=Number.isFinite(seenPosition)&&seenPosition>=0&&seenPosition<86_400
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

async function loadAdsbLolCallsign({callsign,env=process.env,fetcher=global.fetch,now=Date.now()}={}) {
  const config=getAdsbLolConfig(env);
  const ident=String(callsign||'').trim().toUpperCase().replace(/\s+/g,' ');
  if(!config.enabled)return {status:'NOT_CONFIGURED',reason:config.reason,records:[],source:'adsb.lol'};
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
      licence:'ODbL-1.0',attribution_required:true,
      cache_state:'MISS',checked_at:new Date(now).toISOString(),
      provenance:{provider:'adsb.lol',database_license:'ODbL-1.0',fabricated_data_used:false},
    };
    return cacheSet(key,value,DEFAULT_LOOKUP_TTL_MS,now);
  }catch(error){
    return {status:'UNAVAILABLE',reason:error?.code||'provider_error',records:[],source:'adsb.lol',
      provenance:{provider:'adsb.lol',database_license:'ODbL-1.0',fabricated_data_used:false}};
  }
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
    const flights=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.flights)?payload.flights:[];
    const value={
      status:flights.length?'AVAILABLE':'NO_MATCH',
      reason:null,flight_number:number,flights:flights.slice(0,20),
      source:'AeroDataBox',cache_state:'MISS',checked_at:new Date(now).toISOString(),
      commercial_data:true,derived_work_rights_confirmed:true,
      provenance:{provider:'aerodatabox',evidence_class:'COMMERCIAL_PROVIDER_FLIGHT_INFORMATION',fabricated_data_used:false},
    };
    return cacheSet(key,value,60_000,now);
  }catch(error){
    return {status:'UNAVAILABLE',reason:error?.code||'provider_error',flight_number:number,flights:[],source:'AeroDataBox',
      provenance:{provider:'aerodatabox',fabricated_data_used:false}};
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
  if(!opensky?.configured||!['LIVE','DELAYED','CONNECTED'].includes(opensky?.status)||adsbLol?.status==='UNAVAILABLE'||adsbLol?.status==='NOT_CONFIGURED'){
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

function buildSourceRegistry({opensky,weather,adsbLol,commercial}={}) {
  return [
    {id:'opensky',name:'OpenSky Network',capability:'aircraft_positions',status:opensky?.status||'UNKNOWN',
      role:'Primary bounded aircraft state vectors',commercial_data:false,authority:'aircraft_state_only'},
    {id:'adsb_lol',name:'ADSB.lol',capability:'aircraft_position_cross_check',status:adsbLol?.status||'NOT_CONFIGURED',
      role:'Independent targeted callsign cross-check',license:'ODbL-1.0',production_approval_required:true},
    {id:'aerodatabox',name:'AeroDataBox',capability:'flight_schedules_and_status',status:commercial?.status||'NOT_CONFIGURED',
      role:'Commercial flight schedule and operational status',commercial_license_required:true,derived_work_rights_required:true},
    {id:'aviationweather_gov',name:'AviationWeather.gov',capability:'metar_taf_sigmet',status:weather?.status||'NOT_REQUESTED',
      role:'Worldwide METAR, TAF and international SIGMET observations/advisories',refresh_seconds:300},
    {id:'kcaa_aim',name:'KCAA AIM / Nairobi FIR',capability:'notam_and_preflight_briefing',status:'ACCESS_REQUIRED',
      role:'National official NOTAM and flight briefing source',url:KCAA_AIM_URL,operational_authority:true},
    {id:'eurocontrol_ead',name:'EUROCONTROL MyEAD',capability:'global_notam_and_aeronautical_data',status:'AGREEMENT_REQUIRED',
      role:'System-to-system aeronautical data and worldwide NOTAM exchange',url:EAD_URL,operational_authority:true},
    {id:'ourairports',name:'OurAirports',capability:'airport_reference_data',status:'AVAILABLE_NOT_SYNCED',
      role:'Supplemental airport/runway/navaid metadata',license:'Public Domain',quality_limit:'No accuracy or fitness-for-use warranty'},
    {id:'openflightmaps',name:'open flightmaps',capability:'supplemental_aeronautical_reference',status:'OPTIONAL_NOT_SYNCED',
      role:'Supplemental VFR aeronautical database where regional coverage exists',license:'OFMA General Users License',
      quality_limit:'Not certified; never use as primary navigation data'},
  ];
}

async function getSnapshot({flightNumber,airportIcao,baseSnapshot,env=process.env,fetcher=global.fetch,now=Date.now()}={}) {
  const [weatherResult,adsbResult,flightResult]=await Promise.all([
    loadWeather({airportIcao,fetcher,now}).catch(error=>({status:'UNAVAILABLE',reason:error?.code||'provider_error',metar:[],taf:[],international_sigmets:[]})),
    loadAdsbLolCallsign({callsign:flightNumber,env,fetcher,now}),
    loadCommercialFlight({flightNumber,env,fetcher,now}),
  ]);
  const weather=weatherResult||{status:'NOT_REQUESTED',metar:[],taf:[],international_sigmets:[]};
  const adsbLol=adsbResult||{status:'NOT_REQUESTED',records:[]};
  const commercial=flightResult||{status:'NOT_REQUESTED',flights:[]};
  const comparison=compareAircraftSources({flightNumber,opensky:baseSnapshot,adsbLol});
  const activeProviderCount=[
    ['opensky',['LIVE','DELAYED','CONNECTED'].includes(baseSnapshot?.status)],
    ['adsb_lol',adsbLol.status==='AVAILABLE'],
    ['aerodatabox',commercial.status==='AVAILABLE'],
    ['aviationweather_gov',Boolean(weather.metar?.length||weather.taf?.length||weather.international_sigmets?.length)],
  ].filter(([,active])=>active).length;
  return {
    ...(baseSnapshot||{}),
    intelligence:{
      generated_at:new Date(now).toISOString(),
      providers:buildSourceRegistry({opensky:baseSnapshot,weather,adsbLol,commercial}),
      flight_status:commercial,
      aircraft_cross_check:adsbLol,
      aircraft_comparison:comparison,
      aviation_weather:weather,
      notams:{
        status:'ACCESS_REQUIRED',source:'KCAA AIM / Nairobi FIR',
        message:'Official NOTAM and pre-flight briefing access requires an authorised account. No unofficial scraping or inferred NOTAMs are used.',
        url:KCAA_AIM_URL,
        global_source:'EUROCONTROL MyEAD requires system-to-system agreement; EAD Basic is not for operational use.',
      },
      airport_reference:{
        status:'REFERENCE_DATA_AVAILABLE',
        sources:['OurAirports Public Domain','open flightmaps OFMA General Users License'],
        warning:'Reference datasets are supplementary and must not be used as certified navigation data or operational NOTAM authority.',
      },
      provenance:{multi_provider:activeProviderCount>=2,active_provider_count:activeProviderCount,
        provider_registry_present:true,fabricated_data_used:false,providers_are_not_equivalent_authorities:true},
    },
  };
}

function resetCacheForTests(){responseCache.clear();}

module.exports={
  cleanCode,validBaseUrl,getAdsbLolConfig,getAeroDataBoxConfig,numberOrNull,isoTime,
  normaliseWeatherRecords,normaliseAdsbLolRecord,normaliseCallsign,haversineKm,compareAircraftSources,
  loadWeather,loadAdsbLolCallsign,loadCommercialFlight,
  buildSourceRegistry,getSnapshot,resetCacheForTests,
};
