const crypto = require('crypto');
const router = require('express').Router();
const aiClient = require('../utils/aiClient');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { runDecisionFabric } = require('../services/aiSwarm');
const { buildWorldContext } = require('../services/spatial/worldContextService');
const { withOrg } = require('../utils/orgScopedDb');
const { buildCorridorPolygon, midpointOnPath, simplifyPath, validateCorridorGeometry } = require('../utils/corridorGeometry');
const { validateToolInput } = require('../utils/aiToolInputValidation');
const { normalizePolygonGeometry } = require('../utils/geofenceGeometry');
const { createRadiusPolygon, normalizeBoundaryGeometry } = require('../utils/geofenceAutoGeometry');
const { invalidateGeofenceCache } = require('../utils/geofenceEngine');
const { inferGeofenceTask } = require('../utils/geofenceCommandIntent');
const { inferRiskZoneTask } = require('../utils/riskZoneCommandIntent');
const { resolveAdministrativeBoundary } = require('../utils/administrativeBoundaryResolver');
const {
  ACTION_POLICIES,
  READ_ONLY_TOOLS,
  authorizeCopilotTool,
  classifyCopilotCommand,
  hasExplicitActionIntent,
  signActionConfirmation,
  validatePolicyCoverage,
  verifyActionConfirmation,
} = require('../services/copilotActionPolicy');
const actionLedger = require('../services/copilotActionLedger');

async function persistCopilotDecision({ orgId, userId, command, result, requestId }) {
  if (!orgId) throw new Error('Copilot decision persistence requires an authenticated organisation');
  return withOrg(orgId, async (client) => {
    let decisionRow;
    if (requestId) {
      decisionRow = await client.query(
        "INSERT INTO public.copilot_decisions (org_id, user_id, command, decision, risk_level, confidence, answer, result, completed_at, request_id)\n" +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)\n" +
        "ON CONFLICT (org_id, request_id) WHERE request_id IS NOT NULL\n" +
        "DO UPDATE SET user_id=EXCLUDED.user_id, command=EXCLUDED.command, decision=EXCLUDED.decision, risk_level=EXCLUDED.risk_level,\n" +
        "confidence=EXCLUDED.confidence, answer=EXCLUDED.answer, result=EXCLUDED.result, completed_at=NOW()\n" +
        "WHERE public.copilot_decisions.user_id IS NOT DISTINCT FROM EXCLUDED.user_id\n" +
        "RETURNING id",
        [orgId, userId || null, command, result.decision || 'HUMAN_REVIEW_REQUIRED', result.risk_level || 'HIGH', Number(result.confidence || 0), result.answer || '', JSON.stringify(result), requestId],
      );
    } else {
      decisionRow = await client.query(
        "INSERT INTO public.copilot_decisions (org_id, user_id, command, decision, risk_level, confidence, answer, result, completed_at)\n" +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id",
        [orgId, userId || null, command, result.decision || 'HUMAN_REVIEW_REQUIRED', result.risk_level || 'HIGH', Number(result.confidence || 0), result.answer || '', JSON.stringify(result)],
      );
    }
    const decisionId = decisionRow.rows && decisionRow.rows[0] && decisionRow.rows[0].id;
    if (!decisionId) throw new Error('Copilot decision insert returned no identifier');
    if (requestId) {
      await client.query('DELETE FROM public.copilot_decision_agents WHERE decision_id=$1 AND org_id=$2', [decisionId, orgId]);
    }
    for (const agent of result.swarm || []) {
      await client.query(
        "INSERT INTO public.copilot_decision_agents (decision_id, org_id, agent_id, status, confidence, provider, finding, dissent, tools, provenance)\n" +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [decisionId, orgId, agent.id, agent.status || 'uncertain', Number(agent.confidence || 0), agent.provider || null, agent.finding || '', agent.dissent || '', JSON.stringify(agent.tools || []), JSON.stringify(agent.provenance || [])],
      );
    }
    return decisionId;
  });
}

router.use(authenticate);

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCopilotRequest(body, historyLimit = 12) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'request body must be an object' };
  if (typeof body.command !== 'string' || !body.command.trim()) return { status: 400, error: 'command required' };
  if (body.command.length > 4000) return { status: 413, error: 'command exceeds the 4000-character limit' };
  const history = body.history === undefined ? [] : body.history;
  if (!Array.isArray(history) || history.length > 50) return { status: 400, error: 'history must be an array of at most 50 entries' };
  for (let i = 0; i < history.length; i += 1) {
    const item = history[i];
    if (!item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string' || item.content.length > 4000) {
      return { status: 400, error: 'history entry ' + i + ' is invalid or too large' };
    }
  }
  const requestId = body.request_id === undefined ? crypto.randomUUID() : body.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return { status: 400, error: 'request_id must be a UUID' };
  }
  return { command: body.command.trim(), history: history.slice(-Math.max(0, Math.min(12, historyLimit))), requestId };
}

const MODEL = 'claude-opus-4-7';

// Ensure vehicle columns exist (run once on first request)
let columnsChecked = false;
async function ensureColumns() {
  if (columnsChecked) return;
  columnsChecked = true;
  try {
    await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_level DECIMAL(5,2) DEFAULT 85`);
    await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS speed DECIMAL(6,2) DEFAULT 0`);
    await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS maintenance_score INTEGER DEFAULT 0`);
    await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS heading DECIMAL(6,2) DEFAULT 0`);
    await query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS driver_name VARCHAR(255)`);
  } catch (e) { logger.warn('ensureColumns: ' + e.message); }
}

// Ensure risk_zones table exists
let riskZonesChecked = false;
async function ensureRiskZones() {
  if (riskZonesChecked) return;
  riskZonesChecked = true;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS risk_zones (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        risk_level VARCHAR(20) DEFAULT 'medium',
        zone_type VARCHAR(50) DEFAULT 'general',
        lat DECIMAL(10,7),
        lng DECIMAL(10,7),
        radius_km DECIMAL(8,2) DEFAULT 5,
        active BOOLEAN DEFAULT true,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`ALTER TABLE risk_zones ADD COLUMN IF NOT EXISTS zone_type VARCHAR(50) DEFAULT 'general'`);
    await query(`ALTER TABLE risk_zones ADD COLUMN IF NOT EXISTS org_id UUID`);
  } catch (e) { logger.warn('ensureRiskZones: ' + e.message); }
}

// ── System prompt (static — kept frozen so it caches across requests) ──────
const SYSTEM_PROMPT = `You are the AI dispatch assistant for FleetOps Pro, an enterprise logistics command platform running security convoys across East and Central Africa (Kenya, DRC, Tanzania, Uganda, Mali).

You are the Sonalit operational agent, not a generic chatbot. Investigate, compare, summarize, plan, reconcile evidence, create operational artifacts, and explain provenance. For multi-step requests use evidence → analysis → action → verification. Never invent fleet, route, location, timing, security or spatial facts. Geofence accuracy outranks speed: prefer explicit coordinates, OSM/Nominatim resolution and full OSRM road geometry; never silently turn a failed route into a straight line.

