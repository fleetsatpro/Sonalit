/**
 * SONALIT DECISION INTELLIGENCE FABRIC
 *
 * One cognitive surface for conversational copilot + operational decisioning.
 * The model is not the product: orchestration, evidence, dissent, safety gates
 * and graceful degradation are.
 */
const aiClient = require('../utils/aiClient');
const logger = require('../utils/logger');

const AGENTS = [
  { id: 'situation', name: 'SITUATION INTELLIGENCE', focus: 'Current operational state, anomalies, chronology, affected assets and immediate operational picture.' },
  { id: 'security', name: 'SECURITY INTELLIGENCE', focus: 'Physical security, hostile activity, route threats, convoy protection, escalation triggers and life-safety.' },
  { id: 'route', name: 'ROUTE & MOBILITY', focus: 'Route feasibility, delay exposure, road conditions, geofences, rerouting trade-offs and time windows.' },
  { id: 'fleet', name: 'FLEET & ASSET', focus: 'Vehicle condition, fuel, telemetry freshness, driver/asset availability and maintenance implications.' },
  { id: 'weather', name: 'ENVIRONMENTAL', focus: 'Weather and environmental hazards, trafficability and forecast uncertainty.' },
  { id: 'risk', name: 'RISK INTELLIGENCE', focus: 'Probability/severity, cascading risk, emerging signals and risk concentration across the network.' },
  { id: 'compliance', name: 'COMPLIANCE & POLICY', focus: 'Regulatory, contractual, policy, duty-of-care and approval constraints. Prefer abstention when jurisdiction is uncertain.' },
  { id: 'commercial', name: 'COMMERCIAL & FINANCIAL', focus: 'Customer SLA, cost, margin, revenue protection and financial consequences without overriding safety.' },
  { id: 'adversary', name: 'RED TEAM / ADVERSARY', focus: 'How the proposed interpretation or action could fail, be manipulated, spoofed, exploited or create second-order harm.' },
  { id: 'data-quality', name: 'DATA INTEGRITY', focus: 'Freshness, completeness, conflicts, source reliability, stale signals and missing evidence.' },
];

const TOOL_CATALOG = [
  { name: 'query_vehicles', when: 'fleet, vehicle, fuel, driver, offline, speed, location, asset status' },
  { name: 'query_convoys', when: 'convoy, mission, route, ETA, status, priority' },
  { name: 'query_alerts', when: 'alert, incident, anomaly, security, speed, geofence' },
  { name: 'get_weather', when: 'weather, storm, rain, wind, visibility, flooding, forecast' },
  { name: 'check_holidays', when: 'holiday, border timing, staffing, public closure, customs timing' },
  { name: 'get_road_conditions', when: 'road, closure, construction, barrier, trafficability' },
  { name: 'query_risk_zones', when: 'risk area, hotspot, banditry, conflict, strike, dangerous corridor' },
];

