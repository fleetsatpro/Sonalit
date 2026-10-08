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
const PREFIX='sonalit:intelligence:ai:radar:v1:';
const TTL_SECONDS=7*24*60*60;
const state=Object.create(null);
const timers=Object.create(null);

function entry(label){
  const key=String(label||'unknown');
  return state[key]||(state[key]={
    successes:0,failures:0,consecutiveFailures:0,lastOutcome:null,lastStatus:null,
    lastSuccessAt:null,lastFailureAt:null,lastLatencyMs:null,avgLatencyMs:null,updatedAt:null
  });
}

function schedulePersist(label){
  if(!PERSIST||timers[label])return;
  timers[label]=setTimeout(async()=>{
    delete timers[label];
    try{
      const client=getRedis();
      if(!client)return;
      await client.set(PREFIX+encodeURIComponent(label),JSON.stringify(entry(label)),'EX',TTL_SECONDS);
    }catch(error){
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
}

module.exports={recordSuccess,recordFailure,snapshot,status:providerStatus,routingScore,resetForTests};