Guidelines:
- Use query_vehicles / query_convoys / query_alerts for anything about fleet state. Pass filters when the user is specific (a region, status, low fuel, etc.).
- Use get_weather for weather questions — covers any location worldwide.
- Use check_holidays to look up public holidays for any country. This is critical for convoy timing, border crossing windows, and staffing — holidays cause border closures, reduced police escorts, and road congestion.
- Use get_road_conditions to check for construction zones, road closures, and barriers near a location or along a route. Call it for both origin and destination on convoy routes.
- Use query_risk_zones to surface internal records of banditry hotspots, conflict zones, strike zones, and high-risk corridors. Always check this when advising on route safety.
- Use get_world_context for mission-specific spatial questions. It is the canonical spatial source for convoy/vehicle position, route/corridor state, nearby incidents, risk zones, checkpoints, weather, AIS movement, road traffic, external incidents, natural hazards, relationships, events, freshness, provenance, uncertainty, and evidence. Never invent spatial facts that are not present in its result.
- Use create_geofence when the user asks to draw/create a geofence, polygon, boundary, or corridor around a location. Use shape=polygon for a clearly requested radius-based polygon approximation; use shape=boundary only for an explicitly requested official/administrative boundary backed by OpenStreetMap geometry. Never invent an official boundary or disguise an approximation as one. Create valid requested geometry immediately and report its source, radius, vertex count and verification.
- Use create_risk_zone when the user wants to flag a location as dangerous, mark a strike, roadblock, active incident, or high-risk area. Create it immediately.
- For comprehensive navigation advisories: combine weather + road conditions + risk zones + active alerts + upcoming holidays. Give a rated assessment (SAFE / CAUTION / HIGH RISK / AVOID).
- Support investigation, comparison, exception hunting, situation briefs, route-risk analysis, shipment/fleet/maintenance checks, spatial context, geofence/risk-zone creation and other supported operational tasks. For multi-step work, complete the evidence collection first, perform the requested reversible action, then report the resulting object and verification.
- Be concise and direct — 1–4 sentences when the task is simple; for complex tasks use a structured result with what was checked, what changed, what remains uncertain, and the next action. Cite specific vehicle registrations, convoy names, zone names, coordinates, distances and counts from tool results.
- Clearly flag critical situations: low fuel, offline vehicles, critical alerts, severe weather, active risk zones, road closures, and holidays affecting convoy timing.`;

// ── Tool definitions (static — cache together with the system prompt) ──────
const TOOLS = [
  {
    name: 'query_vehicles',
    description: 'Query the live vehicle fleet. Returns matching vehicles with registration, type, status, region, speed (km/h), fuel level (%), coordinates, driver, and last ping.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'idle', 'maintenance', 'offline'], description: 'Filter by vehicle status' },
        region: { type: 'string', description: 'Filter by region, e.g. Kenya, DRC, Tanzania, Uganda, Mali' },
        low_fuel: { type: 'boolean', description: 'If true, only vehicles with fuel level below 25%' },
        moving: { type: 'boolean', description: 'If true, only vehicles currently moving (speed > 2 km/h)' },
        maintenance_overdue: { type: 'boolean', description: 'If true, only vehicles with an overdue non-completed scheduled maintenance record' },
      },
    },
  },
  {
    name: 'query_shipments',
    description: 'Query tenant-scoped shipments with tracking, customer, status, priority, route, ETA, vehicle and driver context.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        priority: { type: 'string' },
        search: { type: 'string' },
      },
    },
  },
  {
    name: 'query_geofences',
    description: 'Inspect tenant-scoped geofences with type, centre, radius, corridor buffer, geometry precision and vertex counts. Use for geofence audits, comparisons and verification.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        search: { type: 'string' },
        active: { type: 'boolean' },
      },
    },
  },
  {
    name: 'query_maintenance',
    description: 'Query tenant-scoped maintenance records, due dates, status, priority, vehicle and workshop context.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        priority: { type: 'string' },
        vehicle: { type: 'string' },
        overdue: { type: 'boolean' },
      },
    },
  },
  {
    name: 'query_drivers',
    description: 'Query tenant-scoped drivers with status, licence expiry, score, current vehicle and basic recent performance signals.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        search: { type: 'string' },
      },
    },
  },
  {
    name: 'query_devices',
    description: 'Query tenant-scoped Guardian devices with health, assignment, panic and last-seen information.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        assignment_type: { type: 'string' },
      },
    },
  },
  {
    name: 'query_convoys',
    description: 'Query convoy missions. Returns convoys with name, status, region, priority, route origin/destination, and timing.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['planned', 'active', 'completed', 'aborted'] },
        region: { type: 'string', description: 'Filter by region' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
  },
  {
    name: 'query_alerts',
    description: 'Query operational alerts. Returns alerts with type, severity, message, affected vehicle, and timestamps. By default returns only unresolved alerts.',
    input_schema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        type: { type: 'string', description: 'Alert type, e.g. speed, geofence, mechanical, security, communication, roadblock, construction' },
        include_resolved: { type: 'boolean', description: 'If true, also include already-resolved alerts' },
      },
    },
  },
  {
    name: 'get_weather',
    description: 'Get current conditions and a 3-day forecast for any location worldwide by name.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or place name, e.g. Nairobi, Mombasa, Kinshasa, Bamako' },
      },
      required: ['location'],
    },
  },
  {
    name: 'check_holidays',
    description: 'Check upcoming public/national holidays for any country. Use this when planning convoy timing, border crossings, or staffing — holidays affect border operations, police escorts, and road traffic. Supports KE (Kenya), TZ (Tanzania), CD (DRC), UG (Uganda), NG (Nigeria), ZA (South Africa), ZM (Zambia), RW (Rwanda), ET (Ethiopia), GH (Ghana) and many others.',
    input_schema: {
      type: 'object',
      properties: {
        country_code: { type: 'string', description: 'ISO 2-letter country code: KE, TZ, CD, UG, ML, NG, ZA, etc.' },
        year: { type: 'number', description: 'Year to check (defaults to current year)' },
      },
      required: ['country_code'],
    },
  },
  {
    name: 'get_road_conditions',
    description: 'Check for road construction zones, closures, and physical barriers near a location using OpenStreetMap data. Use this for both convoy origin and destination to flag any route hazards. Also returns weather context to assess trafficability.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or place name to centre the search' },
        radius_km: { type: 'number', description: 'Search radius in km (default 30, max 100)' },
      },
      required: ['location'],
    },
  },
  {
    name: 'query_risk_zones',
    description: 'Query the internal database of known high-risk zones — banditry hotspots, conflict zones, strike areas, active roadblocks, and dangerous corridors. Always check this before advising on route safety.',
    input_schema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Filter by region or country name (partial match)' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Minimum risk level' },
        zone_type: { type: 'string', description: 'Filter by type: security, construction, flood, banditry, conflict, police_checkpoint, strike, general' },
      },
    },
  },
  {
    name: 'get_world_context',
    description: 'Query Sonalit canonical spatial world context for a convoy, vehicle, or explicit location. Returns route/corridor state, nearby incidents and risk zones, checkpoints, weather, external movement, spatial relations, deterministic spatial events, freshness, provenance, coverage and evidence. Tenant scope is taken from the authenticated session; callers must never supply an organisation id.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'object',
          description: 'Optional mission subject. Supports convoy, vehicle, route, corridor, incident, checkpoint, port, location, or none. For mission-specific intelligence prefer a canonical Sonalit subject id.',
          properties: {
            kind: { type: 'string', enum: ['convoy','vehicle','route','corridor','incident','checkpoint','port','location','none'] },
            id: { type: 'string' },
            label: { type: 'string' },
          },
        },
        center: {
          type: 'object',
          description: 'Optional explicit map centre.',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' },
          },
        },
        radiusM: { type: 'number', description: 'Context radius in metres. Maximum 250000.' },
        bbox: {
          type: 'array',
          description: 'Optional bounded [west,south,east,north] spatial envelope. Server enforces the maximum area.',
          items: { type: 'number' },
          minItems: 4,
          maxItems: 4,
        },
        maxEntitiesPerLayer: { type: 'number', description: 'Optional per-layer entity cap. Server bounds the final value.' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts'] },
          maxItems: 10,
        },
      },
    },
  },
  {
    name: 'create_geofence',
    description: 'Create and verify a geofence without requiring manual map clicks. Shapes: circle (point radius), polygon (48-vertex geodesic approximation of a radius buffer), boundary (only a source-backed single-ring OpenStreetMap administrative Polygon), or a road corridor when route_end is provided. A generated polygon is not an official place boundary. Route corridors use routed road geometry and never silently fall back to a straight line.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 160, description: 'Name, e.g. "Thika Road Corridor" or "Nairobi CBD Safe Zone"' },
        location: { type: 'string', minLength: 1, maxLength: 400, description: 'Place name or route start point' },
        route_end: { type: 'string', minLength: 1, maxLength: 400, description: 'Route end point for a corridor geofence, e.g. "Juja". Omit for a point geofence.' },
        shape: { type: 'string', enum: ['circle', 'polygon', 'boundary'], description: 'circle by default; polygon creates a radius-buffer approximation; boundary requires a source-backed administrative boundary and fails closed when unavailable.' },
        radius_m: { type: 'number', minimum: 10, maximum: 100000, description: 'Radius in metres for circle or polygon geofence (default 3000). Ignored for route corridors and administrative boundaries.' },
        buffer_m: { type: 'number', minimum: 10, maximum: 5000, description: 'Corridor half-width in metres — how far a vehicle can deviate before an alert fires (default 300).' },
        fence_type: { type: 'string', enum: ['safe_zone', 'exclusion_zone', 'checkpoint', 'depot', 'patrol_zone', 'corridor', 'general'] },
        precision: { type: 'string', enum: ['standard', 'high', 'maximum'], description: 'Precision level; maximum is the default for operational geofences.' },
        allow_straight_fallback: { type: 'boolean', description: 'Explicitly allow a straight-line fallback when road routing is unavailable. Defaults to false.' },
      },
      required: ['name', 'location'],
    },
  },
  {
    name: 'create_risk_zone',
    description: 'Mark a location as a high-risk zone in the system. Use when the user reports a security incident, roadblock, strike, dangerous area, or asks to flag a location. Always create it immediately.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the risk zone, e.g. "Garissa Banditry Zone" or "Mombasa Port Strike Area"' },
        location: { type: 'string', description: 'Place name to geocode and centre the zone on' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Risk severity level' },
        zone_type: { type: 'string', enum: ['security', 'construction', 'flood', 'banditry', 'conflict', 'police_checkpoint', 'strike', 'general'], description: 'Nature of the risk' },
        description: { type: 'string', description: 'Details about the hazard, e.g. "Armed robbery incidents reported on A109 near km 234"' },
        radius_km: { type: 'number', minimum: 0.1, maximum: 100, description: 'Radius in km (default 5; bounded to 0.1–100 km).' },
      },
      required: ['name', 'location', 'risk_level'],
    },
  },
];

const toolPolicyCoverage = validatePolicyCoverage(TOOLS.map(tool => tool.name));
if (!toolPolicyCoverage.valid) {
  throw new Error('Copilot tool policy is incomplete: ' + toolPolicyCoverage.unclassified_tools.join(', '));
}

// ── Tool implementations ───────────────────────────────────────────────────
async function toolQueryVehicles(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', vehicles: [], count: 0 };
  const filters = ['deleted_at IS NULL', 'org_id = $1'];
  const params = [orgId];
  if (input.status) { params.push(input.status); filters.push(`status = $${params.length}`); }
  if (input.region) { params.push(input.region); filters.push(`region = $${params.length}`); }
  if (input.low_fuel) filters.push('COALESCE(fuel_level, 85) < 25');
  if (input.moving) filters.push('COALESCE(speed, 0) > 2');
  if (input.maintenance_overdue) filters.push('m.maintenance_due = true');
  const r = await query(
    `SELECT v.registration, v.type, v.status, v.region,
            COALESCE(v.fuel_level, 85) AS fuel_level, COALESCE(v.speed, 0) AS speed,
            v.latitude, v.longitude, v.driver_name, v.last_ping,
            m.maintenance_status, m.maintenance_scheduled_at, m.next_service_date,
            m.next_service_km, m.maintenance_due
     FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT mr.status AS maintenance_status,
              mr.scheduled_at AS maintenance_scheduled_at,
              mr.next_service_date,
              mr.next_service_km,
              (mr.scheduled_at IS NOT NULL AND mr.scheduled_at < NOW() AND COALESCE(mr.status, '') <> 'completed') AS maintenance_due
       FROM maintenance_records mr
       WHERE mr.vehicle_id = v.id
       ORDER BY mr.scheduled_at NULLS LAST, mr.created_at DESC
       LIMIT 1
     ) m ON true
     WHERE ${filters.join(' AND ')}
     ORDER BY v.registration LIMIT 60`,
    params
  );
  return { count: r.rows.length, vehicles: r.rows };
}

async function toolQueryShipments(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', shipments: [], count: 0 };
  try {
    const filters = ['s.org_id = $1', 's.deleted_at IS NULL'];
    const params = [orgId];
    if (input.status) { params.push(input.status); filters.push(`s.status = ${params.length}`); }
    if (input.priority) { params.push(input.priority); filters.push(`s.priority = ${params.length}`); }
    if (input.search) { params.push(`%${String(input.search).slice(0,120)}%`); filters.push(`(s.tracking_number ILIKE ${params.length} OR s.customer_name ILIKE ${params.length} OR s.origin_address ILIKE ${params.length} OR s.destination_address ILIKE ${params.length})`); }
    const result = await query(
      `SELECT s.tracking_number, s.customer_name, s.status, s.priority,
              s.origin_address, s.destination_address, s.scheduled_pickup,
              s.scheduled_delivery, s.estimated_arrival, s.actual_delivery,
              c.name AS convoy_name, v.registration AS vehicle,
              d.name AS driver
         FROM shipments s
         LEFT JOIN convoys c ON c.id=s.convoy_id
         LEFT JOIN vehicles v ON v.id=s.vehicle_id
         LEFT JOIN drivers d ON d.id=s.driver_id
        WHERE ${filters.join(' AND ')}
        ORDER BY s.created_at DESC LIMIT 60`,
      params,
    );
    return { count: result.rows.length, shipments: result.rows };
  } catch (e) { return { error: `Shipment query failed: ${e.message}`, shipments: [], count: 0 }; }
}

async function toolQueryGeofences(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', geofences: [], count: 0 };
  try {
    const filters = ['g.org_id = $1'];
    const params = [orgId];
    if (input.type) { params.push(String(input.type)); filters.push(`LOWER(g.type) = LOWER(${params.length})`); }
    if (input.search) {
      params.push(`%${String(input.search).slice(0,120)}%`);
      filters.push(`(g.name ILIKE ${params.length} OR COALESCE(g.region,'') ILIKE ${params.length})`);
    }
    if (typeof input.active === 'boolean') { params.push(input.active); filters.push(`COALESCE(g.active,true) = ${params.length}`); }
    const result = await query(
      `SELECT g.id, g.name, g.type, g.region, g.active, g.radius,
              g.coordinates, g.corridor_width_km, g.created_at, g.updated_at
         FROM geofences g
        WHERE ${filters.join(' AND ')}
        ORDER BY g.created_at DESC LIMIT 100`,
      params,
    );
    return {
      count: result.rows.length,
      geofences: result.rows.map(g => {
        let c = g.coordinates;
        if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) {} }
        const path = Array.isArray(c?.path) ? c.path : (
          c?.type === 'LineString' && Array.isArray(c.coordinates)
            ? c.coordinates.map(([lng,lat]) => [lat,lng])
            : null
        );
        return {
          id: g.id,
          name: g.name,
          type: g.type || 'circle',
          region: g.region || null,
          active: g.active !== false,
          radius_m: Number(g.radius || 0),
          buffer_m: Number(c?.buffer_m || (g.corridor_width_km ? g.corridor_width_km * 1000 : 0)),
          centre: c?.lat != null && c?.lng != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null,
          path_points: Array.isArray(path) ? path.length : (Array.isArray(c?.coordinates?.[0]) ? Math.max(0, c.coordinates[0].length - 1) : 0),
          has_buffer_polygon: Array.isArray(c?.buffer_polygon) && c.buffer_polygon.length >= 4,
          shape: c?.shape || (c?.type === 'Polygon' ? 'polygon' : null),
          vertex_count: Number(c?.vertex_count || 0) || (Array.isArray(c?.coordinates?.[0]) ? Math.max(0, c.coordinates[0].length - 1) : 0),
          precision: c?.precision || null,
          geometry_source: c?.geometry_source || null,
          route_provider: c?.route_provider || null,
          route_distance_m: Number(c?.route_distance_m || 0) || null,
          created_at: g.created_at,
          updated_at: g.updated_at,
        };
      }),
    };
  } catch (e) {
    return { error: `Geofence query failed: ${e.message}`, geofences: [], count: 0 };
  }
}

async function toolQueryMaintenance(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', maintenance: [], count: 0 };
  try {
    const filters = ['mr.org_id = $1', 'mr.deleted_at IS NULL'];
    const params = [orgId];
    if (input.status) { params.push(input.status); filters.push(`mr.status = ${params.length}`); }
    if (input.priority) { params.push(input.priority); filters.push(`mr.priority = ${params.length}`); }
    if (input.vehicle) { params.push(`%${String(input.vehicle).slice(0,80)}%`); filters.push(`v.registration ILIKE ${params.length}`); }
    if (input.overdue) filters.push(`mr.status IN ('scheduled','in_progress') AND mr.scheduled_at < NOW()`);
    const result = await query(
      `SELECT mr.id, mr.type, mr.title, mr.priority, mr.status, mr.scheduled_at,
              mr.completed_at, mr.next_service_km, mr.next_service_date,
              mr.workshop, v.registration, v.region
         FROM maintenance_records mr
         JOIN vehicles v ON v.id=mr.vehicle_id
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE mr.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                 mr.scheduled_at NULLS LAST LIMIT 60`,
      params,
    );
    return { count: result.rows.length, maintenance: result.rows };
  } catch (e) { return { error: `Maintenance query failed: ${e.message}`, maintenance: [], count: 0 }; }
}

async function toolQueryDrivers(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', drivers: [], count: 0 };
  try {
    const filters = ['d.org_id = $1', 'd.deleted_at IS NULL'];
    const params = [orgId];
    if (input.status) { params.push(input.status); filters.push(`d.status = ${params.length}`); }
    if (input.search) { params.push(`%${String(input.search).slice(0,120)}%`); filters.push(`(d.name ILIKE ${params.length} OR d.employee_id ILIKE ${params.length} OR d.phone ILIKE ${params.length})`); }
    const result = await query(
      `SELECT d.id, d.name, d.employee_id, d.status, d.license_expiry,
              d.driver_score, d.idling_minutes, v.registration AS vehicle
         FROM drivers d
         LEFT JOIN vehicles v ON v.id=d.current_vehicle_id
        WHERE ${filters.join(' AND ')}
        ORDER BY d.driver_score DESC NULLS LAST, d.name LIMIT 60`,
      params,
    );
    return { count: result.rows.length, drivers: result.rows };
  } catch (e) { return { error: `Driver query failed: ${e.message}`, drivers: [], count: 0 }; }
}

async function toolQueryDevices(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', devices: [], count: 0 };
  try {
    const filters = ['d.org_id = $1', 'd.deleted_at IS NULL'];
    const params = [orgId];
    if (input.status) { params.push(input.status); filters.push(`d.status = ${params.length}`); }
    if (input.assignment_type) { params.push(input.assignment_type); filters.push(`d.assignment_type = ${params.length}`); }
    const result = await query(
      `SELECT d.id, d.name, d.model, d.assignment_type, d.assignment_id,
              d.status, d.panic_active, d.last_seen, d.last_lat, d.last_lng,
              d.last_speed, d.last_integrity_verdict, d.last_integrity_verdict_at
         FROM guardian_devices d
        WHERE ${filters.join(' AND ')}
        ORDER BY d.last_seen DESC NULLS LAST LIMIT 60`,
      params,
    );
    return { count: result.rows.length, devices: result.rows };
  } catch (e) { return { error: `Device query failed: ${e.message}`, devices: [], count: 0 }; }
}

async function toolQueryConvoys(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', convoys: [], count: 0 };
  const filters = ['deleted_at IS NULL', 'org_id = $1'];
  const params = [orgId];
  if (input.status) { params.push(input.status); filters.push(`status = $${params.length}`); }
  if (input.region) { params.push(input.region); filters.push(`region = $${params.length}`); }
  if (input.priority) { params.push(input.priority); filters.push(`priority = $${params.length}`); }
  const r = await query(
    `SELECT name, status, region, priority, route_origin, route_destination,
            departure_time, estimated_arrival, arrival_time
     FROM convoys WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC LIMIT 40`,
    params
  );
  return { count: r.rows.length, convoys: r.rows };
}

async function toolQueryAlerts(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', alerts: [], count: 0 };
  const filters = ['a.deleted_at IS NULL', 'a.org_id = $1'];
  const params = [orgId];
  if (!input.include_resolved) filters.push('a.resolved_at IS NULL');
  if (input.severity) { params.push(input.severity); filters.push(`a.severity = $${params.length}`); }
  if (input.type) { params.push(input.type); filters.push(`a.type = $${params.length}`); }
  const r = await query(
    `SELECT a.type, a.severity, a.message, a.created_at, a.acknowledged_at, a.resolved_at,
            v.registration AS vehicle
     FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id
     WHERE ${filters.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT 40`,
    params
  );
  return { count: r.rows.length, alerts: r.rows };
}

// WMO weather interpretation codes (Open-Meteo)
const WMO_CODES = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'depositing rime fog',
  51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
  61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
  66: 'light freezing rain', 67: 'heavy freezing rain',
  71: 'slight snow', 73: 'moderate snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers',
  85: 'slight snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail',
};

async function geocode(locationName) {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.results?.length) throw new Error(`Location "${locationName}" not found`);
  return data.results[0];
}

function parseCoordinatePair(value) {
  const text = String(value || '').trim();
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const latitude = Number(m[1]), longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, source: 'explicit' };
}

async function geocodePrecise(locationName) {
  const direct = parseCoordinatePair(locationName);
  if (direct) return { ...direct, name: 'Explicit coordinates', admin1: null, country: null, precision: 'coordinate' };

  const queryText = String(locationName || '').trim();
  if (!queryText) throw new Error('Location is required');

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(queryText)}`,
      { headers: { 'User-Agent': 'Sonalit-CommandCenter/1.0 (ops@sonalit.io)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(7000) }
    );
    if (res.ok) {
      const candidates = await res.json();
      if (Array.isArray(candidates) && candidates.length) {
        const ranked = candidates.map(c => {
          const type = String(c.type || '').toLowerCase();
          const importance = Number(c.importance || 0);
          const exact = String(c.display_name || '').toLowerCase().includes(queryText.toLowerCase());
          const featureBoost = /road|street|highway|motorway|trunk|primary|secondary|city|town|village|suburb|neighbourhood|port|airport/.test(type) ? 0.15 : 0;
          const tokenBoost = queryText.split(/\s+/).filter(Boolean).reduce((n,t) => String(c.display_name || '').toLowerCase().includes(t.toLowerCase()) ? n + 0.04 : n, 0);
          return { c, score: importance + featureBoost + tokenBoost + (exact ? 0.08 : 0) };
        }).sort((a,b)=>b.score-a.score);
        const best = ranked[0], second = ranked[1];
        if (second && best.score < 0.55 && best.score - second.score < 0.10) {
          throw new Error(`Location "${queryText}" is ambiguous; specify the country, city or exact coordinates.`);
        }
        const c = best.c;
        return {
          latitude: Number(c.lat),
          longitude: Number(c.lon),
          name: c.display_name || queryText,
          admin1: c.address?.state || c.address?.county || null,
          country: c.address?.country || null,
          precision: /road|street|motorway|trunk|primary|secondary/.test(String(c.type || '').toLowerCase()) ? 'street' : 'place',
          osm_type: c.osm_type || null,
          osm_id: c.osm_id || null,
          source: 'nominatim',
          importance: Number(c.importance || 0),
        };
      }
    }
  } catch (e) {
    if (/ambiguous/i.test(String(e?.message || ''))) throw e;
  }

  const g = await geocode(queryText);
  return { ...g, precision: 'place-fallback', source: 'open-meteo' };
}

