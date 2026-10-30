'use strict';

const tls = require('tls');

const HOST='firehose.flightaware.com';
const PORT=1501;
const MAX_BUFFER=512*1024;
const MAX_AIRCRAFT=3000;
const MAX_TRAIL=24;
const RETENTION_MS=10*60*1000;
const LIVE_MS=45_000;
const DELAYED_MS=180_000;
const IDLE_MS=5*60*1000;
const RECONNECT_BASE_MS=3000;
const RECONNECT_MAX_MS=30000;
const aircraft=new Map();
const recentEvents=[];
let socket=null, reconnectTimer=null, idleTimer=null;
let started=false, stopping=false, connected=false, reconnectAttempt=0;
let lastConnectedAt=null,lastReceivedAt=null,lastPositionAt=null,lastErrorCode=null;
let messageCount=0,positionCount=0,rejectedCount=0;

function parseBounds(raw) {
  if(typeof raw!=='string'||!raw.trim())return null;
  const v=raw.trim().split(/[ ,]+/).map(Number);
  if(v.length!==4||v.some(n=>!Number.isFinite(n)))return null;
  const [south,west,north,east]=v;
  if(south < -90||north > 90||west < -180||east > 180||south>=north||west>=east||(north-south)*(east-west)>500)return null;
  return {south,west,north,east};
}
function getConfig(env=process.env) {
  const enabled=env.SJM_AIRSPACE_FEED_ENABLED==='true';
  const licence=env.SJM_AIRSPACE_LICENSE_CONFIRMED==='true';
  const username=String(env.FLIGHTAWARE_FIREHOSE_USERNAME||'').trim();
  const apiKey=String(env.FLIGHTAWARE_FIREHOSE_API_KEY||'').trim();
  const bounds=parseBounds(env.SJM_AIRSPACE_BOUNDS);
  let reason=null;
  if(!enabled)reason='feed_disabled';
  else if(!licence)reason='provider_licence_not_confirmed';
  else if(!username||!apiKey||/[\\r\\n\\s]/.test(username)||/[\\r\\n\\s]/.test(apiKey))reason='provider_credentials_missing_or_invalid';
  else if(!bounds)reason='operational_bounds_missing_or_invalid';
  return {configured:!reason,reason,username:!reason?username:null,apiKey:!reason?apiKey:null,bounds:!reason?bounds:null};
}
function buildInitiationCommand(config) {
  if(!config?.configured||!config.username||!config.apiKey||!config.bounds)throw new Error('Firehose configuration is incomplete.');
  const {south,west,north,east}=config.bounds;
  return ['live','username '+config.username,'password '+config.apiKey,
    'events "position flifo arrival departure cancellation"',
    'latlong "'+[south,west,north,east].join(' ')+'"','keepalive 60'].join(' ')+'\\n';
}
function validCoordinate(lat,lon) {
  return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;
}
function epochIso(value) {
  const n=Number(value);
  return !Number.isFinite(n)||n<=0||n>4e9?null:new Date(n*1000).toISOString();
}
function classifyFreshness(observedAt,now=Date.now(),isConnected=connected) {
  const observed=Date.parse(observedAt||'');
  if(!Number.isFinite(observed)||observed>now)return 'UNAVAILABLE';
  const age=now-observed;
  if(!isConnected)return age<=DELAYED_MS?'DELAYED':age<=RETENTION_MS?'STALE':'UNAVAILABLE';
  if(age<=LIVE_MS)return 'LIVE';
  if(age<=DELAYED_MS)return 'DELAYED';
  if(age<=RETENTION_MS)return 'STALE';
  return 'UNAVAILABLE';
}
function normalizePosition(m,receivedAt=new Date().toISOString()) {
  if(!m||m.type!=='position')return null;
  const lat=Number(m.lat),lon=Number(m.lon),observedAt=epochIso(m.clock);
  const id=String(m.id||m.hexid||m.ident||'').trim();
  if(!id||!validCoordinate(lat,lon)||!observedAt)return null;
  const alt=Number(m.alt_gnss??m.alt),gs=Number(m.gs),heading=Number(m.heading_true??m.heading);
  return {
    id,provider:'flightaware_firehose',ident:String(m.ident||m.atcident||m.reg||id).trim(),
    registration:m.reg||null,aircraft_type:m.aircrafttype||null,
    latitude:lat,longitude:lon,
    altitude_m:Number.isFinite(alt)?alt*0.3048:null,
    ground_speed_mps:Number.isFinite(gs)?gs*0.514444:null,
    heading_deg:Number.isFinite(heading)&&heading>=0&&heading<=360?heading:null,
    origin:m.orig||null,destination:m.dest||null,air_ground:m.air_ground||null,
    update_type:m.updateType||null,observed_at:observedAt,received_at:receivedAt,
    evidence_class:'OBSERVED',
    provenance:{provider:'FlightAware Firehose',source_message:'position',position_source_code:m.updateType||null,pitr:m.pitr||null},
  };
}
function rememberPosition(p) {
  const previous=aircraft.get(p.id),trail=previous?previous.trail.slice(-(MAX_TRAIL-1)):[];
  if(!trail.length||trail[trail.length-1].observed_at!==p.observed_at)trail.push({
    latitude:p.latitude,longitude:p.longitude,altitude_m:p.altitude_m,observed_at:p.observed_at,
  });
  aircraft.set(p.id,{...p,trail});
  if(aircraft.size>MAX_AIRCRAFT) {
    const old=[...aircraft.entries()].sort((a,b)=>Date.parse(a[1].observed_at)-Date.parse(b[1].observed_at)).slice(0,aircraft.size-MAX_AIRCRAFT);
    for(const [key] of old)aircraft.delete(key);
  }
}
function rememberEvent(m,receivedAt) {
  recentEvents.unshift({
    type:m.type,flight_id:m.id||null,ident:m.ident||m.atcident||null,
    airport:m.airport||null,origin:m.orig||null,destination:m.dest||null,
    observed_at:epochIso(m.clock||m.aat||m.pitr),received_at:receivedAt,
    evidence_class:'OBSERVED',source:'flightaware_firehose',
  });
  if(recentEvents.length>100)recentEvents.length=100;
}
function processLine(line) {
  if(!String(line||'').trim())return;
  let m;
  try{m=JSON.parse(String(line));}catch(_){lastErrorCode='provider_message_parse_error';rejectedCount++;return;}
  const receivedAt=new Date().toISOString();
  lastReceivedAt=receivedAt;messageCount++;
  if(m.type==='position') {
    const p=normalizePosition(m,receivedAt);
    if(!p){rejectedCount++;return;}
    rememberPosition(p);positionCount++;lastPositionAt=receivedAt;
  } else if(['flifo','arrival','departure','cancellation'].includes(m.type))rememberEvent(m,receivedAt);
  resetIdleTimer();
}
function snapshot(now=Date.now()) {
  const config=getConfig(),items=[];
  for(const [id,p] of aircraft) {
    const freshness=classifyFreshness(p.observed_at,now);
    if(freshness==='UNAVAILABLE'){aircraft.delete(id);continue;}
    items.push({...p,freshness,age_seconds:Math.max(0,Math.floor((now-Date.parse(p.observed_at))/1000))});
  }
  items.sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));
  const status=!config.configured?'NOT_CONFIGURED':!connected?(items.length?'STALE':'UNAVAILABLE')
    :items.some(x=>x.freshness==='LIVE')?'LIVE':items.some(x=>x.freshness==='DELAYED')?'DELAYED':'CONNECTED';
  return {
    provider:'flightaware_firehose',provider_name:'FlightAware Firehose',status,
    configured:config.configured,connected,last_connected_at:lastConnectedAt,
    last_received_at:lastReceivedAt,last_position_at:lastPositionAt,
    message_count:messageCount,position_count:positionCount,rejected_count:rejectedCount,
    last_error_code:lastErrorCode,
    coverage:{complete:false,bounds:config.bounds,query_scope:config.bounds?'contracted_operational_bounds':'unavailable'},
    aircraft:items,recent_events:recentEvents.slice(0,50),
    provenance:{source:'FlightAware Firehose',position_type:'provider-observed aircraft position',
      flight_information:'separate provider event stream; not an SJM arrival or handover confirmation',
      fabricated_data_used:false},
  };
}
function clearTimers() {
  if(reconnectTimer)clearTimeout(reconnectTimer);
  if(idleTimer)clearTimeout(idleTimer);
  reconnectTimer=null;idleTimer=null;
}
function scheduleReconnect() {
  if(stopping||reconnectTimer)return;
  const delay=Math.min(RECONNECT_MAX_MS,RECONNECT_BASE_MS*(2**reconnectAttempt));
  reconnectAttempt=Math.min(reconnectAttempt+1,5);
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect();},delay);
  reconnectTimer.unref?.();
}
function resetIdleTimer() {
  if(idleTimer)clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>{lastErrorCode='idle_reconnect';socket?.destroy();},IDLE_MS);
  idleTimer.unref?.();
}
function connect() {
  if(stopping||!started||socket)return;
  const config=getConfig();
  if(!config.configured)return;
  lastErrorCode=null;
  let stream;
  try{stream=tls.connect({host:HOST,port:PORT,minVersion:'TLSv1.2',rejectUnauthorized:true});}
  catch(_){lastErrorCode='tls_connection_failed';scheduleReconnect();return;}
  socket=stream;
  let buffer='';
  stream.setKeepAlive?.(true,30_000);
  stream.setEncoding?.('utf8');
  stream.once('secureConnect',()=>{
    if(socket!==stream||stopping)return;
    connected=true;lastConnectedAt=new Date().toISOString();reconnectAttempt=0;
    try{stream.write(buildInitiationCommand(config));resetIdleTimer();}
    catch(_){lastErrorCode='provider_initialisation_failed';stream.destroy();}
  });
  stream.on('data',chunk=>{
    buffer+=String(chunk);
    if(buffer.length>MAX_BUFFER){lastErrorCode='provider_message_buffer_limit';stream.destroy();return;}
    let pos;
    while((pos=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);processLine(line);}
  });
  stream.on('error',()=>{lastErrorCode='tls_stream_error';});
  stream.on('close',()=>{
    if(socket===stream)socket=null;
    connected=false;
    if(idleTimer)clearTimeout(idleTimer);idleTimer=null;
    if(!stopping)scheduleReconnect();
  });
}
function start() {
  if(started)return snapshot();
  started=true;stopping=false;
  if(getConfig().configured)connect();
  return snapshot();
}
function getSnapshot({start:shouldStart=false}={}) {
  if(shouldStart)start();
  return snapshot();
}
function stop() {
  stopping=true;started=false;clearTimers();
  if(socket)socket.destroy();
  socket=null;connected=false;
}
function resetForTests() {
  stop();aircraft.clear();recentEvents.length=0;reconnectAttempt=0;
  lastConnectedAt=null;lastReceivedAt=null;lastPositionAt=null;lastErrorCode=null;
  messageCount=0;positionCount=0;rejectedCount=0;
}
module.exports={parseBounds,getConfig,buildInitiationCommand,validCoordinate,epochIso,
  classifyFreshness,normalizePosition,snapshot,getSnapshot,start,stop,processLine,resetForTests};