function clip(value, max = 7000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\```json|\```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

async function ask(modelPrompt, maxTokens = 1800) {
  const response = await aiClient.createMessage({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: [{
      type: 'text',
      text: [
        'You are one node in SONALIT Decision Intelligence Fabric.',
        'Never invent telemetry, locations, incidents, regulations, people, dates or tool results.',
        'Separate FACTS from INFERENCE. When evidence is missing, say so.',
        'Human life and safety outrank delivery time, cost, revenue and customer preference.',
        'Return valid JSON only. No markdown fences.',
      ].join('\n'),
    }],
    messages: [{ role: 'user', content: modelPrompt }],
  }, { allowFallback: true });
  const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { provider: response._provider || 'unknown', text, json: extractJSON(text) };
}

async function chooseEvidence(command, history) {
  const keyword = String(command).toLowerCase();
  const lexical = [];
  for (const item of TOOL_CATALOG) {
    if (item.when.split(',').some(k => keyword.includes(k.trim()))) lexical.push(item.name);
  }

  let planned = null;
  try {
    const r = await ask([
      'Select the minimum live-data probes required to answer the operator request accurately.',
      'Return JSON: {"tools":["..."],"reason":"...","need_live_data":true|false}.',
      'Allowed tools:', JSON.stringify(TOOL_CATALOG),
      'Operator request:', clip(command, 3000),
      'Recent conversation:', clip(history, 2500),
    ].join('\n\n'), 900);
    planned = r.json;
  } catch (_) {}

  const tools = new Set(lexical);
  if (planned?.need_live_data !== false) {
    for (const t of planned?.tools || []) if (TOOL_CATALOG.some(x => x.name === t)) tools.add(t);
  }
  if (tools.size === 0 && /(now|current|live|today|active|status|where|risk|safe|alert)/i.test(command)) {
    tools.add('query_alerts');
    tools.add('query_convoys');
  }
  return [...tools];
}

async function collectEvidence(command, history, executeTool, userId) {
  const toolNames = await chooseEvidence(command, history);
  const evidence = {};
  const failures = [];

  await Promise.all(toolNames.map(async name => {
    try {
      const result = await executeTool(name, {}, userId);
      evidence[name] = result;
    } catch (err) {
      failures.push({ tool: name, error: err.message });
    }
  }));

  return { evidence, toolNames, failures };
}

async function runSpecialist(agent, command, evidence, history) {
  const prompt = [
    'ROLE:', agent.name,
    'SPECIALTY:', agent.focus,
    'TASK: Analyse the operator request independently. Challenge assumptions.',
    'OUTPUT SCHEMA:',
    '{',
    '  "status":"supported|uncertain|blocked",',
    '  "finding":"...",',
    '  "facts":["..."],',
    '  "inferences":["..."],',
    '  "risks":[{"risk":"...","severity":"low|medium|high|critical"}],',
    '  "recommended_actions":[{"action":"...","urgency":"now|soon|monitor","approval":"none|human"}],',
    '  "confidence":0-1,',
    '  "evidence_gaps":["..."],',
    '  "dissent":"..."',
    '}',
    'IMPORTANT: If evidence does not support a conclusion, do not manufacture one.',
    'OPERATOR REQUEST:', clip(command, 4500),
    'EVIDENCE:', clip(evidence, 12000),
    'RECENT HISTORY:', clip(history, 3000),
  ].join('\n');
  try {
    const r = await ask(prompt, 1700);
    return { ...agent, provider: r.provider, ...(r.json || {
      status: 'uncertain', finding: r.text || 'No structured finding returned.',
      facts: [], inferences: [], risks: [], recommended_actions: [],
      confidence: 0.25, evidence_gaps: ['Agent returned unstructured output.'], dissent: '',
    }) };
  } catch (err) {
    return {
      ...agent, provider: 'failed', status: 'blocked', finding: 'Agent unavailable.',
      facts: [], inferences: [], risks: [], recommended_actions: [],
      confidence: 0, evidence_gaps: [err.message], dissent: 'Unavailable agent.',
    };
  }
}

function deterministicSafetyGate(packet) {
  const text = JSON.stringify(packet).toLowerCase();
  const hardStopTerms = [
    'hijack', 'kidnap', 'armed attack', 'life threat', 'life-threatening',
    'vehicle brake failure', 'brake failure', 'fire', 'explosion',
    'cargo hazard', 'fatality', 'medical emergency', 'weapon',
  ];
  return hardStopTerms.some(term => text.includes(term));
}

function degradedSynthesis(command, evidence, specialists, failures) {
  const usable = specialists.filter(a => a.status !== 'blocked');
  const risks = usable.flatMap(a => a.risks || []).sort((a, b) => {
    const rank = { critical: 4, high: 3, medium: 2, low: 1 };
    return (rank[b.severity] || 0) - (rank[a.severity] || 0);
  }).slice(0, 6);
  const actions = usable.flatMap(a => a.recommended_actions || []).slice(0, 6);
  const maxConf = usable.length ? Math.min(...usable.map(a => Number(a.confidence || 0.2))) : 0;
  const blocked = failures.length || usable.length < 3;
  return {
    answer: blocked
      ? 'Decision intelligence is operating in degraded mode. Live evidence or reasoning capacity is incomplete; no irreversible action should be taken on AI output alone.'
      : 'No arbitration model was available. Showing the independent agent findings without claiming a final decision.',
    decision: blocked ? 'HUMAN_REVIEW_REQUIRED' : 'ADVISORY_ONLY',
    risk_level: risks.some(r => r.severity === 'critical') ? 'CRITICAL' : risks.some(r => r.severity === 'high') ? 'HIGH' : 'MEDIUM',
    confidence: Math.round(maxConf * 100) / 100,
    recommended_actions: actions,
    risks,
    dissent: usable.map(a => a.dissent).filter(Boolean).slice(0, 5),
    missing_data: [...new Set(failures.map(x => x.tool + ': ' + x.error))],
    agents_used: usable.map(a => a.id),
    degraded: true,
  };
}

async function arbitrate(command, evidence, specialists, history) {
  const compact = specialists.map(a => ({
    agent: a.id, status: a.status, finding: a.finding, facts: a.facts,
    inferences: a.inferences, risks: a.risks,
    recommended_actions: a.recommended_actions, confidence: a.confidence,
    gaps: a.evidence_gaps, dissent: a.dissent,
  }));
  const r = await ask([
    'You are the SENIOR ARBITER for Sonalit Decision Intelligence.',
    'Synthesize the specialist swarm. Do not average confidence blindly.',
    'Reward independent agreement and corroborated evidence; penalize unsupported inference and stale/conflicting evidence.',
    'Safety is an absolute override. Never recommend a safety-compromising action for cost or SLA.',
    'Output JSON only using:',
    '{"answer":"...","decision":"ACT_NOW|APPROVAL_REQUIRED|MONITOR|HUMAN_REVIEW_REQUIRED|NO_ACTION",',
    '"risk_level":"LOW|MEDIUM|HIGH|CRITICAL","confidence":0-1,',
    '"recommended_actions":[{"action":"...","reason":"...","approval":"none|human","urgency":"now|soon|monitor"}],',
    '"risks":[{"risk":"...","severity":"low|medium|high|critical"}],',
    '"evidence":["..."],"missing_data":["..."],"dissent":["..."],',
    '"next_check":"..."}',
    'Never fabricate a fact missing from evidence.',
    'OPERATOR:', clip(command, 4500),
    'EVIDENCE:', clip(evidence, 14000),
    'SPECIALISTS:', clip(compact, 18000),
    'HISTORY:', clip(history, 3000),
  ].join('\n\n'), 2400);
  if (!r.json) throw new Error('Arbiter returned invalid structured output');
  return r.json;
}

async function critique(command, draft, evidence, specialists) {
  const r = await ask([
    'You are SONALIT ADVERSARIAL REVIEW.',
    'Attack the proposed decision. Look for hallucinated facts, unsafe actions, missing evidence, conflicting signals, weak confidence, false precision, and irreversible actions without approval.',
    'Return JSON: {"pass":true|false,"critical_issues":["..."],"corrections":["..."],"confidence_adjustment":-1..1}.',
    'REQUEST:', clip(command, 3500),
    'DRAFT:', clip(draft, 9000),
    'EVIDENCE:', clip(evidence, 10000),
    'SPECIALISTS:', clip(specialists, 11000),
  ].join('\n\n'), 1300);
  return r.json || { pass: false, critical_issues: ['Critic failed to return structured output.'], corrections: [], confidence_adjustment: -0.25 };
}

async function finalize(draft, critiqueResult, hardSafetyStop) {
  const confidence = Math.max(0, Math.min(1, Number(draft.confidence || 0.4) + Number(critiqueResult.confidence_adjustment || 0)));
  const hardIssues = critiqueResult.critical_issues || [];
  const mustReview = hardSafetyStop || !critiqueResult.pass || hardIssues.length > 0 || confidence < 0.70;
  return {
    ...draft,
    confidence: Math.round(confidence * 100) / 100,
    decision: mustReview
      ? (hardSafetyStop ? 'HUMAN_REVIEW_REQUIRED' : 'APPROVAL_REQUIRED')
      : draft.decision,
    recommended_actions: mustReview
      ? (draft.recommended_actions || []).map(a => ({ ...a, approval: 'human' }))
      : (draft.recommended_actions || []),
    assurance: {
      safety_gate: hardSafetyStop ? 'TRIGGERED' : 'CLEAR',
      critic: critiqueResult,
      decision_gate: mustReview ? 'HUMAN' : 'AI_ADVISORY',
    },
  };
}

async function runDecisionFabric({ command, history = [], executeTool, userId }) {
  const started = Date.now();
  const evidencePack = await collectEvidence(command, history, executeTool, userId);
  const settled = await Promise.all(AGENTS.map(agent => runSpecialist(agent, command, evidencePack.evidence, history)));
  const failedAgents = settled.filter(a => a.status === 'blocked').length;

  let draft;
  let arbitrationProvider = 'none';
  if (failedAgents > 7) {
    draft = degradedSynthesis(command, evidencePack.evidence, settled, evidencePack.failures);
  } else {
    try {
      draft = await arbitrate(command, evidencePack.evidence, settled, history);
      arbitrationProvider = 'arbiter';
    } catch (err) {
      logger.warn('Decision fabric arbitration fallback: ' + err.message);
      draft = degradedSynthesis(command, evidencePack.evidence, settled, evidencePack.failures);
    }
  }

  let critiqueResult;
  try {
    critiqueResult = await critique(command, draft, evidencePack.evidence, settled);
  } catch (err) {
    critiqueResult = { pass: false, critical_issues: ['Adversarial reviewer unavailable.'], corrections: [], confidence_adjustment: -0.25 };
  }

  const final = await finalize(draft, critiqueResult, deterministicSafetyGate({ command, draft, evidence: evidencePack.evidence }));
  final.swarm = settled.map(a => ({
    id: a.id,
    name: a.name,
    status: a.status,
    confidence: Number(a.confidence || 0),
    provider: a.provider,
    finding: a.finding,
    dissent: a.dissent,
  }));
  final.meta = {
    latency_ms: Date.now() - started,
    evidence_tools: evidencePack.toolNames,
    evidence_failures: evidencePack.failures,
    agent_count: AGENTS.length,
    agent_failures: failedAgents,
    arbitration_provider: arbitrationProvider,
    model_fallback_available: aiClient.hasGroqFallback(),
  };
  return final;
}

module.exports = {
  AGENTS,
  runDecisionFabric,
};
