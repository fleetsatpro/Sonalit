/**
 * SONALIT COPILOT — Decision Swarm
 * Unified operational reasoning engine. Evidence is collected by specialty,
 * decisions are independently challenged, and every material decision can be
 * persisted for audit/outcome feedback.
 */
const aiClient = require('../utils/aiClient');
const logger = require('../utils/logger');

const AGENTS = [
  { id:'situation', name:'SITUATION INTELLIGENCE', focus:'Operational picture, chronology, mission state, anomalies and affected assets.', tools:['query_alerts','query_convoys','query_vehicles'] },
  { id:'security', name:'SECURITY INTELLIGENCE', focus:'Threats, hostile activity, security posture, escalation and life safety.', tools:['query_alerts','query_risk_zones','query_convoys'] },
  { id:'route', name:'ROUTE & MOBILITY', focus:'Route feasibility, delays, road closures, corridor deviations and alternatives.', tools:['query_convoys','get_road_conditions','query_risk_zones','get_weather'] },
  { id:'fleet', name:'FLEET & ASSET', focus:'Vehicle health, telemetry freshness, fuel, driver and mechanical exposure.', tools:['query_vehicles','query_alerts'] },
  { id:'environment', name:'ENVIRONMENTAL', focus:'Weather, flooding, visibility and environmental effects on trafficability.', tools:['get_weather','get_road_conditions'] },
  { id:'risk', name:'RISK INTELLIGENCE', focus:'Likelihood, severity, risk concentration, cascade effects and exposure.', tools:['query_risk_zones','query_alerts','query_convoys'] },
  { id:'compliance', name:'COMPLIANCE & POLICY', focus:'Policy, approvals, duty of care, contractual constraints and data governance.', tools:['query_convoys','query_alerts'] },
  { id:'commercial', name:'COMMERCIAL & SLA', focus:'Customer SLA, schedule, cost and revenue implications after safety constraints.', tools:['query_convoys','query_alerts'] },
  { id:'adversary', name:'RED TEAM / ADVERSARY', focus:'Attack the leading interpretation, identify manipulation, spoofing and second-order failure.', tools:['query_alerts','query_risk_zones','query_convoys'] },
  { id:'data-quality', name:'DATA INTEGRITY', focus:'Freshness, completeness, contradictions, missing evidence and provenance quality.', tools:['query_vehicles','query_convoys','query_alerts'] },
];

