'use strict';

/** Deterministic specialist swarm for continuous 4D world-state reconciliation.
 * Raw telemetry is never edited. The swarm only proposes an operational estimate.
 */
const { haversineKm, projectOntoRoute } = require('./corridor');
const VERSION = 'world-state-swarm-v1';
const MAX_PLAUSIBLE_KPH = Number(process.env.TRACKING_MAX_KPH || 250);
const finite = n => Number.isFinite(Number(n));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pct = n => Math.round(clamp(n, 0, 1) * 100) / 100;

function motionAgent({ previous, observed, elapsedSeconds }) {
  if (!previous || !finite(previous.lat) || !finite(previous.lng)) return { id: 'motion', verdict: 'insufficient_data', score: 0.4, evidence: [] };
  const dt = Math.max(0, Number(elapsedSeconds || 0));
  const km = haversineKm(previous.lat, previous.lng, observed.lat, observed.lng);
  const impliedKph = dt > 0 ? km / (dt / 3600) : Infinity;
  return { id: 'motion', verdict: impliedKph <= MAX_PLAUSIBLE_KPH ? 'consistent' : 'outlier', score: impliedKph <= MAX_PLAUSIBLE_KPH ? 0.95 : 0.05, evidence: [{ kind: 'implied_speed_kph', value: Number.isFinite(impliedKph) ? Math.round(impliedKph * 10) / 10 : null }] };
}

function routePointAtNearest(route, lat, lng) {
  if (!Array.isArray(route) || route.length < 2) return null;
  let best = null;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const x1 = a.lng * Math.cos(meanLat), y1 = a.lat;
    const x2 = b.lng * Math.cos(meanLat), y2 = b.lat;
    const px = lng * Math.cos(meanLat), py = lat;
    const dx = x2 - x1, dy = y2 - y1, denom = dx * dx + dy * dy || 1;
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / denom, 0, 1);
    const pLat = a.lat + (b.lat - a.lat) * t;
    const pLng = a.lng + (b.lng - a.lng) * t;
    const d = haversineKm(lat, lng, pLat, pLng);
    if (!best || d < best.distanceKm) best = { lat: pLat, lng: pLng, distanceKm: d };
  }
  return best;
}

