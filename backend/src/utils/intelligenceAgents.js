// Background intelligence agents: translation, event synthesis, and evidence-governed multi-agent publishing.
const aiClient=require('./aiClient');
const crypto=require('crypto');
const {translateItems}=require('./intelligenceTranslation');
const {runPublicationEditorialBoard,AGENT_ROLES}=require('./intelligencePublicationEditorialBoard');
const {query,globalQuery}=require('../config/database');
const {withOrg}=require('./orgScopedDb');
const {runWithOrgContext}=require('./tenantContext');
const logger=require('./logger');
const { buildEvidencePublication } = require('./intelligencePublicationBuilder');
const { publicationRecoveryMetadata } = require('./publicationRecoveryMetadata');
const { researchPublicationIncidents } = require('./intelligenceIncidentResearch');
const { auditPublicationContent, assessPublicationQuality, isAggregatorDomain, normalizeDomain, sourceIsSubstantive, isRepetitiveTemplateText } = require('./publicationQuality');
const { PDF_RENDERER_VERSION } = require('../services/intelligencePublicationPdfProfessional');

const COUNTRY_NAMES={KE:'Kenya',SO:'Somalia',ET:'Ethiopia',UG:'Uganda',TZ:'Tanzania',RW:'Rwanda',BI:'Burundi',SS:'South Sudan',DJ:'Djibouti',ER:'Eritrea',SD:'Sudan',CD:'DR Congo'};
const DAILY_COUNTRIES=(process.env.INTEL_PUBLICATION_COUNTRIES||Object.keys(COUNTRY_NAMES).join(',')).split(',').map(x=>x.trim().toUpperCase()).filter(x=>COUNTRY_NAMES[x]);
const DEEP_RESEARCH_VERSION='2.0';
const PUBLICATION_EVIDENCE_VERSION='1.1';
const MAX_TRANSLATE=24;
const MAX_SYNTHESIS=10;
const PUBLICATION_TIMEZONE=process.env.INTEL_PUBLICATION_TIMEZONE||'Africa/Nairobi';
const DEFAULT_COUNTRY_TIMEZONES={
  KE:'Africa/Nairobi',SO:'Africa/Mogadishu',ET:'Africa/Addis_Ababa',UG:'Africa/Kampala',TZ:'Africa/Dar_es_Salaam',
  RW:'Africa/Kigali',BI:'Africa/Bujumbura',SS:'Africa/Juba',DJ:'Africa/Djibouti',ER:'Africa/Asmara',
  SD:'Africa/Khartoum',CD:'Africa/Kinshasa'
};
let COUNTRY_TIMEZONES=DEFAULT_COUNTRY_TIMEZONES;
try{
  const configured=JSON.parse(process.env.INTEL_PUBLICATION_TIMEZONE_MAP_JSON||'{}');
  if(configured&&typeof configured==='object'&&!Array.isArray(configured))COUNTRY_TIMEZONES={...DEFAULT_COUNTRY_TIMEZONES,...configured};
}catch(_){COUNTRY_TIMEZONES=DEFAULT_COUNTRY_TIMEZONES;}
function publicationTimezoneForCountry(country){return String(COUNTRY_TIMEZONES[String(country||'').toUpperCase()]||PUBLICATION_TIMEZONE);}
const SECURITY_EVENT_TYPES=new Set(['SECURITY','CRIME','BORDER','MARITIME']);
const SECURITY_SIGNAL_RE=/\b(armed attack|attack|ambush|kidnap(?:ping)?|abduct(?:ion)?|bomb(?:ing)?|explosion|terror(?:ism|ist)?|militia|insurgent|insurgency|armed group|gunfire|shooting|raid|clash|violent protest|unrest|riot|roadblock|checkpoint|security operation|security incident|piracy|hijack(?:ing)?|hostage|IED|detained|curfew|coup|mutiny|bandit(?:ry)?|robbery|murder|carjacking|assassination)\b/i;
const SECURITY_POLITICAL_RE=/\b(protest|demonstration|unrest|riot|clash|curfew|coup|election violence|political violence|security forces)\b/i;
function clean(v,n=5000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,n);}
function extract(response){return Array.isArray(response?.content)?response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n'):'';}
function parse(text){try{return JSON.parse(text)}catch{}const m=String(text||'').match(/[\[{][\s\S]*[\]}]/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}
function zonedParts(date=new Date(),timeZone=PUBLICATION_TIMEZONE){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date));
  const get=type=>Number(parts.find(p=>p.type===type)?.value||0);
  return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second')};
}
function zonedDateFromParts(parts,timeZone=PUBLICATION_TIMEZONE){
  let guess=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour||0,parts.minute||0,parts.second||0);
  const target=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour||0,parts.minute||0,parts.second||0);
  for(let i=0;i<5;i++){
    const p=zonedParts(new Date(guess),timeZone);
    const wall=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    guess+=target-wall;
    if(Math.abs(target-wall)<1000)break;
  }
  return new Date(guess);
}
function shiftedCalendarParts(parts,days){
  const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days,0,0,0));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
