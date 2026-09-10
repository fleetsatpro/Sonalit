const router = require('express').Router();
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/error');
const { normaliseScope, countryClause } = require('../utils/intelligenceScope');
const aiClient = require('../utils/aiClient');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_EVENTS = 180;
const MAX_STORIES = 18;
const MAX_AI_STORIES = 8;
const cache = new Map();

const STOP = new Set('the a an and or of to in on for with from by at as is are was were be this that their its into after before over under about amid during against report reports says said has have had will may could would can local officials security authorities police army forces government area areas country people latest update new news'.split(' '));
const DOMAIN_HINTS = [
  ['maritime',['port','vessel','ship','navy','maritime','coast','piracy','sea','cargo','mombasa']],
  ['border-security',['border','crossing','frontier','customs','smuggling','checkpoint','mandera','garissa','busia','taveta']],
  ['counter-terrorism',['militant','terror','extremist','al-shabaab','isis','attack','bomb','insurgent','counter-terror']],
  ['civil-unrest',['protest','demonstration','riot','strike','rally','unrest','clash']],
  ['crime',['robbery','kidnap','hijack','murder','fraud','theft','criminal','arrest']],
  ['politics',['election','president','minister','parliament','government','party','vote','cabinet']],
  ['transport-logistics',['truck','convoy','road','highway','traffic','cargo','freight','logistics','driver']],
  ['natural-hazard',['flood','cyclone','storm','earthquake','landslide','rainfall','drought','wildfire','weather']],
  ['health',['outbreak','cholera','mpox','disease','hospital','health','virus','epidemic']],
  ['economic',['currency','inflation','market','economy','trade','fuel','commodity','price']],
];

