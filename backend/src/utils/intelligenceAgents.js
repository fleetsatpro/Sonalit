// Background intelligence agents: translation, event synthesis, and evidence-governed multi-agent publishing.
const aiClient=require('./aiClient');
const {translateItems}=require('./intelligenceTranslation');
const {runPublicationEditorialBoard,AGENT_ROLES}=require('./intelligencePublicationEditorialBoard');
const {query}=require('../config/database');
const logger=require('./logger');

const COUNTRY_NAMES={KE:'Kenya',SO:'Somalia',ET:'Ethiopia',UG:'Uganda',TZ:'Tanzania',RW:'Rwanda',BI:'Burundi',SS:'South Sudan',DJ:'Djibouti',ER:'Eritrea',SD:'Sudan',CD:'DR Congo'};
const DAILY_COUNTRIES=(process.env.INTEL_PUBLICATION_COUNTRIES||Object.keys(COUNTRY_NAMES).join(',')).split(',').map(x=>x.trim().toUpperCase()).filter(x=>COUNTRY_NAMES[x]);
const MAX_TRANSLATE=24;
const MAX_SYNTHESIS=10;
function clean(v,n=5000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function extract(response){return Array.isArray(response?.content)?response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n'):'';}
function parse(text){try{return JSON.parse(text)}catch{}const m=String(text||'').match(/[\[{][\s\S]*[\]}]/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}
function dayBounds(date=new Date()){const d=new Date(date);d.setUTCHours(0,0,0,0);return{start:d,end:new Date(d.getTime()+86400000)}}
async function translateQueue(orgId){
  const {rows}=await query(`SELECT id,title,body,language FROM intel_observations WHERE org_id=$1 AND translation_status='pending' AND language IS NOT NULL AND LOWER(language) NOT LIKE 'en%' ORDER BY observed_at DESC LIMIT $2`,[orgId,MAX_TRANSLATE]);
  if(!rows.length)return{queued:0,translated:0};
  const translated=await translateItems(rows);let done=0;
  for(const r of rows){const t=translated.get(String(r.id));if(t){await query(`UPDATE intel_observations SET title_en=$2,body_en=$3,translation_status='translated',translated_at=NOW() WHERE id=$1 AND org_id=$4`,[r.id,t.title||r.title,t.body||r.body,orgId]);done++;}else if(aiClient.hasAnthropic()||aiClient.hasGroqFallback())await query(`UPDATE intel_observations SET translation_status='failed' WHERE id=$1 AND org_id=$2`,[r.id,orgId]).catch(()=>{});}
  return{queued:rows.length,translated:done};
}
async function synthesizeEvents(orgId){
  const {rows}=await query(`SELECT e.id,e.title,e.summary,e.country_code,e.severity,e.confidence,e.last_seen_at,COALESCE(json_agg(json_build_object('id',o.id,'title',COALESCE(o.title_en,o.title),'body',COALESCE(o.body_en,o.body),'language',o.language,'credibility',o.credibility,'source',s.name,'source_reliability',s.reliability,'observed_at',o.observed_at)) FILTER (WHERE o.id IS NOT NULL),'[]') AS evidence FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id LEFT JOIN intel_sources s ON s.id=o.source_id WHERE e.org_id=$1 AND (e.synthesized_at IS NULL OR e.last_seen_at>e.synthesized_at) GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT $2`,[orgId,MAX_SYNTHESIS]);
  if(!rows.length||!(aiClient.hasAnthropic()||aiClient.hasGroqFallback()))return{queued:rows.length,synthesized:0};
  const payload=rows.map(e=>({id:String(e.id),title:clean(e.title,900),summary:clean(e.summary,1800),country:e.country_code,severity:e.severity,confidence:e.confidence,evidence:e.evidence.slice(0,8)}));
  let result;let provider='unknown';
  try{const response=await aiClient.createMessage({max_tokens:5200,system:`You are the Sonalit headline and intelligence synthesis agent. Work only from supplied evidence. Produce factual, publication-safe objects. Never invent actors, casualties, motives, dates, locations or outcomes. Distinguish reported facts from assessment. Return ONLY JSON array with {id,headline,brief,intelligence_type,key_facts,why_it_matters,caveats,confidence}. headline <= 120 chars. key_facts/why_it_matters/caveats are short arrays. intelligence_type must be one of SECURITY, POLITICAL, CRIME, LOGISTICS, MARITIME, BORDER, NATURAL_HAZARD, HEALTH, ECONOMIC, OTHER. confidence is 0-100.`,messages:[{role:'user',content:JSON.stringify(payload)}]});provider=response?._provider||'unknown';result=parse(extract(response));}catch(error){logger.warn(`Intelligence synthesis agent failed org=${orgId}: ${error.message}`);return{queued:rows.length,synthesized:0,error:error.message};}
  let count=0;for(const x of Array.isArray(result)?result:[]){if(!x?.id)continue;const evidence=rows.find(r=>String(r.id)===String(x.id));if(!evidence)continue;await query(`UPDATE intel_events SET canonical_headline=$2,executive_brief=$3,intelligence_type=$4,key_facts=$5::jsonb,why_it_matters=$6::jsonb,caveats=$7::jsonb,synthesis_confidence=$8,synthesized_at=NOW(),synthesis_provider=$9,updated_at=NOW() WHERE id=$1 AND org_id=$10`,[x.id,clean(x.headline,180)||evidence.title,clean(x.brief,1600)||evidence.summary||evidence.title,x.intelligence_type||'OTHER',JSON.stringify(Array.isArray(x.key_facts)?x.key_facts.slice(0,6):[]),JSON.stringify(Array.isArray(x.why_it_matters)?x.why_it_matters.slice(0,5):[]),JSON.stringify(Array.isArray(x.caveats)?x.caveats.slice(0,5):[]),Math.max(0,Math.min(100,Number(x.confidence)||Number(evidence.confidence)||50)),provider,orgId]);count++;}
  return{queued:rows.length,synthesized:count};
}

async function publicationForCountry(orgId,country,type='daily'){
  const now=new Date();let start,end;if(type==='daily'){({start,end}=dayBounds(now));}else if(type==='weekly'){const d=new Date(now);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);d.setUTCHours(0,0,0,0);start=d;end=new Date(d.getTime()+7*86400000);}else{start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));}
  const {rows:existing}=await query(`SELECT id,status FROM intel_publications WHERE org_id=$1 AND country_code=$2 AND publication_type=$3 AND period_start=$4 AND period_end=$5 ORDER BY version DESC LIMIT 1`,[orgId,country,type,start,end]);
  if(existing.length)return{status:'exists',id:existing[0].id};
  const {rows:events}=await query(`SELECT e.id,COALESCE(e.canonical_headline,e.title) AS headline,COALESCE(e.executive_brief,e.summary) AS brief,e.severity,e.confidence,e.intelligence_type,e.last_seen_at,e.latitude,e.longitude,COUNT(DISTINCT eo.observation_id)::int AS observation_count,COUNT(DISTINCT o.source_id)::int AS source_count FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4 GROUP BY e.id ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC LIMIT 40`,[orgId,country,start,end]);
  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);const sourceCount=new Set();for(const e of events){const {rows:s}=await query(`SELECT DISTINCT o.source_id FROM intel_event_observations eo JOIN intel_observations o ON o.id=eo.observation_id WHERE eo.event_id=$1`,[e.id]);for(const x of s)if(x.source_id)sourceCount.add(String(x.source_id));}
  const evidenceContract=evidenceCount>=3&&sourceCount.size>=2;let title=`${COUNTRY_NAMES[country]} Security Intelligence — ${type.toUpperCase()} Report`;
  const baseBody={reporting_standard:'Sonalit Evidence-Governed Intelligence',country_code:country,country_name:COUNTRY_NAMES[country],publication_type:type,period_start:start.toISOString(),period_end:end.toISOString(),executive_assessment:`Collection coverage for ${COUNTRY_NAMES[country]} produced ${events.length} security-relevant event objects during the reporting period.`,key_events:events,collection_coverage:{event_count:events.length,evidence_count:evidenceCount,source_count:sourceCount.size,evidence_contract_met:evidenceContract},sections:['executive_assessment','security_environment','key_events','political_developments','crime_and_public_safety','border_and_transport','natural_hazards','operational_implications','outlook','collection_gaps'],analyst_note:evidenceContract?'Evidence threshold met for automated publication.':'Evidence threshold not met; publication remains a draft for analyst review.'};
  let executive=baseBody.executive_assessment;let subtitle=null;let sections=baseBody.sections;let outlook=[];let board=null;let visual=null;let graphics=null;let provider='multi-agent-editorial-board';
  if((aiClient.hasAnthropic()||aiClient.hasGroqFallback())&&events.length){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events,baseBody,evidenceContract});
      board=result.board;visual=result.visual;graphics=result.graphics;
      const final=result.final;
      if(final){title=final.title||title;subtitle=final.subtitle||null;executive=final.executive_assessment||executive;sections=final.sections||sections;outlook=final.outlook||[];}
      if(!result.publishable) logger.warn(`Publication editorial board held ${country}/${type}: evidence=${evidenceContract} qa=${result.qa?.publishable===true} blocking=${(result.qa?.blocking_issues||[]).length}`);
    }catch(error){logger.warn(`Publication editorial board failed ${country}/${type}: ${error.message}`);}
  }
  const qaComplete=Boolean(board?.agents?.some(a=>a.id==='publication-qa'&&a.status==='complete'));
  const status=(evidenceContract&&(!board||qaComplete))?'published':'draft';
  const body={...baseBody,subtitle,sections,outlook,key_events:events,editorial_board:{agents:AGENT_ROLES.map(a=>a.id),board,visual_plan:visual,graphics_plan:graphics,provider},generator:{name:'SONALIT MULTI-AGENT PUBLICATION BOARD',provider,evidence_contract:evidenceContract}};
  const {rows}=await query(`INSERT INTO intel_publications (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING id,status`,[orgId,country,type,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,status==='published'?new Date():null]);return{status:'created',publication_id:rows[0].id,publication_status:rows[0].status,evidence_contract:evidenceContract,evidence_count:evidenceCount,source_count:sourceCount.size,editorial_agents:AGENT_ROLES.length};
}
async function publishDue(orgId){const results=[];for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'daily')});}catch(error){results.push({country,status:'failed',error:error.message});}}
 const d=new Date();if(d.getUTCDay()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'weekly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 if(d.getUTCDate()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'monthly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 return{processed:results.length,results};}
async function runIntelligenceAgents(){const {rows:orgs}=await query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const output=[];for(const {org_id} of orgs){try{const translation=await translateQueue(org_id);const synthesis=await synthesizeEvents(org_id);const publications=await publishDue(org_id);output.push({org_id,translation,synthesis,publications});}catch(error){output.push({org_id,error:error.message});logger.warn(`Intelligence agents org=${org_id} failed: ${error.message}`);}}return output;}
module.exports={runIntelligenceAgents,translateQueue,synthesizeEvents,publishDue,publicationForCountry};
