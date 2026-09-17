'use strict';

/**
 * Route Safety Control Plane.
 *
 * Safety score is deterministic and grounded in real road geometry + Sonalit
 * risk zones. AI is an enrichment layer only: if every AI provider is down,
 * the route analysis still succeeds with a traceable deterministic assessment.
 */

const aiClient = require('./aiClient');
const logger = require('./logger');
const { query } = require('../config/database');
const { mapboxToken, osrmUrl } = require('../services/geo/providerEnv');
const { planRouteAlternatives } = require('../services/geo/routePlan');
const { rankRoutes } = require('../services/geo/routeRisk');
const { runSwarm } = require('../services/geo/routeSafetySwarm');

const ROUTE_ANALYSIS_VERSION = 'route-safety-v2';
const ROUTE_CACHE_MINUTES = 15;

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : min));
}

function riskBand(score) {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'guarded';
  return 'low';
}

function riskFactorsFromExposures(exposures = []) {
  const out = new Set();
  for (const e of exposures) {
    const type = String(e.zone_type || '').toLowerCase();
    const level = String(e.risk_level || '').toLowerCase();
    if (['armed_robbery', 'banditry', 'carjacking', 'security'].some(x => type.includes(x)) || ['high','critical','no_go'].includes(level)) {
      out.add(type.includes('carjack') ? 'carjacking' : 'armed_robbery');
    } else if (['weather','flood','storm','landslide'].some(x => type.includes(x))) out.add('weather');
    else if (['protest','civil_unrest','riot','demonstration'].some(x => type.includes(x))) out.add('civil_unrest');
    else if (['road','construction','closure','condition'].some(x => type.includes(x))) out.add('road_condition');
    else out.add('other');
  }
  return [...out].slice(0, 6);
}

async function fetchNearbyRiskZones(orgId, origin, destination) {
  const pad = 1.75;
  const minLat = Math.min(origin.lat, destination.lat) - pad;
  const maxLat = Math.max(origin.lat, destination.lat) + pad;
  const minLng = Math.min(origin.lng, destination.lng) - pad;
  const maxLng = Math.max(origin.lng, destination.lng) + pad;

  const rows = await query(
    `SELECT id, name, description, risk_level, zone_type, lat, lng, radius_km
       FROM risk_zones
      WHERE org_id = $1
        AND COALESCE(is_active, active, true) = true
        AND lat BETWEEN $2 AND $3
        AND lng BETWEEN $4 AND $5
        AND (valid_until IS NULL OR valid_until > NOW())
      ORDER BY CASE LOWER(COALESCE(risk_level, 'medium'))
        WHEN 'no_go' THEN 1 WHEN 'critical' THEN 2 WHEN 'high' THEN 3
        WHEN 'medium' THEN 4 ELSE 5 END
      LIMIT 200`,
    [orgId, minLat, maxLat, minLng, maxLng],
  );
  return rows;
}