function clean(v,max=3600){return String(v||'').replace(/\s+/g,' ').trim().slice(0,max);}
function sha(v){return crypto.createHash('sha1').update(String(v||'')).digest('hex');}
function norm(v){return clean(v,600).toLowerCase().replace(/[^a-z0-9\s-]/g,' ');}
function tokens(v){return new Set(norm(v).split(/\s+/).filter(x=>x.length>=4&&!STOP.has(x)));}
function overlap(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(1,Math.min(A.size,B.size));}
function km(lat1,lon1,lat2,lon2){if([lat1,lon1,lat2,lon2].some(v=>!Number.isFinite(Number(v))))return Infinity;const R=6371,toRad=x=>x*Math.PI/180;const dLat=toRad(Number(lat2)-Number(lat1));const dLon=toRad(Number(lon2)-Number(lon1));const a=Math.sin(dLat/2)**2+Math.cos(toRad(Number(lat1)))*Math.cos(toRad(Number(lat2)))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function domainFor(text){const s=norm(text);const hits=DOMAIN_HINTS.map(([d,ks])=>[d,ks.reduce((n,k)=>n+(s.includes(k)?1:0),0)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);return hits[0]?.[0]||'general-security';}
function scoreEvent(e){const severity={critical:100,high:75,moderate:50,medium:50,low:25}[String(e.severity||'').toLowerCase()]||10;const confidence=Number(e.confidence||0);const sources=Number(e.source_count||0);const recency=e.last_seen_at?Math.max(0,72-(Date.now()-new Date(e.last_seen_at).getTime())/3600000):0;return severity+confidence*.35+Math.min(20,sources*5)+recency*.3;}
function storyKey(cluster){return sha(cluster.map(e=>e.id).sort().join('|')).slice(0,12);}
function deterministicHeadline(cluster){const lead=[...cluster].sort((a,b)=>scoreEvent(b)-scoreEvent(a))[0]||{};const t=clean(lead.title||lead.summary||lead.headline||'Security development',180);return t.replace(/[.!?]+$/,'').toUpperCase();}
function deterministicTopic(cluster){const joined=cluster.map(e=>`${e.title||''} ${e.summary||''}`).join(' ');return domainFor(joined).replace(/-/g,' ').toUpperCase();}
function parseArray(text){const raw=clean(text,12000);try{const x=JSON.parse(raw);return Array.isArray(x)?x:[]}catch(_){const m=raw.match(/\[[\s\S]*\]/);if(!m)return[];try{const x=JSON.parse(m[0]);return Array.isArray(x)?x:[]}catch{return[]}}}
function confidenceFromCluster(cluster){const values=cluster.map(e=>Number(e.confidence||0)).filter(Number.isFinite);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):50;}

async function synthesize(clusters){
  const out=new Map();
  const candidates=clusters.slice(0,MAX_AI_STORIES).map(cluster=>({
    story_id:storyKey(cluster),
    observations:cluster.slice(0,8).map(e=>({id:String(e.id),title:clean(e.title,500),summary:clean(e.summary,1400),country_code:e.country_code||null,severity:e.severity||null,confidence:e.confidence||null,evidence_count:e.source_count||0,last_seen_at:e.last_seen_at||null}))
  }));
  if(!(aiClient.hasAnthropic()||aiClient.hasGroqFallback())||!candidates.length)return out;
  try{
    const response=await aiClient.createMessage({max_tokens:5200,system:`You are Sonalit's intelligence synthesis engine. Convert grouped source events into concise operational intelligence objects. You must only use facts explicitly present in the supplied observations. Do not invent actors, locations, casualties, motives, dates or outcomes. Treat allegations as allegations. Preserve uncertainty. Create a neutral canonical headline that removes clickbait and source-brand wording, a precise topic label, an executive brief, key facts, why-it-matters, and analytical caveats. Return ONLY JSON: [{story_id,headline,topic,brief,key_facts,why_it_matters,caveats,confidence_label,operational_relevance}]. key_facts/why_it_matters/caveats must be short arrays of strings. confidence_label must be LOW, MODERATE or HIGH. operational_relevance must be NONE, LOW, MEDIUM or HIGH.`,messages:[{role:'user',content:JSON.stringify(candidates)}]});
    for(const x of parseArray(response.content?.filter?.(b=>b?.type==='text').map(b=>b.text).join('\n')||''))if(x?.story_id)out.set(String(x.story_id),x);
  }catch(err){logger.warn(`Intelligence synthesis unavailable: ${err.message}`);}
  return out;
}

router.get('/stories', asyncHandler(async(req,res)=>{
  const s=normaliseScope(req);
  const windowHours=Math.min(168,Math.max(1,Number(req.query.window_hours)||24));
  const limit=Math.min(30,Math.max(1,Number(req.query.limit)||18));
  const key=sha(JSON.stringify({org:req.user.org_id,scope:s,windowHours,limit}));
  const hit=cache.get(key); if(hit&&hit.expires>Date.now())return res.json(hit.value);
  const geo=countryClause(s,'e',3);
  const limitIndex=3+geo.params.length;
  const {rows}=await req.db(`SELECT e.id,e.title,e.summary,e.description,e.country_code,e.scope_type,e.scope_key,e.severity,e.confidence,e.status,e.latitude,e.longitude,e.first_seen_at,e.last_seen_at,COUNT(eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.last_seen_at>=now()-($2::int * interval '1 hour') AND ${geo.clause} GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT $${limitIndex}`,[req.user.org_id,windowHours,...geo.params,MAX_EVENTS]);
  const events=rows.filter(e=>e.title||e.summary);
  const clusters=[];const used=new Set();
  for(const event of [...events].sort((a,b)=>scoreEvent(b)-scoreEvent(a))){
    if(used.has(String(event.id)))continue;
    const cluster=[event];used.add(String(event.id));
    for(const other of events){
      if(used.has(String(other.id)))continue;
      const sameCountry=!event.country_code||!other.country_code||String(event.country_code).toUpperCase()===String(other.country_code).toUpperCase();
      const sameStory=overlap(`${event.title||''} ${event.summary||''}`,`${other.title||''} ${other.summary||''}`)>=0.42;
      const proximity=km(event.latitude,event.longitude,other.latitude,other.longitude)<=75;
      const timeA=new Date(event.last_seen_at||event.first_seen_at||0).getTime(),timeB=new Date(other.last_seen_at||other.first_seen_at||0).getTime();
      const within=Math.abs(timeA-timeB)<=48*3600000;
      if(sameCountry&&within&&(sameStory||proximity)){cluster.push(other);used.add(String(other.id));}
    }
    clusters.push(cluster);
    if(clusters.length>=MAX_STORIES*2)break;
  }
  const ai=await synthesize(clusters);
  const stories=clusters.slice(0,limit).map((cluster,index)=>{
    const lead=[...cluster].sort((a,b)=>scoreEvent(b)-scoreEvent(a))[0];
    const id=storyKey(cluster), generated=ai.get(id)||{};
    const severity=cluster.some(e=>String(e.severity||'').toLowerCase()==='critical')?'critical':cluster.some(e=>String(e.severity||'').toLowerCase()==='high')?'high':cluster.some(e=>String(e.severity||'').toLowerCase()==='moderate')?'moderate':'low';
    const confidence=generated.confidence_label?String(generated.confidence_label).toUpperCase():confidenceFromCluster(cluster)>=75?'HIGH':confidenceFromCluster(cluster)>=45?'MODERATE':'LOW';
    return {id,rank:index+1,headline:clean(generated.headline||deterministicHeadline(cluster),220).toUpperCase(),topic:clean(generated.topic||deterministicTopic(cluster),100).toUpperCase(),brief:clean(generated.brief||lead.summary||lead.description||lead.title,700),key_facts:Array.isArray(generated.key_facts)?generated.key_facts.slice(0,5):[],why_it_matters:Array.isArray(generated.why_it_matters)?generated.why_it_matters.slice(0,4):[],caveats:Array.isArray(generated.caveats)?generated.caveats.slice(0,4):[],confidence_label:confidence,operational_relevance:String(generated.operational_relevance||'MEDIUM').toUpperCase(),severity,country_code:lead.country_code||null,status:cluster.some(e=>String(e.status||'').toLowerCase()==='closed')?'CLOSED':'DEVELOPING',source_count:cluster.reduce((n,e)=>n+Number(e.source_count||0),0),observation_count:cluster.length,first_seen_at:cluster.reduce((v,e)=>!v||new Date(e.first_seen_at||e.last_seen_at)<new Date(v)?(e.first_seen_at||e.last_seen_at):v,null),last_seen_at:cluster.reduce((v,e)=>!v||new Date(e.last_seen_at||e.first_seen_at)>new Date(v)?(e.last_seen_at||e.first_seen_at):v,null),event_ids:cluster.map(e=>e.id),events:cluster.slice(0,10)};
  });
  const topicMap=new Map();
  for(const story of stories){const current=topicMap.get(story.topic)||{topic:story.topic,story_count:0,signal_count:0,severity:'low',countries:new Set()};current.story_count++;current.signal_count+=story.observation_count;current.severity=['critical','high','moderate','low'].indexOf(story.severity)<['critical','high','moderate','low'].indexOf(current.severity)?story.severity:current.severity;if(story.country_code)current.countries.add(story.country_code);topicMap.set(story.topic,current);}
  const topics=[...topicMap.values()].map(x=>({...x,countries:[...x.countries]})).sort((a,b)=>b.signal_count-a.signal_count).slice(0,8);
  const changes={signals_24h:events.length,high_priority:events.filter(e=>['critical','high'].includes(String(e.severity||'').toLowerCase())).length,developing_stories:stories.filter(s=>s.status==='DEVELOPING').length,source_observations:events.reduce((n,e)=>n+Number(e.observation_count||0),0)};
  const payload={stories,topics,changes,scope:s,generated_at:new Date().toISOString(),engine:{name:'SONALIT SYNTHESIS ENGINE',ai_used:ai.size>0,stories_synthesized:ai.size,cache_ttl_seconds:CACHE_TTL_MS/1000}};
  cache.set(key,{expires:Date.now()+CACHE_TTL_MS,value:payload});
  res.json(payload);
}));

router.get('/stories/:id', asyncHandler(async(req,res)=>{
  const ids=Array.isArray(req.query.event_ids)?req.query.event_ids.filter(Boolean):String(req.query.event_ids||req.params.id).split(',').map(x=>x.trim()).filter(Boolean);
  const safeIds=ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x)).slice(0,20);
  if(!safeIds.length)return res.status(400).json({error:'event_ids must contain valid event UUIDs'});
  const {rows}=await req.db(`SELECT e.id,e.title,e.summary,e.description,e.country_code,e.scope_type,e.scope_key,e.severity,e.confidence,e.status,e.latitude,e.longitude,e.first_seen_at,e.last_seen_at,COUNT(eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.id=ANY($2::uuid[]) GROUP BY e.id ORDER BY e.last_seen_at DESC`,[req.user.org_id,safeIds]);
  res.json({events:rows});
}));

module.exports=router;
