/**
 * routeAnalyser — AI-powered route safety scoring.
 *
 * Fetches active risk zones near the route corridor, then calls Claude
 * to score the route and suggest alternates. Returns a structured
 * RouteAnalysis object ready to persist and send to the client.
 */
const Anthropic = require('@anthropic-ai/sdk');
const { query } = require('../config/database');
const logger = require('./logger');

const client = new Anthropic();
const MODEL = 'claude-opus-4-8';

/**
 * Haversine distance in km between two lat/lng points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch active risk zones within a bounding box padded around origin→dest corridor.
 */
async function fetchNearbyRiskZones(originLat, originLng, destLat, destLng) {
  const pad = 1.5; // degrees
  const minLat = Math.min(originLat, destLat) - pad;
  const maxLat = Math.max(originLat, destLat) + pad;
  const minLng = Math.min(originLng, destLng) - pad;
  const maxLng = Math.max(originLng, destLng) + pad;

  try {
    const result = await query(
      `SELECT name, description, risk_level, zone_type, lat, lng, radius_km
       FROM risk_zones
       WHERE active = true
         AND lat BETWEEN $1 AND $2
         AND lng BETWEEN $3 AND $4
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY risk_level DESC
       LIMIT 20`,
      [minLat, maxLat, minLng, maxLng],
    );
    return result.rows;
  } catch (err) {
    logger.warn({ err }, 'routeAnalyser: failed to fetch risk zones');
    return [];
  }
}

/**
 * Call Claude with a structured tool to produce a RouteAnalysis.
 */
async function callAnalysisAI(origin, destination, riskZones, context) {
  const distanceKm = haversineKm(
    origin.lat, origin.lng,
    destination.lat, destination.lng,
  ).toFixed(1);

  const zonesText = riskZones.length
    ? riskZones.map(z =>
        `- ${z.name} (${z.risk_level}, ${z.zone_type}): ${z.description ?? 'no description'} — ${haversineKm(origin.lat, origin.lng, z.lat, z.lng).toFixed(1)} km from origin`
      ).join('\n')
    : 'No active risk zones found in corridor.';

  const prompt = `You are a route safety analyst for a convoy management system operating in sub-Saharan Africa.

Analyse this route and provide a structured safety assessment:

**Origin:** ${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}
**Destination:** ${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}
**Direct distance:** ${distanceKm} km
**Departure context:** ${context.departureTime ?? 'unspecified time'}${context.avoidNightTravel ? ' — operator prefers to avoid night travel' : ''}

**Active risk zones in corridor:**
${zonesText}

Provide: an overall risk score (0–100), the primary risk factors present, a recommended route with waypoints and estimated duration, up to 2 alternate routes if meaningful, and a brief prose summary (2–3 sentences) for the dispatcher.`;

  const tools = [{
    name: 'route_analysis',
    description: 'Structured route safety analysis result',
    input_schema: {
      type: 'object',
      properties: {
        overall_risk_score: { type: 'number', description: '0 = completely safe, 100 = impassable' },
        primary_risk_factors: {
          type: 'array',
          items: { type: 'string', enum: ['armed_robbery','carjacking','road_condition','weather','civil_unrest','border_delay','fuel_scarcity','night_travel','other'] },
        },
        recommended_route: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            waypoints: { type: 'array', items: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat','lng'] } },
            distance_km: { type: 'number' },
            estimated_duration_minutes: { type: 'integer' },
            risk_score: { type: 'number' },
            risk_factors: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['label','waypoints','distance_km','estimated_duration_minutes','risk_score','risk_factors'],
        },
        alternate_routes: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              waypoints: { type: 'array', items: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat','lng'] } },
              distance_km: { type: 'number' },
              estimated_duration_minutes: { type: 'integer' },
              risk_score: { type: 'number' },
              risk_factors: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
            required: ['label','waypoints','distance_km','estimated_duration_minutes','risk_score','risk_factors'],
          },
        },
        ai_summary: { type: 'string', description: '2–3 sentence dispatcher briefing' },
      },
      required: ['overall_risk_score','primary_risk_factors','recommended_route','alternate_routes','ai_summary'],
    },
  }];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools,
    tool_choice: { type: 'tool', name: 'route_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI did not return a tool_use block');
  return toolUse.input;
}

/**
 * Main entry point. Analyses a route and returns a RouteAnalysis object.
 * Does NOT persist — caller handles DB write.
 */
async function analyseRoute({ origin, destination, convoyId, requestedBy, departureTime, avoidNightTravel, orgId }) {
  const riskZones = await fetchNearbyRiskZones(
    origin.lat, origin.lng,
    destination.lat, destination.lng,
  );

  const result = await callAnalysisAI(
    origin,
    destination,
    riskZones,
    { departureTime, avoidNightTravel },
  );

  return {
    org_id: orgId,
    convoy_id: convoyId ?? null,
    origin_lat: origin.lat,
    origin_lng: origin.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    overall_risk_score: Math.max(0, Math.min(100, Number(result.overall_risk_score))),
    primary_risk_factors: result.primary_risk_factors ?? [],
    recommended_route: result.recommended_route ?? {},
    alternate_routes: result.alternate_routes ?? [],
    ai_summary: result.ai_summary ?? null,
    requested_by: requestedBy ?? null,
  };
}

module.exports = { analyseRoute };