function localWeekday(parts){return new Date(Date.UTC(parts.year,parts.month-1,parts.day)).getUTCDay();}
function publicationWindow(now=new Date(),type='daily',timeZone=PUBLICATION_TIMEZONE){
  const local=zonedParts(now,timeZone);
  const endParts={year:local.year,month:local.month,day:local.day,hour:0,minute:0,second:0};
  let startParts;
  if(type==='daily'){
    const previous=shiftedCalendarParts(local,-1);
    startParts={...previous,hour:0,minute:0,second:0};
  }else if(type==='weekly'){
    const mondayOffset=(localWeekday(local)+6)%7;
    const currentWeekStart=shiftedCalendarParts(local,-mondayOffset);
    const previousWeekStart=shiftedCalendarParts(local,-(mondayOffset+7));
    startParts={...previousWeekStart,hour:0,minute:0,second:0};
    endParts={...currentWeekStart,hour:0,minute:0,second:0};
  }else{
    const previousMonth=new Date(Date.UTC(local.year,local.month-2,1));
    startParts={year:previousMonth.getUTCFullYear(),month:previousMonth.getUTCMonth()+1,day:1,hour:0,minute:0,second:0};
    endParts.year=local.year; endParts.month=local.month; endParts.day=1;
  }
  return {start:zonedDateFromParts(startParts,timeZone),end:zonedDateFromParts(endParts,timeZone),timezone:timeZone,local};
}
function isPublicationBoundary(now=new Date(),timeZone=PUBLICATION_TIMEZONE){
  const p=zonedParts(now,timeZone);
  return p.hour===0 && p.minute<5;
}
function isCountryPublicationBoundary(country,now=new Date()){
  return isPublicationBoundary(now,publicationTimezoneForCountry(country));
}
function anyCountryPublicationBoundary(now=new Date()){
  return DAILY_COUNTRIES.some(country=>isCountryPublicationBoundary(country,now));
}
function nextCountryPublicationBoundary(country,now=new Date()){
  const timeZone=publicationTimezoneForCountry(country);
  const local=zonedParts(now,timeZone);
  if(isPublicationBoundary(now,timeZone))return new Date(now.getTime()+1000);
  let day=shiftedCalendarParts(local,1);
  let target=zonedDateFromParts({...day,hour:0,minute:0,second:5},timeZone);
  if(target.getTime()<=now.getTime()){day=shiftedCalendarParts(local,2);target=zonedDateFromParts({...day,hour:0,minute:0,second:5},timeZone);}
  return target;
}
function msUntilNextCountryPublicationBoundary(country,now=new Date()){
  return Math.max(1000,nextCountryPublicationBoundary(country,now).getTime()-now.getTime());
}
function msUntilAnyCountryPublicationBoundary(now=new Date()){
  if(!DAILY_COUNTRIES.length)return 86400000;
  return Math.min(...DAILY_COUNTRIES.map(country=>msUntilNextCountryPublicationBoundary(country,now)));
}
function isSecurityRelevantEvent(event){
  const type=String(event?.intelligence_type||'').toUpperCase();
  if(SECURITY_EVENT_TYPES.has(type))return true;
  const blob=String(event?.title||'')+' '+String(event?.summary||'')+' '+String(event?.headline||'');
  if(type==='POLITICAL')return SECURITY_POLITICAL_RE.test(blob);
  if(type==='LOGISTICS')return /\b(security|armed|attack|ambush|kidnap|roadblock|checkpoint|escort|militia|insurgent|piracy|hijack)\b/i.test(blob);
  return SECURITY_SIGNAL_RE.test(blob)&&['OTHER',''].includes(type);
}
function dayBounds(date=new Date()){return publicationWindow(date,'daily');}
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
  const headline=clean(event.title||'INTELLIGENCE EVENT',180);
  const whyByType={
    SECURITY:'Monitor whether '+headline+' persists, expands geographically or is independently corroborated.',
    POLITICAL:'Monitor whether '+headline+' develops into sustained political disruption or wider mobilisation.',
    LOGISTICS:'Monitor whether '+headline+' creates sustained delay, diversion or access constraints.',
    NATURAL_HAZARD:'Monitor whether '+headline+' persists or expands into wider access, infrastructure, population or service impacts.',
    HEALTH:'Monitor whether '+headline+' persists, spreads or creates material continuity consequences.',
    ECONOMIC:'Monitor whether '+headline+' creates sustained pressure on commerce, supply or operating costs.',
    BORDER:'Monitor whether '+headline+' produces recurring crossing, customs or access disruption.',
    MARITIME:'Monitor whether '+headline+' affects vessel movement, route risk or port continuity.',
    CRIME:'Monitor whether '+headline+' recurs or expands beyond the reported area.',
    OTHER:'Monitor whether '+headline+' recurs, spreads or gains independent corroboration.'
  };
  return {
    id:String(event.id),
    headline,
    brief:clean(event.summary||headline||'Evidence record available.',1600),
    intelligence_type,
    key_facts,
    why_it_matters:[whyByType[intelligence_type]||whyByType.OTHER],
    caveats:[clean('Evidence coverage is limited to the sources linked to this event in Sonalit. Unresolved details are retained as intelligence gaps rather than filled with assumption.',420)],
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
      JSON.stringify(Array.isArray(x.why_it_matters)?x.why_it_matters.map(v=>clean(v,800)).filter(v=>v&&!isRepetitiveTemplateText(v)).slice(0,5):[]),
      JSON.stringify(Array.isArray(x.caveats)?x.caveats.map(v=>clean(v,800)).filter(v=>v&&!/^evidence coverage is limited to the sources linked to this event in sonalit\./i.test(v)).slice(0,5):[]),
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

function publicationFingerprint(country,type,start,end,events){
  const stableEvents=events.map(e=>({
    id:e.id,
    headline:e.headline,brief:e.brief,severity:e.severity,confidence:e.confidence,
    intelligence_type:e.intelligence_type,region:e.region,risk_velocity:e.risk_velocity,
    occurred_from:e.occurred_from,occurred_to:e.occurred_to,
    key_facts:e.key_facts||[],why_it_matters:e.why_it_matters||[],caveats:e.caveats||[],
    assessment:e.assessment||{},
    synthesis_confidence:e.synthesis_confidence,
    evidence:(Array.isArray(e.evidence)?e.evidence:[]).map(o=>({id:o.id,source_id:o.source_id,observed_at:o.observed_at,published_at:o.published_at,credibility:o.credibility,title:o.title,url:o.url}))
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)))
  })).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return crypto.createHash('sha256').update(JSON.stringify({country,type,start:start.toISOString(),end:end.toISOString(),events:stableEvents})).digest('hex');
}