function makeFallbackRoute(origin, destination) {
  const distance = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng);
  return {
    route: [origin, destination],
    provider: 'direct-fallback',
    distance_km: Math.round(distance * 100) / 100,
    duration_min: Math.max(1, Math.round((distance / 55) * 60)),
    routed: false,
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRouteOption(candidate, label) {
  const riskScore = clamp(candidate.blocked ? 100 : candidate.score);
  return {
    label,
    waypoints: candidate.route,
    distance_km: Number(candidate.distance_km ?? 0),
    estimated_duration_minutes: Math.max(0, Math.round(candidate.duration_min ?? 0)),
    risk_score: riskScore,
    risk_factors: riskFactorsFromExposures(candidate.exposures),
    notes: candidate.blocked
      ? 'This route intersects a no-go risk zone and is blocked from normal selection.'
      : candidate.exposures?.length
        ? `${candidate.exposures.length} mapped risk zone exposure(s); see route evidence for detail.`
        : 'No mapped active risk-zone exposure detected.',
  };
}

async function callAnalysisAI(origin, destination, routes, context) {
  const summaryInput = routes.map((r, i) => ({
    option: i + 1,
    label: r.label,
    distance_km: r.distance_km,
    eta_min: r.estimated_duration_minutes,
    risk_score: r.risk_score,
    factors: r.risk_factors,
  }));

  const prompt = `You are Sonalit's route-safety briefing layer. Do not invent roads, hazards, coordinates, incidents, or operational facts.
Use only the supplied deterministic route evidence. Give a concise dispatcher briefing explaining the selected route, material risk trade-offs, and any timing consideration.

Origin: ${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}
Destination: ${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}
Departure: ${context.departureTime || 'unspecified'}
Avoid night: ${context.avoidNightTravel ? 'yes' : 'no'}
Route evidence:
${JSON.stringify(summaryInput)}`;

  const response = await aiClient.createMessage({
    max_tokens: 700,
    tools: [{
      name: 'route_brief',
      description: 'Return a short evidence-grounded dispatcher briefing.',
      input_schema: {
        type: 'object',
        properties: {
          ai_summary: { type: 'string' },
        },
        required: ['ai_summary'],
      },
    }],
    messages: [{ role: 'user', content: prompt }],
  });

  const tool = response?.content?.find(b => b.type === 'tool_use');
  if (tool?.input?.ai_summary) return String(tool.input.ai_summary).slice(0, 2048);

  const textBlock = response?.content?.find(b => b.type === 'text' && b.text);
  return textBlock?.text ? String(textBlock.text).slice(0, 2048) : null;
}

async function analyseRoute({ origin, destination, convoyId, requestedBy, departureTime, avoidNightTravel, orgId }) {
  const cached = await query(
    `SELECT *
       FROM route_analyses
      WHERE org_id=$1
        AND (($2::uuid IS NULL AND convoy_id IS NULL) OR convoy_id=$2)
        AND origin_lat=$3 AND origin_lng=$4
        AND destination_lat=$5 AND destination_lng=$6
        AND analysed_at > NOW() - make_interval(mins => $7)
      ORDER BY analysed_at DESC
      LIMIT 1`,
    [orgId, convoyId ?? null, origin.lat, origin.lng, destination.lat, destination.lng, ROUTE_CACHE_MINUTES],
  );
  if (cached[0]) return { ...cached[0], cache_hit: true };

  const zones = await fetchNearbyRiskZones(orgId, origin, destination);

  const routing = await planRouteAlternatives(
    [origin, destination],
    {
      mapboxToken: mapboxToken(),
      osrmUrl: osrmUrl(),
      maxPoints: 300,
    },
  );

  const candidates = routing.length ? routing : [makeFallbackRoute(origin, destination)];
  const ranked = rankRoutes(candidates, zones);
  const rankedRows = ranked.ranked;

  const primary = rankedRows[0];
  const deterministicOptions = rankedRows.slice(0, 3).map((candidate, i) =>
    toRouteOption(candidate, i === 0 ? 'Recommended safety route' : `Alternative ${i}`),
  );

  const best = deterministicOptions[0] || toRouteOption({
    route: [origin, destination],
    distance_km: haversineKm(origin.lat, origin.lng, destination.lat, destination.lng),
    duration_min: 0,
    score: 0,
    blocked: false,
    exposures: [],
  }, 'Direct fallback');

  let swarm = null;
  try {
    swarm = await runSwarm({
      origin,
      destination,
      departureTime,
      avoidNightTravel,
      candidates: deterministicOptions,
      zones: zones.slice(0, 100),
    });
  } catch (err) {
    logger.warn({ err }, 'Route Safety swarm unavailable; deterministic result retained');
  }

  const overallRisk = best.risk_score;
  const swarmLevel = swarm?.arbiter?.risk_level || null;
  const swarmSummary = swarm?.arbiter?.route_selection_reason || null;
  const aiSummary = swarmSummary || `Deterministic route assessment: ${riskBand(overallRisk)} risk based on current mapped route exposure and road-routing evidence.`;
  const safetyGate = swarm?.consensus?.hard_block || swarmLevel === 'CRITICAL'
    ? 'HUMAN_REVIEW'
    : (swarm?.arbiter?.go_no_go || 'CONDITIONAL');
  return {
    org_id: orgId,
    convoy_id: convoyId ?? null,
    origin_lat: origin.lat,
    origin_lng: origin.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    overall_risk_score: overallRisk,
    primary_risk_factors: riskFactorsFromExposures(primary?.exposures ?? []),
    recommended_route: best,
    alternate_routes: deterministicOptions.slice(1),
    ai_summary: aiSummary,
    safety_gate: safetyGate,
    swarm: swarm ? {
      version: swarm.version,
      agent_count: swarm.agent_count,
      providers: [...new Set((swarm.reports || []).map(r => r.provider).filter(Boolean)), swarm.arbiter?.provider, swarm.critic?.provider].filter(Boolean),
      confidence: swarm.consensus?.confidence ?? 0,
      hard_block: Boolean(swarm.consensus?.hard_block),
      aggregated_risks: swarm.aggregated_risks || [],
      arbiter: swarm.arbiter || null,
      critic: swarm.critic ? { provider: swarm.critic.provider, status: swarm.critic.status, finding: swarm.critic.finding, contradictions: swarm.critic.contradictions, evidence_gaps: swarm.critic.evidence_gaps } : null,
    } : null,
    requested_by: requestedBy ?? null,
    analysis_version: ROUTE_ANALYSIS_VERSION,
    routing_provider: best.label.includes('fallback') ? 'direct-fallback' : (primary?.provider || 'unknown'),
    route_status: primary?.blocked ? 'blocked' : (primary?.routed === false ? 'unrouted' : 'routed'),
    risk_zone_count: zones.length,
    cache_hit: false,
  };
}

module.exports = { analyseRoute, ROUTE_ANALYSIS_VERSION };
