'use strict';

/**
 * Sonalit AI provider radar.
 *
 * Uses real request outcomes only. It deliberately avoids synthetic probes so
 * free-tier quotas are not consumed just to measure provider health.
 */
const logger=require('./logger');
const {getRedis}=require('../config/redis');

const ENABLED=String(process.env.INTEL_AI_RADAR_ENABLED||'true').toLowerCase()!=='false';
const PERSIST=String(process.env.INTEL_AI_RADAR_PERSIST||'true').toLowerCase()!=='false' &&
  Boolean(process.env.REDIS_URL) &&
  String(process.env.DISABLE_REDIS||'false').toLowerCase()!=='true';
const DEBOUNCE_MS=Math.max(1000,Math.min(60000,Number(process.env.INTEL_AI_RADAR_PERSIST_DEBOUNCE_MS||5000)));
const HYDRATION_TIMEOUT_MS=Math.max(250,Math.min(5000,Number(process.env.INTEL_AI_RADAR_HYDRATION_TIMEOUT_MS||2000)));
const PREFIX='sonalit:intelligence:ai:radar:v1:';
const TTL_SECONDS=7*24*60*60;
const MAX_HYDRATED_KEYS=1000;
const state=Object.create(null);
const timers=Object.create(null);
let hydrated=!PERSIST;
let hydrationPromise=null;
let persistenceAvailable=PERSIST;

function entry(label){
  const key=String(label||'unknown');
  return state[key]||(state[key]={
    successes:0,failures:0,consecutiveFailures:0,lastOutcome:null,lastStatus:null,
    lastSuccessAt:null,lastFailureAt:null,lastLatencyMs:null,avgLatencyMs:null,updatedAt:null
  });
}

function boundedCount(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1_000_000_000,Math.floor(n))):0;
}

function boundedNumber(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?Math.min(n,86_400_000):null;
}

function boundedTimestamp(value){
  return typeof value==='string'&&value.length<=64?value:null;
}

function parsePersisted(raw){
  if(typeof raw!=='string'||raw.length>8192)return null;
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const outcome=value.lastOutcome==='success'||value.lastOutcome==='failure'?value.lastOutcome:null;
    return {
      successes:boundedCount(value.successes),
      failures:boundedCount(value.failures),
      consecutiveFailures:Math.min(20,boundedCount(value.consecutiveFailures)),
      lastOutcome:outcome,
      lastStatus:Number.isFinite(Number(value.lastStatus))&&value.lastStatus!==null?Number(value.lastStatus):null,
      lastSuccessAt:boundedTimestamp(value.lastSuccessAt),
      lastFailureAt:boundedTimestamp(value.lastFailureAt),
      lastLatencyMs:boundedNumber(value.lastLatencyMs),
      avgLatencyMs:boundedNumber(value.avgLatencyMs),
      updatedAt:boundedTimestamp(value.updatedAt)
    };
  }catch{
    return null;
  }
}

function mergePersisted(label,persisted){
  const current=state[label];
  if(!current){
    state[label]=persisted;
    return;
  }
  // Normally requests wait for hydration, but preserve any local outcomes if a
  // caller records telemetry during startup rather than discarding that data.
  const localSuccesses=boundedCount(current.successes);
  const localFailures=boundedCount(current.failures);
  const localTotal=localSuccesses+localFailures;
  const storedTotal=persisted.successes+persisted.failures;
  const merged={...persisted};
  merged.successes=Math.min(1_000_000_000,persisted.successes+localSuccesses);
  merged.failures=Math.min(1_000_000_000,persisted.failures+localFailures);
  merged.consecutiveFailures=localTotal>0?current.consecutiveFailures:persisted.consecutiveFailures;
  if(localTotal>0&&current.updatedAt&&(!persisted.updatedAt||current.updatedAt>=persisted.updatedAt)){
    merged.lastOutcome=current.lastOutcome;
    merged.lastStatus=current.lastStatus;
    merged.lastSuccessAt=current.lastSuccessAt||persisted.lastSuccessAt;
    merged.lastFailureAt=current.lastFailureAt||persisted.lastFailureAt;
    merged.lastLatencyMs=current.lastLatencyMs??persisted.lastLatencyMs;
    merged.avgLatencyMs=current.avgLatencyMs??persisted.avgLatencyMs;
    merged.updatedAt=current.updatedAt;
  }else if(localTotal>0){
    merged.consecutiveFailures=current.consecutiveFailures;
  }
  if(localTotal===0&&storedTotal===0){
    merged.consecutiveFailures=0;
  }
  state[label]=merged;
}

async function withTimeout(promise,ms){
  let timer;
  try{
    return await Promise.race([
      promise,
      new Promise(resolve=>{
        timer=setTimeout(()=>resolve(null),ms);
        if(typeof timer?.unref==='function')timer.unref();
      })
    ]);
  }finally{
    if(timer)clearTimeout(timer);
  }
}

async function readPersistedEntries(client){
  if(typeof client.scan!=='function'){
    throw new Error('Redis client does not support SCAN for AI radar hydration');
  }
  const keys=[];
  let cursor='0';
  do{
    const result=await client.scan(cursor,'MATCH',PREFIX+'*','COUNT',100);
    if(!Array.isArray(result)||result.length<2||!Array.isArray(result[1])){
      throw new Error('Unexpected Redis SCAN response for AI radar hydration');
    }
    cursor=String(result[0]);
    for(const key of result[1]){
      if(typeof key==='string'&&key.startsWith(PREFIX))keys.push(key);
      if(keys.length>=MAX_HYDRATED_KEYS)return keys;
    }
  }while(cursor!=='0');
  return keys;
}

