const router = require('express').Router();
const aiClient = require('../utils/aiClient');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { runDecisionFabric } = require('../services/aiSwarm');
const { buildWorldContext } = require('../services/spatial/worldContextService');
const { withOrg } = require('../utils/orgScopedDb');

async function persistCopilotDecision({ orgId, userId, command, result }) {
  if (!orgId) throw new Error('Copilot decision persistence requires an authenticated organisation');
  const decisionRow = await query(
    `INSERT INTO public.copilot_decisions (org_id, user_id, command, decision, risk_level, confidence, answer, result, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
    [orgId, userId || null, command, result.decision || 'HUMAN_REVIEW_REQUIRED', result.risk_level || 'HIGH', Number(result.confidence || 0), result.answer || '', JSON.stringify(result)]
  );
  const decisionId = decisionRow.rows[0].id;
  for (const agent of result.swarm || []) {
    await query(
      `INSERT INTO public.copilot_decision_agents (decision_id, org_id, agent_id, status, confidence, provider, finding, dissent, tools, provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [decisionId, orgId, agent.id, agent.status || 'uncertain', Number(agent.confidence || 0), agent.provider || null, agent.finding || '', agent.dissent || '', JSON.stringify(agent.tools || []), JSON.stringify(agent.provenance || [])]
    );
  }
  return decisionId;
}

router.use(authenticate);

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

You have tools to query live fleet data, weather, road conditions, public holidays, and known risk zones — and you can create geofences and mark risk zones directly on the map. Always use the tools — never guess fleet state or invent data.