function resolvedCacheHit(shape, location) {
  return shape === 'boundary' && Boolean(location && location.cache_hit);
}

async function geocodeAdministrativeBoundary(locationName) {
  return resolveAdministrativeBoundary(locationName);
}

function toLatLngPath(osrmCoordinates) {
  if (!Array.isArray(osrmCoordinates) || osrmCoordinates.length < 2) {
    throw new RangeError('OSRM returned no usable route geometry.');
  }
  // Bound untrusted upstream payload size before allocating a large converted
  // array. Dense routes are simplified later with an explicit metre tolerance;
  // don't invoke normalizePath here because it intentionally caps final
  // operational geometry at 800 vertices.
  if (osrmCoordinates.length > 20000) {
    throw new RangeError('OSRM route geometry exceeds the safe input vertex limit.');
  }
  return osrmCoordinates.map((point, index) => {
    if (!Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) {
      throw new RangeError('OSRM returned an invalid coordinate at route index ' + index + '.');
    }
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (Math.abs(lat) > 85 || Math.abs(lng) > 180) {
      throw new RangeError('OSRM returned an out-of-bounds coordinate at route index ' + index + '.');
    }
    return [lat, lng];
  });
}

// Haversine distance in metres between two lat/lng points
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function toolGetWeather(input) {
  const loc = (input.location || '').trim();
  if (!loc) return { error: 'No location provided' };

  try {
    const g = await geocode(loc);
    const fcRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&forecast_days=3&timezone=auto`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!fcRes.ok) return { error: `Forecast failed (HTTP ${fcRes.status})` };
    const fc = await fcRes.json();
    const cur = fc.current || {};
    const daily = fc.daily || {};
    const forecast = (daily.time || []).map((d, i) => ({
      date: d,
      conditions: WMO_CODES[daily.weather_code?.[i]] || 'unknown',
      high_c: daily.temperature_2m_max?.[i],
      low_c: daily.temperature_2m_min?.[i],
      precip_chance_pct: daily.precipitation_probability_max?.[i],
    }));

    return {
      location: [g.name, g.admin1, g.country].filter(Boolean).join(', '),
      current: {
        conditions: WMO_CODES[cur.weather_code] || 'unknown',
        temperature_c: cur.temperature_2m,
        humidity_pct: cur.relative_humidity_2m,
        precipitation_mm: cur.precipitation,
        wind_speed_kmh: cur.wind_speed_10m,
      },
      forecast,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function toolCheckHolidays(input) {
  const countryCode = (input.country_code || '').toUpperCase().trim();
  const year = input.year || new Date().getFullYear();

  if (!countryCode || countryCode.length !== 2) {
    return { error: 'Provide a 2-letter ISO country code, e.g. KE, TZ, CD, UG, NG.' };
  }

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.status === 404) return { error: `Country code "${countryCode}" not supported by the holiday database.` };
    if (!res.ok) return { error: `Holiday API failed (HTTP ${res.status})` };

    const holidays = await res.json();
    if (!Array.isArray(holidays)) return { error: 'Unexpected response from holiday API' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = holidays
      .filter(h => new Date(h.date) >= today)
      .slice(0, 12)
      .map(h => ({
        date: h.date,
        name: h.localName || h.name,
        national: h.national !== false,
        days_away: Math.ceil((new Date(h.date) - today) / 86400000),
      }));

    const imminent = upcoming.filter(h => h.days_away <= 7);

    return {
      country_code: countryCode,
      year,
      total_holidays: holidays.length,
      upcoming_count: upcoming.length,
      imminent_7_days: imminent,
      upcoming,
    };
  } catch (e) {
    return { error: `Holiday lookup failed: ${e.message}` };
  }
}

async function toolGetRoadConditions(input) {
  const loc = (input.location || '').trim();
  if (!loc) return { error: 'Location required' };
  const radius_km = Math.min(Math.max(input.radius_km || 30, 5), 100);

  try {
    const g = await geocode(loc);
    const locationLabel = [g.name, g.admin1, g.country].filter(Boolean).join(', ');
    const radius_m = radius_km * 1000;

    // Overpass query: construction zones, no-access roads, physical barriers
    const overpassQuery = `
[out:json][timeout:12];
(
  way["highway"="construction"](around:${radius_m},${g.latitude},${g.longitude});
  way["access"="no"]["highway"~"^(primary|secondary|tertiary|trunk|motorway)$"](around:${radius_m},${g.latitude},${g.longitude});
  node["barrier"~"^(gate|bollard|block|jersey_barrier|concrete_block)$"](around:${radius_m},${g.latitude},${g.longitude});
  way["construction"~"."](around:${radius_m},${g.latitude},${g.longitude});
);
out body;
>;
out skel qt;
    `.trim();

    let roadData = { construction_zones: 0, road_closures: 0, barriers: 0, details: [], note: null };
    try {
      const ovRes = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(overpassQuery)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000),
      });
      if (ovRes.ok) {
        const data = await ovRes.json();
        const elements = data.elements || [];
        const construction = elements.filter(e => e.tags?.highway === 'construction' || e.tags?.construction);
        const closures = elements.filter(e => e.tags?.access === 'no');
        const barriers = elements.filter(e => e.tags?.barrier);
        roadData = {
          construction_zones: construction.length,
          road_closures: closures.length,
          barriers: barriers.length,
          details: elements.slice(0, 10).map(e => ({
            type: e.type,
            tags: e.tags ? Object.fromEntries(Object.entries(e.tags).slice(0, 6)) : {},
          })),
          note: null,
        };
      } else {
        roadData.note = 'Road data service temporarily unavailable.';
      }
    } catch (_) {
      roadData.note = 'Road condition query timed out — OSM data unavailable for this area.';
    }

    // Also get weather at this location for trafficability context
    let weatherSummary = null;
    try {
      const fcRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
        `&current=weather_code,precipitation,wind_speed_10m&forecast_days=1&timezone=auto`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (fcRes.ok) {
        const fc = await fcRes.json();
        const cur = fc.current || {};
        weatherSummary = {
          conditions: WMO_CODES[cur.weather_code] || 'unknown',
          precipitation_mm: cur.precipitation,
          wind_speed_kmh: cur.wind_speed_10m,
        };
      }
    } catch (_) {}

    return {
      location: locationLabel,
      lat: g.latitude,
      lng: g.longitude,
      radius_km,
      ...roadData,
      current_weather: weatherSummary,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function toolQueryRiskZones(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', risk_zones: [], count: 0 };
  try {
    const filters = ['active = true', 'org_id = $1'];
    const params = [orgId];
    if (input.region) {
      params.push(`%${input.region}%`);
      filters.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    if (input.risk_level) {
      params.push(input.risk_level);
      filters.push(`risk_level = $${params.length}`);
    }
    if (input.zone_type) {
      params.push(input.zone_type);
      filters.push(`zone_type = $${params.length}`);
    }
    const r = await query(
      `SELECT name, description, risk_level, zone_type, lat, lng, radius_km, created_at
       FROM risk_zones WHERE ${filters.join(' AND ')}
       ORDER BY CASE risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
       LIMIT 30`,
      params
    );
    return { count: r.rows.length, risk_zones: r.rows };
  } catch (e) {
    return { error: `Risk zone query failed: ${e.message}`, count: 0, risk_zones: [] };
  }
}

async function toolCreateGeofence(input, userId, orgId) {
  if (!orgId) return { error: 'Organisation context is required' };
  const { name, location, route_end, fence_type = 'general' } = input || {};
  const shape = ['circle', 'polygon', 'boundary'].includes(input?.shape) ? input.shape : 'circle';
  if (!name || !location) return { error: 'name and location are required' };

  const precision = input.precision || 'maximum';
  const allowStraightFallback = input.allow_straight_fallback === true;

  try {
    if (route_end) {
      const gStart = await geocodePrecise(location);
      const gEnd = await geocodePrecise(route_end);
      const buffer_m = Math.max(10, Math.min(Number(input.buffer_m || 300), 5000));
      let pathLatLng = null;
      let distM = null;
      let routeProvider = 'OSRM';

      try {
        const osrmRes = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${gStart.longitude},${gStart.latitude};${gEnd.longitude},${gEnd.latitude}?overview=full&geometries=geojson&alternatives=false&steps=false`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (osrmRes.ok) {
          const od = await osrmRes.json();
          if (od.code === 'Ok' && od.routes?.[0]?.geometry?.coordinates?.length >= 2) {
            pathLatLng = toLatLngPath(od.routes[0].geometry.coordinates);
            distM = Number(od.routes[0].distance);
          }
        }
      } catch (e) {
        logger.warn(`Precision geofence routing failed for "${name}": ${e.message}`);
      }

      if (!pathLatLng || pathLatLng.length < 2 || !Number.isFinite(distM)) {
        if (!allowStraightFallback) {
          return {
            created: false,
            error: 'Road routing is unavailable. No corridor geofence was created because a straight-line substitute would be inaccurate.',
            precision: 'unavailable',
            start: { latitude: gStart.latitude, longitude: gStart.longitude, precision: gStart.precision },
            end: { latitude: gEnd.latitude, longitude: gEnd.longitude, precision: gEnd.precision },
          };
        }
        pathLatLng = [[gStart.latitude, gStart.longitude], [gEnd.latitude, gEnd.longitude]];
        distM = haversineM(gStart.latitude, gStart.longitude, gEnd.latitude, gEnd.longitude);
        routeProvider = 'straight-line-explicit-fallback';
      }

      // Simplify only to a documented geometric error bound, never to an
      // arbitrary point count. Preserve both endpoints and refuse a route that
      // cannot be represented safely within the algorithm's complexity budget.
      const pathSimplification = simplifyPath(pathLatLng, 10);
      pathLatLng = pathSimplification.path;
      const mid = midpointOnPath(pathLatLng);
      const region = gStart.admin1 || gStart.country || location;
      const locationLabel = `${gStart.name || location} → ${gEnd.name || route_end}`;
      const approxRadius = Math.round(distM / 2) + buffer_m;
      const bufferPolygon = buildCorridorPolygon(pathLatLng, buffer_m);

      // IMPORTANT: the operational engine uses [lat,lng] path order. OSRM
      // returns [lng,lat], so normalization happens exactly once here.
      const coordinates = {
        lat: mid[0],
        lng: mid[1],
        type: 'corridor',
        path: pathLatLng,
        buffer_m,
        buffer_polygon: bufferPolygon,
        precision,
        geometry_source: routeProvider === 'OSRM' ? 'OpenStreetMap via OSRM' : 'geocoded straight-line explicit fallback',
        route_provider: routeProvider,
        route_distance_m: distM,
        path_points: pathLatLng.length,
        source_path_points: pathSimplification.originalPointCount,
        path_simplification_tolerance_m: pathSimplification.toleranceM,
        geocoding: {
          start: { source: gStart.source || 'unknown', precision: gStart.precision || 'unknown', osm_id: gStart.osm_id || null },
          end: { source: gEnd.source || 'unknown', precision: gEnd.precision || 'unknown', osm_id: gEnd.osm_id || null },
        },
        created_at: new Date().toISOString(),
      };

      const stored = await withOrg(orgId, async (client) => {
        const insert = await client.query(
          `INSERT INTO geofences (name, type, coordinates, radius, region, org_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [name, 'corridor', JSON.stringify(coordinates), approxRadius, region, orgId]
        );
        const geofenceId = insert.rows?.[0]?.id;
        if (!geofenceId) throw new Error('Corridor insert returned no identifier');

        // Read back in the same tenant transaction. A write acknowledgement
        // alone is not proof that the authoritative geometry is valid.
        const verify = await client.query(
          `SELECT coordinates FROM geofences WHERE id = $1 AND org_id = $2`,
          [geofenceId, orgId]
        );
        let persisted = verify.rows?.[0]?.coordinates;
        if (typeof persisted === 'string') {
          try { persisted = JSON.parse(persisted); } catch (_) { persisted = null; }
        }
        const persistedPath = Array.isArray(persisted?.path) ? persisted.path : [];
        const first = persistedPath[0], last = persistedPath[persistedPath.length - 1];
        const startDriftM = first ? haversineM(gStart.latitude, gStart.longitude, Number(first[0]), Number(first[1])) : Infinity;
        const endDriftM = last ? haversineM(gEnd.latitude, gEnd.longitude, Number(last[0]), Number(last[1])) : Infinity;
        const shape = validateCorridorGeometry(persistedPath, persisted?.buffer_polygon, persisted?.buffer_m);
        const valid = shape.valid && persisted?.type === 'corridor' &&
          persistedPath.length === pathLatLng.length && startDriftM <= 1500 && endDriftM <= 1500;
        if (!valid) {
          await client.query('DELETE FROM geofences WHERE id = $1 AND org_id = $2', [geofenceId, orgId]);
          return {
            valid: false,
            verification: {
              path_points: persistedPath.length,
              expected_path_points: pathLatLng.length,
              start_drift_m: Number.isFinite(startDriftM) ? Math.round(startDriftM) : null,
              end_drift_m: Number.isFinite(endDriftM) ? Math.round(endDriftM) : null,
              shape_reason: shape.reason || null,
            },
          };
        }
        return { valid: true, geofenceId, persistedPath, startDriftM, endDriftM };
      });
      if (!stored.valid) {
        return {
          created: false,
          error: 'Geometry verification failed. No corridor geofence was retained.',
          verification: stored.verification,
        };
      }
      invalidateGeofenceCache(orgId);
      const geofenceId = stored.geofenceId;
      const persistedPath = stored.persistedPath;
      const startDriftM = stored.startDriftM;
      const endDriftM = stored.endDriftM;

      const effectivePrecision = precision === 'maximum' && (gStart.source === 'nominatim' || gStart.source === 'explicit') && (gEnd.source === 'nominatim' || gEnd.source === 'explicit')
        ? 'maximum'
        : (precision === 'standard' ? 'standard' : 'high');

      return {
        created: true,
        geofence_id: geofenceId,
        name,
        fence_type: 'corridor',
        lat: mid[0],
        lng: mid[1],
        radius_m: approxRadius,
        region,
        location: locationLabel,
        is_corridor: true,
        path_points: pathLatLng.length,
        source_path_points: pathSimplification.originalPointCount,
        path_simplification_tolerance_m: pathSimplification.toleranceM,
        road_distance_km: (distM / 1000).toFixed(2),
        buffer_m,
        precision: effectivePrecision,
        requested_precision: precision,
        route_provider: routeProvider,
        geometry_source: coordinates.geometry_source,
        geocode_precision: { start: gStart.precision, end: gEnd.precision },
        geometry_verification: { start_drift_m: Math.round(startDriftM), end_drift_m: Math.round(endDriftM), persisted_path_points: persistedPath.length },
        fallback_used: routeProvider !== 'OSRM',
        message: routeProvider === 'OSRM'
          ? `High-precision corridor "${name}" created on the routed road geometry: ${(distM / 1000).toFixed(2)} km, ${pathLatLng.length} verified centreline vertices, ${buffer_m}m deviation threshold${pathSimplification.toleranceM ? " (centreline simplified within 10m tolerance)" : ""}.`
          : `LOW-PRECISION explicit fallback "${name}" created from a straight line. Review before operational use.`,
      };
    }

    if (shape === 'polygon' || shape === 'boundary') {
      let g;
      let geometry;
      let geometrySource;
      let precisionUsed;
      let simplificationToleranceDegrees = null;
      let radius_m = null;

      if (shape === 'boundary') {
        const resolved = await geocodeAdministrativeBoundary(location);
        g = { ...resolved.location, cache_hit: resolved.cache_hit, stale_fallback: resolved.stale_fallback, stale_warning: resolved.stale_warning };
        geometry = normalizeBoundaryGeometry(resolved.geometry);
        simplificationToleranceDegrees = resolved.simplification_tolerance_degrees;
        const sourceName = g.source || 'source-backed administrative-boundary provider';
        const sourceYear = g.source_year ? ', dataset year ' + g.source_year : '';
        const license = g.license ? ', licence ' + g.license : '';
        const toleranceText = Number.isFinite(simplificationToleranceDegrees)
          ? ', topology-preserving simplification tolerance ' + simplificationToleranceDegrees + ' degrees'
          : '';
        geometrySource = sourceName + (sourceName.toLowerCase().includes('administrative boundary') ? '' : ' administrative boundary') + sourceYear + license + toleranceText;
        precisionUsed = 'source-backed-administrative-boundary';
      } else {
        g = await geocodePrecise(location);
        radius_m = Math.max(10, Math.min(Number(input.radius_m || 3000), 100000));
        geometry = createRadiusPolygon(g.latitude, g.longitude, radius_m);
        geometrySource = 'Sonalit-generated geodesic radius approximation (48 vertices)';
        precisionUsed = 'generated-radius-approximation';
      }

      const ring = geometry.coordinates[0];
      const polygonCoordinates = {
        type: 'Polygon',
        coordinates: geometry.coordinates,
        lat: g.latitude,
        lng: g.longitude,
        shape,
        radius_m,
        precision: precisionUsed,
        geometry_source: geometrySource,
        source_simplification_tolerance_degrees: simplificationToleranceDegrees,
        source_url: g.source_url || null,
        source_year: g.source_year || null,
        source_license: g.license || null,
        source_attribution: g.attribution || null,
        source_id: g.source_id || null,
        source_fetched_at: g.fetched_at || null,
        boundary_cache_hit: resolvedCacheHit(shape, g),
        vertex_count: ring.length - 1,
        geocoding: {
          source: g.source || (shape === 'boundary' ? 'source-backed-boundary' : 'unknown'),
          precision: g.precision || precisionUsed,
          osm_type: g.osm_type || null,
          osm_id: g.osm_id || null,
        },
        created_at: new Date().toISOString(),
      };
      const region = g.admin1 || g.country || location;

      const stored = await withOrg(orgId, async (client) => {
        const insert = await client.query(
          'INSERT INTO geofences (name, type, coordinates, radius, region, org_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [name, 'polygon', JSON.stringify(polygonCoordinates), radius_m, region, orgId]
        );
        const geofenceId = insert.rows?.[0]?.id;
        if (!geofenceId) throw new Error('Polygon insert returned no identifier');

        const verify = await client.query(
          'SELECT type, coordinates FROM geofences WHERE id = $1 AND org_id = $2',
          [geofenceId, orgId]
        );
        let persisted = verify.rows?.[0]?.coordinates;
        if (typeof persisted === 'string') {
          try { persisted = JSON.parse(persisted); } catch (_) { persisted = null; }
        }
        let normalized = null;
        try { normalized = normalizePolygonGeometry(persisted); } catch (_) {}
        const persistedRing = normalized?.coordinates?.[0];
        const valid = verify.rows?.[0]?.type === 'polygon'
          && Array.isArray(persistedRing)
          && persistedRing.length === ring.length
          && persistedRing[0]?.[0] === persistedRing[persistedRing.length - 1]?.[0]
          && persistedRing[0]?.[1] === persistedRing[persistedRing.length - 1]?.[1];
        if (!valid) {
          await client.query('DELETE FROM geofences WHERE id = $1 AND org_id = $2', [geofenceId, orgId]);
          return { valid: false, verification: { expected_vertices: ring.length, persisted_vertices: persistedRing?.length || 0 } };
        }
        return { valid: true, geofenceId, persistedRing };
      });

      if (!stored.valid) {
        return {
          created: false,
          error: 'Persisted polygon geometry failed verification. No geofence was retained.',
          verification: stored.verification,
        };
      }

      invalidateGeofenceCache(orgId);
      const locationLabel = g.name || location;
      const isBoundary = shape === 'boundary';
      const vertexCount = stored.persistedRing.length - 1;
      const message = isBoundary
        ? 'Source-backed administrative boundary geofence "' + name + '" created from ' + (g.source || 'a verified administrative-boundary provider') + ' at ' + locationLabel + ', with ' + vertexCount + ' verified vertices'
          + (g.source_year ? ' (source dataset year ' + g.source_year + ')' : '')
          + (Number.isFinite(simplificationToleranceDegrees) ? ' (topology-preserving simplification tolerance ' + simplificationToleranceDegrees + ' degrees)' : '')
          + (g.attribution ? '. Attribution: ' + g.attribution : '.')
          + (resolvedCacheHit(shape, g) ? ' Reused cached source-backed geometry.' : '')
          + (g.stale_warning ? ' Warning: ' + g.stale_warning : '')
        : 'Autonomously created a ' + vertexCount + '-vertex polygon geofence approximating a ' + radius_m + ' m radius around ' + locationLabel + '. This is a radius approximation, not an official place boundary.';

      return {
        created: true,
        geofence_id: stored.geofenceId,
        name,
        fence_type: isBoundary ? 'boundary' : 'polygon',
        shape,
        lat: g.latitude,
        lng: g.longitude,
        radius_m,
        region,
        location: locationLabel,
        precision: precisionUsed,
        geometry_source: geometrySource,
        source_simplification_tolerance_degrees: simplificationToleranceDegrees,
        source_url: g.source_url || null,
        source_year: g.source_year || null,
        source_license: g.license || null,
        source_attribution: g.attribution || null,
        source_id: g.source_id || null,
        source_fetched_at: g.fetched_at || null,
        boundary_cache_hit: resolvedCacheHit(shape, g),
        stale_source_fallback: Boolean(g.stale_fallback),
        vertex_count: vertexCount,
        geometry_verification: { vertices: vertexCount, persisted: true },
        message,
      };
    }

    const g = await geocodePrecise(location);
    const radius_m = Math.max(10, Math.min(Number(input.radius_m || 3000), 100000));
    const coordinates = {
      lat: g.latitude,
      lng: g.longitude,
      precision,
      geometry_source: 'geocoded point',
      geocoding: { source: g.source || 'unknown', precision: g.precision || 'unknown', osm_id: g.osm_id || null },
      created_at: new Date().toISOString(),
    };
    const region = g.admin1 || g.country || location;

    const stored = await withOrg(orgId, async (client) => {
      const insert = await client.query(
        `INSERT INTO geofences (name, type, coordinates, radius, region, org_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [name, 'circle', JSON.stringify(coordinates), radius_m, region, orgId]
      );
      const geofenceId = insert.rows?.[0]?.id;
      if (!geofenceId) throw new Error('Point geofence insert returned no identifier');
      const verify = await client.query(
        `SELECT type, radius, coordinates FROM geofences WHERE id = $1 AND org_id = $2`,
        [geofenceId, orgId]
      );
      const row = verify.rows?.[0];
      let persisted = row?.coordinates;
      if (typeof persisted === 'string') {
        try { persisted = JSON.parse(persisted); } catch (_) { persisted = null; }
      }
      const persistedLat = Number(persisted?.lat);
      const persistedLng = Number(persisted?.lng);
      const persistedRadius = Number(row?.radius);
      const driftM = Number.isFinite(persistedLat) && Number.isFinite(persistedLng)
        ? haversineM(g.latitude, g.longitude, persistedLat, persistedLng)
        : Infinity;
      const valid = row?.type === 'circle' && Number.isFinite(persistedRadius) &&
        Math.abs(persistedRadius - radius_m) < 0.5 && driftM <= 5;
      if (!valid) {
        await client.query('DELETE FROM geofences WHERE id = $1 AND org_id = $2', [geofenceId, orgId]);
        return { valid: false, verification: { persisted_type: row?.type || null, persisted_radius_m: Number.isFinite(persistedRadius) ? persistedRadius : null, coordinate_drift_m: Number.isFinite(driftM) ? Math.round(driftM * 100) / 100 : null } };
      }
      return { valid: true, geofenceId, driftM };
    });
    if (!stored.valid) {
      return { created: false, error: 'Persisted point geometry failed verification. No geofence was retained.', verification: stored.verification };
    }

    invalidateGeofenceCache(orgId);
    const locationLabel = g.name || location;
    return {
      created: true,
      geofence_id: stored.geofenceId,
      name,
      fence_type,
      lat: g.latitude,
      lng: g.longitude,
      radius_m,
      region,
      location: locationLabel,
      is_corridor: false,
      precision,
      geometry_source: coordinates.geometry_source,
      geocode_precision: g.precision,
      message: `Geofence "${name}" created at ${locationLabel}, radius ${radius_m}m, precision ${precision}.`,
    };
  } catch (e) {
    return { error: `Failed to create geofence: ${e.message}` };
  }
}