function selectPublicationResearchEvents(events,limit=10){
  const ordered=(Array.isArray(events)?events:[]).slice().sort((a,b)=>{
    const sev=v=>({critical:4,high:3,moderate:2,low:1,informational:0}[String(v||'').toLowerCase()]??2);
    const sa=sev(a.severity), sb=sev(b.severity);
    if(sb!==sa)return sb-sa;
    const ca=Number(a.confidence||0), cb=Number(b.confidence||0);
    if(cb!==ca)return cb-ca;
    const oa=Number(a.observation_count||0), ob=Number(b.observation_count||0);
    if(ob!==oa)return ob-oa;
    return new Date(b.last_seen_at||0)-new Date(a.last_seen_at||0);
  });
  const out=[]; const covered=new Set();
  for(const e of ordered){
    const type=String(e.intelligence_type||'OTHER').toUpperCase();
    if(out.length>=limit)break;
    if(!covered.has(type) || String(e.severity||'').toLowerCase()==='critical'){
      out.push(e); covered.add(type);
    }
  }
  for(const e of ordered){
    if(out.length>=limit)break;
    if(!out.some(x=>String(x.id)===String(e.id)))out.push(e);
  }
  return out.slice(0,limit);
}

async function publicationForCountryUnsafe(orgId,country,type='daily',options={}){
  const now=options.executionNow instanceof Date?options.executionNow:(options.periodAnchor instanceof Date?new Date():(options.now instanceof Date?options.now:new Date()));
  const periodAnchor=options.periodAnchor instanceof Date?options.periodAnchor:now;
  let start,end;
  const publicationTimezone=publicationTimezoneForCountry(country);
  ({start,end}=publicationWindow(periodAnchor,type,publicationTimezone));
  const {rows:existing}=await query(
    `SELECT id,status,version,body,pdf_status,pdf_version FROM intel_publications
      WHERE org_id=$1 AND country_code=$2 AND publication_type=$3 AND period_start=$4 AND period_end=$5 AND status IN ('draft','review','published')
      ORDER BY version DESC LIMIT 1`,[orgId,country,type,start,end]
  );
  const {rows:rawEvents}=await query(
    `SELECT
      e.id,COALESCE(e.canonical_headline,e.title) AS headline,
      COALESCE(e.executive_brief,e.summary) AS brief,e.summary,e.title,e.severity,e.confidence,e.intelligence_type,
      e.assessment,e.key_facts,e.why_it_matters,e.caveats,e.synthesis_confidence,e.synthesis_provider,
      e.latitude,e.longitude,e.region,e.risk_velocity,e.occurred_from,e.occurred_to,e.last_seen_at,e.updated_at,
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
      WHERE e.org_id=$1 AND e.country_code=$2 AND ((e.occurred_from IS NOT NULL AND e.occurred_from>=$3 AND e.occurred_from<$4) OR (e.occurred_from IS NULL AND e.last_seen_at>=$3 AND e.last_seen_at<$4))
      GROUP BY e.id
      ORDER BY CASE e.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC,e.last_seen_at DESC
      LIMIT 160`,[orgId,country,start,end]
  );
  const events=rawEvents.filter(isSecurityRelevantEvent);

  const evidenceCount=events.reduce((n,e)=>n+Number(e.observation_count||0),0);
  const sourceIds=new Set();
  for(const e of events) for(const obs of Array.isArray(e.evidence)?e.evidence:[]) if(obs&&obs.source_id) sourceIds.add(String(obs.source_id));
  const sourceCount=sourceIds.size;
  const evidenceContract=evidenceCount>=3&&sourceCount>=2;
  const periodClosed=end.getTime()<=now.getTime();
  const priorCoverage=existing[0]?.body?.collection_coverage||{};
  const priorResearch=existing[0]?.body?.deep_research||{};
  const fingerprint=publicationFingerprint(country,type,start,end,events);
  // Research exactly the bounded incident set exposed by the publication.
  const researchLimit=type==='daily'
    ?Math.max(4,Math.min(20,Number(process.env.INTEL_PUBLICATION_RESEARCH_LIMIT_DAILY)||12))
    :type==='weekly'
      ?Math.max(6,Math.min(30,Number(process.env.INTEL_PUBLICATION_RESEARCH_LIMIT_WEEKLY)||20))
      :Math.max(8,Math.min(40,Number(process.env.INTEL_PUBLICATION_RESEARCH_LIMIT_MONTHLY)||30));
  const publicationEvents=selectPublicationResearchEvents(events,researchLimit);
  const deepResearchEnabled=String(process.env.INTEL_PUBLICATION_DEEP_RESEARCH||'true').toLowerCase()!=='false';
  const publicationResearchRequired=String(process.env.INTEL_PUBLICATION_REQUIRE_RESEARCH||'true').toLowerCase()!=='false';
  const expectedResearchCount=publicationEvents.length;
  const previousResearchCount=Number(priorResearch.incidents_web_researched||0);
  const priorDossiers=Array.isArray(existing[0]?.body?.incident_dossiers)?existing[0].body.incident_dossiers:[];
  const priorDossierResearchReady=expectedResearchCount===0 || publicationEvents.every(e=>{
    const id=String(e.id);
    const dossier=priorDossiers.find(d=>String(d?.event_id||d?.id||'')===id);
    return ['researched','researched_limited'].includes(String(dossier?.research_status||'').toLowerCase());
  });
  const researchVersionMismatch=String(priorResearch.research_version||'')!==DEEP_RESEARCH_VERSION;
  const pdfRendererMismatch=String(existing[0]?.body?.generator?.pdf_renderer_version||'')!==PDF_RENDERER_VERSION;
  const publicationPolicyMismatch=String(existing[0]?.body?.collection_basis?.version||'')!==PUBLICATION_EVIDENCE_VERSION;
  const researchCooldownMinutes=Math.max(5,Math.min(24*60,Number(process.env.INTEL_PUBLICATION_RESEARCH_RETRY_MINUTES)||60));
  const lastResearchAttemptAt=priorResearch.last_attempt_at?new Date(priorResearch.last_attempt_at):null;
  const researchAttemptRecent=Boolean(lastResearchAttemptAt&&!Number.isNaN(lastResearchAttemptAt.getTime())&&(now.getTime()-lastResearchAttemptAt.getTime())<researchCooldownMinutes*60*1000);
  const evidenceChanged=String(priorCoverage.fingerprint||'')!==fingerprint;
  const needsDeepResearch=deepResearchEnabled&&expectedResearchCount>0&&(!priorDossierResearchReady||previousResearchCount<expectedResearchCount||researchVersionMismatch||evidenceChanged||Boolean(options.forceResearch))&&(!researchAttemptRecent||evidenceChanged||Boolean(options.forceResearch));
  const priorResearchReleaseReady=!publicationResearchRequired || priorDossierResearchReady;
  const priorReleaseGate=existing[0]?.body?.release_gate||{};
  const priorQualityState=existing[0]?.body?.publication_quality||{};
  const priorGenerationGatePassed=priorReleaseGate.research_release_gate!==false
    &&priorReleaseGate.ai_board_gate!==false
    &&priorReleaseGate.tradecraft_quality_gate!==false
    &&priorQualityState.passed!==false;
  const unchanged=existing.length
    && !evidenceChanged
    && Number(priorCoverage.evidence_count||-1)===evidenceCount
    && Number(priorCoverage.source_count||-1)===sourceCount
    && !needsDeepResearch
    && !pdfRendererMismatch
    && !publicationPolicyMismatch
    && priorResearchReleaseReady
    && priorGenerationGatePassed
    && !(priorResearch.last_failure_reason && priorDossierResearchReady);
  if(existing.length&&unchanged)return{status:'exists',id:existing[0].id,publication_id:existing[0].id,publication_status:existing[0].status,version:existing[0].version||1};

  const refreshPdf=Boolean(existing.length&&(evidenceChanged||needsDeepResearch||pdfRendererMismatch||publicationPolicyMismatch));

  const priorResearchByEvent=Object.fromEntries(priorDossiers.map(d=>[
    String(d.id||d.event_id||d.observation_id||''),
    {packet:{},agent:{
      status:d.research_status||null,
      narrative:d.what_happened||d.brief||'',
      context:d.context||'',
      confirmed_facts:Array.isArray(d.key_facts)?d.key_facts:[],
      reported_or_disputed:Array.isArray(d.reported_or_disputed)?d.reported_or_disputed:[],
      analytical_assessment:d.assessment||'',
      why_it_matters:Array.isArray(d.why_it_matters)?d.why_it_matters:[],
      uncertainty:Array.isArray(d.caveats)?d.caveats:[],
      chronology:Array.isArray(d.chronology)?d.chronology:[],
      sources:Array.isArray(d.research_sources)?d.research_sources:[],
      provider:d.research_provider||'prior-publication'
    }}
  ]).filter(([id])=>id));

  const publicationAiPolicy={dataClassification:String(process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION||'public').toLowerCase(),allowFreeProviders:true,preferFreeProviders:true};
  // Use configuration/policy eligibility here. The AI client owns bounded
  // cooldown waiting and provider failover; a momentarily cooling provider must
  // not prevent the research/editorial path from attempting recovery.
  const publicationAiAvailable=typeof aiClient.hasAnyProvider==='function' && aiClient.hasAnyProvider(publicationAiPolicy);
  let incidentResearch={byEvent:{},summary:{requested:0,researched:0,fallback:0,failed:0,web_search_requests:0}};
  let researchAttempted=false;
  if(deepResearchEnabled&&expectedResearchCount>0&&needsDeepResearch){
    researchAttempted=true;
    try{
      incidentResearch=await researchPublicationIncidents(publicationEvents,{country});
      logger.info('Intelligence publication research '+country+'/'+type+': requested='+incidentResearch.summary.requested+' ai_researched='+incidentResearch.summary.researched+' web_packet_researched='+(incidentResearch.summary.web_packet_researched||0)+' fallback='+incidentResearch.summary.fallback+' failed='+incidentResearch.summary.failed+' web_search_requests='+(incidentResearch.summary.web_search_requests||0)+' web_sources_retrieved='+(incidentResearch.summary.web_sources_retrieved||0));
    }catch(error){
      incidentResearch={byEvent:{},summary:{requested:expectedResearchCount,researched:0,fallback:expectedResearchCount,failed:0,web_search_requests:0}};
      logger.warn('Intelligence publication research failed '+country+'/'+type+': '+error.message);
    }
  }else if(deepResearchEnabled&&expectedResearchCount>0&&researchAttemptRecent&&!evidenceChanged){
    incidentResearch={
      byEvent:priorResearchByEvent,
      summary:{requested:expectedResearchCount,researched:Number(priorResearch.incidents_web_researched||0),fallback:Number(priorResearch.incidents_fallback||0),failed:0,web_search_requests:0,skipped_due_to_cooldown:true}
    };
    logger.info('Intelligence publication research '+country+'/'+type+': skipped due to retry cooldown='+researchCooldownMinutes+'m');
  }

  const effectiveResearchByEvent={...incidentResearch.byEvent};
  for(const e of publicationEvents){
    const id=String(e.id);
    const current=effectiveResearchByEvent[id],prior=priorResearchByEvent[id];
    if(!evidenceChanged){
      if(current?.agent?.status==='fallback'&&prior?.agent?.status==='researched')effectiveResearchByEvent[id]=prior;
      else if(!current&&prior)effectiveResearchByEvent[id]=prior;
    }
  }
  const priorEvidenceConstrained=
    String(existing[0]?.body?.release_gate?.research_mode||'').toLowerCase()==='evidence_constrained' ||
    Number(priorResearch.degraded_evidence_eligible_incidents||0)>=expectedResearchCount;
  const hasEligiblePerIncidentProviderFailure=publicationEvents.some(e=>{
    const entry=effectiveResearchByEvent[String(e.id)]||{};
    const agent=entry.agent||{};
    const status=String(agent.status||'').toLowerCase();
    const method=String(agent.research_method||'').toLowerCase();
    return entry.error==='ai_provider_unavailable' &&
      status==='fallback' &&
      ['degraded_evidence','live_web_packet'].includes(method) &&
      agent.degraded_evidence_eligible===true &&
      Number(e.observation_count||0)>=1 &&
      Number(e.source_count||0)>=1;
  });
  const researchProviderUnavailable=Boolean(
    !publicationAiAvailable ||
    incidentResearch?.summary?.provider_unavailable===true ||
    hasEligiblePerIncidentProviderFailure
  );
  const isDegradedEvidenceEvent=(e)=>{
    const entry=effectiveResearchByEvent[String(e.id)]||{};
    const agent=entry.agent||{};
    const status=String(agent.status||'').toLowerCase();
    const method=String(agent.research_method||'').toLowerCase();
    return status==='fallback' &&
      (method==='degraded_evidence' || (method==='live_web_packet' && entry.error==='ai_provider_unavailable')) &&
      Number(e.observation_count||0)>=1 &&
      Number(e.source_count||0)>=1 &&
      (entry.error==='ai_provider_unavailable' || priorEvidenceConstrained);
  };
  const enrichedEvents=events.map(e=>({...e,research:effectiveResearchByEvent[String(e.id)]||null}));
  const enrichedEventsById=new Map(enrichedEvents.map(e=>[String(e.id),e]));
  const publicationBasis=publicationEvidenceBasis(evidenceContract,incidentResearch,publicationEvents,events);
  const allSelectedIncidentsDegraded=
    expectedResearchCount>0 &&
    publicationEvents.length===expectedResearchCount &&
    publicationEvents.every(isDegradedEvidenceEvent);
  // Each selected dossier must have either controlled AI research or a narrowly
  // eligible, attributable evidence-only fallback. This also supports mixed
  // outcomes when some pages were retrieved but providers failed for other cases.
  const releaseResearchEligible=
    expectedResearchCount>0 &&
    publicationEvents.length===expectedResearchCount &&
    publicationEvents.every(e=>{
      const status=String(effectiveResearchByEvent[String(e.id)]?.agent?.status||'').toLowerCase();
      return ['researched','researched_limited'].includes(status) || isDegradedEvidenceEvent(e);
    });
  const reportEvents=publicationBasis.publishable
    ? publicationBasis.reportEvents
    : (allSelectedIncidentsDegraded ? publicationEvents : publicationBasis.reportEvents);
  const reportEvidenceCount=evidenceContract ? evidenceCount : reportEvents.reduce((n,e)=>n+Number(e.observation_count||0),0);
  const reportSourceIds=new Set();
  for(const e of reportEvents)for(const obs of Array.isArray(e.evidence)?e.evidence:[])if(obs?.source_id)reportSourceIds.add(String(obs.source_id));
  const reportSourceCount=evidenceContract ? sourceCount : Math.max(publicationBasis.researchSourceCount,reportSourceIds.size);
  const publicationEvidenceContract=events.length===0 || evidenceContract || publicationBasis.publishable || allSelectedIncidentsDegraded;
  const deterministic=buildEvidencePublication({country,type,start,end,events:reportEvents.map(e=>enrichedEventsById.get(String(e.id))||e),evidenceCount:reportEvidenceCount,sourceCount:reportSourceCount,evidenceContract:publicationEvidenceContract,publicationTimezone});
  const researchControlledComplete=expectedResearchCount===0 || publicationEvents.every(e=>{
    const status=String(effectiveResearchByEvent[String(e.id)]?.agent?.status||'').toLowerCase();
    return ['researched','researched_limited'].includes(status);
  });
  const degradedEvidenceRelease=
    releaseResearchEligible &&
    !researchControlledComplete &&
    publicationEvidenceContract &&
    researchProviderUnavailable;
  let finalBody={...deterministic,deep_research:{
    ...(deterministic.deep_research||{}),
    research_mode:degradedEvidenceRelease?'evidence_constrained':(expectedResearchCount===0?'no_incidents':'deep_research')
  }};
  const researchReleaseGate=!publicationResearchRequired || expectedResearchCount===0 || researchControlledComplete || degradedEvidenceRelease;
  let title=deterministic.title;
  let subtitle=deterministic.subtitle;
  let executive=deterministic.executive_assessment;
  let board=null,visual=null,graphics=null;
  let provider='evidence-first-fallback';
  let aiBoardStatus='disabled';
  let aiBoardHoldReason=null;
  const aiBoardEnabled=String(process.env.INTEL_PUBLICATION_AI_BOARD||'true').toLowerCase()!=='false';
  const aiBoardRequired=String(process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'true').toLowerCase()!=='false';

  if(aiBoardEnabled && publicationAiAvailable && events.length && !degradedEvidenceRelease){
    try{
      const result=await runPublicationEditorialBoard({country:COUNTRY_NAMES[country],period:{start,end},events:reportEvents,baseBody:deterministic,evidenceContract:publicationEvidenceContract,precomputedResearch:incidentResearch});
      board=result.board;visual=result.visual;graphics=result.graphics;provider=result.provider||'multi-agent-editorial-board';
      const boardProviderUnavailable=Array.isArray(result?.qaConsensus?.blocking_issues) && result.qaConsensus.blocking_issues.includes('ai_provider_unavailable');
      aiBoardStatus=boardProviderUnavailable?'provider_unavailable':(result.publishable?'passed':'held');
      aiBoardHoldReason=result.publishable?null:JSON.stringify({qa:result.qa?.publishable===true,blocking:(result.qa?.blocking_issues||[]).length,provider_unavailable:boardProviderUnavailable});
      const final=result.final;
      if(final){
        title=final.title||title;
        subtitle=final.subtitle||subtitle;
        executive=final.executive_assessment||executive;
        finalBody={...deterministic,...final,title:final.title||deterministic.title,subtitle:final.subtitle||deterministic.subtitle,executive_assessment:final.executive_assessment||deterministic.executive_assessment};
        if(Array.isArray(finalBody.incident_dossiers)){
          finalBody.incident_dossiers=finalBody.incident_dossiers.map(d=>{
            const id=String(d?.event_id||'');
            const verifiedResearch=effectiveResearchByEvent[id]?.agent||{};
            return {
              ...d,
              event_id:id,
              research_status:verifiedResearch.status||d?.research_status||null,
              research_provider:verifiedResearch.provider||d?.research_provider||null,
              research_method:verifiedResearch.research_method||d?.research_method||null,
              web_sources_retrieved:Number(verifiedResearch.web_sources_retrieved||d?.web_sources_retrieved||0)||0,
              research_sources:Array.isArray(verifiedResearch.sources)?verifiedResearch.sources.map(src=>({...src})):(
                Array.isArray(d?.research_sources)?d.research_sources:[]
              )
            };
          });
        }
      }
      if(!result.publishable) logger.warn(`Publication editorial board held ${country}/${type}: evidence=${evidenceContract} qa=${result.qa?.publishable===true} blocking=${(result.qa?.blocking_issues||[]).length}; publication remains on release hold.`);
    }catch(error){aiBoardStatus='unavailable';aiBoardHoldReason=error.message;logger.warn(`Publication editorial board unavailable ${country}/${type}; publication remains on release hold: ${error.message}`);}
  }

  if(aiBoardEnabled && aiBoardStatus==='disabled')aiBoardStatus=publicationAiAvailable?'not_run':'provider_unavailable';
  const boardPublishable=board?.publishable===true;
  const finalQuality=auditPublicationContent(
    Array.isArray(finalBody.incident_dossiers)?finalBody.incident_dossiers:
    (Array.isArray(deterministic.incident_dossiers)?deterministic.incident_dossiers:[])
  );
  const tradecraftQuality=assessPublicationQuality(finalBody);
  finalBody.publication_quality={...tradecraftQuality,legacy_audit:finalQuality};
  const qualityGate=tradecraftQuality.passed===true && finalQuality.passed===true;
  const aiBoardDegraded=!boardPublishable&&(['provider_unavailable','unavailable','disabled','not_run'].includes(aiBoardStatus) || degradedEvidenceRelease || !publicationAiAvailable);
  const aiBoardGate=events.length===0 ? true : (boardPublishable || !aiBoardRequired || aiBoardDegraded);
  const status=(publicationEvidenceContract&&qualityGate&&aiBoardGate&&researchReleaseGate)?'published':'draft';
  const version=existing.length?Number(existing[0].version||1)+1:1;
  const body={
    ...finalBody,title,subtitle,executive_assessment:executive,key_events:reportEvents,
    collection_basis:{version:PUBLICATION_EVIDENCE_VERSION,original_evidence_contract_met:evidenceContract,publication_evidence_contract_met:publicationEvidenceContract,basis:publicationBasis.basis,research_backed_incidents:publicationBasis.researchBackedIncidents,research_source_count:publicationBasis.researchSourceCount,research_source_domains:publicationBasis.researchSourceDomains,excluded_event_count:publicationBasis.excludedEventCount},
    editorial_board:{agents:AGENT_ROLES.map(a=>a.id),board,visual_plan:visual,graphics_plan:graphics,provider},
    generator:{
      name:'SONALIT EVIDENCE-FIRST PUBLICATION FABRIC',
      provider,
      mode:incidentResearch.summary.researched>0?'EVIDENCE_FIRST_WITH_DEEP_RESEARCH':(provider==='evidence-first-fallback'?'DETERMINISTIC_EVIDENCE_PUBLICATION':'AI_ENHANCED'),
      pdf_renderer_version:PDF_RENDERER_VERSION,
      evidence_contract:publicationEvidenceContract,
      original_evidence_contract:evidenceContract,
      publication_quality:finalBody.publication_quality||deterministic.publication_quality||null,
      ai_board:{enabled:aiBoardEnabled,required:aiBoardRequired,status:aiBoardStatus,hold_reason:aiBoardHoldReason}
    },
    publication_quality:finalBody.publication_quality||null,
    ai_board:{enabled:aiBoardEnabled,required:aiBoardRequired,status:aiBoardStatus,hold_reason:aiBoardHoldReason},
    release_gate:{publication_research_required:publicationResearchRequired,research_release_gate:researchReleaseGate,research_mode:degradedEvidenceRelease?'evidence_constrained':(expectedResearchCount===0?'no_incidents':'deep_research'),research_release_reason:degradedEvidenceRelease?'AI research fabric unavailable; release constrained to the verified Sonalit evidence contract.':null,tradecraft_quality_gate:qualityGate,ai_board_gate:aiBoardGate,ai_board_degraded:aiBoardDegraded,ai_board_degraded_reason:aiBoardDegraded?'live_ai_provider_fabric_unavailable':null,status},
    deep_research:{
      ...finalBody.deep_research,
      agent_summary:incidentResearch.summary,
      degraded_evidence_eligible_incidents:Number(incidentResearch.summary.degraded_evidence_eligible||priorResearch.degraded_evidence_eligible_incidents||0),
      research_version:DEEP_RESEARCH_VERSION,
      last_attempt_at:researchAttempted?now.toISOString():(priorResearch.last_attempt_at||null),
      retry_cooldown_minutes:researchCooldownMinutes,
      skipped_due_to_cooldown:Boolean(incidentResearch.summary.skipped_due_to_cooldown),
      ...publicationRecoveryMetadata({
        priorResearch,
        researchSummary:incidentResearch.summary,
        expectedResearchCount,
        researchAttempted,
        now,
        cooldownMinutes:researchCooldownMinutes,
        maxAttempts:Math.max(1,Math.min(8,Number(process.env.INTEL_PUBLICATION_RECOVERY_MAX_ATTEMPTS)||3))
      }),
      research_mode:degradedEvidenceRelease?'evidence_constrained':(expectedResearchCount===0?'no_incidents':'deep_research'),
      research_method:incidentResearch.summary.researched>0?'ai_web_search':(incidentResearch.summary.web_packet_researched>0?'live_web_packet':'evidence_only')
    },
    version
  };
  let publicationId=null;
  if(existing.length){
    const updated=await query(
      `UPDATE intel_publications
       SET title=$3,subtitle=$4,status=$5,period_start=$6,period_end=$7,executive_assessment=$8,body=$9::jsonb,evidence=$10::jsonb,confidence=$11,version=$12,published_at=CASE WHEN $5='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW()
       WHERE id=$1 AND org_id=$2 RETURNING id,status,version`,
      [existing[0].id,orgId,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(reportEvents.map(e=>e.id)),
       reportEvents.length?Math.round(reportEvents.reduce((n,e)=>n+Number(e.confidence||0),0)/reportEvents.length):0,version]
    );
    publicationId=updated.rows[0]?.id||existing[0].id;
    if(refreshPdf){
      await query(
        "UPDATE intel_publications SET pdf_status='not_requested',pdf_key=NULL,pdf_url=NULL,pdf_generated_at=NULL,pdf_error=NULL,pdf_version=COALESCE(pdf_version,1)+1,updated_at=NOW() WHERE id=$1 AND org_id=$2",
        [publicationId,orgId]
      );
    }
  } else {
    const inserted=await query(
      `INSERT INTO intel_publications
       (org_id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,body,evidence,confidence,published_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
       RETURNING id,status,version`,
      [orgId,country,type,title,subtitle,status,start,end,executive,JSON.stringify(body),JSON.stringify(reportEvents.map(e=>e.id)),
       reportEvents.length?Math.round(reportEvents.reduce((n,e)=>n+Number(e.confidence||0),0)/reportEvents.length):0,status==='published'?new Date():null,version]
    );
    publicationId=inserted.rows[0]?.id||null;
  }
  return{
    status:'created',publication_id:publicationId,publication_status:status,
    evidence_contract:publicationEvidenceContract,evidence_count:reportEvidenceCount,source_count:reportSourceCount,
    editorial_agents:AGENT_ROLES.length,generator_mode:body.generator.mode,version
  };
}
function publicationEvidenceBasis(originalEvidenceContract, research, publicationEvents, allEvents){
  if(originalEvidenceContract){
    const reportEvents=Array.isArray(allEvents)&&allEvents.length?allEvents:(Array.isArray(publicationEvents)?publicationEvents:[]);
    return {publishable:true,basis:'ORIGINAL_EVIDENCE',reportEvents,researchBackedIncidents:0,researchSourceCount:0,researchSourceDomains:0,excludedEventCount:Math.max(0,(Array.isArray(allEvents)?allEvents.length:0)-reportEvents.length)};
  }
  const backed=[];
  const sources=[];
  for(const event of Array.isArray(publicationEvents)?publicationEvents:[]){
    const packet=research?.byEvent?.[String(event?.id)]||{};
    const verifiedPages=Array.isArray(packet?.packet?.fetched_pages)
      ? packet.packet.fetched_pages.filter(sourceIsSubstantive)
      : [];
    const direct=verifiedPages.filter(src=>{
      const url=String(src?.url||'').trim();
      const domain=normalizeDomain(src?.domain||url);
      return url && domain && !isAggregatorDomain(domain);
    });
    if(direct.length) backed.push(event);
    for(const src of direct)sources.push(src);
  }
  const uniqueUrls=new Set(sources.map(src=>String(src.url).trim()).filter(Boolean));
  const uniqueDomains=new Set(sources.map(src=>normalizeDomain(src.domain||src.url)).filter(Boolean));
  const researchContract=backed.length>0 && uniqueUrls.size>=2 && uniqueDomains.size>=2;
  return {
    publishable:researchContract,
    basis:researchContract?'DIRECT_WEB_RESEARCH':'INSUFFICIENT_EVIDENCE',
    reportEvents:researchContract?backed:[],
    researchBackedIncidents:backed.length,
    researchSourceCount:uniqueUrls.size,
    researchSourceDomains:uniqueDomains.size,
    excludedEventCount:Math.max(0,(Array.isArray(publicationEvents)?publicationEvents.length:0)-backed.length)
  };
}

