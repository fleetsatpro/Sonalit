const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');

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

// ── System prompt (static — kept frozen so it caches across requests) ──────
const SYSTEM_PROMPT = `You are the AI dispatch assistant for FleetOps Pro, an enterprise logistics command platform running security convoys across East and Central Africa (Kenya, DRC, Tanzania, Uganda, Mali).

You have tools to query live fleet data and weather. Always use them — never guess fleet state or invent data.

Guidelines:
- Use query_vehicles / query_convoys / query_alerts for anything about fleet state. Pass filters when the user is specific (a region, a status, low fuel, etc.).
- Use get_weather for weather questions — it covers any location worldwide, including a convoy route's origin or destination.
- You may call multiple tools, and call a tool again with different filters if the first result isn't enough to answer.
- Be concise and direct — 1-4 sentences. Cite specific vehicle registrations, convoy names, and numbers from the tool results.
- Clearly flag critical situations: low fuel, offline vehicles, critical alerts, severe weather on a route.
- You can answer questions about fleet operations and weather. You do NOT yet have live traffic, security-incident, or maritime data — if asked, say so briefly instead of guessing.`;

// ── Tool definitions (static — cache together with the system prompt) ──────
const TOOLS = [
  {
    name: 'query_vehicles',
    description: 'Query the live vehicle fleet. Returns matching vehicles with registration, type, status, region, speed (km/h), fuel level (%), coordinates, driver, and last ping. Call with no filters for the whole fleet.',
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
    description: 'Query convoy missions. Returns convoys with name, status, region, priority, route origin/destination, and timing. Call with no filters for all convoys.',
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
        type: { type: 'string', description: 'Alert type, e.g. speed, geofence, mechanical, security, communication' },
        include_resolved: { type: 'boolean', description: 'If true, also include already-resolved alerts' },
      },
    },
  },
  {
    name: 'get_weather',
    description: 'Get current conditions and a 3-day forecast for any location worldwide by name. Use for weather questions, including weather along a convoy route or at a vehicle location.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or place name, e.g. Nairobi, Mombasa, Kinshasa, Bamako' },
      },
      required: ['location'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────
async function toolQueryVehicles(input) {
  const filters = ['deleted_at IS NULL'];
  const params = [];
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

async function toolQueryConvoys(input) {
  const filters = ['deleted_at IS NULL'];
  const params = [];
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

async function toolQueryAlerts(input) {
  const filters = ['a.deleted_at IS NULL'];
  const params = [];
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

async function toolGetWeather(input) {
  const loc = (input.location || '').trim();
  if (!loc) return { error: 'No location provided' };

  // 1. Geocode the place name (Open-Meteo geocoding — free, no key)
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!geoRes.ok) return { error: `Geocoding failed (HTTP ${geoRes.status})` };
  const geo = await geoRes.json();
  if (!geo.results || !geo.results.length) return { error: `Location "${loc}" not found` };
  const g = geo.results[0];

  // 2. Current conditions + 3-day forecast (Open-Meteo forecast — free, no key)
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
}

async function runTool(name, input) {
  switch (name) {
    case 'query_vehicles': return toolQueryVehicles(input || {});
    case 'query_convoys':  return toolQueryConvoys(input || {});
    case 'query_alerts':   return toolQueryAlerts(input || {});
    case 'get_weather':    return toolGetWeather(input || {});
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ── POST /ai/dispatch — agentic tool-use loop ──────────────────────────────
router.post('/dispatch', async (req, res) => {
  const { command, history = [] } = req.body;
  if (!command || !command.trim()) return res.status(400).json({ error: 'command required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length < 20) {
    return res.json({
      response: 'AI dispatch is not configured — set ANTHROPIC_API_KEY on the backend to enable it.',
      actions: [],
      source: 'unconfigured',
    });
  }

  try {
    await ensureColumns();
    const client = new Anthropic({ apiKey });

    // Static system prompt + tools are the cacheable prefix; only the
    // conversation (volatile) follows the cache breakpoint.
    const messages = [
      ...history.slice(-6)
        .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: command.trim() },
    ];

    const toolsUsed = [];
    let finalText = '';

    for (let turn = 0; turn < 6; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolsUsed.push(block.name);
          let result, isError = false;
          try {
            result = await runTool(block.name, block.input);
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

      // Terminal turn — collect the text answer
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
      source: 'claude',
    });
  } catch (err) {
    logger.error('AI dispatch error: ' + err.message);
    return res.status(500).json({
      response: 'AI engine error: ' + err.message,
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
      query('SELECT priority, risk_score FROM convoys WHERE id=$1', [req.params.convoyId]),
    ]);
    const count = parseInt(alertCount.rows[0].count);
    const priority = convoy.rows[0]?.priority || 'medium';
    const base = { critical: 25, high: 15, medium: 5, low: 0 }[priority] || 0;
    const score = Math.min(100, count * 12 + base);
    const level = score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
    res.json({ data: { score, level, openAlerts: count } });
  } catch (err) { next(err); }
});

module.exports = router;