async function toolCreateRiskZone(input, userId, orgId) {
  if (!orgId) return { error: 'Organisation context is required' };
  const { name, location, risk_level = 'high', zone_type = 'general', description = '', radius_km = 5 } = input;
  if (!name || !location) return { error: 'name and location are required' };

  try {
    await ensureRiskZones();
    const explicitCoordinates = parseCoordinatePair(location);
    const g = explicitCoordinates
      ? { ...explicitCoordinates, name: 'Explicit coordinates', admin1: null, country: null }
      : await geocode(location);
    const desc = description || `${zone_type} risk zone near ${location}`;

    const r = await query(
      `INSERT INTO risk_zones (name, description, risk_level, zone_type, lat, lng, radius_km, created_by, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, risk_level, zone_type, lat, lng, radius_km`,
      [name, desc, risk_level, zone_type, g.latitude, g.longitude, radius_km, userId || null, orgId]
    );

    const locationLabel = [g.name, g.admin1, g.country].filter(Boolean).join(', ');
    return {
      created: true,
      risk_zone_id: r.rows[0].id,
      name,
      risk_level,
      zone_type,
      lat: g.latitude,
      lng: g.longitude,
      radius_km,
      location: locationLabel,
      message: `Risk zone "${name}" (${risk_level.toUpperCase()} — ${zone_type}) marked at ${locationLabel}, radius ${radius_km}km.`,
    };
  } catch (e) {
    return { error: `Failed to create risk zone: ${e.message}` };
  }
}