async function recoverStalledPublications(orgId,now=new Date(),options={}){
  const staleMinutes=Math.max(5,Math.min(180,Number(options.staleMinutes||process.env.INTEL_PUBLICATION_RECOVERY_STALE_MINUTES)||15));
  const limit=Math.max(1,Math.min(8,Number(options.limit||process.env.INTEL_PUBLICATION_RECOVERY_BATCH)||4));
  const maxAttempts=Math.max(1,Math.min(8,Number(options.maxAttempts||process.env.INTEL_PUBLICATION_RECOVERY_MAX_ATTEMPTS)||3));
  const recoveryCooldownMinutes=Math.max(5,Math.min(1440,Number(options.cooldownMinutes||process.env.INTEL_PUBLICATION_RESEARCH_RETRY_MINUTES)||60));
  const nextAttemptAt=new Date(now.getTime()+recoveryCooldownMinutes*60*1000).toISOString();
  const {rows}=await withOrg(orgId,client=>client.query(
    `SELECT id,country_code,publication_type,period_end,updated_at,body
       FROM intel_publications
      WHERE org_id=$1
        AND status IN ('draft','review')
        AND period_end <= $2
        AND updated_at < NOW()-($3::int*INTERVAL '1 minute')
        AND CASE
          WHEN NULLIF(body->'deep_research'->>'next_attempt_at','') IS NULL THEN TRUE
          WHEN (body->'deep_research'->>'next_attempt_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'
            THEN (body->'deep_research'->>'next_attempt_at')::timestamptz <= NOW()
          ELSE FALSE
        END
        AND (
          COALESCE(body->'release_gate'->>'research_release_gate','true')='false'
          OR COALESCE(body->'release_gate'->>'ai_board_gate','true')='false'
          OR body->'deep_research'->>'last_failure_reason' IS NOT NULL
        )
        AND CASE
          WHEN NULLIF(body->'deep_research'->>'recovery_attempts','') IS NULL THEN 0
          WHEN (body->'deep_research'->>'recovery_attempts') ~ '^[0-9]{1,6}$'
            THEN (body->'deep_research'->>'recovery_attempts')::int
          ELSE 999999
        END < $5
      ORDER BY
        CASE
          WHEN COALESCE(body->'release_gate'->>'research_release_gate','true')='false' THEN 0
          WHEN COALESCE(body->'release_gate'->>'ai_board_gate','true')='false' THEN 1
          ELSE 2
        END,
        updated_at ASC
      LIMIT $4`,
    [orgId,now,staleMinutes,limit,maxAttempts]
  ));
  if(!rows.length)return{processed:0,published:0,drafts:0,failed:0,results:[]};
  const results=[];
  for(const row of rows){
    const country=String(row.country_code||'').toUpperCase();
    const type=String(row.publication_type||'daily').toLowerCase();
    if(!country||!['daily','weekly','monthly'].includes(type))continue;
    const periodEnd=new Date(row.period_end);
    if(Number.isNaN(periodEnd.getTime()))continue;
    const research=row.body?.deep_research&&typeof row.body.deep_research==='object'?row.body.deep_research:{};
    const storedAttemptsRaw=Number(research.recovery_attempts);
    const storedAttempts=Number.isSafeInteger(storedAttemptsRaw)&&storedAttemptsRaw>=0?storedAttemptsRaw:0;
    const nextAttempt=storedAttempts+1;
    try{
      // Claim and persist the attempt before expensive provider calls so a
      // process restart or thrown exception cannot reset the retry budget.
      const claim=await withOrg(orgId,client=>client.query(
        `UPDATE intel_publications
            SET body=jsonb_set(
              COALESCE(body,'{}'::jsonb),
              '{deep_research}',
              COALESCE(body->'deep_research','{}'::jsonb) ||
                jsonb_build_object(
                  'recovery_attempts',$3::int,
                  'recovery_max_attempts',$4::int,
                  'last_recovery_attempt_at',$5::text,
                  'next_attempt_at',$8::text
                ),
              true
            ),
            updated_at=NOW()
          WHERE id=$1 AND org_id=$2
            AND status IN ('draft','review')
            AND updated_at < NOW()-($6::int*INTERVAL '1 minute')
            AND CASE
              WHEN NULLIF(body->'deep_research'->>'recovery_attempts','') IS NULL THEN 0
              WHEN (body->'deep_research'->>'recovery_attempts') ~ '^[0-9]{1,6}$'
                THEN (body->'deep_research'->>'recovery_attempts')::int
              ELSE 999999
            END = $7
          RETURNING id`,
        [row.id,orgId,nextAttempt,maxAttempts,now.toISOString(),staleMinutes,storedAttempts,nextAttemptAt]
      ));
      if(!claim.rows.length){
        results.push({id:String(row.id),country,type,status:'skipped',reason:'publication_changed_before_recovery_claim'});
        continue;
      }
      const anchorNow=new Date(periodEnd.getTime()-1000);
      const result=await publicationForCountry(orgId,country,type,{
        periodAnchor:anchorNow,forceResearch:true,recovery:true,recoveryAttempt:nextAttempt,recoveryMaxAttempts:maxAttempts
      });
      results.push({
        id:String(row.id),country,type,
        publication_status:result.publication_status,
        status:result.status||'created',
        publication_id:result.publication_id||result.id||row.id,
        recovery_attempt:nextAttempt,
        recovery_max_attempts:maxAttempts
      });
    }catch(error){
      logger.warn(`Intelligence publication recovery failed ${country}/${type} id=${row.id}: ${error.message}`);
      results.push({id:String(row.id),country,type,status:'failed',error:String(error.message||error),recovery_attempt:nextAttempt,recovery_max_attempts:maxAttempts});
    }
  }
  return {
    processed:results.filter(x=>x.status!=='skipped').length,
    published:results.filter(x=>x.publication_status==='published').length,
    drafts:results.filter(x=>x.publication_status==='draft').length,
    failed:results.filter(x=>x.status==='failed'||x.error).length,
    skipped:results.filter(x=>x.status==='skipped').length,
    results
  };
}

