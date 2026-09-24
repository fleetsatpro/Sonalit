/**
 * SONALIT COPILOT — Decision Swarm
 * Unified operational reasoning engine. Evidence is collected by specialty,
 * decisions are independently challenged, and every material decision can be
 * persisted for audit/outcome feedback.
 */
const aiClient = require('../utils/aiClient');
const logger = require('../utils/logger');

const AGENTS = [
  { id:'situation', name:'SITUATION INTELLIGENCE', focus:'Operational picture, chronology, mission state, anomalies and affected assets.', tools:['query_alerts','query_convoys','query_vehicles','get_world_context'] },
  { id:'security', name:'SECURITY INTELLIGENCE', focus:'Threats, hostile activity, security posture, escalation and life safety.', tools:['query_alerts','query_risk_zones','query_convoys'] },
  { id:'route', name:'ROUTE & MOBILITY', focus:'Route feasibility, delays, road closures, corridor deviations and alternatives.', tools:['query_convoys','get_road_conditions','query_risk_zones','get_weather','get_world_context'] },
  { id:'fleet', name:'FLEET & ASSET', focus:'Vehicle health, telemetry freshness, fuel, driver and mechanical exposure.', tools:['query_vehicles','query_alerts'] },
  { id:'environment', name:'ENVIRONMENTAL', focus:'Weather, flooding, visibility and environmental effects on trafficability.', tools:['get_weather','get_road_conditions','get_world_context'] },
  { id:'risk', name:'RISK INTELLIGENCE', focus:'Likelihood, severity, risk concentration, cascade effects and exposure.', tools:['query_risk_zones','query_alerts','query_convoys'] },
  { id:'compliance', name:'COMPLIANCE & POLICY', focus:'Policy, approvals, duty of care, contractual constraints and data governance.', tools:['query_convoys','query_alerts'] },
  { id:'commercial', name:'COMMERCIAL & SLA', focus:'Customer SLA, schedule, cost and revenue implications after safety constraints.', tools:['query_convoys','query_alerts'] },
  { id:'adversary', name:'RED TEAM / ADVERSARY', focus:'Attack the leading interpretation, identify manipulation, spoofing and second-order failure.', tools:['query_alerts','query_risk_zones','query_convoys'] },
  { id:'data-quality', name:'DATA INTEGRITY', focus:'Freshness, completeness, contradictions, missing evidence and provenance quality.', tools:['query_vehicles','query_convoys','query_alerts','get_world_context'] },
];

const TOOL_CATALOG = {
  query_vehicles:{description:'Live vehicles with registration, status, region, fuel, speed, coordinates, driver and last ping.',schema:{type:'object',properties:{status:{type:'string'},region:{type:'string'},low_fuel:{type:'boolean'},moving:{type:'boolean'}}}},
  query_convoys:{description:'Convoys with status, region, priority, origin, destination and timing.',schema:{type:'object',properties:{status:{type:'string'},region:{type:'string'},priority:{type:'string'}}}},
  query_alerts:{description:'Open or historical operational alerts with severity, type, vehicle and timestamps.',schema:{type:'object',properties:{severity:{type:'string'},type:{type:'string'},include_resolved:{type:'boolean'}}}},
  get_weather:{description:'Current conditions and short forecast at a place.',schema:{type:'object',properties:{location:{type:'string'}},required:['location']}},
  check_holidays:{description:'Public holidays for a country/year.',schema:{type:'object',properties:{country_code:{type:'string'},year:{type:'number'}},required:['country_code']}},
  get_road_conditions:{description:'Road closures, barriers, construction and weather context near a place.',schema:{type:'object',properties:{location:{type:'string'},radius_km:{type:'number'}},required:['location']}},
  query_risk_zones:{description:'Internal active risk zones.',schema:{type:'object',properties:{region:{type:'string'},risk_level:{type:'string'},zone_type:{type:'string'}}}},
  get_world_context:{description:'Spatial world context: nearby Sonalit vehicles + external aircraft (OpenSky) with honest freshness.',schema:{type:'object',properties:{location:{type:'string'},latitude:{type:'number'},longitude:{type:'number'},radius_km:{type:'number'},layers:{type:'array',items:{type:'string'}},max_entities:{type:'number'}}}},
};

