/*
 * Sonalit Intelligence Publication Editorial Board
 *
 * A multi-agent newsroom pipeline for publication generation.
 * Agents are logical specialist roles; the orchestrator deliberately bounds
 * provider calls and forces deterministic evidence/review gates before publish.
 */
const aiClient = require('./aiClient');
const logger = require('./logger');
const { researchPublicationIncidents } = require('./intelligenceIncidentResearch');

const AGENT_ROLES = [
  { id:'evidence-curator', lane:'research', purpose:'Build the evidence ledger and identify corroboration, gaps and provenance.', providerHints:['qwen3.5-397b-openrouter','deepseek-v3.2-openrouter','nemotron3-super-nvidia'] },
  { id:'incident-researcher', lane:'research', purpose:'Research each incident independently, seek corroboration, explain context and write a natural humanized incident narrative without copying sources.', providerHints:['deepseek-v3.2-openrouter','qwen3.5-397b-openrouter','nemotron3-super-nvidia'] },
  { id:'security-analyst', lane:'writer', purpose:'Assess the overall security environment and threat posture.', providerHints:['deepseek-v3.2-openrouter','nemotron3-super-nvidia','qwen3.5-397b-openrouter'] },
  { id:'crime-analyst', lane:'writer', purpose:'Analyze crime, public safety and violent-incident developments.', providerHints:['qwen3.5-397b-openrouter','deepseek-v3.2-openrouter','glm47-cerebras'] },
  { id:'political-analyst', lane:'writer', purpose:'Analyze political, governance and civil-unrest developments.', providerHints:['deepseek-v3.2-openrouter','qwen3.5-397b-openrouter','nemotron3-super-nvidia'] },
  { id:'border-transport-analyst', lane:'writer', purpose:'Analyze borders, roads, corridors, checkpoints and transport disruption.', providerHints:['nemotron3-super-nvidia','qwen3.5-397b-openrouter','deepseek-v3.2-openrouter'] },
  { id:'maritime-analyst', lane:'writer', purpose:'Analyze ports, maritime security, shipping and coastal risks where relevant.', providerHints:['deepseek-v3.2-openrouter','nemotron3-super-nvidia','glm47-cerebras'] },
  { id:'hazard-analyst', lane:'writer', purpose:'Analyze weather, natural hazards, health emergencies and environmental disruption.', providerHints:['qwen3.5-397b-openrouter','nemotron3-super-nvidia','deepseek-v3.2-openrouter'] },
  { id:'operational-implications-analyst', lane:'writer', purpose:'Translate intelligence into actionable logistics/security implications.', providerHints:['nemotron3-super-nvidia','deepseek-v3.2-openrouter','qwen3.5-397b-openrouter'] },
  { id:'source-critic', lane:'review', purpose:'Challenge source reliability, provenance, duplication and corroboration.', providerHints:['deepseek-v3.2-openrouter','qwen3.5-397b-openrouter','glm47-cerebras'] },
  { id:'fact-checker', lane:'review', purpose:'Check claims against the supplied evidence and flag unsupported assertions.', providerHints:['nemotron3-super-nvidia','deepseek-v3.2-openrouter','qwen3.5-397b-openrouter'] },
  { id:'red-team-reviewer', lane:'review', purpose:'Actively seek analytical overreach, contradictions, hidden assumptions and false certainty.', providerHints:['deepseek-v3.2-openrouter','nemotron3-super-nvidia','glm47-cerebras'] },
  { id:'risk-consistency-reviewer', lane:'review', purpose:'Ensure severity, confidence, language and recommendations are internally consistent.', providerHints:['nemotron3-super-nvidia','qwen3.5-397b-openrouter','deepseek-v3.2-openrouter'] },
  { id:'visual-intelligence-designer', lane:'visual', purpose:'Design the report\'s map, visual intelligence panels and image placements from available evidence.', providerHints:['qwen3.5-397b-openrouter','glm47-cerebras','deepseek-v3.2-openrouter'] },
  { id:'data-graphics-designer', lane:'visual', purpose:'Design charts/metrics such as severity distribution, event volume, source coverage and trend views.', providerHints:['qwen3.5-397b-openrouter','nemotron3-super-nvidia','glm47-cerebras'] },
  { id:'copy-editor', lane:'editorial', purpose:'Improve clarity, structure, tone, grammar and executive readability without changing facts.', providerHints:['qwen3.5-397b-openrouter','deepseek-v3.2-openrouter','glm47-cerebras'] },
  { id:'senior-editor', lane:'editorial', purpose:'Resolve reviewer findings and assemble the authoritative final report.', providerHints:['deepseek-v3.2-openrouter','qwen3.5-397b-openrouter','nemotron3-super-nvidia'] },
  { id:'publication-qa', lane:'qa', purpose:'Perform final publication safety, completeness, evidence and rendering checks.', providerHints:['nemotron3-super-nvidia','deepseek-v3.2-openrouter','glm47-cerebras'] },
  { id:'independent-quality-assurance', lane:'qa', purpose:'Independently score the final report against the Sonalit publication standard. Do not defer to the senior editor or other reviewers.', providerHints:['qwen3.5-397b-openrouter','deepseek-v3.2-openrouter','nemotron3-super-nvidia'] },
  { id:'release-integrity-auditor', lane:'qa', purpose:'Act as the final release authority: look for provenance breaks, unsupported inference, misleading precision, missing uncertainty and any reason a client should not receive the report.', providerHints:['deepseek-v3.2-openrouter','nemotron3-super-nvidia','qwen3.5-397b-openrouter'] },
];

