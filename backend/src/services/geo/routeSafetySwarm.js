'use strict';

const aiClient = require('../../utils/aiClient');
const logger = require('../../utils/logger');

const AGENTS = [
  { id:'route_engineer', role:'ROAD NETWORK ENGINEER', mission:'Validate route geometry, connectivity, distance, duration and alternatives. Never invent roads.' },
  { id:'security_analyst', role:'SECURITY THREAT ANALYST', mission:'Assess crime, conflict, banditry, kidnapping and hostile exposure from supplied evidence only.' },
  { id:'environment_analyst', role:'ENVIRONMENT & WEATHER ANALYST', mission:'Assess weather, flooding, storm, visibility and natural-hazard effects from supplied evidence.' },
  { id:'infrastructure_analyst', role:'INFRASTRUCTURE / ROAD CONDITIONS', mission:'Assess closures, construction, barriers, bottlenecks and border constraints.' },
  { id:'operations_analyst', role:'CONVOY OPERATIONS ANALYST', mission:'Translate route evidence into convoy timing, staging, checkpoints and execution hazards.' },
  { id:'data_assurance', role:'DATA ASSURANCE AGENT', mission:'Detect missing, stale, contradictory, low-confidence or invalid evidence.' },
  { id:'red_team', role:'RED TEAM / ADVERSARIAL ROUTE REVIEW', mission:'Try to disprove the proposed route and expose unsafe assumptions and overconfidence.' },
];

function clip(v,max){ const s=typeof v==='string'?v:JSON.stringify(v); return s.length>max?s.slice(0,max)+'…':s; }
function extractJson(text){
  if(!text)return null;
  const clean=String(text).replace(/```json|```/g,'').trim();
  try{return JSON.parse(clean);}catch(_){ }
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a>=0&&b>a)try{return JSON.parse(clean.slice(a,b+1));}catch(_){ }
  return null;
}
async function ask(system,user,maxTokens){
  const r=await aiClient.createMessage({max_tokens:maxTokens||1500,system,messages:[{role:'user',content:user}]});
  const text=(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
  return {provider:r._provider||'unknown',text,json:extractJson(text)};
}
async function runAgent(agent,input){
  const system='You are '+agent.role+' inside Sonalit Route Safety. Mission: '+agent.mission+' Never invent coordinates, roads, incidents, weather or closures. Separate observed evidence from inference. Do not treat absence of evidence as safety. Return JSON only: {"status":"supported|uncertain|blocked","finding":"...","confidence":0,"risks":[{"risk":"...","severity":"low|medium|high|critical","evidence":"..."}],"actions":[{"action":"...","urgency":"now|soon|monitor"}],"contradictions":[],"evidence_gaps":[],"provenance":[]}';
  try{
    const r=await ask(system,'ROUTE SAFETY INPUT:\n'+clip(input,15000),1500);
    const j=r.json;
    if(!j)return Object.assign({},agent,{provider:r.provider,status:'uncertain',finding:r.text||'No structured response',confidence:0.15,risks:[],actions:[],contradictions:['Unstructured model output'],evidence_gaps:['Structured output missing'],provenance:[]});
    return Object.assign({},agent,r,{provider:r.provider,status:j.status||'uncertain',finding:j.finding||'',confidence:Math.max(0,Math.min(1,Number(j.confidence==null?0.3:j.confidence))),risks:j.risks||[],actions:j.actions||[],contradictions:j.contradictions||[],evidence_gaps:j.evidence_gaps||[],provenance:j.provenance||[]});
  }catch(e){
    return Object.assign({},agent,{provider:'failed',status:'blocked',finding:'Agent unavailable',confidence:0,risks:[],actions:[],contradictions:[e.message],evidence_gaps:['Agent unavailable'],provenance:[]});
  }
}

async function runSwarm(input){
  const reports=await Promise.all(AGENTS.map(a=>runAgent(a,input)));
  const riskMap=new Map();
  const severityRank={low:1,medium:2,high:3,critical:4};
  for(const r of reports)for(const x of r.risks||[]){
    const key=String(x.risk||'').toLowerCase().trim(); if(!key)continue;
    const cur=riskMap.get(key)||{risk:x.risk,severity:x.severity,sources:[]};
    cur.sources.push(r.id);
    if((severityRank[x.severity]||1)>(severityRank[cur.severity]||1))cur.severity=x.severity;
    riskMap.set(key,cur);
  }
  let arbiter;
  try{
    const r=await ask(
      'You are the SENIOR ROUTE SAFETY ARBITER for Sonalit. Reconcile independent specialist reports and deterministic route evidence. Never invent facts. Flag disagreements instead of smoothing them away. Return JSON: {"route_selection_reason":"...","risk_level":"LOW|MEDIUM|HIGH|CRITICAL","confidence":0,"material_risks":[{"risk":"...","severity":"low|medium|high|critical","evidence":"..."}],"actions":[{"action":"...","urgency":"now|soon|monitor","approval":"none|human"}],"go_no_go":"GO|CONDITIONAL|NO_GO|HUMAN_REVIEW","uncertainties":[],"dissent":[]}',
      clip(JSON.stringify({input,reports}),28000),2200
    );
    arbiter=r.json;
    if(!arbiter)throw new Error('Arbiter returned invalid structured output');
    arbiter.provider=r.provider;
  }catch(e){
    logger.warn('Route Safety arbiter unavailable: '+e.message);
    arbiter={route_selection_reason:'Arbitration unavailable; operator review required.',risk_level:'HIGH',confidence:0.2,material_risks:[],actions:[],go_no_go:'HUMAN_REVIEW',uncertainties:['Arbiter unavailable'],dissent:[],provider:'failed'};
  }
  const critic=await runAgent(
    {id:'route_critic',role:'FINAL ROUTE SAFETY AUDITOR',mission:'Attack the arbitration and find hidden unsafe assumptions.'},
    {route_evidence:input,arbiter:arbiter,reports:reports}
  );
  const hardBlock=reports.some(r=>r.status==='blocked'||(r.risks||[]).some(x=>String(x.severity).toLowerCase()==='critical'));
  if(hardBlock)arbiter.go_no_go='HUMAN_REVIEW';
  const confs=reports.map(r=>Number(r.confidence)).filter(Number.isFinite);
  const mean=confs.length?confs.reduce((a,b)=>a+b,0)/confs.length:0;
  const finalConfidence=Number((Number(arbiter.confidence||mean||0)*0.6+mean*0.4).toFixed(2));
  return {version:'route-safety-swarm-v1',agent_count:reports.length+2,reports,arbiter,critic,aggregated_risks:Array.from(riskMap.values()),consensus:{confidence:finalConfidence,hard_block:hardBlock}};
}

module.exports={AGENTS,runSwarm};
