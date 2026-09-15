'use strict';

/**
 * 4D World-State Reconciliation Swarm
 *
 * This is deliberately deterministic at the coordinate layer. Each specialist
 * is an independent evidence check; the consensus layer combines their
 * assessments without modifying raw telemetry. LLMs can be added above this
 * fabric later for explanation/investigation, but they are never required to
 * calculate the operational position.
 */

const { haversineKm, projectOntoRoute } = require('./corridor');

const VERSION = 'world-state-swarm-v1';
const MAX_PLAUSIBLE_KPH = Number(process.env.TRACKING_MAX_KPH || 250);

function finite(n) { return Number.isFinite(Number(n)); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function pct(n) { return Math.round(clamp(n, 0, 1) * 100) / 100; }

function motionAgent(ctx) {
  const { previous, observed, elapsedSeconds } = ctx;
  if (!previous || !finite(previous.lat) || !finite(previous.lng)) {
    return { id: 'motion', verdict: 'insufficient_data', score: 0.4, evidence: [] };
  }
  const dt = Math.max(0, Number(elapsedSeconds || 0));
  const km = haversineKm(previous.lat, previous.lng, observed.lat, observed.lng);
  const impliedKph = dt > 0 ? km / (dt / 3600) : Infinity;
  const plausible = impliedKph <= MAX_PLAUSIBLE_KPH;
  return {
    id: 'motion',
    verdict: plausible ? 'consistent' : 'outlier',
    score: plausible ? 0.95 : 0.05,
    evidence: [{ kind: 'implied_speed_kph', value: Number.isFinite(impliedKph) ? Math.round(impliedKph * 10) / 10 : null }],
  };
}

function routeAgent(ctx) {
  const { route, observed, previous } = ctx;
  if (!Array.isArray(route) || route.length < 2) {
    return { id: 'route', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  }
  const obs = projectOntoRoute(route, observed.lat, observed.lng);
  const prev = previous && finite(previous.lat) && finite(previous.lng)
    ? projectOntoRoute(route, previous.lat, previous.lng) : null;

  // The route check is evidence, not a command to snap a genuine deviation.
  const continuityPenalty = prev && obs.alongKm + 5 < prev.alongKm ? 0.35 : 0;
  const onRouteScore = clamp(1 - obs.crossTrackKm / 2, 0, 1);
  const score = clamp(onRouteScore - continuityPenalty, 0, 1);
  return {
    id: 'route',
    verdict: score >= 0.6 ? 'consistent' : 'route_conflict',
    score: pct(score),
    evidence: [{ kind: 'cross_track_km', value: Number(obs.crossTrackKm.toFixed(3)) }, { kind: 'along_km', value: Number(obs.alongKm.toFixed(3)) }],
    projection: obs,
  };
}

function headingAgent(ctx) {
  const { previous, observed } = ctx;
  if (!previous || !finite(previous.lat) || !finite(previous.lng) || !finite(observed.lat) || !finite(observed.lng)) {
    return { id: 'heading', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  }
  const travelledKm = haversineKm(previous.lat, previous.lng, observed.lat, observed.lng);
  if (travelledKm < 0.03 || !finite(previous.heading)) {
    return { id: 'heading', verdict: 'neutral', score: 0.6, evidence: [] };
  }
  const brg = bearingDeg(previous.lat, previous.lng, observed.lat, observed.lng);
  const delta = angularDifference(brg, Number(previous.heading));
  const score = clamp(1 - delta / 120, 0, 1);
  return { id: 'heading', verdict: score >= 0.55 ? 'consistent' : 'direction_conflict', score: pct(score), evidence: [{ kind: 'bearing_delta_deg', value: Math.round(delta * 10) / 10 }] };
}

function sourceQualityAgent(ctx) {
  const accuracy = Number(ctx.observed.accuracy_m);
  const score = !finite(accuracy) ? 0.55 : accuracy <= 25 ? 0.98 : accuracy <= 75 ? 0.9 : accuracy <= 250 ? 0.7 : 0.35;
  return { id: 'source_quality', verdict: score >= 0.6 ? 'usable' : 'degraded', score, evidence: [{ kind: 'accuracy_m', value: finite(accuracy) ? accuracy : null }] };
}

function temporalAgent(ctx) {
  const { observedAt, now } = ctx;
  if (!observedAt) return { id: 'temporal', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const age = Math.max(0, (Number(now) - new Date(observedAt).getTime()) / 1000);
  const score = age <= 30 ? 0.98 : age <= 90 ? 0.85 : age <= 300 ? 0.6 : 0.25;
  return { id: 'temporal', verdict: score >= 0.6 ? 'fresh' : 'stale', score, evidence: [{ kind: 'age_seconds', value: Math.round(age) }] };
}

function challengerAgent(ctx, proposal) {
  if (!ctx.previous || !proposal) return { id: 'challenger', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const gapKm = haversineKm(ctx.previous.lat, ctx.previous.lng, proposal.lat, proposal.lng);
  const dt = Math.max(1, Number(ctx.elapsedSeconds || 1));
  const impliedKph = gapKm / (dt / 3600);
  const score = impliedKph > MAX_PLAUSIBLE_KPH ? 0.05 : 0.9;
  return { id: 'challenger', verdict: score > 0.5 ? 'could_be_valid' : 'reject_proposal', score, evidence: [{ kind: 'challenge_speed_kph', value: Math.round(impliedKph * 10) / 10 }] };
}

function benignExplanationAgent(ctx, agents) {
  const reasons = [];
  if (agents.find(a => a.id === 'motion' && a.verdict === 'outlier')) reasons.push('motion_discontinuity');
  if (agents.find(a => a.id === 'temporal' && a.verdict === 'stale')) reasons.push('stale_source');
  if (agents.find(a => a.id === 'source_quality' && a.verdict === 'degraded')) reasons.push('poor_accuracy');
  return { id: 'benign_explanation', verdict: reasons.length ? 'degradation_plausible' : 'no_known_benign_explanation', score: reasons.length ? 0.75 : 0.5, evidence: reasons.map(kind => ({ kind })) };
}

function bearingDeg(aLat, aLng, bLat, bLng) {
  const p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180;
  const dl = (bLng - aLng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angularDifference(a, b) { const d = Math.abs(((a - b + 180) % 360) - 180); return d; }

function reconcileWorldState({ previous = null, observed, route = null, elapsedSeconds = 0, observedAt = null, now = Date.now() }) {
  if (!observed || !finite(observed.lat) || !finite(observed.lng)) {
    return { version: VERSION, state: 'no_confident_estimate', confidence: 0, estimate: null, agents: [], reason: 'invalid_observation' };
  }

  const ctx = { previous, observed, route, elapsedSeconds, observedAt, now };
  const agents = [motionAgent(ctx), routeAgent(ctx), headingAgent(ctx), sourceQualityAgent(ctx), temporalAgent(ctx)];

  const hardOutlier = agents.some(a => a.id === 'motion' && a.verdict === 'outlier');
  const routeProjection = agents.find(a => a.id === 'route')?.projection;

  // Prefer the previous estimate when a new point is physically impossible.
  // For plausible movement, retain the measured point; route projection is an
  // explanatory signal unless corroborated strongly enough to justify an
  // estimate along the same route segment.
  let estimate = { lat: observed.lat, lng: observed.lng };
  let state = 'observed';
  if (hardOutlier && previous && finite(previous.lat) && finite(previous.lng)) {
    estimate = { lat: previous.lat, lng: previous.lng };
    state = 'outlier_suspected';
  } else if (routeProjection && routeProjection.crossTrackKm <= 2) {
    const t = clamp(0.35, 0, 1);
    estimate = interpolate(previous || observed, routePoint(route, routeProjection), t);
    // Only use a route-aware estimate when the observed point is close enough to
    // the corridor that doing so is a denoising operation, not route enforcement.
    if (previous && haversineKm(estimate.lat, estimate.lng, observed.lat, observed.lng) > 1.5) {
      estimate = { lat: observed.lat, lng: observed.lng };
    } else if (previous && haversineKm(estimate.lat, estimate.lng, observed.lat, observed.lng) > 0.08) {
      state = 'reconciled_estimate';
    }
  }

  const challenger = challengerAgent(ctx, estimate);
  agents.push(challenger);
  agents.push(benignExplanationAgent(ctx, agents));

  const weighted = agents.filter(a => Number.isFinite(a.score)).reduce((sum, a) => sum + a.score, 0);
  const confidence = agents.length ? pct(weighted / agents.length) : 0;
  const uncertainty = state === 'outlier_suspected'
    ? Math.max(Number(observed.accuracy_m || 0), haversineKm(previous.lat, previous.lng, observed.lat, observed.lng) * 500)
    : Number(observed.accuracy_m || 0);

  const supporting = agents.filter(a => a.score >= 0.75).map(a => a.id);
  const contradicting = agents.filter(a => a.score < 0.4).map(a => a.id);

  return {
    version: VERSION,
    state,
    confidence,
    uncertainty_m: Math.round(uncertainty),
    estimate,
    route_projection: routeProjection || null,
    supporting_agents: supporting,
    contradicting_agents: contradicting,
    disagreement: contradicting.length > 0 && supporting.length > 0,
    agents,
    reason: state === 'outlier_suspected'
      ? 'new observation rejected from operational state because motion continuity failed'
      : state === 'reconciled_estimate'
        ? 'position denoised against route geometry and prior trajectory'
        : 'observation consistent enough to remain operational state',
  };
}

function interpolate(a, b, t) {
  return { lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * t, lng: Number(a.lng) + (Number(b.lng) - Number(a.lng)) * t };
}
function routePoint(route, projection) {
  let left = projection.segmentIndex ?? 0;
  if (!route || !route.length) return { lat: projection.lat, lng: projection.lng };
  if (left >= route.length - 1) left = route.length - 2;
  const a = route[left], b = route[left + 1];
  const t = projection.segmentT ?? 0.5;
  return interpolate(a, b, t);
}

module.exports = {
  VERSION,
  motionAgent,
  routeAgent,
  headingAgent,
  sourceQualityAgent,
  temporalAgent,
  challengerAgent,
  benignExplanationAgent,
  reconcileWorldState,
};