async function toolGetWorldContext(input, context) {
  const orgId = context && context.orgId ? context.orgId : null;
  const userId = context && context.userId ? context.userId : null;
  if (!orgId) return { error: 'Organisation context is required' };

  const requested = input || {};
  let subject = requested.subject || null;
  if (!subject && requested.convoy_id) subject = { kind: 'convoy', id: requested.convoy_id };
  if (!subject && requested.vehicle_id) subject = { kind: 'vehicle', id: requested.vehicle_id };
  if (!subject) subject = { kind: 'none', id: 'context' };

  if (!['convoy','vehicle','route','corridor','incident','checkpoint','port','location','none'].includes(subject.kind)) {
    return { error: 'Unsupported spatial subject kind' };
  }
  if (subject.kind !== 'none' && (!subject.id || typeof subject.id !== 'string')) {
    return { error: 'Spatial subject id is required' };
  }

  let center = null;
  if (requested.center) {
    const lat = Number(requested.center.latitude);
    const lng = Number(requested.center.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { error: 'Invalid spatial center' };
    }
    center = { latitude: lat, longitude: lng };
  }

  const radius = Number(requested.radiusM);
  let bbox = null;
  if (requested.bbox != null) {
    if (!Array.isArray(requested.bbox) || requested.bbox.length !== 4 || requested.bbox.some(x => !Number.isFinite(Number(x)))) {
      return { error: 'Invalid spatial bbox' };
    }
    bbox = requested.bbox.map(Number);
    const [west, south, east, north] = bbox;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north || (east - west) * (north - south) > 25) {
      return { error: 'Spatial bbox exceeds server bounds' };
    }
  }
  const maxEntitiesPerLayer = Number.isFinite(Number(requested.maxEntitiesPerLayer))
    ? Math.min(250, Math.max(1, Number(requested.maxEntitiesPerLayer)))
    : 100;
  const layers = Array.isArray(requested.layers)
    ? requested.layers.filter(x => typeof x === 'string').slice(0, 10)
    : ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts'];

  const ctx = await buildWorldContext({
    orgId,
    userId,
    db: (sql, params) => withOrg(orgId, client => client.query(sql, params)),
    subject: {
      kind: subject.kind,
      id: String(subject.id || 'context'),
      label: subject.label ? String(subject.label) : undefined,
    },
    center,
    radiusM: Number.isFinite(radius) && radius > 0 ? Math.min(radius, 250000) : 25000,
    bbox,
    layers,
    maxEntitiesPerLayer,
    requestId: requested.request_id ? String(requested.request_id).slice(0, 120) : undefined,
    persistEvents: false,
  });

  return {
    subject: ctx.subject,
    generatedAt: ctx.generatedAt,
    spatialContext: ctx.spatialContext || null,
    mission: ctx.mission || null,
    operational: ctx.operational || { vehicles: [], alerts: [] },
    relations: (ctx.relations || []).slice(0, 150),
    correlations: (ctx.correlations || []).slice(0, 75),
    events: (ctx.events || []).slice(0, 75),
    lifecycle: ctx.lifecycle || { resolvedEventIds: [], resolvedEventKeys: [] },
    environment: (ctx.environment || []).slice(0, 30),
    movement: (ctx.movement || []).slice(0, 50),
    infrastructure: (ctx.infrastructure || []).slice(0, 100),
    security: (ctx.security || []).slice(0, 100),
    traffic: (ctx.traffic || []).slice(0, 100),
    hazards: (ctx.hazards || []).slice(0, 100),
    coverage: ctx.coverage,
    layerHealth: ctx.layerHealth,
    providerCoverage: ctx.providerCoverage || {},

    provenance: ctx.provenance,
    freshness: ctx.freshness,
    uncertainty: ctx.uncertainty,
    warnings: ctx.warnings,
    entities: (ctx.entities || []).slice(0, 250),
    providerHealth: ctx.providerHealth || {},
    dataHealth: ctx.dataHealth || { ok: true, readErrors: [] },
  };
}

async function runTool(name, input, context = {}) {
  const userId = context.userId || null;
  const orgId = context.orgId || null;
  switch (name) {
    case 'query_vehicles':     return toolQueryVehicles(input || {}, orgId);
    case 'query_shipments':   return toolQueryShipments(input || {}, orgId);
    case 'query_maintenance': return toolQueryMaintenance(input || {}, orgId);
    case 'query_geofences':   return toolQueryGeofences(input || {}, orgId);
    case 'query_drivers':     return toolQueryDrivers(input || {}, orgId);
    case 'query_devices':     return toolQueryDevices(input || {}, orgId);
    case 'query_convoys':      return toolQueryConvoys(input || {}, orgId);
    case 'query_alerts':       return toolQueryAlerts(input || {}, orgId);
    case 'get_weather':        return toolGetWeather(input || {});
    case 'check_holidays':     return toolCheckHolidays(input || {});
    case 'get_road_conditions':return toolGetRoadConditions(input || {});
    case 'query_risk_zones':   return toolQueryRiskZones(input || {}, orgId);
    case 'get_world_context':  return toolGetWorldContext(input || {}, context);
    case 'create_geofence':    return toolCreateGeofence(input || {}, userId, orgId);
    case 'create_risk_zone':   return toolCreateRiskZone(input || {}, userId, orgId);
    default: return { error: `Unknown tool: ${name}` };
  }
}


async function recordCopilotToolTraceBestEffort(trace) {
  try {
    return await actionLedger.recordToolTrace(trace);
  } catch (error) {
    logger.warn('Copilot tool trace persistence failed: ' + String(error && error.message || error).slice(0, 180));
    return null;
  }
}

async function persistCopilotReceiptBestEffort({ orgId, userId, command, result, requestId }) {
  try {
    return await persistCopilotDecision({ orgId, userId, command, result, requestId });
  } catch (error) {
    logger.warn('Copilot request receipt persistence failed: ' + String(error && error.message || error).slice(0, 180));
    return null;
  }
}