function routeAgent({ route, observed, previous }) {
  if (!Array.isArray(route) || route.length < 2) return { id: 'route', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const obs = projectOntoRoute(route, observed.lat, observed.lng);
  const prev = previous && finite(previous.lat) && finite(previous.lng) ? projectOntoRoute(route, previous.lat, previous.lng) : null;
  const backward = prev && obs.alongKm + 5 < prev.alongKm;
  const score = clamp((1 - obs.crossTrackKm / 2) - (backward ? 0.35 : 0), 0, 1);
  return { id: 'route', verdict: score >= 0.6 ? 'consistent' : 'route_conflict', score: pct(score), evidence: [{ kind: 'cross_track_km', value: Number(obs.crossTrackKm.toFixed(3)) }, { kind: 'along_km', value: Number(obs.alongKm.toFixed(3)) }, { kind: 'backward_progress', value: !!backward }], projection: obs };
}

function headingAgent({ previous, observed }) {
  if (!previous || !finite(previous.lat) || !finite(previous.lng) || !finite(previous.heading)) return { id: 'heading', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const d = haversineKm(previous.lat, previous.lng, observed.lat, observed.lng);
  if (d < 0.03) return { id: 'heading', verdict: 'neutral', score: 0.6, evidence: [] };
  const brg = bearingDeg(previous.lat, previous.lng, observed.lat, observed.lng);
  const delta = Math.abs(((brg - Number(previous.heading) + 180) % 360) - 180);
  const score = clamp(1 - delta / 120, 0, 1);
  return { id: 'heading', verdict: score >= 0.55 ? 'consistent' : 'direction_conflict', score: pct(score), evidence: [{ kind: 'bearing_delta_deg', value: Math.round(delta * 10) / 10 }] };
}

function sourceQualityAgent({ observed }) {
  const accuracy = Number(observed.accuracy_m);
  const score = !finite(accuracy) ? 0.55 : accuracy <= 25 ? 0.98 : accuracy <= 75 ? 0.90 : accuracy <= 250 ? 0.70 : 0.35;
  return { id: 'source_quality', verdict: score >= 0.6 ? 'usable' : 'degraded', score, evidence: [{ kind: 'accuracy_m', value: finite(accuracy) ? accuracy : null }] };
}

function temporalAgent({ observedAt, now }) {
  if (!observedAt) return { id: 'temporal', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const age = Math.max(0, (Number(now) - new Date(observedAt).getTime()) / 1000);
  const score = age <= 30 ? 0.98 : age <= 90 ? 0.85 : age <= 300 ? 0.6 : 0.25;
  return { id: 'temporal', verdict: score >= 0.6 ? 'fresh' : 'stale', score, evidence: [{ kind: 'age_seconds', value: Math.round(age) }] };
}

function challengerAgent({ previous, observed, elapsedSeconds }, proposal) {
  if (!previous || !proposal) return { id: 'challenger', verdict: 'insufficient_data', score: 0.5, evidence: [] };
  const km = haversineKm(previous.lat, previous.lng, proposal.lat, proposal.lng);
  const dt = Math.max(1, Number(elapsedSeconds || 1));
  const kph = km / (dt / 3600);
  return { id: 'challenger', verdict: kph <= MAX_PLAUSIBLE_KPH ? 'could_be_valid' : 'reject_proposal', score: kph <= MAX_PLAUSIBLE_KPH ? 0.9 : 0.05, evidence: [{ kind: 'challenge_speed_kph', value: Math.round(kph * 10) / 10 }] };
}

function benignExplanationAgent({ observed }, agents) {
  const reasons = [];
  if (agents.some(a => a.id === 'motion' && a.verdict === 'outlier')) reasons.push('motion_discontinuity');
  if (agents.some(a => a.id === 'temporal' && a.verdict === 'stale')) reasons.push('stale_source');
  if (agents.some(a => a.id === 'source_quality' && a.verdict === 'degraded')) reasons.push('poor_accuracy');
  return { id: 'benign_explanation', verdict: reasons.length ? 'degradation_plausible' : 'no_known_benign_explanation', score: reasons.length ? 0.75 : 0.5, evidence: reasons.map(kind => ({ kind })) };
}

function bearingDeg(aLat, aLng, bLat, bLng) {
  const p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180, dl = (bLng - aLng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function reconcileWorldState({ previous = null, observed, route = null, elapsedSeconds = 0, observedAt = null, now = Date.now() }) {
  if (!observed || !finite(observed.lat) || !finite(observed.lng)) return { version: VERSION, state: 'no_confident_estimate', confidence: 0, estimate: null, agents: [], reason: 'invalid_observation' };
  const ctx = { previous, observed, route, elapsedSeconds, observedAt, now };
  const agents = [motionAgent(ctx), routeAgent(ctx), headingAgent(ctx), sourceQualityAgent(ctx), temporalAgent(ctx)];
  const hardOutlier = agents.some(a => a.id === 'motion' && a.verdict === 'outlier');
  const projection = agents.find(a => a.id === 'route')?.projection || null;
  let estimate = { lat: observed.lat, lng: observed.lng };
  let state = 'observed';
  if (hardOutlier && previous && finite(previous.lat) && finite(previous.lng)) {
    estimate = { lat: previous.lat, lng: previous.lng };
    state = 'outlier_suspected';
  } else if (projection && projection.crossTrackKm <= 2 && previous && finite(previous.lat) && finite(previous.lng)) {
    const nearest = routePointAtNearest(route, observed.lat, observed.lng);
    if (nearest && nearest.distanceKm >= 0.08 && nearest.distanceKm <= 1.5) {
      const smoothed = { lat: previous.lat + (nearest.lat - previous.lat) * 0.35, lng: previous.lng + (nearest.lng - previous.lng) * 0.35 };
      estimate = smoothed;
      state = 'reconciled_estimate';
    }
  }
  agents.push(challengerAgent(ctx, estimate));
  agents.push(benignExplanationAgent(ctx, agents));
  const confidence = pct(agents.reduce((sum, a) => sum + Number(a.score || 0), 0) / agents.length);
  const uncertainty = state === 'outlier_suspected'
    ? Math.max(Number(observed.accuracy_m || 0), haversineKm(previous.lat, previous.lng, observed.lat, observed.lng) * 500)
    : Number(observed.accuracy_m || 0);
  const supporting = agents.filter(a => a.score >= 0.75).map(a => a.id);
  const contradicting = agents.filter(a => a.score < 0.4).map(a => a.id);
  return {
    version: VERSION, state, confidence, uncertainty_m: Math.round(uncertainty), estimate,
    route_projection: projection, supporting_agents: supporting, contradicting_agents: contradicting,
    disagreement: supporting.length > 0 && contradicting.length > 0, agents,
    reason: state === 'outlier_suspected' ? 'new observation rejected from operational state because motion continuity failed' :
      state === 'reconciled_estimate' ? 'position denoised against route geometry and prior trajectory' :
        'observation consistent enough to remain operational state',
  };
}

module.exports = { VERSION, motionAgent, routeAgent, headingAgent, sourceQualityAgent, temporalAgent, challengerAgent, benignExplanationAgent, reconcileWorldState };