function clip(value,max=9000){const s=typeof value==='string'?value:JSON.stringify(value);return s.length>max?s.slice(0,max)+'…':s;}
function extractJSON(text){
  if(!text)return null;
  const cleaned=String(text).replace(/\\`\\`\\`json|\\`\\`\\`/g,'').trim();
  try{return JSON.parse(cleaned);}catch(_){}
  const a=cleaned.indexOf('{'),b=cleaned.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(cleaned.slice(a,b+1));}catch(_){}}
  return null;
}
async function ask(prompt,maxTokens=1600){
  const r=await aiClient.createMessage({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens:maxTokens,
    system:[{type:'text',text:'You are SONALIT COPILOT. Never invent operational facts. Distinguish facts, inference and uncertainty. Safety outranks schedule and cost. Return JSON only when a schema is supplied.'}],
    messages:[{role:'user',content:prompt}],
  });
  const text=(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').trim();
  return {provider:r._provider||'unknown',text,json:extractJSON(text)};
}

function inferLocations(command){
  const s=String(command);
  const matches=s.match(/(?:between|from|near|at|in|through|via)\s+([A-Z][A-Za-z' -]{2,50})/g)||[];
  return [...new Set(matches.map(x=>x.replace(/^(between|from|near|at|in|through|via)\s+/i,'').trim()).filter(Boolean))].slice(0,4);
}

async function planEvidence(command,history){
  const lexical=[];
  const lc=String(command).toLowerCase();
  for(const [name,t] of Object.entries(TOOL_CATALOG)){
    if(name==='query_vehicles' && /vehicle|truck|fleet|driver|fuel|speed|offline|telemetry|location/.test(lc)) lexical.push(name);
    if(name==='query_convoys' && /convoy|mission|eta|departure|arrival|shipment/.test(lc)) lexical.push(name);
    if(name==='query_alerts' && /alert|incident|anomaly|security|warning|panic/.test(lc)) lexical.push(name);
    if(name==='get_weather' && /weather|rain|storm|wind|flood|visibility/.test(lc)) lexical.push(name);
    if(name==='check_holidays' && /holiday|border|closure|public/.test(lc)) lexical.push(name);
    if(name==='get_road_conditions' && /road|closure|construction|traffic|route|barrier/.test(lc)) lexical.push(name);
    if(name==='query_risk_zones' && /risk|danger|hotspot|bandit|conflict|strike|roadblock|security/.test(lc)) lexical.push(name);
    if(name==='get_world_context' && /aircraft|airspace|opensky|nearby|around|proximity|spatial|world context|overhead|flight/.test(lc)) lexical.push(name);
  }
  let modelPlan=null;
  try{
    const r=await ask([
      'Plan the smallest sufficient live evidence set.',
      'Return JSON: {"probes":[{"tool":"allowed_name","input":{}}],"reason":"...","need_live_data":true|false}.',
      'Allowed tools:',JSON.stringify(TOOL_CATALOG),
      'Detected candidate locations:',JSON.stringify(inferLocations(command)),
      'REQUEST:',clip(command,3500),
      'HISTORY:',clip(history,2500),
    ].join('\n\n'),1000);
    modelPlan=r.json;
  }catch(_){}
  const probes=[];
  const add=(tool,input={})=>{if(TOOL_CATALOG[tool]&&!probes.some(p=>p.tool===tool&&JSON.stringify(p.input)===JSON.stringify(input)))probes.push({tool,input});};
  for(const tool of lexical)add(tool,{});
  for(const p of modelPlan?.probes||[]){if(TOOL_CATALOG[p.tool])add(p.tool,p.input||{});}
  const locs=inferLocations(command);
  for(const loc of locs.slice(0,2)){
    if(probes.some(p=>p.tool==='get_weather')){probes.push({tool:'get_weather',input:{location:loc}});}
    if(probes.some(p=>p.tool==='get_road_conditions')){probes.push({tool:'get_road_conditions',input:{location:loc,radius_km:50}});}
  }
  if(!probes.length && /(safe|risk|current|live|now|active|status)/i.test(command)){
    add('query_alerts',{});add('query_convoys',{});
  }
  return [...new Map(probes.map(p=>[p.tool+JSON.stringify(p.input),p])).values()].slice(0,10);
}

async function collectToolEvidence(probes,executeTool,context){
  const evidence={},failures=[];
  await Promise.all(probes.map(async p=>{
    try{evidence[p.tool+JSON.stringify(p.input)]=await executeTool(p.tool,p.input,context);}
    catch(e){failures.push({tool:p.tool,input:p.input,error:e?.message||String(e)});}
  }));
  return {evidence,failures};
}

async function runSpecialist(agent,command,evidence,history){
  const own={};
  for(const [key,val] of Object.entries(evidence)){
    const tool=key.split('{')[0];
    if(agent.tools.includes(tool))own[key]=val;
  }
  const prompt=[
    'SPECIALIST:',agent.name,
    'MISSION:',agent.focus,
    'You may reason only from the evidence below.',
    'Identify facts, implications, risks and disagreements.',
    'OUTPUT JSON:',
    '{"status":"supported|uncertain|blocked","finding":"...","facts":[],"inferences":[],"risks":[{"risk":"...","severity":"low|medium|high|critical"}],"recommended_actions":[{"action":"...","urgency":"now|soon|monitor","approval":"none|human"}],"confidence":0,"evidence_gaps":[],"dissent":"...","provenance":["tool key / fact"]}',
    'REQUEST:',clip(command,4000),
    'YOUR EVIDENCE:',clip(own,10000),
    'HISTORY:',clip(history,2500),
  ].join('\n\n');
  try{
    const r=await ask(prompt,1700);
    return {...agent,provider:r.provider,...(r.json||{status:'uncertain',finding:r.text||'No structured finding',facts:[],inferences:[],risks:[],recommended_actions:[],confidence:0.2,evidence_gaps:['Unstructured agent output'],dissent:'',provenance:[]})};
  }catch(e){
    return {...agent,provider:'failed',status:'blocked',finding:'Agent unavailable',facts:[],inferences:[],risks:[],recommended_actions:[],confidence:0,evidence_gaps:[e.message],dissent:'Unavailable',provenance:[]};
  }
}

function deterministicSafetyAssessment(evidence){
  const flat=Object.entries(evidence).map(([source,value])=>({source,value}));
  const alerts=flat.filter(x=>x.source.startsWith('query_alerts')).flatMap(x=>x.value?.alerts||[]);
  const vehicles=flat.filter(x=>x.source.startsWith('query_vehicles')).flatMap(x=>x.value?.vehicles||[]);
  const zones=flat.filter(x=>x.source.startsWith('query_risk_zones')).flatMap(x=>x.value?.risk_zones||[]);
  const criticalAlerts=alerts.filter(a=>a.severity==='critical').length;
  const highAlerts=alerts.filter(a=>a.severity==='high').length;
  const criticalZones=zones.filter(z=>z.risk_level==='critical').length;
  const highZones=zones.filter(z=>z.risk_level==='high').length;
  const offline=vehicles.filter(v=>v.status==='offline').length;
  const lowFuel=vehicles.filter(v=>Number(v.fuel_level)<25).length;
  const reasons=[];
  if(criticalAlerts)reasons.push({code:'CRITICAL_ALERT',count:criticalAlerts});
  if(criticalZones)reasons.push({code:'CRITICAL_RISK_ZONE',count:criticalZones});
  if(highAlerts)reasons.push({code:'HIGH_ALERT',count:highAlerts});
  if(highZones)reasons.push({code:'HIGH_RISK_ZONE',count:highZones});
  if(offline)reasons.push({code:'OFFLINE_VEHICLE',count:offline});
  if(lowFuel)reasons.push({code:'LOW_FUEL',count:lowFuel});
  let level='LOW';
  if(criticalAlerts||criticalZones)level='CRITICAL';
  else if(highAlerts>=2||highZones>=2)level='HIGH';
  else if(highAlerts||highZones||offline||lowFuel)level='MEDIUM';
  return {level,hard_stop:level==='CRITICAL',reasons};
}

function evidenceHealth(evidence,failures){
  const values=Object.values(evidence);
  const total=values.length+failures.length;
  const successRate=total?values.length/total:0;
  return {probes:total,succeeded:values.length,failed:failures.length,success_rate:Number(successRate.toFixed(2))};
}

async function arbitrate(command,evidence,agents,history,safety){
  const compact=agents.map(a=>({id:a.id,status:a.status,finding:a.finding,facts:a.facts,inferences:a.inferences,risks:a.risks,actions:a.recommended_actions,confidence:a.confidence,gaps:a.evidence_gaps,dissent:a.dissent,provenance:a.provenance}));
  const r=await ask([
    'You are the SENIOR SONALIT COPILOT ARBITER.',
    'Synthesize independent specialist reports and evidence.',
    'Do not treat model confidence as probability. Reduce confidence for missing/stale/conflicting evidence.',
    'Safety assessment below is deterministic and cannot be overridden by cost/SLA arguments.',
    'Return JSON only:',
    '{"answer":"...","decision":"ACT_NOW|APPROVAL_REQUIRED|MONITOR|HUMAN_REVIEW_REQUIRED|NO_ACTION","risk_level":"LOW|MEDIUM|HIGH|CRITICAL","confidence":0,"recommended_actions":[{"action":"...","reason":"...","approval":"none|human","urgency":"now|soon|monitor"}],"risks":[{"risk":"...","severity":"low|medium|high|critical"}],"evidence":["..."],"missing_data":[],"dissent":[],"next_check":"..."}',
    'REQUEST:',clip(command,4500),
    'DETERMINISTIC SAFETY:',JSON.stringify(safety),
    'EVIDENCE:',clip(evidence,15000),
    'SPECIALISTS:',clip(compact,18000),
    'HISTORY:',clip(history,3000),
  ].join('\n\n'),2400);
  if(!r.json)throw new Error('Arbiter returned invalid structured output');
  return {...r.json,provider:r.provider};
}

async function critique(command,draft,evidence,agents){
  try{
    const r=await ask([
      'You are SONALIT COPILOT RED TEAM.',
      'Attempt to invalidate the proposed decision.',
      'Reject hallucinated facts, unsafe action, false certainty, insufficient evidence, hidden conflicts and irreversible recommendations.',
      'Return JSON: {"pass":true|false,"critical_issues":[],"corrections":[],"confidence_adjustment":-1..1}.',
      'REQUEST:',clip(command,3500),'DRAFT:',clip(draft,9000),'EVIDENCE:',clip(evidence,10000),
      'SPECIALISTS:',clip(agents,12000),
    ].join('\n\n'),1300);
    return r.json||{pass:false,critical_issues:['Red-team returned no structured result'],corrections:[],confidence_adjustment:-0.25};
  }catch(_){return {pass:false,critical_issues:['Red-team unavailable'],corrections:[],confidence_adjustment:-0.25};}
}

function finalize(draft,critic,safety,health){
  const base=Math.max(0,Math.min(1,Number(draft.confidence||0.4)));
  const conf=Math.max(0,Math.min(1,base+Number(critic.confidence_adjustment||0)-(health.success_rate<0.5?0.15:0)));
  const review=safety.hard_stop||!critic.pass||(critic.critical_issues||[]).length>0||conf<0.70||health.failed>0;
  return {
    ...draft,
    confidence:Number(conf.toFixed(2)),
    risk_level:safety.level==='CRITICAL'?'CRITICAL':draft.risk_level,
    decision: safety.hard_stop?'HUMAN_REVIEW_REQUIRED':review?'APPROVAL_REQUIRED':draft.decision,
    recommended_actions:(draft.recommended_actions||[]).map(a=>review?{...a,approval:'human'}:a),
    assurance:{safety_gate:safety.hard_stop?'TRIGGERED':'CLEAR',deterministic_safety:safety,red_team:critic,decision_gate:review?'HUMAN':'AI_ADVISORY',evidence_health:health},
  };
}

async function runDecisionFabric({command,history=[],executeTool,userId,orgId,persistDecision}){
  const started=Date.now();
  const probes=await planEvidence(command,history);
  const collected=await collectToolEvidence(probes,executeTool,{userId,orgId});
  const relevantToolNames = new Set(probes.map(p => p.tool));
  const selectedAgents = AGENTS.filter(a => a.tools.some(t => relevantToolNames.has(t)));
  const boundedAgents = (selectedAgents.length ? selectedAgents : AGENTS.slice(0, 3)).slice(0, 5);
  const agents=await Promise.all(boundedAgents.map(a=>runSpecialist(a,command,collected.evidence,history)));
  const safety=deterministicSafetyAssessment(collected.evidence);
  const health=evidenceHealth(collected.evidence,collected.failures);
  let draft;
  try{draft=await arbitrate(command,collected.evidence,agents,history,safety);}
  catch(e){logger.warn('Copilot arbiter fallback: '+e.message);draft={answer:'Sonalit Copilot is operating in degraded mode; no final autonomous decision is authorised.',decision:'HUMAN_REVIEW_REQUIRED',risk_level:safety.level,confidence:0.2,recommended_actions:[],risks:[],evidence:[],missing_data:['Arbiter unavailable'],dissent:[]};}
  const critic=await critique(command,draft,collected.evidence,agents);
  const final=finalize(draft,critic,safety,health);
  final.swarm=agents.map(a=>({id:a.id,name:a.name,status:a.status,confidence:Number(a.confidence||0),provider:a.provider,finding:a.finding,dissent:a.dissent,tools:a.tools}));
  final.meta={latency_ms:Date.now()-started,probe_plan:probes,agent_count:agents.length,agent_failures:agents.filter(a=>a.status==='blocked').length,provider_fallback_available:aiClient.hasOpenSourcePrimary?.()||aiClient.hasGroqFallback?.(),persisted:false};
  if(persistDecision){
    try{const decisionId=await persistDecision({orgId,userId,command,result:final});final.id=decisionId;final.meta.persisted=true;}catch(e){logger.warn('Copilot decision persistence failed: '+e.message);}
  }
  return final;
}

module.exports={AGENTS,TOOL_CATALOG,runDecisionFabric};