function buildCopilotActionOutcome({ toolName, result, run, requestId, source, replayed = false }) {
  const succeeded = Boolean(result && result.created === true);
  const entityType = toolName === 'create_risk_zone' ? 'risk_zone' : 'geofence';
  const responseText = result && (result.message || result.error)
    ? String(result.message || result.error)
    : (succeeded ? 'The requested operation completed.' : 'The requested operation was not completed.');
  return {
    response: responseText,
    answer: responseText,
    actions: succeeded ? [toolName] : [],
    created: succeeded ? [{ type: entityType, ...result }] : [],
    task: { type: entityType, completed: succeeded },
    action_receipt: actionLedger.makeActionReceipt(run),
    request_id: requestId,
    source,
    ...(replayed ? { replayed: true } : {}),
  };
}

function makePendingActionView(run, token) {
  const input = run && run.action_input && typeof run.action_input === 'object' ? run.action_input : {};
  const location = typeof input.location === 'string' ? input.location : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const details = [];
  if (location) details.push('Location: ' + location);
  if (description) details.push(description);
  if (input.zone_type) details.push('Type: ' + String(input.zone_type));
  if (input.risk_level) details.push('Risk level: ' + String(input.risk_level));
  if (Number.isFinite(Number(input.radius_km))) details.push('Radius: ' + String(input.radius_km) + ' km');
  return {
    action_id: run.id,
    request_id: run.request_id,
    confirmation_token: token,
    tool_name: run.tool_name,
    title: String(input.name || 'Review operational action').slice(0, 160),
    summary: details.join(' • ').slice(0, 700) || 'Review the operation details before confirming.',
    risk_level: run.risk_level,
    preview: actionLedger.summarizeToolInput(input),
    created_at: run.created_at,
    expires_at: run.expires_at,
  };
}

async function runCopilotEvidenceFallback({ command, history, userId, orgId, requestId }) {
  let ordinal = 0;
  const result = await runDecisionFabric({
    command,
    history,
    userId,
    orgId,
    executeTool: async (name, input) => {
      if (!READ_ONLY_TOOLS.includes(name)) return { error: 'tool_policy_missing', tool: name };
      const started = Date.now();
      let value;
      let errorCode = null;
      try {
        value = await runTool(name, input || {}, { userId, orgId });
      } catch (error) {
        errorCode = 'tool_execution_failed';
        value = { error: errorCode, message: String(error && error.message || error).slice(0, 250) };
      }
      await recordCopilotToolTraceBestEffort({
        orgId, userId, requestId, ordinal: ordinal++, toolName: name,
        status: value && value.error ? 'failed' : 'succeeded',
        input, result: value, latencyMs: Date.now() - started,
        provider: 'decision-fabric', errorCode,
      });
      return value;
    },
    persistDecision: (args) => persistCopilotDecision({ ...args, requestId }),
  });
  const answer = result.answer || 'No decision narrative was returned.';
  return {
    ...result,
    answer,
    response: answer,
    request_id: requestId,
    decision_id: result.id || null,
    source: result.meta && result.meta.degraded ? 'decision-fabric-fallback' : 'decision-fabric',
  };
}

// ── POST /ai/decision — unified Decision Intelligence Fabric ──────────────
// Conversation + decision support share one resilient swarm. The legacy
// /dispatch endpoint remains intact for existing tool-execution workflows.
router.get('/decision/history', async (req, res) => {
  try {
    const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });
    const userId = req.user?.id || null;
    if (!userId) return res.status(403).json({ error: 'User context required' });
    const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 50);
    const r = await query(
      `SELECT id, request_id, command, decision, risk_level, confidence, answer, created_at, outcome, outcome_notes
       FROM public.copilot_decisions
       WHERE org_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [orgId, userId, limit]
    );
    return res.json({ data: r.rows });
  } catch (err) {
    logger.error('Copilot history error: ' + err.message);
    return res.status(500).json({ error: 'Unable to load Copilot history' });
  }
});

router.post('/decision/:decisionId/feedback', async (req, res) => {
  try {
    const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id;
    const userId = req.user?.id || null;
    const outcome = String(req.body?.outcome || '').trim();
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 4000) : null;
    const allowed = new Set(['correct', 'incorrect', 'partially_correct', 'superseded', 'unknown']);
    if (!orgId || !userId || !allowed.has(outcome)) return res.status(400).json({ error: 'Valid organisation, user and outcome required' });
    const exists = await query(
      'SELECT id FROM public.copilot_decisions WHERE id = $1 AND org_id = $2 AND user_id = $3',
      [req.params.decisionId, orgId, userId]
    );
    if (!exists.rows.length) return res.status(404).json({ error: 'Decision not found' });
    await query(
      `INSERT INTO public.copilot_decision_feedback (decision_id, org_id, user_id, outcome, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.decisionId, orgId, userId, outcome, notes]
    );
    await query(
      `UPDATE public.copilot_decisions
       SET outcome=$1, outcome_notes=$2, outcome_recorded_at=NOW()
       WHERE id=$3 AND org_id=$4 AND user_id=$5`,
      [outcome, notes, req.params.decisionId, orgId, userId]
    );
    return res.json({ ok: true, decision_id: req.params.decisionId, outcome });
  } catch (err) {
    logger.error('Copilot feedback error: ' + err.message);
    return res.status(500).json({ error: 'Unable to record Copilot feedback' });
  }
});

router.post('/decision', async (req, res) => {
  const request = validateCopilotRequest(req.body, 12);
  if (request.error) return res.status(request.status).json({ error: request.error });
  const { command, history } = request;

  // Do not short-circuit when model providers are unavailable. The decision fabric
  // has a deterministic evidence-only fallback and must remain operational.
  try {
    await ensureColumns();
    await ensureRiskZones();
    const result = await runDecisionFabric({
      command: String(command).trim(),
      history: Array.isArray(history) ? history : [],
      executeTool: (name, input, context) => runTool(name, input, context),
      userId: req.user?.id || null,
      orgId: req.user?.org_id || req.user?.orgId || req.user?.organization_id || null,
      persistDecision: (args) => persistCopilotDecision({ ...args, requestId: request.requestId }),
    });

    return res.json({
      ...result,
      answer: result.answer || 'No decision narrative was returned.',
    });
  } catch (err) {
    logger.error('Decision Intelligence Fabric error: ' + (err?.message || err));
    return res.status(200).json({
      answer: 'Sonalit Copilot entered fail-safe mode. The swarm could not complete this request; no irreversible AI action is authorised.',
      decision: 'HUMAN_REVIEW_REQUIRED',
      risk_level: 'HIGH',
      confidence: 0,
      recommended_actions: [],
      risks: [{ risk: 'Decision fabric execution failure', severity: 'high' }],
      meta: { degraded: true, fatal: true, error: err?.message || 'unknown' },
    });
  }
});