async function hydrateFromRedis(){
  if(!PERSIST){
    hydrated=true;
    persistenceAvailable=false;
    return;
  }
  const client=getRedis();
  if(!client){
    persistenceAvailable=false;
    hydrated=true;
    return;
  }
  try{
    const keys=await withTimeout(readPersistedEntries(client),HYDRATION_TIMEOUT_MS);
    if(!Array.isArray(keys)){
      persistenceAvailable=false;
      logger.warn('AI provider radar hydration timed out; continuing with local provider health.');
      return;
    }
    if(keys.length){
      const rawValues=await withTimeout(
        Promise.all(keys.map(key=>client.get(key))),
        HYDRATION_TIMEOUT_MS
      );
      if(!Array.isArray(rawValues)){
        persistenceAvailable=false;
        logger.warn('AI provider radar values timed out; continuing with local provider health.');
        return;
      }
      for(let i=0;i<keys.length;i+=1){
        let label;
        try{ label=decodeURIComponent(keys[i].slice(PREFIX.length)); }
        catch{ continue; }
        if(!label||label.length>256)continue;
        const persisted=parsePersisted(rawValues[i]);
        if(persisted)mergePersisted(label,persisted);
      }
    }
    persistenceAvailable=true;
  }catch(error){
    persistenceAvailable=false;
    logger.warn('AI provider radar hydration unavailable: '+error.message);
  }finally{
    hydrated=true;
  }
}

function hydrate(){
  if(hydrated)return Promise.resolve();
  if(!hydrationPromise){
    hydrationPromise=hydrateFromRedis().catch(error=>{
      persistenceAvailable=false;
      hydrated=true;
      logger.warn('AI provider radar hydration failed: '+error.message);
    });
  }
  return hydrationPromise;
}

function schedulePersist(label){
  if(!PERSIST||timers[label])return;
  timers[label]=setTimeout(async()=>{
    delete timers[label];
    try{
      const client=getRedis();
      if(!client){
        persistenceAvailable=false;
        return;
      }
      await client.set(PREFIX+encodeURIComponent(label),JSON.stringify(entry(label)),'EX',TTL_SECONDS);
      persistenceAvailable=true;
    }catch(error){
      persistenceAvailable=false;
      logger.warn('AI provider radar persistence unavailable: '+error.message);
    }
  },DEBOUNCE_MS);
  if(typeof timers[label]?.unref==='function')timers[label].unref();
}

function recordSuccess(label,meta={}){
  if(!ENABLED)return;
  const e=entry(label),latency=Math.max(0,Number(meta.latencyMs||0));
  e.successes++;
  e.consecutiveFailures=0;
  e.lastOutcome='success';
  e.lastStatus=200;
  e.lastSuccessAt=new Date().toISOString();
  if(latency>0){
    e.lastLatencyMs=latency;
    e.avgLatencyMs=e.avgLatencyMs==null?latency:Math.round(Number(e.avgLatencyMs)*0.8+latency*0.2);
  }
  e.updatedAt=new Date().toISOString();
  schedulePersist(label);
}

function recordFailure(label,meta={}){
  if(!ENABLED)return;
  const e=entry(label);
  e.failures++;
  e.consecutiveFailures=Math.min(20,Number(e.consecutiveFailures||0)+1);
  e.lastOutcome='failure';
  e.lastStatus=Number(meta.status||0)||null;
  e.lastFailureAt=new Date().toISOString();
  e.updatedAt=new Date().toISOString();
  schedulePersist(label);
}

function score(e){
  const total=Number(e.successes||0)+Number(e.failures||0);
  if(total<=0)return null;
  const failureRate=Number(e.failures||0)/total;
  const consecutivePenalty=Math.min(45,Number(e.consecutiveFailures||0)*15);
  const latencyPenalty=e.avgLatencyMs==null?0:Math.min(20,Math.max(0,(Number(e.avgLatencyMs)-1500)/500));
  return Math.max(0,Math.min(100,Math.round(100-failureRate*65-consecutivePenalty-latencyPenalty)));
}

function statusFor(e){
  const s=score(e);
  if(s==null)return 'unknown';
  if(s>=80)return 'healthy';
  if(s>=50)return 'degraded';
  return 'unhealthy';
}

function providerStatus(label){
  const e=entry(label);
  return {
    score:score(e),
    status:statusFor(e),
    successes:Number(e.successes||0),
    failures:Number(e.failures||0),
    consecutive_failures:Number(e.consecutiveFailures||0),
    last_outcome:e.lastOutcome,
    last_status:e.lastStatus,
    last_success_at:e.lastSuccessAt,
    last_failure_at:e.lastFailureAt,
    last_latency_ms:e.lastLatencyMs,
    avg_latency_ms:e.avgLatencyMs
  };
}

function snapshot(){
  const providers={};
  for(const label of Object.keys(state))providers[label]=providerStatus(label);
  return {
    version:'1.0',
    enabled:ENABLED,
    persistence:PERSIST,
    persistence_available:persistenceAvailable,
    hydrated,
    providers,
    generated_at:new Date().toISOString()
  };
}

function routingScore(label){
  if(!ENABLED)return 50;
  const s=score(entry(label));
  return s==null?50:s;
}

function resetForTests(){
  for(const timer of Object.values(timers))clearTimeout(timer);
  for(const key of Object.keys(timers))delete timers[key];
  for(const key of Object.keys(state))delete state[key];
  hydrated=!PERSIST;
  hydrationPromise=null;
  persistenceAvailable=PERSIST;
}

module.exports={recordSuccess,recordFailure,snapshot,status:providerStatus,routingScore,hydrate,resetForTests};

// Start warming persisted health immediately; request paths also await this
// promise so routing never knowingly evaluates providers before hydration.
void hydrate();
