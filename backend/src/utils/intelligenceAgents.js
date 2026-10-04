// Background intelligence agents: translation, event synthesis, and evidence-governed multi-agent publishing.
const aiClient=require('./aiClient');
const {translateItems}=require('./intelligenceTranslation');
const {runPublicationEditorialBoard,AGENT_ROLES}=require('./intelligencePublicationEditorialBoard');
const {query,globalQuery}=require('../config/database');
const {runWithOrgContext}=require('./tenantContext');
const logger=require('./logger');
const { buildEvidencePublication } = require('./intelligencePublicationBuilder');

const COUNTRY_NAMES={KE:'Kenya',SO:'Somalia',ET:'Ethiopia',UG:'Uganda',TZ:'Tanzania',RW:'Rwanda',BI:'Burundi',SS:'South Sudan',DJ:'Djibouti',ER:'Eritrea',SD:'Sudan',CD:'DR Congo'};
const DAILY_COUNTRIES=(process.env.INTEL_PUBLICATION_COUNTRIES||Object.keys(COUNTRY_NAMES).join(',')).split(',').map(x=>x.trim().toUpperCase()).filter(x=>COUNTRY_NAMES[x]);
const MAX_TRANSLATE=24;
const MAX_SYNTHESIS=10;
function clean(v,n=5000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function extract(response){return Array.isArray(response?.content)?response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n'):'';}
function parse(text){try{return JSON.parse(text)}catch{}const m=String(text||'').match(/[\[{][\s\S]*[\]}]/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}
function dayBounds(date=new Date()){const d=new Date(date);d.setUTCHours(0,0,0,0);return{start:d,end:new Date(d.getTime()+86400000)}}
function evidenceDerivedSynthesis(event){
  const text=clean(`${event?.title||''} ${event?.summary||''}`,2200).toLowerCase();
  let intelligence_type='OTHER';
  if(/\b(earthquake|flood|cyclone|storm|wildfire|drought|volcan|landslide|tsunami|natural hazard)\b/.test(text)) intelligence_type='NATURAL_HAZARD';
  else if(/\b(outbreak|cholera|disease|health|ebola|mpox|malaria)\b/.test(text)) intelligence_type='HEALTH';
  else if(/\b(vessel|ship|maritime|shipping lane|seafar|piracy)\b/.test(text)) intelligence_type='MARITIME';
  else if(/\b(border|crossing|checkpoint|customs)\b/.test(text)) intelligence_type='BORDER';
  else if(/\b(attack|ambush|kidnap|abduct|bomb|explosion|terror|gunfire|militia|insurgent|armed|security)\b/.test(text)) intelligence_type='SECURITY';
  else if(/\b(election|parliament|government|president|minister|vote|coup|opposition|political)\b/.test(text)) intelligence_type='POLITICAL';
  else if(/\b(robbery|theft|murder|arrest|gang|smuggl|fraud|crime)\b/.test(text)) intelligence_type='CRIME';
  else if(/\b(port|cargo|shipment|trucking|freight|logistics|transport|road closure|supply chain)\b/.test(text)) intelligence_type='LOGISTICS';
  else if(/\b(inflation|currency|trade|economy|economic|fuel price)\b/.test(text)) intelligence_type='ECONOMIC';

  const evidence=Array.isArray(event?.evidence)?event.evidence:[];
  const key_facts=evidence.slice(0,6).map((item)=>{
    const source=clean(item?.source||'Source',120);
    const title=clean(item?.title||item?.body||'Evidence record',420);
    return `${source}: ${title}`;
  });
  return {
    id:String(event.id),
    headline:clean(event.title||'INTELLIGENCE EVENT',180),
    brief:clean(event.summary||event.title||'Evidence record available.',1600),
    intelligence_type,
    key_facts,
    why_it_matters:['Evidence-derived event record retained; automated analytical synthesis is unavailable.'],
    caveats:['Automated AI synthesis unavailable; no unsupported inference added.'],
    confidence:Math.max(0,Math.min(100,Number(event.confidence)||50)),
  };
}
async function applyEvidenceSynthesisFallback(rows,orgId,reason){
  let count=0;
  for(const event of rows){
    const fallback=evidenceDerivedSynthesis(event);
    await query(`UPDATE intel_events
      SET canonical_headline=$2,
          executive_brief=$3,
          intelligence_type=$4,
          key_facts=$5::jsonb,
          why_it_matters=$6::jsonb,
          caveats=$7::jsonb,
          synthesis_confidence=$8,
          synthesized_at=NOW(),
          synthesis_provider='evidence-fallback',
          updated_at=NOW()
      WHERE id=$1 AND org_id=$9`,
      [fallback.id,fallback.headline,fallback.brief,fallback.intelligence_type,
        JSON.stringify(fallback.key_facts),JSON.stringify(fallback.why_it_matters),
        JSON.stringify(fallback.caveats),fallback.confidence,orgId]);
    count++;
  }
  logger.warn(`Intelligence synthesis evidence fallback applied org=${orgId}: events=${count} reason=${reason}`);
  return {queued:rows.length,synthesized:count,fallback:true,reason};
}

async function translateQueue(orgId){
  const {rows}=await query(`SELECT id,title,body,language FROM intel_observations WHERE org_id=$1 AND translation_status='pending' AND language IS NOT NULL AND LOWER(language) NOT LIKE 'en%' ORDER BY observed_at DESC LIMIT $2`,[orgId,MAX_TRANSLATE]);
  if(!rows.length)return{queued:0,translated:0};
  const translated=await translateItems(rows);let done=0;
  for(const r of rows){const t=translated.get(String(r.id));if(t){await query(`UPDATE intel_observations SET title_en=$2,body_en=$3,translation_status='translated',translated_at=NOW() WHERE id=$1 AND org_id=$4`,[r.id,t.title||r.title,t.body||r.body,orgId]);done++;}else if(aiClient.hasAnyProvider())await query(`UPDATE intel_observations SET translation_status='failed' WHERE id=$1 AND org_id=$2`,[r.id,orgId]).catch(()=>{});}
  return{queued:rows.length,translated:done};
}
async function synthesizeEvents(orgId){
  const {rows}=await query(`SELECT e.id,e.title,e.summary,e.country_code,e.severity,e.confidence,e.last_seen_at,COALESCE(json_agg(json_build_object('id',o.id,'title',COALESCE(o.title_en,o.title),'body',COALESCE(o.body_en,o.body),'language',o.language,'credibility',o.credibility,'source',s.name,'source_reliability',s.reliability,'observed_at',o.observed_at)) FILTER (WHERE o.id IS NOT NULL),'[]') AS evidence FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id LEFT JOIN intel_observations o ON o.id=eo.observation_id LEFT JOIN intel_sources s ON s.id=o.source_id WHERE e.org_id=$1 AND (e.synthesized_at IS NULL OR e.last_seen_at>e.synthesized_at) GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT $2`,[orgId,MAX_SYNTHESIS]);
  if(!rows.length)return{queued:0,synthesized:0};
  if(!aiClient.hasAnyProvider())return applyEvidenceSynthesisFallback(rows,orgId,'no_ai_provider_available');
  const payload=rows.map(e=>({id:String(e.id),title:clean(e.title,900),summary:clean(e.summary,1800),country:e.country_code,severity:e.severity,confidence:e.confidence,evidence:e.evidence.slice(0,8)}));
  let result;let provider='unknown';
  try{
    const response=await aiClient.createMessage({max_tokens:5200,system:`You are the Sonalit headline and intelligence synthesis agent. Work only from supplied evidence. Produce factual, publication-safe objects. Never invent actors, casualties, motives, dates, locations or outcomes. Distinguish reported facts from assessment. Return ONLY JSON array with {id,headline,brief,intelligence_type,key_facts,why_it_matters,caveats,confidence}. headline <= 120 chars. key_facts/why_it_matters/caveats are short arrays. intelligence_type must be one of SECURITY, POLITICAL, CRIME, LOGISTICS, MARITIME, BORDER, NATURAL_HAZARD, HEALTH, ECONOMIC, OTHER. confidence is 0-100.`,messages:[{role:'user',content:JSON.stringify(payload)}]});
    provider=response?._provider||'unknown';
    result=parse(extract(response));
  }catch(error){
    logger.warn(`Intelligence synthesis agent failed org=${orgId}: ${error.message}`);
    return applyEvidenceSynthesisFallback(rows,orgId,error.message);
  }
  if(!Array.isArray(result)||!result.length)return applyEvidenceSynthesisFallback(rows,orgId,'provider_returned_no_structured_result');
  let count=0;
  for(const x of result){
    if(!x?.id)continue;
    const evidence=rows.find(r=>String(r.id)===String(x.id));
    if(!evidence)continue;
    await query(`UPDATE intel_events SET canonical_headline=$2,executive_brief=$3,intelligence_type=$4,key_facts=$5::jsonb,why_it_matters=$6::jsonb,caveats=$7::jsonb,synthesis_confidence=$8,synthesized_at=NOW(),synthesis_provider=$9,updated_at=NOW() WHERE id=$1 AND org_id=$10`,[
      x.id,clean(x.headline,180)||evidence.title,clean(x.brief,1600)||evidence.summary||evidence.title,x.intelligence_type||'OTHER',
      JSON.stringify(Array.isArray(x.key_facts)?x.key_facts.slice(0,6):[]),
      JSON.stringify(Array.isArray(x.why_it_matters)?x.why_it_matters.slice(0,5):[]),
      JSON.stringify(Array.isArray(x.caveats)?x.caveats.slice(0,5):[]),
      Math.max(0,Math.min(100,Number(x.confidence)||Number(evidence.confidence)||50)),provider,orgId
    ]);
    count++;
  }
  if(count<rows.length){
    const remaining=rows.filter(r=>!result.some(x=>String(x?.id)===String(r.id)));
    const fallback=remaining.length?await applyEvidenceSynthesisFallback(remaining,orgId,'partial_provider_result'):null;
    return {queued:rows.length,synthesized:count+(fallback?.synthesized||0),fallback:Boolean(fallback),provider};
  }
  return{queued:rows.length,synthesized:count,provider};
}

async function publicationForCountry(orgId,country,type='daily'){
  const now=new Date();
  let start,end;
  if(type==='daily'){({start,end}=dayBounds(now));}
  else if(type==='weekly'){
    const d=new Date(now);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);d.setUTCHours(0,0,0,0);start=d;end=new Date(d.getTime()+7*86400000);
  } else {
    start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  }
  const {rows:existing}=await query(
    \`SELECT id,status,version,body,pdf_status,pdf_version FROM intel_publications
      WHERE org_id=$1 AND country_code=$2 AND publication_type=$3 AND period_start=$4 AND period_end=$5
      ORDER BY version DESC LIMIT 1\`,[orgId,country,type,start,end]
  );
  const {rows:events}=await query(
    \`SELECT
      e.id,COALESCE(e.canonical_headline,e.title) AS headline,
      COALESCE(e.executive_brief,e.summary) AS brief,e.summary,e.title,e.severity,e.confidence,e.intelligence_type,
      e.latitude,e.longitude,e.region,e.risk_velocity,e.occurred_from,e.occurred_to,e.last_seen_at,
      COUNT(DISTINCT eo.observation_id)::int AS observation_count,
      COUNT(DISTINCT o.source_id)::int AS source_count,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'id',o.id,'source_id',o.source_id,'source_name',s.name,
          'title',COALESCE(o.title_en,o.title),'url',o.url,
          'observed_at',o.observed_at,'published_at',o.published_at,'credibility',o.credibility
        )) FILTER (WHERE o.id IS NOT NULL),'[]'::json
      ) AS evidence
      FROM intel_events e
      LEFT JOIN intel_event_observations eo ON eo.event_id=e.id
      LEFT JOIN intel_observations o ON o.id=eo.observation_id
      LEFT JOIN intel_sources s ON s.id=o.source_id
      WHERE e.org_id=$1 AND e.country_code=$2 AND e.last_seen_at>=$3 AND e.last_seen_at<$4
      GROUP BY e.id
      ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC
      LIMIT 80\`,[orgId,country,start,end]
  );

  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);
  const sourceIds=new Set();
  for(const e of events) for(const obs of Array.isArray(e.evidence)?e.evidence:[]) if(obs&&obs.source_id) sourceIds.add(String(obs.source_id));
  const sourceCount=sourceIds.size;
  const evidenceContract=evidenceCount>=3&&sourceCount>=2;
  const periodClosed=end.getTime()<=now.getTime();
  const priorCoverage=existing[0]?.body?.collection_coverage||{};
  const unchanged=existing.length && existing[0].status==='published'
    && Number(priorCoverage.evidence_count||-1)===evidenceCount
    && Number(priorCoverage.source_count||-1)===sourceCount;
  if(existing.length && existing[0].status==='published' && (periodClosed || unchanged)) return{status:'exists',id:existing[0].id,publication_id:existing[0].id,publication_status:'published',version:existing[0].version||1};

  const refreshPdf=Boolean(existing.length && (Number(priorCoverage.evidence_count||-1)!==evidenceCount || Number(priorCoverage.source_count||-1)!==sourceCount));

  const deterministic=buildEvidencePublication({country,type,start,end,events,evidenceCount,sourceCount,evidenceContract});
  let finalBody=deterministic;
  let title=deterministic.title;
  let subtitle=deterministic.subtitle;
  let executive=deterministic.executive_assessment;
  let board=null,visual=null,graphics=null;
  let provider='evidence-first-fallback';

  if(String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true' && aiClient.hasAnyProvider() && events.length){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events,baseBody:deterministic,evidenceContract});
      board=result.board;visual=result.visual;graphics=result.graphics;provider=result.provider||'multi-agent-editorial-board';
      const final=result.final;
      if(final){title=final.title||title;subtitle=final.subtitle||subtitle;executive=final.executive_assessment||executive;finalBody={...deterministic,...final};}
      if(!result.publishable) logger.warn(\`Publication editorial board held \${country}/\${type}: evidence=\${evidenceContract} qa=\${result.qa?.publishable===true} blocking=\${(result.qa?.blocking_issues||[]).length}\`);
    }catch(error){logger.warn(\`Publication editorial board unavailable \${country}/\${type}; deterministic evidence product retained: \${error.message}\`);}
  }

  const boardPublishable=board?.publishable===true;
  const aiRequired=String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true';
  const status=(evidenceContract&&(!aiRequired||boardPublishable))?'published':'draft';
  const version=existing.length?Number(existing[0].version||1)+1:1;
  const body={
    ...finalBody,title,subtitle,executive_assessment:executive,key_events:events,
    editorial_board:{agents:AGENT_ROLES.map(a=>a.id),board,visual_plan:visual,graphics_plan:graphics,provider},
    generator:{
      name:'SONALIT EVIDENCE-FIRST PUBLICATION FABRIC',
      provider,
      mode:provider==='evidence-first-fallback'?'DETERMINISTIC_EVIDENCE_PUBLICATION':'AI_ENHANCED',
      evidence_contract:evidenceContract
    },
    version
  };
  let publicationId=null;
  if(existing.length){
    const updated=await query(
      \`UPDATE intel_publications
       SET title=$3,subtitle=$4,status=$5,period_start=$6,period_end=$7,executive_assessment=$8,body=$9::jsonb,evidence=$10::jsonb,confidence=$11,version=$12,published_at=CASE WHEN $5='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW()
       WHERE id=$1 AND org_id=$2 RETURNING id,status,version\`,
      [existing[0].id,orgId,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),
       events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,version]
    );
    publicationId=updated.rows[0]?.id||existing[0].id;
    if(refreshPdf && status==='published'){
      await query(
        "UPDATE intel_publications SET pdf_status='not_requested',pdf_key=NULL,pdf_url=NULL,pdf_generated_at=NULL,pdf_error=NULL,pdf_version=COALESCE(pdf_version,1)+1,updated_at=NOW() WHERE id=$1 AND org_id=$2",
        [publicationId,orgId]
      );
    }
  } else {
    const inserted=await query(
      \`INSERT INTO intel_publications
       (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
       RETURNING id,status,version\`,
      [orgId,country,type,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(events.map(e=>e.id)),
       events.length?Math.round(events.reduce((n,e)=>n+Number(e.confidence||0),0)/events.length):0,status==='published'?new Date():null,version]
    );
    publicationId=inserted.rows[0]?.id||null;
  }
  return{
    status:'created',publication_id:publicationId,publication_status:status,
    evidence_contract:evidenceContract,evidence_count:evidenceCount,source_count:sourceCount,
    editorial_agents:AGENT_ROLES.length,generator_mode:body.generator.mode,version
  };
}
async function publishDue(orgId){const results=[];for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'daily')});}catch(error){results.push({country,status:'failed',error:error.message});}}
 const d=new Date();if(d.getUTCDay()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'weekly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 if(d.getUTCDate()===1){for(const country of DAILY_COUNTRIES){try{results.push({country,...await publicationForCountry(orgId,country,'monthly')});}catch(error){results.push({country,status:'failed',error:error.message});}}}
 return{processed:results.length,results};}
async function runIntelligenceAgents(){const {rows:orgs}=await globalQuery(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);const output=[];for(const {org_id} of orgs){try{const result=await runWithOrgContext(org_id,async()=>{const translation=await translateQueue(org_id);const synthesis=await synthesizeEvents(org_id);const publications=await publishDue(org_id);return{translation,synthesis,publications};});output.push({org_id,...result});}catch(error){output.push({org_id,error:error.message});logger.warn(`Intelligence agents org=${org_id} failed: ${error.message}`);}}return output;}
module.exports={runIntelligenceAgents,translateQueue,synthesizeEvents,publishDue,publicationForCountry,evidenceDerivedSynthesis};