function hasAi(){ return aiClient.hasAnyProvider(); }
function extract(response){ return Array.isArray(response?.content) ? response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n') : ''; }
function parse(text){ try { return JSON.parse(text); } catch (_) {} const m=String(text||'').match(/[\[{][\s\S]*[\]}]/); if(!m)return null; try{return JSON.parse(m[0]);}catch(_){return null;} }
function clean(v,n=5000){ return String(v||'').replace(/\s+/g,' ').trim().slice(0,n); }

async function callAgent(role, payload){
  if(!hasAi()) return { role:role.id, status:'skipped', reason:'no_ai_provider' };
  try {
    const response = await aiClient.createMessage({
      max_tokens: role.lane==='editorial' || role.lane==='review' ? 3000 : 2400,
      system: `You are the Sonalit Intelligence Centre's ${role.id} agent. ${role.purpose}\n\nRules: work ONLY from supplied evidence; never invent facts, sources, casualties, dates, motives, locations or outcomes. Separate observed/reporting from assessment. Preserve uncertainty. Do not merely restate source material. Every analytical judgement must add causal explanation, alternative hypothesis or decision consequence when the evidence supports it. State what would change the judgement. Avoid stock language and repeated sentence structures. Use precise professional intelligence prose. Return ONLY valid JSON.`,
      providerHints:role.providerHints,
      messages:[{role:'user',content:JSON.stringify(payload)}]
    });
    const parsed=parse(extract(response));
    return { role:role.id, status:parsed?'complete':'invalid_output', provider:response?._provider||'unknown', output:parsed };
  } catch(error){
    logger.warn(`Publication agent ${role.id} failed: ${error.message}`);
    return { role:role.id, status:'failed', error:error.message };
  }
}

async function runLimited(tasks, limit=4){
  const out=[]; let cursor=0;
  async function worker(){ while(true){ const i=cursor++; if(i>=tasks.length)return; out[i]=await tasks[i](); } }
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},worker));
  return out;
}

function evidencePackage(country, period, events){
  return { country, period_start:period.start?.toISOString?.()||period.start, period_end:period.end?.toISOString?.()||period.end,
    events:events.map(e=>({id:String(e.id),headline:clean(e.headline||e.title,500),brief:clean(e.brief||e.summary,900),severity:e.severity,confidence:e.confidence,intelligence_type:e.intelligence_type,last_seen_at:e.last_seen_at,observation_count:e.observation_count,source_count:e.source_count,latitude:e.latitude,longitude:e.longitude})) };
}

