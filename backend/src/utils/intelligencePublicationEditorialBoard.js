/*
 * Sonalit Intelligence Publication Editorial Board
 *
 * A multi-agent newsroom pipeline for publication generation.
 * Agents are logical specialist roles; the orchestrator deliberately bounds
 * provider calls and forces deterministic evidence/review gates before publish.
 */
const aiClient = require('./aiClient');
const logger = require('./logger');

const AGENT_ROLES = [
  { id:'evidence-curator', lane:'research', purpose:'Build the evidence ledger and identify corroboration, gaps and provenance.' },
  { id:'security-analyst', lane:'writer', purpose:'Assess the overall security environment and threat posture.' },
  { id:'crime-analyst', lane:'writer', purpose:'Analyze crime, public safety and violent-incident developments.' },
  { id:'political-analyst', lane:'writer', purpose:'Analyze political, governance and civil-unrest developments.' },
  { id:'border-transport-analyst', lane:'writer', purpose:'Analyze borders, roads, corridors, checkpoints and transport disruption.' },
  { id:'maritime-analyst', lane:'writer', purpose:'Analyze ports, maritime security, shipping and coastal risks where relevant.' },
  { id:'hazard-analyst', lane:'writer', purpose:'Analyze weather, natural hazards, health emergencies and environmental disruption.' },
  { id:'operational-implications-analyst', lane:'writer', purpose:'Translate intelligence into actionable logistics/security implications.' },
  { id:'source-critic', lane:'review', purpose:'Challenge source reliability, provenance, duplication and corroboration.' },
  { id:'fact-checker', lane:'review', purpose:'Check claims against the supplied evidence and flag unsupported assertions.' },
  { id:'red-team-reviewer', lane:'review', purpose:'Actively seek analytical overreach, contradictions, hidden assumptions and false certainty.' },
  { id:'risk-consistency-reviewer', lane:'review', purpose:'Ensure severity, confidence, language and recommendations are internally consistent.' },
  { id:'visual-intelligence-designer', lane:'visual', purpose:'Design the report's map, visual intelligence panels and image placements from available evidence.' },
  { id:'data-graphics-designer', lane:'visual', purpose:'Design charts/metrics such as severity distribution, event volume, source coverage and trend views.' },
  { id:'copy-editor', lane:'editorial', purpose:'Improve clarity, structure, tone, grammar and executive readability without changing facts.' },
  { id:'senior-editor', lane:'editorial', purpose:'Resolve reviewer findings and assemble the authoritative final report.' },
  { id:'publication-qa', lane:'qa', purpose:'Perform final publication safety, completeness, evidence and rendering checks.' },
];

function hasAi(){ return aiClient.hasAnthropic() || aiClient.hasGroqFallback(); }
function extract(response){ return Array.isArray(response?.content) ? response.content.filter(x=>x?.type==='text').map(x=>x.text).join('\n') : ''; }
function parse(text){ try { return JSON.parse(text); } catch (_) {} const m=String(text||'').match(/[\[{][\s\S]*[\]}]/); if(!m)return null; try{return JSON.parse(m[0]);}catch(_){return null;} }
function clean(v,n=5000){ return String(v||'').replace(/\s+/g,' ').trim().slice(0,n); }

async function callAgent(role, payload){
  if(!hasAi()) return { role:role.id, status:'skipped', reason:'no_ai_provider' };
  try {
    const response = await aiClient.createMessage({
      max_tokens: role.lane==='editorial' || role.lane==='review' ? 3000 : 2400,
      system: `You are the Sonalit Intelligence Centre's ${role.id} agent. ${role.purpose}\n\nRules: work ONLY from supplied evidence; never invent facts, sources, casualties, dates, motives, locations or outcomes. Separate reported fact from assessment. Preserve uncertainty. Return ONLY valid JSON.`,
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
  async function worker(){
    while(true){const i=cursor++; if(i>=tasks.length)return; out[i]=await tasks[i]();}
  }
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},worker));
  return out;
}

function evidencePackage(country, period, events){
  return {
    country, period_start:period.start?.toISOString?.()||period.start, period_end:period.end?.toISOString?.()||period.end,
    events:events.map(e=>({id:String(e.id),headline:clean(e.headline||e.title,500),brief:clean(e.brief||e.summary,900),severity:e.severity,confidence:e.confidence,intelligence_type:e.intelligence_type,last_seen_at:e.last_seen_at,observation_count:e.observation_count,source_count:e.source_count,latitude:e.latitude,longitude:e.longitude}))
  };
}

async function runPublicationEditorialBoard({country, period, events, baseBody, evidenceContract}){
  const evidence=evidencePackage(country,period,events);
  const board={version:'1.0', agents:AGENT_ROLES.map(r=>({...r,status:'pending'})), evidence_contract:evidenceContract, started_at:new Date().toISOString()};
  if(!events.length){
    board.agents=board.agents.map(a=>({...a,status:'no_data'}));
    return { board, final:null, visual:null, graphics:null, publishable:false };
  }

  const writers=AGENT_ROLES.filter(r=>r.lane==='writer');
  const writerResults=await runLimited(writers.map(role=>()=>callAgent(role,{assignment:role.purpose,evidence})),4);
  for(const result of writerResults){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const writerOutputs=writerResults.filter(x=>x?.output).map(x=>({agent:x.role,output:x.output}));
  const reviewPayload={evidence,writer_outputs:writerOutputs,base_report:baseBody};
  const reviewRoles=AGENT_ROLES.filter(r=>r.lane==='review');
  const reviewResults=await runLimited(reviewRoles.map(role=>()=>callAgent(role,{assignment:role.purpose,...reviewPayload})),4);
  for(const result of reviewResults){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const visual=await callAgent(AGENT_ROLES.find(r=>r.id==='visual-intelligence-designer'),{assignment:'Return a JSON visual plan with map:true, image_slots (0-4), captions and placement notes. Never fabricate an image.',evidence});
  const graphics=await callAgent(AGENT_ROLES.find(r=>r.id==='data-graphics-designer'),{assignment:'Return a JSON graphics plan with metric cards and chart specifications based only on the evidence.',evidence});
  for(const result of [visual,graphics]){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const editorialPayload={evidence,writer_outputs:writerOutputs,reviews:reviewResults.filter(x=>x?.output).map(x=>({agent:x.role,output:x.output})),base_report:baseBody,visual_plan:visual.output||null,graphics_plan:graphics.output||null};
  const copy=await callAgent(AGENT_ROLES.find(r=>r.id==='copy-editor'),{assignment:'Create a clean editorial draft preserving every supported fact and clearly separating assessment from reporting.',...editorialPayload});
  const senior=await callAgent(AGENT_ROLES.find(r=>r.id==='senior-editor'),{assignment:'Resolve reviewer findings and return the complete authoritative report JSON. Required keys: title,subtitle,executive_assessment,sections,outlook.',...editorialPayload,copy_edit:copy.output||null});
  for(const result of [copy,senior]){const a=board.agents.find(x=>x.id===result.role);if(a)Object.assign(a,result);}

  const qa=await callAgent(AGENT_ROLES.find(r=>r.id==='publication-qa'),{assignment:'Return {publishable:boolean,blocking_issues:[],warnings:[],checks:{evidence,attribution,contradictions,confidence,completeness}}. Publishable requires no blocking factual/evidence problems.',evidence,final_report:senior.output||copy.output||null,reviews:reviewResults.filter(x=>x?.output).map(x=>x.output)});
  const qaAgent=board.agents.find(x=>x.id==='publication-qa'); if(qaAgent)Object.assign(qaAgent,qa);

  board.completed_at=new Date().toISOString();
  const final=senior.output||copy.output||null;
  const publishable=Boolean(evidenceContract && final && qa.output?.publishable===true && !(qa.output?.blocking_issues||[]).length);
  return {board,final,visual:visual.output||null,graphics:graphics.output||null,qa:qa.output||null,publishable};
}

module.exports={AGENT_ROLES,runPublicationEditorialBoard};