Guidelines:
- Use query_vehicles / query_convoys / query_alerts for anything about fleet state. Pass filters when the user is specific (a region, status, low fuel, etc.).
- Use get_weather for weather questions — covers any location worldwide.
- Use check_holidays to look up public holidays for any country. This is critical for convoy timing, border crossing windows, and staffing — holidays cause border closures, reduced police escorts, and road congestion.
- Use get_road_conditions to check for construction zones, road closures, and barriers near a location or along a route. Call it for both origin and destination on convoy routes.
- Use query_risk_zones to surface internal records of banditry hotspots, conflict zones, strike zones, and high-risk corridors. Always check this when advising on route safety.
- Use get_world_context for mission-specific spatial questions. It is the canonical spatial source for convoy/vehicle position, route/corridor state, nearby incidents, risk zones, checkpoints, weather, AIS movement, road traffic, external incidents, natural hazards, relationships, events, freshness, provenance, uncertainty, and evidence. Never invent spatial facts that are not present in its result.
- Use create_geofence when the user asks to "draw a geofence", "create a zone", "set a boundary", or "mark an area" around any location. Geocode it and create it immediately — never just describe it.
- Use create_risk_zone when the user wants to flag a location as dangerous, mark a strike, roadblock, active incident, or high-risk area. Create it immediately.
- For comprehensive navigation advisories: combine weather + road conditions + risk zones + active alerts + upcoming holidays. Give a rated assessment (SAFE / CAUTION / HIGH RISK / AVOID).
- Be concise and direct — 1–4 sentences. Cite specific vehicle registrations, convoy names, zone names, and numbers from tool results.
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
    description: 'Create a geofence zone on the map. Two modes: (1) Point — geocode a place and draw a circle. (2) Route corridor — provide location (start) AND route_end (end) to create a polygon corridor that follows the actual road geometry. Vehicles that stray more than buffer_m metres off the road trigger a deviation alert. Use for "draw a geofence around X", "geofence from A to B", or "geofence on Thika Road from Ngara to Juja".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name, e.g. "Thika Road Corridor" or "Nairobi CBD Safe Zone"' },
        location: { type: 'string', description: 'Place name or route start point' },
        route_end: { type: 'string', description: 'Route end point for a corridor geofence, e.g. "Juja". Omit for a point geofence.' },
        radius_m: { type: 'number', description: 'Radius in metres for a point geofence (default 3000). Ignored for corridors.' },
        buffer_m: { type: 'number', description: 'Corridor half-width in metres — how far a vehicle can deviate before an alert fires (default 300).' },
        fence_type: { type: 'string', enum: ['safe_zone', 'exclusion_zone', 'checkpoint', 'depot', 'patrol_zone', 'corridor', 'general'] },
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
        radius_km: { type: 'number', description: 'Radius in km (default 5)' },
      },
      required: ['name', 'location', 'risk_level'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────
async function toolQueryVehicles(input, orgId) {
  if (!orgId) return { error: 'Organisation context is required', vehicles: [], count: 0 };
  const filters = ['deleted_at IS NULL', 'org_id = $1'];
  const params = [orgId];
  if (input.status) { params.push(input.status); filters.push(`status = $${params.length}`); }
  if (input.region) { params.push(input.region); filters.push(`region = $${params.length}`); }
  if (input.low_fuel) filters.push('COALESCE(fuel_level, 85) < 25');
  if (input.moving) filters.push('COALESCE(speed, 0) > 2');
  const r = await query(
    `SELECT registration, type, status, region,
            COALESCE(fuel_level, 85) AS fuel_level, COALESCE(speed, 0) AS speed,
            latitude, longitude, driver_name, last_ping
     FROM vehicles WHERE ${filters.join(' AND ')}
     ORDER BY registration LIMIT 60`,
    params
  );
  return { count: r.rows.length, vehicles: r.rows };
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
  const { name, location, route_end, fence_type = 'general' } = input;
  if (!name || !location) return { error: 'name and location are required' };

  try {
    if (route_end) {
      // ── Route corridor mode: use OSRM for actual road geometry ──
      const [gStart, gEnd] = await Promise.all([geocode(location), geocode(route_end)]);
      const buffer_m = Math.max(50, Math.min(input.buffer_m || 300, 5000));

      // Fetch road route from public OSRM (free, no key)
      let path, distM;
      try {
        const osrmRes = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${gStart.longitude},${gStart.latitude};${gEnd.longitude},${gEnd.latitude}?overview=full&geometries=geojson`,
          { signal: AbortSignal.timeout(12000) }
        );
        if (osrmRes.ok) {
          const od = await osrmRes.json();
          if (od.routes?.length) {
            // OSRM returns [lng, lat] — keep as GeoJSON [lng, lat]
            path = od.routes[0].geometry.coordinates;
            distM = od.routes[0].distance;
          }
        }
      } catch (_) {}

      // Fallback: straight line if OSRM unavailable
      if (!path || path.length < 2) {
        path = [[gStart.longitude, gStart.latitude], [gEnd.longitude, gEnd.latitude]];
        distM = haversineM(gStart.latitude, gStart.longitude, gEnd.latitude, gEnd.longitude);
        logger.warn(`OSRM unavailable for corridor "${name}" — using straight-line fallback`);
      }

      // Midpoint for map fly-to — path is [lng, lat] order
      const mid = path[Math.floor(path.length / 2)];
      const midLng = mid[0], midLat = mid[1];
      const region = gStart.admin1 || gStart.country || location;
      const locationLabel = `${gStart.name} → ${gEnd.name}`;
      const approxRadius = Math.round(distM / 2) + buffer_m;

      // Store coordinates as GeoJSON [lng,lat] array under 'coordinates' key
      const coordinates = { lat: midLat, lng: midLng, type: 'corridor', coordinates: path, buffer_m };

      const r = await query(
        `INSERT INTO geofences (name, type, coordinates, radius, region, org_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [name, 'corridor', JSON.stringify(coordinates), approxRadius, region, orgId]
      );

      return {
        created: true,
        geofence_id: r.rows[0].id,
        name,
        fence_type: 'corridor',
        lat: midLat,
        lng: midLng,
        radius_m: approxRadius,
        region,
        location: locationLabel,
        is_corridor: true,
        path_points: path.length,
        road_distance_km: (distM / 1000).toFixed(1),
        buffer_m,
        message: `Corridor geofence "${name}" created from ${locationLabel} — ${(distM / 1000).toFixed(1)} km road, ${path.length} waypoints, ${buffer_m}m deviation limit.`,
      };
    } else {
      // ── Point mode: single location circle ──
      const g = await geocode(location);
      const radius_m = input.radius_m || 3000;
      const coordinates = { lat: g.latitude, lng: g.longitude };
      const region = g.admin1 || g.country || location;

      const r = await query(
        `INSERT INTO geofences (name, type, coordinates, radius, region, org_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [name, 'circle', JSON.stringify(coordinates), radius_m, region, orgId]
      );

      const locationLabel = [g.name, g.admin1, g.country].filter(Boolean).join(', ');
      return {
        created: true,
        geofence_id: r.rows[0].id,
        name,
        fence_type,
        lat: g.latitude,
        lng: g.longitude,
        radius_m,
        region,
        location: locationLabel,
        is_corridor: false,
        message: `Geofence "${name}" created at ${locationLabel}, radius ${radius_m}m.`,
      };
    }
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
    const g = await geocode(location);
    const desc = description || `${zone_type} risk zone near ${location}`;

    const r = await query(
      `INSERT INTO risk_zones (name, description, risk_level, zone_type, lat, lng, radius_km, created_by)
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


// ── POST /ai/decision — unified Decision Intelligence Fabric ──────────────
// Conversation + decision support share one resilient swarm. The legacy
// /dispatch endpoint remains intact for existing tool-execution workflows.
router.get('/decision/history', async (req, res) => {
  try {
    const orgId = req.user?.org_id || req.user?.orgId || req.user?.organization_id;
    if (!orgId) return res.status(403).json({ error: 'Organisation context required' });
    const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 50);
    const r = await query(
      `SELECT id, command, decision, risk_level, confidence, answer, created_at, outcome, outcome_notes
       FROM public.copilot_decisions
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [orgId, limit]
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
    if (!orgId || !allowed.has(outcome)) return res.status(400).json({ error: 'Valid organisation and outcome required' });
    const exists = await query('SELECT id FROM public.copilot_decisions WHERE id = $1 AND org_id = $2', [req.params.decisionId, orgId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Decision not found' });
    await query(
      `INSERT INTO public.copilot_decision_feedback (decision_id, org_id, user_id, outcome, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.decisionId, orgId, userId, outcome, notes]
    );
    await query(
      `UPDATE public.copilot_decisions
       SET outcome=$1, outcome_notes=$2, outcome_recorded_at=NOW()
       WHERE id=$3 AND org_id=$4`,
      [outcome, notes, req.params.decisionId, orgId]
    );
    return res.json({ ok: true, decision_id: req.params.decisionId, outcome });
  } catch (err) {
    logger.error('Copilot feedback error: ' + err.message);
    return res.status(500).json({ error: 'Unable to record Copilot feedback' });
  }
});

router.post('/decision', async (req, res) => {
  const { command, history = [] } = req.body || {};
  if (!command || !String(command).trim()) {
    return res.status(400).json({ error: 'command required' });
  }

  if (!aiClient.hasAnyProvider()) {
    return res.json({
      answer: 'Decision Intelligence is not configured. Add ANTHROPIC_API_KEY or GROQ_API_KEY.',
      decision: 'HUMAN_REVIEW_REQUIRED',
      risk_level: 'HIGH',
      confidence: 0,
      recommended_actions: [],
      risks: [{ risk: 'No AI provider configured', severity: 'high' }],
      meta: { degraded: true, agent_count: 0, agent_failures: 0, provider_capabilities: aiClient.providerCapabilities() },
    });
  }

  try {
    await ensureColumns();
    await ensureRiskZones();
    const result = await runDecisionFabric({
      command: String(command).trim(),
      history: Array.isArray(history) ? history : [],
      executeTool: (name, input, context) => runTool(name, input, context),
      userId: req.user?.id || null,
      orgId: req.user?.org_id || req.user?.orgId || req.user?.organization_id || null,
      persistDecision: persistCopilotDecision,
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
  const { command, history = [] } = req.body;
  if (!command || !command.trim()) return res.status(400).json({ error: 'command required' });

  if (!aiClient.hasAnthropic() && !aiClient.hasGroqFallback()) {
    return res.json({
      response: 'AI dispatch is not configured — set ANTHROPIC_API_KEY (or GROQ_API_KEY as a fallback) on the backend to enable it.',
      actions: [],
      source: 'unconfigured',
    });
  }

  try {
    await ensureColumns();
    await ensureRiskZones();
    const userId = req.user?.id || null;

    const messages = [
      ...history.slice(-6)
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: command.trim() },
    ];

    const toolsUsed = [];
    const actionsCreated = [];
    let finalText = '';
    let lastProvider = 'anthropic';

    // Falls back to Groq (open-weight model) mid-conversation if Anthropic
    // is rate-limited, out of quota, or down — see aiClient.js. Best-effort:
    // sustained multi-turn tool use is meaningfully less reliable on an
    // open-weight model than Claude, so a Groq-served response here is a
    // degraded mode, not a like-for-like swap — flagged via `source` below
    // so the frontend can show that distinction if it wants to.
    for (let turn = 0; turn < 8; turn++) {
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
          toolsUsed.push(block.name);
          let result, isError = false;
          try {
            result = await runTool(block.name, block.input, { userId, orgId: req.user?.org_id || req.user?.orgId || req.user?.organization_id || null });
            // Track map-mutating actions for frontend refresh
            if (block.name === 'create_geofence' && result.created) {
              actionsCreated.push({ type: 'geofence', ...result });
            }
            if (block.name === 'create_risk_zone' && result.created) {
              actionsCreated.push({ type: 'risk_zone', ...result });
            }
          } catch (e) {
            result = { error: e.message };
            isError = true;
            logger.warn(`AI tool ${block.name} failed: ${e.message}`);
          }
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

      finalText = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      break;
    }

    return res.json({
      response: finalText || 'I could not produce a response — please rephrase your request.',
      actions: [...new Set(toolsUsed)],
      created: actionsCreated,
      source: lastProvider === 'groq' ? 'groq-fallback' : 'claude',
    });
  } catch (err) {
    // By the time an error reaches here, aiClient.createMessage has already
    // tried the Groq fallback (if configured) and that failed too — this is
    // a genuine "no AI provider could answer" case, not just an Anthropic
    // hiccup.
    if (err?.status === 401) {
      logger.warn('AI dispatch: ANTHROPIC_API_KEY rejected by Anthropic (401)');
      return res.json({
        response: 'AI dispatch is misconfigured — the ANTHROPIC_API_KEY on the backend was rejected. Set a valid key (from console.anthropic.com) and redeploy.',
        actions: [],
        source: 'unconfigured',
      });
    }
    if (aiClient.isRetryableAnthropicError(err)) {
      logger.warn('AI dispatch: AI provider(s) overloaded after retries' + (aiClient.hasGroqFallback() ? ' (including Groq fallback)' : ''));
      return res.json({
        response: 'The AI engine is temporarily overloaded — please try again in a few seconds.',
        actions: [],
        source: 'error',
      });
    }
    logger.error('AI dispatch error: ' + err.message);
    return res.json({
      response: 'AI engine error — please try again.',
      actions: [],
      source: 'error',
    });
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