async function runPublicationEditorialBoard({country, period, events, baseBody, evidenceContract, precomputedResearch=null}){
  const deepResearchEnabled=String(process.env.INTEL_PUBLICATION_DEEP_RESEARCH||'true').toLowerCase()!=='false';
  let research=precomputedResearch||{byEvent:{},summary:{requested:0,researched:0,fallback:0,failed:0}};
  if(!precomputedResearch && deepResearchEnabled && events.length){
    try{ research=await researchPublicationIncidents(events,{country}); }
    catch(error){ logger.warn(`Publication incident-research stage failed: ${error.message}`); }
  }
  const enrichedEvents=events.map(e=>({...e,research:research.byEvent[String(e.id)]||null}));
  const evidence=evidencePackage(country,period,enrichedEvents);
  const board={version:'1.0', agents:AGENT_ROLES.map(r=>({...r,status:'pending'})), evidence_contract:evidenceContract, started_at:new Date().toISOString()};
  if(!events.length){ board.agents=board.agents.map(a=>({...a,status:'no_data'})); board.publishable=false; return {board,final:null,visual:null,graphics:null,publishable:false}; }

  const writers=AGENT_ROLES.filter(r=>r.lane==='writer');
  const writerResults=await runLimited(writers.map(role=>()=>callAgent(role,{assignment:role.purpose,evidence})),4);
  for(const result of writerResults){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}
  const writerOutputs=writerResults.filter(x=>x?.output).map(x=>({agent:x.role,output:x.output}));

  const reviewPayload={evidence,research_summary:research.summary,research_packets:enrichedEvents.map(e=>({incident_id:String(e.id),research:e.research})),writer_outputs:writerOutputs,base_report:baseBody};
  const reviewRoles=AGENT_ROLES.filter(r=>r.lane==='review');
  const reviewResults=await runLimited(reviewRoles.map(role=>()=>callAgent(role,{assignment:role.purpose,...reviewPayload})),4);
  for(const result of reviewResults){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const visual=await callAgent(AGENT_ROLES.find(r=>r.id==='visual-intelligence-designer'),{assignment:'Return JSON visual plan with map:true, image_slots (0-4), captions and placement notes. Never fabricate an image.',evidence});
  const graphics=await callAgent(AGENT_ROLES.find(r=>r.id==='data-graphics-designer'),{assignment:'Return JSON graphics plan with metric cards and chart specifications based only on the evidence.',evidence});
  for(const result of [visual,graphics]){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const editorialPayload={evidence,research_summary:research.summary,incident_dossiers:enrichedEvents.map(e=>({incident_id:String(e.id),research:e.research})),writer_outputs:writerOutputs,reviews:reviewResults.filter(x=>x?.output).map(x=>({agent:x.role,output:x.output})),base_report:baseBody,visual_plan:visual.output||null,graphics_plan:graphics.output||null};
  const copy=await callAgent(AGENT_ROLES.find(r=>r.id==='copy-editor'),{assignment:'Create a publication-grade editorial draft. Preserve every supported fact, but transform source material into specific, decision-relevant analysis. Every major judgement must identify its evidentiary basis, confidence, uncertainty, causal logic and, where feasible, an observable indicator that would change the assessment. Remove generic summaries, filler, repetition and unsupported certainty.',...editorialPayload});
  const senior=await callAgent(AGENT_ROLES.find(r=>r.id==='senior-editor'),{assignment:'Act as the senior all-source intelligence editor. Resolve reviewer findings and return the complete authoritative report JSON. Required keys: title,subtitle,executive_assessment,sections,outlook,incident_dossiers. Each incident_dossiers item must preserve event_id and include headline,what_happened,context,assessment,key_facts,why_it_matters,caveats,research_sources. Do not omit or rename the incident dossiers because the professional PDF renders them directly. Do not produce a news digest. Distinguish fact from assessment; explain why developments matter; identify competing explanations or material counter-evidence where relevant; provide explicit uncertainty; give a concrete forward outlook with indicators and time horizons; eliminate boilerplate and repetitive language; preserve source provenance.',...editorialPayload,copy_edit:copy.output||null});
  for(const result of [copy,senior]){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const qaRoles=AGENT_ROLES.filter(r=>r.lane==='qa');
  const qaResults=await runLimited(qaRoles.map(role=>()=>callAgent(role,{
    assignment:'Return {publishable:boolean,blocking_issues:[],warnings:[],checks:{evidence,attribution,contradictions,confidence,completeness,specificity,analytical_depth,forecast_quality,source_diversity}}. Block publication for generic or restated prose, unsupported analytical leaps, weak source diversity, false precision, missing uncertainty, missing decision relevance, or incomplete incident research—not only for factual errors.',
    evidence,
    final_report:senior.output||copy.output||null,
    reviews:reviewResults.filter(x=>x?.output).map(x=>x.output)
  })),Math.min(3,qaRoles.length));
  for(const result of qaResults){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}
  const qa=qaResults.find(x=>x.role==='publication-qa')||qaResults[0]||{output:null};
  const qaConsensus={
    reviewers:qaResults.map(x=>({role:x.role,status:x.status,publishable:x.output?.publishable===true,blocking_issues:Array.isArray(x.output?.blocking_issues)?x.output.blocking_issues:[]})),
    all_complete:qaResults.length===qaRoles.length&&qaResults.every(x=>x.status==='complete'),
    unanimous_publishable:qaResults.length===qaRoles.length&&qaResults.every(x=>x.output?.publishable===true),
    blocking_issues:qaResults.flatMap(x=>Array.isArray(x.output?.blocking_issues)?x.output.blocking_issues:[]).slice(0,50)
  };

  board.completed_at=new Date().toISOString();
  const final=senior.output||copy.output||null;
  const finalDossiers=Array.isArray(final?.incident_dossiers)?final.incident_dossiers:[];
  const expectedEventIds=new Set(events.map(e=>String(e.id)));
  const returnedEventIds=new Set(finalDossiers.map(d=>String(d?.event_id||'')).filter(Boolean));
  const finalDossiersComplete=events.length===0 || (
    finalDossiers.length===events.length &&
    returnedEventIds.size===expectedEventIds.size &&
    [...expectedEventIds].every(id=>returnedEventIds.has(id))
  );
  const allResearchComplete=events.length===0 || events.every(e=>String(e?.research?.agent?.status||'').toLowerCase()==='researched');
  const publishable=Boolean(evidenceContract&&final&&finalDossiersComplete&&allResearchComplete&&qaConsensus.all_complete&&qaConsensus.unanimous_publishable&&!qaConsensus.blocking_issues.length);
  board.publishable=publishable;
  return {board,final,visual:visual.output||null,graphics:graphics.output||null,qa:qa.output||null,qaConsensus,publishable,research};
}
module.exports={AGENT_ROLES,runPublicationEditorialBoard};