// ── POST /ai/dispatch — agentic tool-use loop ──────────────────────────────
router.post('/dispatch', async (req, res) => {
  const request = validateCopilotRequest(req.body, 6);
  if (request.error) return res.status(request.status).json({ error: request.error });
  const { command, history, requestId } = request;
  const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id || null;
  const userId = req.user?.id || null;
  const user = { ...(req.user || {}), id: userId, org_id: orgId };
  const classification = classifyCopilotCommand(command);
  const geofenceTask = classification.kind === 'action' && hasExplicitActionIntent(command, 'create_geofence')
    ? inferGeofenceTask(command)
    : null;
  const riskZoneTask = classification.kind === 'action' && hasExplicitActionIntent(command, 'create_risk_zone')
    ? inferRiskZoneTask(command)
    : null;

  // Authorization happens before provider/model calls so a disallowed user
  // cannot ask a model to launder a prohibited action through tool selection.
  const explicitMutation = Object.keys(ACTION_POLICIES).find(toolName => hasExplicitActionIntent(command, toolName));
  if (explicitMutation) {
    const authorization = authorizeCopilotTool({ toolName: explicitMutation, command, user });
    if (!authorization.allowed) {
      return res.status(403).json({
        error: authorization.code || 'action_not_authorized',
        message: authorization.reason || 'This operation is not authorized.',
        minimum_role: authorization.minimum_role,
        request_id: requestId,
      });
    }
  }

  // Geofence geometry must come from the deterministic, validated geospatial
  // builder. We never permit the model to invent or directly persist vertices.
  if (geofenceTask) {
    const authorization = authorizeCopilotTool({ toolName: 'create_geofence', command, user });
    if (!authorization.allowed) {
      return res.status(403).json({ error: authorization.code, message: authorization.reason, request_id: requestId });
    }

    const { task: _taskName, ...geofenceInput } = geofenceTask;
    const definition = TOOLS.find(tool => tool.name === 'create_geofence');
    const check = definition ? validateToolInput(definition.input_schema, geofenceInput) : { valid: false, errors: [] };
    if (!check.valid) return res.status(400).json({ error: 'invalid_geofence_request', details: check.errors, request_id: requestId });

    let actionCreated;
    try {
      actionCreated = await actionLedger.createActionRun({
        orgId, userId, requestId, command, toolName: 'create_geofence',
        input: geofenceInput, riskLevel: authorization.risk_level, status: 'executing',
      });
    } catch (error) {
      logger.error('Copilot geofence audit reservation failed: ' + String(error && error.message || error).slice(0, 180));
      return res.status(503).json({
        error: String(error && error.message || error) === 'idempotency_conflict' ? 'idempotency_conflict' : 'action_audit_unavailable',
        message: 'The geofence was not created because a durable action receipt could not be reserved.',
        request_id: requestId,
      });
    }

    const actionRun = actionCreated.run;
    if (actionCreated.duplicate) {
      if (actionRun.status === 'succeeded') {
        return res.json(buildCopilotActionOutcome({
          toolName: 'create_geofence', result: actionRun.result || {}, run: actionRun,
          requestId, source: 'action-replay', replayed: true,
        }));
      }
      return res.status(409).json({
        error: actionRun.status === 'executing' ? 'action_in_progress' : 'idempotent_request_already_resolved',
        message: 'This request ID already belongs to a geofence action. Use a new request ID for a new operation.',
        action_receipt: actionLedger.makeActionReceipt(actionRun),
        request_id: requestId,
      });
    }

    const started = Date.now();
    let result;
    try {
      result = await toolCreateGeofence(geofenceInput, userId, orgId);
    } catch (error) {
      result = { created: false, error: 'Geofence task failed safely: ' + String(error && error.message || error).slice(0, 250) };
    }

    let finished;
    try {
      finished = await actionLedger.finishActionRun({
        orgId, actionId: actionRun.id,
        status: result && result.created === true ? 'succeeded' : 'failed',
        result,
        errorCode: result && result.created === true ? null : 'geofence_creation_failed',
      });
    } catch (error) {
      logger.error('Copilot geofence result ledger update failed: ' + String(error && error.message || error).slice(0, 180));
    }
    await recordCopilotToolTraceBestEffort({
      orgId, userId, requestId, ordinal: 0, toolName: 'create_geofence',
      status: result && result.created === true ? 'succeeded' : 'failed',
      input: geofenceInput, result, latencyMs: Date.now() - started,
      provider: 'deterministic-geofence',
      errorCode: result && result.created === true ? null : 'geofence_creation_failed',
    });

    const runForReceipt = finished || {
      ...actionRun,
      status: result && result.created === true ? 'executing' : 'failed',
      result,
    };
    const outcome = buildCopilotActionOutcome({
      toolName: 'create_geofence', result, run: runForReceipt,
      requestId, source: result && result.created === true ? 'deterministic-geofence' : 'geofence-validation',
    });
    if (result && result.created === true && !finished) {
      const warning = ' The geofence was created, but the action ledger could not finalise its receipt. Verify the geofence before retrying this request.';
      outcome.response += warning;
      outcome.answer = outcome.response;
      outcome.source = 'action-ledger-degraded';
    }
    await persistCopilotReceiptBestEffort({
      orgId, userId, command,
      result: {
        decision: result && result.created === true ? 'ACT_NOW' : 'HUMAN_REVIEW_REQUIRED',
        risk_level: 'MEDIUM',
        confidence: result && result.created === true ? 0.98 : 0.5,
        answer: outcome.response,
        evidence: ['create_geofence', 'persisted_geometry_verification'],
        missing_data: [],
        risks: result && result.created === true ? [] : [{ risk: 'Geofence was not created', severity: 'medium' }],
        swarm: [],
      },
      requestId,
    });
    return res.json(outcome);
  }

  if (explicitMutation === 'create_geofence' && !geofenceTask) {
    return res.status(400).json({
      error: 'geofence_request_not_understood',
      message: 'No geofence was created. Specify one unambiguous place or valid latitude/longitude pair, and choose a radius between 10 m and 100 km. Corridor buffers must be between 10 m and 5 km. Copilot will not silently change invalid geometry dimensions.',
      request_id: requestId,
      actions: [],
      created: [],
      source: 'deterministic-intent-validation',
    });
  }

  if (explicitMutation === 'create_risk_zone' && !riskZoneTask) {
    return res.status(400).json({
      error: 'risk_zone_request_not_understood',
      message: 'No risk zone was staged. Specify one unambiguous place or valid latitude/longitude pair and, when needed, a radius from 0.1 to 100 km. Use an explicit radius such as “radius 5 km”; Copilot will not guess or silently change the requested geometry.',
      request_id: requestId,
      actions: [],
      created: [],
      source: 'deterministic-intent-validation',
    });
  }

  // Deterministic risk-zone intent stages high-risk writes even if every model
  // provider is down. The write itself remains impossible until the user
  // approves a signed, tenant-bound, expiring confirmation receipt.
  if (riskZoneTask) {
    const authorization = authorizeCopilotTool({ toolName: 'create_risk_zone', command, user });
    if (!authorization.allowed || !authorization.requires_confirmation) {
      return res.status(403).json({
        error: authorization.code || 'confirmation_policy_invalid',
        message: authorization.reason || 'Risk-zone confirmation policy is unavailable.',
        request_id: requestId,
      });
    }
    const { task: _taskName, ...riskZoneInput } = riskZoneTask;
    const definition = TOOLS.find(tool => tool.name === 'create_risk_zone');
    const check = definition ? validateToolInput(definition.input_schema, riskZoneInput) : { valid: false, errors: [] };
    if (!check.valid) return res.status(400).json({ error: 'invalid_risk_zone_request', details: check.errors, request_id: requestId });

    let staged;
    try {
      staged = await actionLedger.createActionRun({
        orgId, userId, requestId, command, toolName: 'create_risk_zone',
        input: riskZoneInput, riskLevel: authorization.risk_level, status: 'pending_confirmation',
      });
    } catch (error) {
      const conflict = String(error && error.message || error) === 'idempotency_conflict';
      return res.status(conflict ? 409 : 503).json({
        error: conflict ? 'idempotency_conflict' : 'action_audit_unavailable',
        message: conflict
          ? 'This request ID already belongs to a different action. Submit a fresh request.'
          : 'The risk zone was not created or staged because a durable approval record could not be saved.',
        request_id: requestId,
      });
    }

    const actionRun = staged.run;
    if (staged.duplicate && actionRun.status === 'succeeded') {
      return res.json(buildCopilotActionOutcome({
        toolName: 'create_risk_zone', result: actionRun.result || {}, run: actionRun,
        requestId, source: 'action-replay', replayed: true,
      }));
    }
    if (actionRun.status !== 'pending_confirmation') {
      return res.status(409).json({
        error: actionRun.status === 'executing' ? 'action_in_progress' : 'idempotent_request_already_resolved',
        response: 'This request ID already belongs to an action that is not awaiting approval.',
        action_receipt: actionLedger.makeActionReceipt(actionRun),
        request_id: requestId,
      });
    }

    let confirmationToken;
    try {
      confirmationToken = signActionConfirmation({
        actionId: actionRun.id, orgId, userId, expiresAt: actionRun.expires_at,
      });
    } catch (error) {
      if (!staged.duplicate) {
        try { await actionLedger.declineActionRun({ orgId, actionId: actionRun.id, userId }); } catch (_) {}
      }
      logger.error('Copilot deterministic risk-zone approval signing failed: ' + String(error && error.message || error).slice(0, 160));
      return res.status(503).json({
        error: 'confirmation_signing_unavailable',
        response: 'The high-risk action was not staged because confirmation signing is unavailable.',
        request_id: requestId,
      });
    }

    const pendingAction = makePendingActionView(actionRun, confirmationToken);
    const pendingText = 'A high-risk risk-zone action is prepared but has not been executed. Review its exact location, radius and severity, then explicitly confirm it below.';
    await recordCopilotToolTraceBestEffort({
      orgId, userId, requestId, ordinal: 0, toolName: 'create_risk_zone',
      status: 'pending_confirmation', input: riskZoneInput,
      result: { pending_confirmation: true, action_id: actionRun.id, risk_level: actionRun.risk_level },
      latencyMs: 0, provider: 'deterministic-intent',
    });
    await persistCopilotReceiptBestEffort({
      orgId, userId, command,
      result: {
        decision: 'APPROVAL_REQUIRED',
        risk_level: 'HIGH',
        confidence: 0.95,
        answer: pendingText,
        evidence: ['deterministic_action_intent', 'action_policy', 'durable_confirmation_record'],
        missing_data: [],
        risks: [{ risk: 'High-risk operational write is awaiting explicit operator confirmation', severity: 'high' }],
        swarm: [],
        pending_action_id: actionRun.id,
      },
      requestId,
    });
    return res.json({
      response: pendingText,
      answer: pendingText,
      actions: [],
      created: [],
      pending_actions: [pendingAction],
      action_receipt: actionLedger.makeActionReceipt(actionRun),
      request_id: requestId,
      source: 'approval-required',
    });
  }

  const runFallback = async () => runCopilotEvidenceFallback({ command, history, userId, orgId, requestId });

  // One public endpoint, two server-selected lanes: investigation turns keep
  // the Decision Fabric's evidence plan, deterministic safety gate and synthesis.
  // The browser never picks a less-governed execution path with regex keywords.
  if (classification.kind === 'investigation') {
    try {
      return res.json(await runFallback());
    } catch (error) {
      logger.error('Copilot investigation failed: ' + String(error && error.message || error).slice(0, 200));
      return res.status(503).json({
        error: 'copilot_unavailable',
        response: 'Copilot could not complete its evidence-backed investigation. No operational write was performed.',
        request_id: requestId,
        source: 'error',
      });
    }
  }

  if (!aiClient.hasAnthropic() && !aiClient.hasGroqFallback()) {
    if (hasExplicitActionIntent(command, 'create_risk_zone')) {
      return res.status(503).json({
        error: 'ai_provider_unavailable',
        response: 'No high-risk zone was created. Copilot needs an available reasoning provider to prepare a confirmable action.',
        request_id: requestId,
        actions: [],
        created: [],
        source: 'unconfigured',
      });
    }
    try {
      return res.json(await runFallback());
    } catch (error) {
      logger.error('Copilot evidence fallback failed: ' + String(error && error.message || error));
      return res.status(503).json({
        error: 'copilot_unavailable',
        response: 'Copilot could not access its reasoning provider or evidence fallback. No operational write was performed.',
        request_id: requestId,
        source: 'error',
      });
    }
  }

  try {
    await ensureColumns();
    await ensureRiskZones();
    const messages = [
      ...history.slice(-6)
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: command },
    ];
    const toolsUsed = [];
    const actionsCreated = [];
    const policyBlockedActions = [];
    let finalText = '';
    let lastProvider = 'anthropic';
    let toolOrdinal = 0;
    let mutationAttempted = false;

    for (let turn = 0; turn < 6; turn += 1) {
      const response = await aiClient.createMessage({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
      lastProvider = response._provider || lastProvider;

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const ordinal = toolOrdinal++;
          toolsUsed.push(block.name);
          const definition = TOOLS.find(tool => tool.name === block.name);
          const argumentCheck = definition
            ? validateToolInput(definition.input_schema, block.input)
            : { valid: false, errors: [{ path: 'input', code: 'unknown_tool', message: 'Tool is not registered.' }] };
          let result;
          let isError = false;
          let traceStatus = 'succeeded';
          let errorCode = null;
          const started = Date.now();

          if (!argumentCheck.valid) {
            result = { error: 'invalid_tool_input', details: argumentCheck.errors };
            isError = true;
            traceStatus = 'denied';
            errorCode = 'invalid_tool_input';
          } else if (ACTION_POLICIES[block.name]) {
            const authorization = authorizeCopilotTool({ toolName: block.name, command, user });
            if (!authorization.allowed) {
              result = { error: authorization.code || 'action_not_authorized', message: authorization.reason || 'Action not authorized.' };
              isError = true;
              traceStatus = 'denied';
              errorCode = authorization.code || 'action_not_authorized';
              policyBlockedActions.push({ tool_name: block.name, code: errorCode });
            } else if (block.name === 'create_geofence') {
              // If the deterministic parser did not recognise the user's
              // request, do not let model-generated arguments write geometry.
              result = {
                error: 'deterministic_geofence_parser_required',
                message: 'No geofence was written. Rephrase the request with an explicit named location or coordinates and a supported radius or route corridor.',
              };
              isError = true;
              traceStatus = 'denied';
              errorCode = 'deterministic_geofence_parser_required';
              policyBlockedActions.push({ tool_name: block.name, code: errorCode });
            } else if (authorization.requires_confirmation && mutationAttempted) {
              result = { error: 'multiple_mutations_per_request', message: 'Only one mutating operation may be staged per Copilot request.' };
              isError = true;
              traceStatus = 'denied';
              errorCode = 'multiple_mutations_per_request';
              policyBlockedActions.push({ tool_name: block.name, code: errorCode });
            } else if (authorization.requires_confirmation) {
              mutationAttempted = true;
              let staged;
              try {
                staged = await actionLedger.createActionRun({
                  orgId, userId, requestId, command,
                  toolName: block.name, input: block.input,
                  riskLevel: authorization.risk_level, status: 'pending_confirmation',
                });
              } catch (error) {
                const failureCode = String(error && error.message || error) === 'idempotency_conflict' ? 'idempotency_conflict' : 'action_audit_unavailable';
                const statusCode = failureCode === 'idempotency_conflict' ? 409 : 503;
                logger.error('Copilot confirmation staging failed: ' + String(error && error.message || error).slice(0, 180));
                return res.status(statusCode).json({
                  error: failureCode,
                  response: failureCode === 'idempotency_conflict'
                    ? 'This request ID already belongs to a different action. Submit a fresh request rather than retrying with a reused ID.'
                    : 'The high-risk action was not executed because its approval record could not be saved.',
                  request_id: requestId,
                  source: 'action-control-plane',
                });
              }

              const actionRun = staged.run;
              if (staged.duplicate && actionRun.status === 'succeeded') {
                return res.json(buildCopilotActionOutcome({
                  toolName: block.name,
                  result: actionRun.result || {},
                  run: actionRun,
                  requestId,
                  source: 'action-replay',
                  replayed: true,
                }));
              }
              if (!['pending_confirmation'].includes(actionRun.status)) {
                return res.status(409).json({
                  error: actionRun.status === 'executing' ? 'action_in_progress' : 'idempotent_request_already_resolved',
                  response: 'This request ID already belongs to an action that is no longer awaiting approval.',
                  request_id: requestId,
                  action_receipt: actionLedger.makeActionReceipt(actionRun),
                });
              }
              if (!actionRun.expires_at || new Date(actionRun.expires_at).getTime() <= Date.now()) {
                await actionLedger.claimActionRun({ orgId, actionId: actionRun.id, userId });
                return res.status(409).json({
                  error: 'confirmation_expired',
                  response: 'The approval window expired. Submit a new request to prepare another action.',
                  request_id: requestId,
                });
              }

              let confirmationToken;
              try {
                confirmationToken = signActionConfirmation({
                  actionId: actionRun.id, orgId, userId, expiresAt: actionRun.expires_at,
                });
              } catch (error) {
                if (!staged.duplicate) {
                  try { await actionLedger.declineActionRun({ orgId, actionId: actionRun.id, userId }); } catch (_) {}
                }
                logger.error('Copilot approval token unavailable: ' + String(error && error.message || error).slice(0, 160));
                return res.status(503).json({
                  error: 'confirmation_signing_unavailable',
                  response: 'The high-risk action was not staged for execution because confirmation signing is unavailable.',
                  request_id: requestId,
                });
              }

              const pendingAction = makePendingActionView(actionRun, confirmationToken);
              const pendingText = 'A high-risk action is prepared but has not been executed. Review its details and explicitly confirm it below.';
              await recordCopilotToolTraceBestEffort({
                orgId, userId, requestId, ordinal, toolName: block.name,
                status: 'pending_confirmation', input: block.input,
                result: { pending_confirmation: true, action_id: actionRun.id, risk_level: actionRun.risk_level },
                latencyMs: Date.now() - started, provider: lastProvider,
              });
              await persistCopilotReceiptBestEffort({
                orgId, userId, command,
                result: {
                  decision: 'APPROVAL_REQUIRED',
                  risk_level: 'HIGH',
                  confidence: 0.9,
                  answer: pendingText,
                  evidence: ['action_policy', 'durable_confirmation_record'],
                  missing_data: [],
                  risks: [{ risk: 'High-risk operational write is awaiting explicit confirmation', severity: 'high' }],
                  swarm: [],
                  pending_action_id: actionRun.id,
                },
                requestId,
              });
              return res.json({
                response: pendingText,
                answer: pendingText,
                actions: [],
                created: [],
                pending_actions: [pendingAction],
                action_receipt: actionLedger.makeActionReceipt(actionRun),
                request_id: requestId,
                source: 'approval-required',
              });
            } else {
              result = { error: 'confirmation_policy_missing', message: 'The mutation is blocked because its confirmation policy is incomplete.' };
              isError = true;
              traceStatus = 'denied';
              errorCode = 'confirmation_policy_missing';
              policyBlockedActions.push({ tool_name: block.name, code: errorCode });
            }
          } else {
            try {
              result = await runTool(block.name, block.input, { userId, orgId });
              if (result && typeof result === 'object' && result.error) {
                isError = true;
                traceStatus = 'failed';
                errorCode = String(result.code || result.error).slice(0, 100);
              }
            } catch (error) {
              result = { error: 'tool_execution_failed', message: String(error && error.message || 'Unknown tool failure').slice(0, 300) };
              isError = true;
              traceStatus = 'failed';
              errorCode = 'tool_execution_failed';
              logger.warn('Copilot read tool ' + block.name + ' failed: ' + String(error && error.message || error).slice(0, 180));
            }
          }

          await recordCopilotToolTraceBestEffort({
            orgId, userId, requestId, ordinal, toolName: block.name,
            status: traceStatus, input: block.input, result,
            latencyMs: Date.now() - started, provider: lastProvider, errorCode,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: isError,
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      finalText = (response.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();
      break;
    }

    if (policyBlockedActions.length) {
      finalText = (finalText || 'I could not complete the requested operation.') +
        '\n\n**Execution safeguard:** No blocked write was executed. ' +
        policyBlockedActions.map(item => item.tool_name + ': ' + item.code).join('; ');
    }
    const responseText = finalText || 'I could not produce a response — please rephrase your request.';
    const receipt = await persistCopilotReceiptBestEffort({
      orgId, userId, command,
      result: {
        decision: policyBlockedActions.length ? 'HUMAN_REVIEW_REQUIRED' : 'MONITOR',
        risk_level: policyBlockedActions.length ? 'HIGH' : 'LOW',
        confidence: policyBlockedActions.length ? 0.5 : 0.7,
        answer: responseText,
        evidence: toolsUsed,
        missing_data: [],
        risks: policyBlockedActions.map(item => ({ risk: item.code, severity: 'high' })),
        swarm: [],
      },
      requestId,
    });
    return res.json({
      response: responseText,
      answer: responseText,
      actions: [...new Set(toolsUsed)],
      tools_used: [...new Set(toolsUsed)],
      created: actionsCreated,
      decision_id: receipt || null,
      request_id: requestId,
      source: lastProvider === 'groq' ? 'groq-fallback' : 'claude',
    });
  } catch (error) {
    logger.error('Copilot dispatch error: ' + String(error && error.message || error).slice(0, 250));
    try {
      const fallback = await runFallback();
      return res.json({
        ...fallback,
        meta: { ...(fallback.meta || {}), degraded: true, fallback_reason: 'agent_execution_failed' },
      });
    } catch (fallbackError) {
      logger.error('Copilot fallback after dispatch failure failed: ' + String(fallbackError && fallbackError.message || fallbackError).slice(0, 180));
      return res.status(503).json({
        error: 'copilot_unavailable',
        response: 'Copilot could not complete its reasoning or evidence fallback. No further operational write was attempted.',
        request_id: requestId,
        source: 'error',
      });
    }
  }
});

router.get('/dispatch/pending', async (req, res) => {
  const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id || null;
  const userId = req.user?.id || null;
  if (!orgId || !userId) return res.status(403).json({ error: 'Tenant and user context required' });
  try {
    const runs = await actionLedger.listPendingActionRuns({ orgId, userId, limit: 15 });
    const pendingActions = runs.map(run => {
      const token = signActionConfirmation({
        actionId: run.id, orgId, userId, expiresAt: run.expires_at,
      });
      return makePendingActionView(run, token);
    });
    return res.json({ pending_actions: pendingActions });
  } catch (error) {
    logger.error('Copilot pending action list failed: ' + String(error && error.message || error).slice(0, 180));
    return res.status(503).json({ error: 'pending_actions_unavailable', pending_actions: [] });
  }
});

router.post('/dispatch/confirm', async (req, res) => {
  const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id || null;
  const userId = req.user?.id || null;
  if (!orgId || !userId) return res.status(403).json({ error: 'Tenant and user context required' });
  const actionId = req.body?.action_id;
  const confirmationToken = req.body?.confirmation_token;
  const approved = req.body?.approved;
  if (typeof actionId !== 'string' || !REQUEST_ID_PATTERN.test(actionId) || typeof approved !== 'boolean' || typeof confirmationToken !== 'string' || confirmationToken.length > 4096) {
    return res.status(400).json({ error: 'valid action_id UUID, confirmation_token and boolean approved are required' });
  }

  try {
    const run = await actionLedger.getActionRun({ orgId, actionId });
    if (!run) return res.status(404).json({ error: 'action_not_found' });
    if (String(run.user_id) !== String(userId)) return res.status(403).json({ error: 'action_owner_mismatch' });

    // A retry after a successful operation returns its durable result without
    // requiring a still-live token and without executing the write again.
    if (run.status === 'succeeded') {
      return res.json(buildCopilotActionOutcome({
        toolName: run.tool_name, result: run.result || {}, run,
        requestId: run.request_id, source: 'action-replay', replayed: true,
      }));
    }
    if (run.status !== 'pending_confirmation') {
      return res.status(409).json({
        error: run.status === 'executing' ? 'action_in_progress' : 'action_not_pending',
        action_receipt: actionLedger.makeActionReceipt(run),
      });
    }

    const verified = verifyActionConfirmation(confirmationToken);
    if (!verified.valid) return res.status(403).json({ error: verified.code || 'invalid_confirmation_token' });
    const tokenPayload = verified.payload;
    if (
      tokenPayload.action_id !== run.id
      || tokenPayload.org_id !== String(orgId)
      || tokenPayload.user_id !== String(userId)
    ) {
      return res.status(403).json({ error: 'confirmation_identity_mismatch' });
    }

    if (!approved) {
      const declined = await actionLedger.declineActionRun({ orgId, actionId, userId });
      if (!declined) return res.status(409).json({ error: 'action_already_resolved' });
      await recordCopilotToolTraceBestEffort({
        orgId, userId, requestId: run.request_id, ordinal: 9999,
        toolName: run.tool_name, status: 'denied',
        input: run.action_input, result: { declined: true },
        latencyMs: 0, provider: 'operator-confirmation', errorCode: 'operator_declined',
      });
      const responseText = 'The proposed action was declined. No operational write was performed.';
      await persistCopilotReceiptBestEffort({
        orgId, userId, command: run.command,
        result: { decision: 'NO_ACTION', risk_level: run.risk_level.toUpperCase(), confidence: 1, answer: responseText, evidence: ['operator_declined'], missing_data: [], risks: [], swarm: [] },
        requestId: run.request_id,
      });
      return res.json({
        response: responseText,
        answer: responseText,
        action_receipt: actionLedger.makeActionReceipt(declined),
        request_id: run.request_id,
        source: 'operator-declined',
      });
    }

    const authorization = authorizeCopilotTool({
      toolName: run.tool_name,
      command: run.command,
      user: { ...req.user, id: userId, org_id: orgId },
    });
    if (!authorization.allowed || !authorization.requires_confirmation) {
      return res.status(403).json({
        error: authorization.code || 'confirmation_policy_invalid',
        message: authorization.reason || 'The action is no longer eligible for this confirmation workflow.',
      });
    }
    const definition = TOOLS.find(tool => tool.name === run.tool_name);
    const argumentCheck = definition
      ? validateToolInput(definition.input_schema, run.action_input)
      : { valid: false, errors: [{ path: 'tool_name', code: 'unknown_tool', message: 'Tool is not registered.' }] };
    if (!argumentCheck.valid) return res.status(400).json({ error: 'stored_action_invalid', details: argumentCheck.errors });

    const claim = await actionLedger.claimActionRun({ orgId, actionId, userId });
    if (claim.mode === 'replay') {
      return res.json(buildCopilotActionOutcome({
        toolName: run.tool_name, result: claim.run.result || {}, run: claim.run,
        requestId: run.request_id, source: 'action-replay', replayed: true,
      }));
    }
    if (claim.mode !== 'claimed' || !claim.run) {
      return res.status(claim.mode === 'forbidden' ? 403 : claim.mode === 'not_found' ? 404 : 409).json({
        error: claim.mode === 'in_progress' ? 'action_in_progress' : claim.mode,
        action_receipt: actionLedger.makeActionReceipt(claim.run),
      });
    }

    const started = Date.now();
    let result;
    try {
      result = await runTool(run.tool_name, claim.run.action_input, { userId, orgId });
    } catch (error) {
      result = { created: false, error: String(error && error.message || error).slice(0, 250) };
    }
    const succeeded = Boolean(result && result.created === true && !result.error);
    let finished;
    try {
      finished = await actionLedger.finishActionRun({
        orgId, actionId,
        status: succeeded ? 'succeeded' : 'failed',
        result,
        errorCode: succeeded ? null : 'confirmed_tool_execution_failed',
      });
    } catch (error) {
      logger.error('Copilot action completion ledger update failed: ' + String(error && error.message || error).slice(0, 180));
    }
    await recordCopilotToolTraceBestEffort({
      orgId, userId, requestId: run.request_id, ordinal: 9999,
      toolName: run.tool_name, status: succeeded ? 'succeeded' : 'failed',
      input: claim.run.action_input, result, latencyMs: Date.now() - started,
      provider: 'operator-confirmation', errorCode: succeeded ? null : 'confirmed_tool_execution_failed',
    });
    const responseRun = finished || { ...claim.run, status: succeeded ? 'executing' : 'failed', result };
    const outcome = buildCopilotActionOutcome({
      toolName: run.tool_name, result, run: responseRun,
      requestId: run.request_id, source: succeeded ? 'confirmed-action' : 'action-failed',
    });
    if (succeeded && !finished) {
      const warning = ' The operation appears to have completed, but its final receipt could not be persisted. Do not repeat it blindly; verify the operational record first.';
      outcome.response += warning;
      outcome.answer = outcome.response;
      outcome.source = 'action-ledger-degraded';
    }
    await persistCopilotReceiptBestEffort({
      orgId, userId, command: run.command,
      result: {
        decision: succeeded ? 'ACT_NOW' : 'HUMAN_REVIEW_REQUIRED',
        risk_level: run.risk_level.toUpperCase(),
        confidence: succeeded ? 1 : 0.4,
        answer: outcome.response,
        evidence: ['operator_confirmation', run.tool_name, 'durable_action_receipt'],
        missing_data: [],
        risks: succeeded ? [] : [{ risk: 'Confirmed action did not complete', severity: 'high' }],
        swarm: [],
      },
      requestId: run.request_id,
    });
    return res.json(outcome);
  } catch (error) {
    logger.error('Copilot action confirmation failed: ' + String(error && error.message || error).slice(0, 200));
    return res.status(503).json({ error: 'confirmation_execution_unavailable', message: 'The action result could not be verified. Check the durable action receipt before attempting a new request.' });
  }
});


router.get('/anomalies', async (req, res, next) => {
  try {
    await ensureColumns();
    const r = await query(`
      SELECT a.*, v.registration, v.region FROM alerts a
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.resolved_at IS NULL AND a.deleted_at IS NULL
        AND a.type IN ('speed','route_deviation','geofence')
      ORDER BY a.created_at DESC LIMIT 50
    `);
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

router.get('/risk/:convoyId', async (req, res, next) => {
  try {
    const [alertCount, convoy] = await Promise.all([
      query('SELECT COUNT(*) FROM alerts WHERE convoy_id=$1 AND resolved_at IS NULL AND deleted_at IS NULL', [req.params.convoyId]),
      query('SELECT priority, COALESCE(risk_score,0) AS risk_score FROM convoys WHERE id=$1', [req.params.convoyId]),
    ]);
    if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    const count    = parseInt(alertCount.rows[0].count);
    const priority = convoy.rows[0].priority || 'medium';
    const dbScore  = parseInt(convoy.rows[0].risk_score);
    const alertAdd = { critical: 25, high: 15, medium: 5, low: 0 }[priority] || 0;
    const score    = Math.min(100, Math.max(dbScore, count * 12 + alertAdd));
    const level    = score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
    res.json({ data: { score, level, openAlerts: count, priority } });
  } catch (err) { next(err); }
});

module.exports = router;
