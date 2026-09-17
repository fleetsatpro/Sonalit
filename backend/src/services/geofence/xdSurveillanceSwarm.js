'use strict';

const aiClient = require('../../utils/aiClient');
const logger = require('../../utils/logger');

const AGENTS = [
  ['spatial-fusion','SPACE','Spatial Fusion','Validate positional coherence, route geometry and entity placement.'],
  ['temporal-reconstructor','TIME','Temporal Reconstructor','Explain chronology, freshness, gaps and sequence consistency.'],
  ['entity-resolver','IDENTITY','Entity Resolver','Correlate device, vehicle, officer, convoy, client and mission identities.'],
  ['motion-analyst','MOTION','Motion Analyst','Inspect speed, heading, progress, deviation, stops and movement continuity.'],
  ['source-integrity','INTEGRITY','Source Integrity','Assess source freshness, provenance, conflicts, stale state and confidence.'],
  ['anomaly-challenger','INTEGRITY','Anomaly Challenger','Attempt to falsify suspicious observations and distinguish anomaly from benign explanation.'],
  ['security-correlator','SECURITY','Security Correlator','Correlate route, risk overlays, incidents and operational security exposure.'],
  ['risk-exposure','SECURITY','Risk Exposure','Measure exposure concentration, duration and proximity to known risk.'],
  ['checkpoint-watch','SECURITY','Checkpoint Watch','Assess checkpoint sequencing, expected passage windows and missing checkpoint evidence.'],
  ['elock-watch','SECURITY','E-Lock Watch','Assess e-lock integrity and custody transitions when evidence is present.'],
  ['evidence-auditor','EVIDENCE','Evidence Auditor','Identify evidence supporting or missing from material world-state claims.'],
  ['telemetry-auditor','EVIDENCE','Telemetry Auditor','Inspect telemetry cadence, gaps and source continuity.'],
  ['route-sentinel','SPACE','Route Sentinel','Challenge corridor adherence and identify route-level anomalies.'],
  ['fleet-health','MOTION','Fleet Health','Identify operational concerns visible from vehicle state and movement evidence.'],
  ['client-context','IDENTITY','Client Context','Keep convoy and cargo-client ownership/context attached to each world observation.'],
  ['trajectory-forecaster','FUTURE','Trajectory Forecaster','Generate bounded forward-looking possibilities from observed evidence only.'],
  ['scenario-lab','FUTURE','Scenario Lab','Explore explicit what-if scenarios without presenting them as observations.'],
  ['red-team','INTEGRITY','Red Team','Attack the strongest interpretation and surface hidden assumptions or unsupported certainty.'],
  ['swarm-arbiter','FUTURE','Swarm Arbiter','Synthesize specialist findings while preserving disagreements and evidence gaps.'],
];

function clip(value, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

async function runAgent(agent, snapshot) {
  const [id, dimension, name, mission] = agent;
  try {
    const response = await aiClient.createMessage({
      max_tokens: 1100,
      messages: [{
        role: 'user',
        content: [
          'SONALIT XD LIVE SURVEILLANCE specialist task.',
          `AGENT: ${name}`,
          `DIMENSION: ${dimension}`,
          `MISSION: ${mission}`,
          'Use ONLY the supplied canonical snapshot. Never invent coordinates, incidents, identities, timestamps, risks, e-lock states or outcomes.',
          'Separate observation from inference. Treat expected/forecast/scenario as non-observed. Do not issue irreversible actions.',
          'Return JSON only:',
          '{"status":"nominal|watch|alert|degraded|blocked","finding":"...","facts":[],"inferences":[],"risks":[],"evidence_gaps":[],"confidence":0,"recommended_followup":"..."}',
          'CANONICAL SNAPSHOT:',
          clip(snapshot, 14000),
        ].join('\n\n'),
      }],
    });
    const text = (response.content || []).filter(x => x?.type === 'text').map(x => x.text).join('\n').trim();
    const parsed = parseJson(text) || {
      status: 'degraded', finding: text || 'No structured finding', facts: [], inferences: [], risks: [], evidence_gaps: ['Unstructured output'], confidence: 0, recommended_followup: 'Review raw specialist output',
    };
    return { id, dimension, name, mission, provider: response._provider || 'unknown', ...parsed };
  } catch (error) {
    logger.warn(`XD specialist failed: ${id}: ${error?.message || error}`);
    return { id, dimension, name, mission, provider: 'unavailable', status: 'degraded', finding: 'Specialist unavailable', facts: [], inferences: [], risks: [], evidence_gaps: [error?.message || String(error)], confidence: 0, recommended_followup: 'Use deterministic world-state evidence' };
  }
}

async function arbitrate(snapshot, specialists) {
  try {
    const response = await aiClient.createMessage({
      max_tokens: 1600,
      messages: [{
        role: 'user',
        content: [
          'You are the senior arbiter for SONALIT XD LIVE SURVEILLANCE.',
          'Synthesize the independent specialist findings below against the canonical snapshot.',
          'Never convert inference into fact. Preserve disagreement. Do not override deterministic telemetry or geospatial truth.',
          'Return JSON only:',
          '{"posture":"NOMINAL|WATCH|ELEVATED|CRITICAL|INSUFFICIENT_EVIDENCE","summary":"...","material_findings":[],"material_gaps":[],"confidence":0,"next_review":"...","dissent":[]}',
          'CANONICAL SNAPSHOT:', clip(snapshot, 14000),
          'SPECIALISTS:', clip(specialists.map(s => ({ id: s.id, dimension: s.dimension, status: s.status, finding: s.finding, risks: s.risks, confidence: s.confidence, gaps: s.evidence_gaps, provider: s.provider })), 22000),
        ].join('\n\n'),
      }],
    });
    const text = (response.content || []).filter(x => x?.type === 'text').map(x => x.text).join('\n').trim();
    return { ...(parseJson(text) || { posture: 'INSUFFICIENT_EVIDENCE', summary: 'Arbiter returned no structured synthesis', material_findings: [], material_gaps: ['Invalid arbiter output'], confidence: 0, next_review: 'Review canonical world state', dissent: [] }), provider: response._provider || 'unknown' };
  } catch (error) {
    return { posture: 'INSUFFICIENT_EVIDENCE', summary: 'Arbiter unavailable; specialist evidence remains inspectable', material_findings: [], material_gaps: [error?.message || String(error)], confidence: 0, next_review: 'Review deterministic world state', dissent: [], provider: 'unavailable' };
  }
}

async function runXdSurveillanceSwarm(snapshot) {
  const specialists = [];
  for (let i = 0; i < AGENTS.length; i += 6) {
    const batch = AGENTS.slice(i, i + 6);
    const results = await Promise.all(batch.map(agent => runAgent(agent, snapshot)));
    specialists.push(...results);
  }
  const arbiter = await arbitrate(snapshot, specialists);
  return {
    version: 'xd-swarm-v1',
    generated_at: new Date().toISOString(),
    provider_fabric: aiClient.providerCapabilities(),
    agents: specialists,
    arbiter,
  };
}

module.exports = { AGENTS, runXdSurveillanceSwarm };
