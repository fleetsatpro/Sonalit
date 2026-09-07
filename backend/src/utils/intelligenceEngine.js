// Loading the assessment engine activates the Collection Fabric exactly once per process.
// This keeps collection startup independent from the legacy Risk OSINT sweep while
// remaining part of the admin-only Intelligence Centre backend.
require('./intelligenceCollection');

const SEVERITY_RANK = { informational: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function severityFromScore(score) {
  const s = clamp(score);
  if (s >= 85) return 'critical';
  if (s >= 65) return 'high';
  if (s >= 40) return 'moderate';
  if (s >= 15) return 'low';
  return 'informational';
}

function weightedConfidence(observations = []) {
  if (!observations.length) return 0;
  const independent = new Map();
  for (const o of observations) {
    const source = o.source_id || o.source || `observation:${o.id}`;
    const score = clamp((Number(o.reliability ?? 50) * 0.45) + (Number(o.credibility ?? 50) * 0.45) + ((100 - Number(o.manipulation_score || 0)) * 0.10));
    independent.set(source, Math.max(independent.get(source) || 0, score));
  }
  const values = [...independent.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const diversityBonus = Math.min(18, Math.max(0, values.length - 1) * 4.5);
  return Math.round(clamp(mean + diversityBonus));
}

function riskVelocity(currentCount, previousCount, intervalHours = 24) {
  const current = Math.max(0, Number(currentCount) || 0);
  const previous = Math.max(0, Number(previousCount) || 0);
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * (24 / Math.max(1, intervalHours)) * 100) / 100;
}

function trajectory(velocity) {
  const v = Number(velocity) || 0;
  if (v >= 15) return 'rapidly_rising';
  if (v >= 4) return 'rising';
  if (v <= -15) return 'rapidly_falling';
  if (v <= -4) return 'falling';
  return Math.abs(v) < 1 ? 'stable' : 'volatile';
}

function fuseSeverity(events = []) {
  if (!events.length) return 'informational';
  const weighted = events.reduce((sum, e) => {
    const severity = SEVERITY_RANK[e.severity] ?? 0;
    const confidence = clamp(e.confidence ?? 50) / 100;
    return sum + severity * (0.55 + confidence * 0.45);
  }, 0) / events.length;
  return severityFromScore(weighted * 25);
}

function contradictionRate(observations = []) {
  if (!observations.length) return 0;
  return Math.round((observations.filter(o => o.relationship === 'contradicts').length / observations.length) * 100);
}

function buildAssessment({ scope, events = [], observations = [], exposure = null }) {
  const confidence = weightedConfidence(observations);
  const severity = fuseSeverity(events);
  const current = events.length;
  const previous = events.filter(e => Date.now() - new Date(e.last_seen_at || e.occurred_at || 0).getTime() > 24 * 3600 * 1000).length;
  const velocity = riskVelocity(current, previous || Math.max(1, current), 24);
  return { scope, severity, confidence, velocity, trajectory: trajectory(velocity), contradiction_rate: contradictionRate(observations), event_count: current, operational_exposure: exposure, evidence_count: observations.length, generated_at: new Date().toISOString() };
}

module.exports = { clamp, severityFromScore, weightedConfidence, riskVelocity, trajectory, fuseSeverity, contradictionRate, buildAssessment };
