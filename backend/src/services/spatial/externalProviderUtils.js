'use strict';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
class BoundedTtlCache {
  constructor(ttlMs, maxEntries = 128) { this.ttlMs=ttlMs; this.maxEntries=maxEntries; this.map=new Map(); }
  get(key, now=Date.now()) {
    const e=this.map.get(key); if (!e) return null;
    if (now-e.createdAt>this.ttlMs) { this.map.delete(key); return null; }
    e.lastAccessAt=now; return e;
  }
  set(key,value,now=Date.now()) {
    if (this.map.size>=this.maxEntries && !this.map.has(key)) {
      let oldestKey=null, oldest=Infinity;
      for (const [k,e] of this.map) if (e.lastAccessAt<oldest) { oldest=e.lastAccessAt; oldestKey=k; }
      if (oldestKey) this.map.delete(oldestKey);
    }
    this.map.set(key,{value,createdAt:now,lastAccessAt:now});
  }
  getStale(key) { return this.map.get(key) || null; }
  clear() { this.map.clear(); }
}
class CircuitBreaker {
  constructor(threshold=5,cooldownMs=30000) { this.threshold=threshold; this.cooldownMs=cooldownMs; this.failures=0; this.state='CLOSED'; this.openedAt=null; }
  canRequest(now=Date.now()) {
    if (this.state==='CLOSED') return true;
    if (this.state==='OPEN' && this.openedAt != null && now-this.openedAt>=this.cooldownMs) { this.state='HALF_OPEN'; return true; }
    return this.state==='HALF_OPEN';
  }
  success() { this.failures=0; this.state='CLOSED'; this.openedAt=null; }
  failure(now=Date.now()) { this.failures+=1; if (this.failures>=this.threshold) { this.state='OPEN'; this.openedAt=now; } }
}
class RequestBudget {
  constructor(maxPerMinute,maxConcurrent) { this.maxPerMinute=maxPerMinute; this.maxConcurrent=maxConcurrent; this.timestamps=[]; this.active=0; }
  prune(now=Date.now()) { const cutoff=now-60000; while(this.timestamps.length&&this.timestamps[0]<cutoff)this.timestamps.shift(); }
  canRequest(now=Date.now()) { this.prune(now); return this.active<this.maxConcurrent&&this.timestamps.length<this.maxPerMinute; }
  begin(now=Date.now()) { this.prune(now); this.active+=1; this.timestamps.push(now); }
  end() { this.active=Math.max(0,this.active-1); }
  remaining(now=Date.now()) { this.prune(now); return Math.max(0,this.maxPerMinute-this.timestamps.length); }
}
async function fetchJsonWithTimeout(url,init={},timeoutMs=8000) {
  const controller=new AbortController(); const upstream=init.signal; let timedOut=false;
  const onAbort=()=>controller.abort(upstream.reason||new Error('cancelled'));
  if (upstream) { if (upstream.aborted) onAbort(); else upstream.addEventListener('abort',onAbort,{once:true}); }
  const timer=setTimeout(()=>{ timedOut=true; controller.abort(new Error('provider timeout')); },timeoutMs);
  try {
    const response=await fetch(url,Object.assign({},init,{signal:controller.signal}));
    const text=await response.text(); let data=null;
    try { data=text?JSON.parse(text):null; } catch (_) { const e=new Error('Provider returned malformed JSON'); e.failureClass='malformed'; throw e; }
    if (!response.ok) { const e=new Error('Provider HTTP '+response.status); e.failureClass=response.status===429?'rate_limited':(response.status===401||response.status===403?'auth_required':'http_error'); e.httpStatus=response.status; throw e; }
    return {data,response};
  } catch (error) {
    if (timedOut) error=Object.assign(error||new Error('Provider timeout'),{failureClass:'timeout'});
    else if (error && error.name==='AbortError') error=Object.assign(error,{failureClass:'cancelled'});
    throw error;
  } finally { clearTimeout(timer); if(upstream)upstream.removeEventListener('abort',onAbort); }
}
function isValidBbox(bbox) {
  return Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)&&bbox[0]>=-180&&bbox[0]<bbox[2]&&bbox[2]<=180&&bbox[1]>=-90&&bbox[1]<bbox[3]&&bbox[3]<=90;
}
function bboxKey(bbox) { return bbox.map(v=>Number(v).toFixed(5)).join(','); }
async function runBudgeted(budget,circuit,task) {
  const now=Date.now();
  if(!circuit.canRequest(now)){const e=new Error('Provider circuit is open');e.failureClass='circuit_open';throw e;}
  if(!budget.canRequest(now)){const e=new Error('Provider request budget exhausted');e.failureClass='rate_limited';throw e;}
  budget.begin(now);
  try { const result=await task(); circuit.success(); return result; }
  catch(error){ if(!error||error.failureClass!=='cancelled') circuit.failure(); throw error; }
  finally { budget.end(); }
}
module.exports={BoundedTtlCache,CircuitBreaker,RequestBudget,clampInt,fetchJsonWithTimeout,isValidBbox,bboxKey,runBudgeted,sleep};