const TOOL_CATALOG = {
  query_vehicles:{description:'Live vehicles with registration, status, region, fuel, speed, coordinates, driver and last ping.',schema:{type:'object',properties:{status:{type:'string'},region:{type:'string'},low_fuel:{type:'boolean'},moving:{type:'boolean'}}}},
  query_convoys:{description:'Convoys with status, region, priority, origin, destination and timing.',schema:{type:'object',properties:{status:{type:'string'},region:{type:'string'},priority:{type:'string'}}}},
  query_alerts:{description:'Open or historical operational alerts with severity, type, vehicle and timestamps.',schema:{type:'object',properties:{severity:{type:'string'},type:{type:'string'},include_resolved:{type:'boolean'}}}},
  get_weather:{description:'Current conditions and short forecast at a place.',schema:{type:'object',properties:{location:{type:'string'}},required:['location']}},
  check_holidays:{description:'Public holidays for a country/year.',schema:{type:'object',properties:{country_code:{type:'string'},year:{type:'number'}},required:['country_code']}},
  get_road_conditions:{description:'Road closures, barriers, construction and weather context near a place.',schema:{type:'object',properties:{location:{type:'string'},radius_km:{type:'number'}},required:['location']}},
  query_risk_zones:{description:'Internal active risk zones.',schema:{type:'object',properties:{region:{type:'string'},risk_level:{type:'string'},zone_type:{type:'string'}}}},
  get_world_context:{description:'Canonical tenant-scoped spatial context for mission, route, vehicle, incident, traffic, hazards, security, movement, coverage, freshness and provenance.',schema:{type:'object',properties:{subject:{type:'object'},center:{type:'object'},radiusM:{type:'number'},bbox:{type:'array'},maxEntitiesPerLayer:{type:'number'},layers:{type:'array'}}}},
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

function planEvidence(command,history){
  const probes=[];
  const lc=String(command||'').toLowerCase();
  const add=(tool,input={})=>{
    if(!TOOL_CATALOG[tool])return;
    const key=tool+JSON.stringify(input);
    if(!probes.some(p=>p.tool+JSON.stringify(p.input)===key))probes.push({tool,input});
  };
  const locations=inferLocations(command);

  if(/vehicle|truck|fleet|driver|fuel|speed|offline|telemetry|location|maintenance|overdue|service|inspection|breakdown|mechanical/.test(lc)) add('query_vehicles',{});
  if(/convoy|mission|eta|departure|arrival|shipment|movement|corridor/.test(lc)) add('query_convoys',{});
  if(/alert|incident|anomaly|security|warning|panic|emergency|breach/.test(lc)) add('query_alerts',{});
  if(/weather|rain|storm|wind|flood|visibility|heat|temperature/.test(lc)) add('get_weather',{});
  if(/holiday|border|closure|public holiday|crossing/.test(lc)) add('check_holidays',{});
  if(/road|closure|construction|traffic|route|barrier|detour|mobility/.test(lc)) add('get_road_conditions',{});
  if(/risk|danger|hotspot|bandit|conflict|strike|roadblock|security|threat|exposure/.test(lc)) add('query_risk_zones',{});
  if(/world|spatial|satellite|cctv|camera|aircraft|maritime|ais|hazard|traffic|geofence|map|position|where is|around /.test(lc)) add('get_world_context',{subject:{kind:'none',id:'context'}});

  for(const loc of locations.slice(0,2)){
    if(/weather|rain|storm|wind|flood|visibility|heat|temperature|trafficability/.test(lc)) add('get_weather',{location:loc});
    if(/road|closure|construction|traffic|route|barrier|detour|mobility/.test(lc)) add('get_road_conditions',{location:loc,radius_km:50});
  }

  if(!probes.length && /(what|which|why|how|show|summarize|analyse|analyze|check|tell|current|live|now|active|status|decision)/i.test(String(command||''))){
    add('query_alerts',{});
    add('query_convoys',{});
    add('query_vehicles',{});
  }
  return probes.slice(0,10);
}
async function collectToolEvidence(probes,executeTool,context){
  const evidence={},failures=[];
  await Promise.all(probes.map(async p=>{
    try{
      const key=p.tool+JSON.stringify(p.input);
      const value=await executeTool(p.tool,p.input,context);
      evidence[key]=value;
      if(value&&typeof value==='object'&&value.error) failures.push({tool:p.tool,input:p.input,error:String(value.error)});
    }catch(e){failures.push({tool:p.tool,input:p.input,error:e?.message||String(e)});}
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
    'Synthesize the live evidence and evidence-lane findings below.',
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
  const review=safety.hard_stop||!critic.pass||(critic.critical_issues||[]).length>0||conf<0.65||(health.failed>0&&health.success_rate<0.5);
  return {
    ...draft,
    confidence:Number(conf.toFixed(2)),
    risk_level:safety.level==='CRITICAL'?'CRITICAL':draft.risk_level,
    decision: safety.hard_stop?'HUMAN_REVIEW_REQUIRED':review?'APPROVAL_REQUIRED':draft.decision,
    recommended_actions:(draft.recommended_actions||[]).map(a=>review?{...a,approval:'human'}:a),
    assurance:{safety_gate:safety.hard_stop?'TRIGGERED':'CLEAR',deterministic_safety:safety,red_team:critic,decision_gate:review?'HUMAN':'AI_ADVISORY',evidence_health:health},
  };
}

function deterministicEvidenceLanes(evidence,health){
  const keys=Object.keys(evidence);
  const has=(tool)=>keys.some(k=>k.startsWith(tool));
  const count=(tool,path)=>Object.entries(evidence).filter(([k])=>k.startsWith(tool)).reduce((n,[,v])=>n+(Array.isArray(v?.[path])?v[path].length:0),0);
  const lane=(id,name,tools)=>{
    const present=tools.filter(has);
    const status=present.length?((health.failed===0||health.success_rate>=0.5)?'supported':'uncertain'):'blocked';
    const confidence=present.length?Number(Math.max(0.2,Math.min(0.95,health.success_rate||0.2)).toFixed(2)):0;
    const facts=[];
    if(id==='situation'){ facts.push(count('query_vehicles','vehicles')+' vehicle records',count('query_convoys','convoys')+' convoy records',count('query_alerts','alerts')+' alert records'); }
    if(id==='security'){ facts.push(count('query_alerts','alerts')+' alert records',count('query_risk_zones','risk_zones')+' risk-zone records'); }
    if(id==='route'){ facts.push((has('get_road_conditions')?'road evidence':'no road evidence'),(has('get_weather')?'weather evidence':'no weather evidence')); }
    if(id==='fleet'){ facts.push(count('query_vehicles','vehicles')+' vehicle records'); }
    if(id==='environment'){ facts.push((has('get_weather')?'weather evidence':'no weather evidence')); }
    if(id==='risk'){ facts.push(count('query_risk_zones','risk_zones')+' risk-zone records',count('query_alerts','alerts')+' alert records'); }
    if(id==='data-quality'){ facts.push(health.succeeded+'/'+health.probes+' evidence probes succeeded'); }
    return {id,name,status,confidence,provider:'deterministic-evidence',finding:'Evidence lane derived from live Sonalit tool results; this is not an independent model opinion.',dissent:'',tools:present,provenance:facts};
  };
  return [
    lane('situation','SITUATION INTELLIGENCE',['query_vehicles','query_convoys','query_alerts']),
    lane('security','SECURITY INTELLIGENCE',['query_alerts','query_risk_zones']),
    lane('route','ROUTE & MOBILITY',['query_convoys','get_road_conditions','get_weather']),
    lane('fleet','FLEET & ASSET',['query_vehicles','query_alerts']),
    lane('environment','ENVIRONMENTAL',['get_weather','get_road_conditions']),
    lane('risk','RISK INTELLIGENCE',['query_risk_zones','query_alerts']),
    lane('data-quality','DATA INTEGRITY',['query_vehicles','query_convoys','query_alerts','get_world_context']),
  ].filter(x=>x.status!=='blocked');
}

function deterministicNarrative(command,evidence,health,safety){
  const all=Object.values(evidence);
  const vehicles=all.flatMap(v=>Array.isArray(v?.vehicles)?v.vehicles:[]);
  const convoys=all.flatMap(v=>Array.isArray(v?.convoys)?v.convoys:[]);
  const alerts=all.flatMap(v=>Array.isArray(v?.alerts)?v.alerts:[]);
  const zones=all.flatMap(v=>Array.isArray(v?.risk_zones)?v.risk_zones:[]);
  const errors=all.filter(v=>v&&typeof v==='object'&&v.error).map(v=>String(v.error));
  const criticalAlerts=alerts.filter(a=>String(a.severity).toLowerCase()==='critical').length;
  const highAlerts=alerts.filter(a=>String(a.severity).toLowerCase()==='high').length;
  const criticalZones=zones.filter(z=>String(z.risk_level).toLowerCase()==='critical').length;
  const offline=vehicles.filter(v=>String(v.status).toLowerCase()==='offline').length;
  const lowFuel=vehicles.filter(v=>Number(v.fuel_level)<25).length;
  const activeConvoys=convoys.filter(c=>String(c.status).toLowerCase()==='active').length;
  const lines=[
    'Live evidence was reconciled without model-generated operational facts.',
    'Evidence health: '+health.succeeded+'/'+health.probes+' probes succeeded'+(health.failed?' ('+health.failed+' failed).':'.'),
  ];
  if(vehicles.length) lines.push('Fleet: '+vehicles.length+' records; '+offline+' offline; '+lowFuel+' below 25% fuel.');
  if(convoys.length) lines.push('Convoys: '+convoys.length+' records; '+activeConvoys+' active.');
  if(alerts.length) lines.push('Alerts: '+alerts.length+' records; '+criticalAlerts+' critical; '+highAlerts+' high.');
  if(zones.length) lines.push('Risk zones: '+zones.length+' records; '+criticalZones+' critical.');
  if(errors.length) lines.push('Evidence service errors: '+errors.slice(0,3).join(' | '));
  else if(!vehicles.length&&!convoys.length&&!alerts.length&&!zones.length&&all.length) lines.push('The requested live tools returned no matching fleet/convoy/alert/risk records.');
  if(!all.length) lines.push('No live evidence was available for this request.');
  const decision=safety.hard_stop?'HUMAN_REVIEW_REQUIRED':(health.failed||!all.length?'APPROVAL_REQUIRED':'MONITOR');
  lines.push('Decision: '+decision+'. Risk posture: '+safety.level+'.');
  if(criticalAlerts||criticalZones) lines.push('Safety gate is triggered because critical evidence is present; do not rely on an automated action.');
  else if(offline||lowFuel||highAlerts) lines.push('Operational exposure detected; verify the affected assets before changing schedule or route.');
  if(command) lines.push('Request: '+String(command).trim().slice(0,500));
  return lines.join('\n');
}

async function runDecisionFabric({command,history=[],executeTool,userId,orgId,persistDecision}){
  const started=Date.now();
  const probes=planEvidence(command,history);
  const collected=await collectToolEvidence(probes,executeTool,{userId,orgId});
  const safety=deterministicSafetyAssessment(collected.evidence);
  const health=evidenceHealth(collected.evidence,collected.failures);
  const lanes=deterministicEvidenceLanes(collected.evidence,health);
  let draft=null;
  let provider='deterministic-evidence-fallback';
  const ready=typeof aiClient.hasReadyProvider==='function' && aiClient.hasReadyProvider({dataClassification:'internal',allowFreeProviders:false});
  if(ready){
    try{
      draft=await arbitrate(command,collected.evidence,lanes,history,safety);
      provider=draft.provider||provider;
    }catch(e){
      logger.warn('Copilot synthesis fallback: '+e.message);
    }
  }
  if(!draft){
    draft={answer:deterministicNarrative(command,collected.evidence,health,safety),decision:safety.hard_stop?'HUMAN_REVIEW_REQUIRED':(health.failed?'APPROVAL_REQUIRED':'MONITOR'),risk_level:safety.level,confidence:Number(Math.max(0.2,Math.min(0.95,health.success_rate||0.2)).toFixed(2)),recommended_actions:[],risks:safety.reasons.map(x=>({risk:x.code,severity:String(x.code).includes('CRITICAL')?'critical':String(x.code).includes('HIGH')?'high':'medium'})),evidence:Object.keys(collected.evidence),missing_data:collected.failures.map(x=>x.tool),dissent:[],next_check:'Re-run when missing evidence sources recover.',provider};
  }
  let critic={pass:true,critical_issues:[],corrections:[],confidence_adjustment:0};
  const needsCritique=safety.level==='CRITICAL'||safety.level==='HIGH'||/\b(execute|approve|dispatch|reroute|stop|abort|override|recommend)\b/i.test(String(command));
  if(ready&&needsCritique){ critic=await critique(command,draft,collected.evidence,lanes); }
  const final=finalize(draft,critic,safety,health);
  final.answer=final.answer||deterministicNarrative(command,collected.evidence,health,safety);
  final.swarm=lanes;
  final.meta={...(final.meta||{}),latency_ms:Date.now()-started,probe_plan:probes,agent_count:lanes.length,agent_failures:lanes.filter(a=>a.status==='blocked').length,provider_fallback_available:aiClient.hasReadyProvider?.({dataClassification:'internal',allowFreeProviders:false})||false,persisted:false,degraded:provider==='deterministic-evidence-fallback'};
  if(persistDecision){
    try{const decisionId=await persistDecision({orgId,userId,command,result:final});final.id=decisionId;final.meta.persisted=true;}catch(e){logger.warn('Copilot decision persistence failed: '+e.message);}
  }
  return final;
}
module.exports={AGENTS,TOOL_CATALOG,runDecisionFabric};