function publicationForCountry(orgId,country,type='daily',options={}){
  return withOrg(orgId, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`sonalit:intelligence:publication:${orgId}:${country}:${type}`]);
    return publicationForCountryUnsafe(orgId,country,type,options);
  });
}

async function publishDue(orgId,now=new Date(),options={}){
 const results=[];
 const forceDaily=Boolean(options.forceDaily);
 const run=async(country,type)=>{
   try{results.push({country,timezone:publicationTimezoneForCountry(country),...await publicationForCountry(orgId,country,type,{now})});}
   catch(error){logger.error('Intelligence publication failed '+country+'/'+type+' org='+orgId+': '+error.message);results.push({country,type,status:'failed',error:error.message});}
 };
 for(const country of DAILY_COUNTRIES){
   const tz=publicationTimezoneForCountry(country);
   const local=zonedParts(now,tz);
   if(forceDaily || isPublicationBoundary(now,tz))await run(country,'daily');
   if(local.hour===0&&local.minute<5&&localWeekday(local)===1)await run(country,'weekly');
   if(local.hour===0&&local.minute<5&&local.day===1)await run(country,'monthly');
 }
 return{processed:results.length,results,timezone:'per-country-local',boundary:'00:00 local by country'};
}
async function runIntelligenceAgents(options={}){
 const includePublications=Boolean(options.includePublications);
 const forceDailyPublications=Boolean(options.forceDailyPublications);
 const now=options.now instanceof Date?options.now:new Date();
 const {rows:orgs}=await globalQuery('SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL');
 const output=[];
 for(const {org_id} of orgs){
   try{
     const result=await runWithOrgContext(org_id,async()=>{
       const translation=await translateQueue(org_id);
       const synthesis=await synthesizeEvents(org_id);
       const publications=includePublications?await publishDue(org_id,now,{forceDaily:forceDailyPublications}):{processed:0,results:[],skipped:'scheduled publication boundary only'};
       return{translation,synthesis,publications};
     });
     output.push({org_id,...result});
   }catch(error){output.push({org_id,error:error.message});logger.warn('Intelligence agents org='+org_id+' failed: '+error.message);}
 }
 return output;
}
async function runScheduledPublicationBoundary(now=new Date()){
 if(!anyCountryPublicationBoundary(now))return{skipped:true,reason:'not_publication_boundary_for_any_country',timezone:'per-country-local'};
 return{skipped:false,timezone:'per-country-local',results:await runIntelligenceAgents({includePublications:true,now})};
}
module.exports={runIntelligenceAgents,translateQueue,synthesizeEvents,publishDue,publicationForCountry,recoverStalledPublications,evidenceDerivedSynthesis,publicationWindow,isPublicationBoundary,isSecurityRelevantEvent,isCountryPublicationBoundary,anyCountryPublicationBoundary,publicationTimezoneForCountry,nextCountryPublicationBoundary,msUntilNextCountryPublicationBoundary,msUntilAnyCountryPublicationBoundary,defaultPublicationTimezone:PUBLICATION_TIMEZONE,defaultCountryTimezones:DEFAULT_COUNTRY_TIMEZONES,runScheduledPublicationBoundary};
