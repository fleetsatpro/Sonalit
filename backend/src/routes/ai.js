const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');

router.use(authenticate);

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
  } catch(e) { logger.warn('ensureColumns: ' + e.message); }
}

router.post('/dispatch', async (req, res) => {
  const { command, history = [] } = req.body;
  if (!command?.trim()) return res.status(400).json({ error: 'command required' });

  try {
    await ensureColumns();

    const [vehicleRows, convoyRows, alertRows] = await Promise.all([
      query(`SELECT registration, status, region, type,
               COALESCE(fuel_level, 85) AS fuel_level,
               COALESCE(speed, 0) AS speed,
               COALESCE(maintenance_score, 0) AS maintenance_score,
               latitude, longitude, last_ping
             FROM vehicles WHERE deleted_at IS NULL LIMIT 50`
      ).then(r => r.rows).catch(e => { logger.warn('vehicles query: ' + e.message); return []; }),

      query(`SELECT name, status, priority, region, route_origin, route_destination, risk_score,
               estimated_arrival
             FROM convoys WHERE deleted_at IS NULL AND status != 'completed' LIMIT 20`
      ).then(r => r.rows).catch(e => { logger.warn('convoys query: ' + e.message); return []; }),

      query(`SELECT type, severity, message, created_at FROM alerts
             WHERE resolved_at IS NULL AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 15`
      ).then(r => r.rows).catch(e => { logger.warn('alerts query: ' + e.message); return []; }),
    ]);

    const context = {
      total_vehicles: vehicleRows.length,
      active: vehicleRows.filter(v => v.status === 'active').length,
      idle: vehicleRows.filter(v => v.status === 'idle').length,
      offline: vehicleRows.filter(v => v.status === 'offline').length,
      maintenance: vehicleRows.filter(v => v.status === 'maintenance').length,
      low_fuel: vehicleRows.filter(v => parseFloat(v.fuel_level) < 25).map(v => v.registration),
      moving: vehicleRows.filter(v => parseFloat(v.speed) > 2).length,
      by_region: vehicleRows.reduce((acc, v) => { acc[v.region] = (acc[v.region] || 0) + 1; return acc; }, {}),
      vehicles: vehicleRows,
      convoys: convoyRows,
      open_alerts: alertRows,
      critical_alerts: alertRows.filter(a => a.severity === 'critical').length,
    };

    // ── Try Anthropic API ───────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey.length > 20) {
      try {
        const systemPrompt = `You are the AI dispatch assistant for FleetOps Pro — an enterprise logistics command platform operating across East/Central Africa.

Current fleet data:
- ${context.total_vehicles} vehicles total: ${context.active} active, ${context.idle} idle, ${context.maintenance} maintenance, ${context.offline} offline
- ${context.moving} vehicles currently moving
- Low fuel vehicles: ${context.low_fuel.join(', ') || 'none'}
- Regional breakdown: ${JSON.stringify(context.by_region)}
- Active convoys: ${convoyRows.filter(c=>c.status==='active').length}
- Open alerts: ${alertRows.length} (${context.critical_alerts} critical)

Full vehicle list: ${JSON.stringify(vehicleRows.slice(0,20))}
Convoys: ${JSON.stringify(convoyRows)}
Recent alerts: ${JSON.stringify(alertRows.slice(0,8))}

Instructions:
- Be concise and direct — 1-3 sentences max
- Use specific vehicle registrations and convoy names from the data
- Flag critical situations clearly
- If asked for actions, suggest practical next steps`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 300,
            system: systemPrompt,
            messages: [
              ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
              { role: 'user', content: command },
            ],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || '';
          return res.json({ response: text, actions: [], source: 'claude' });
        }
        logger.warn('Anthropic returned ' + response.status);
      } catch (err) {
        logger.warn('Anthropic error: ' + err.message + ' — using pattern matching');
      }
    }

    // ── Pattern matching (rich fallback) ───────────────────────────
    const q = command.toLowerCase().trim();

    const matchers = [
      // Fuel
      [/(low fuel|critical fuel|fuel alert|fuel level)/,
        () => context.low_fuel.length
          ? `${context.low_fuel.length} vehicle${context.low_fuel.length>1?'s':''} below 25% fuel: ${context.low_fuel.join(', ')}. Dispatch refuelling immediately.`
          : 'All vehicles have fuel above 25%. Fleet fuel levels nominal.'],

      // Fleet status / summary
      [/(fleet status|fleet summary|overview|how many vehicle|total vehicle)/,
        () => `Fleet: ${context.total_vehicles} vehicles — ${context.active} active, ${context.idle} idle, ${context.maintenance} in maintenance, ${context.offline} offline. ${context.moving} currently moving.`],

      // Active convoys
      [/(active convoy|current convoy|convoy.*status|convoy.*now)/,
        () => {
          const active = convoyRows.filter(c => c.status === 'active');
          if (!active.length) return 'No convoys are currently active.';
          return `${active.length} active convoy${active.length>1?'s':''}: ${active.map(c => `${c.name} (${c.route_origin||'?'} → ${c.route_destination||'?'}, ${c.region})`).join(' | ')}.`;
        }],

      // Alerts
      [/(alert|incident|emergency|critical)/,
        () => {
          if (!alertRows.length) return 'No open alerts. All systems normal.';
          const crits = alertRows.filter(a => a.severity === 'critical');
          let r = `${alertRows.length} open alert${alertRows.length>1?'s':''} — ${context.critical_alerts} critical.`;
          if (crits.length) r += ` Critical: ${crits.map(a => a.message).slice(0,2).join('; ')}.`;
          return r;
        }],

      // Offline vehicles
      [/(offline|not responding|unreachable|lost contact)/,
        () => {
          const off = vehicleRows.filter(v => v.status === 'offline');
          return off.length
            ? `${off.length} vehicle${off.length>1?'s':''} offline: ${off.map(v => v.registration).join(', ')}. Verify communication and GPS units.`
            : 'All vehicles are online and responding.';
        }],

      // Maintenance
      [/(maintenance|service|repair|overdue|breakdown)/,
        () => {
          const due = vehicleRows.filter(v => v.status === 'maintenance');
          const score = vehicleRows.filter(v => parseInt(v.maintenance_score) > 80);
          let r = due.length ? `${due.length} vehicle${due.length>1?'s':''} currently in maintenance: ${due.map(v=>v.registration).join(', ')}.` : 'No vehicles in active maintenance.';
          if (score.length) r += ` ${score.length} with high maintenance score (attention needed).`;
          return r;
        }],

      // Moving / speed
      [/(moving|speed|driving|on route|in transit)/,
        () => {
          const moving = vehicleRows.filter(v => parseFloat(v.speed) > 2);
          return moving.length
            ? `${moving.length} vehicle${moving.length>1?'s':''} currently moving. Fastest: ${vehicleRows.sort((a,b) => parseFloat(b.speed)-parseFloat(a.speed))[0]?.registration} at ${parseFloat(vehicleRows[0]?.speed||0).toFixed(0)} km/h.`
            : 'No vehicles currently in motion.';
        }],

      // Regional queries
      [/\b(kenya|nairobi|mombasa)\b/,
        () => {
          const r = vehicleRows.filter(v => v.region === 'Kenya');
          return `Kenya fleet: ${r.length} vehicles — ${r.filter(v=>v.status==='active').length} active, ${r.filter(v=>v.status==='idle').length} idle, ${r.filter(v=>v.status==='offline').length} offline.`;
        }],
      [/\b(drc|congo|kinshasa)\b/,
        () => {
          const r = vehicleRows.filter(v => v.region === 'DRC');
          return `DRC fleet: ${r.length} vehicles — ${r.filter(v=>v.status==='active').length} active, ${r.filter(v=>v.status==='offline').length} offline.`;
        }],
      [/\b(tanzania|dar|dodoma)\b/,
        () => {
          const r = vehicleRows.filter(v => v.region === 'Tanzania');
          return `Tanzania fleet: ${r.length} vehicles — ${r.filter(v=>v.status==='active').length} active.`;
        }],
      [/\b(mali|bamako)\b/,
        () => {
          const r = vehicleRows.filter(v => v.region === 'Mali');
          return `Mali fleet: ${r.length} vehicles — ${r.filter(v=>v.status==='active').length} active.`;
        }],

      // Convoy count
      [/(how many convoy|convoy count|all convoy)/,
        () => {
          const planned = convoyRows.filter(c=>c.status==='planned').length;
          const active = convoyRows.filter(c=>c.status==='active').length;
          return `${convoyRows.length} total convoys: ${active} active, ${planned} planned.`;
        }],

      // Help
      [/(help|what can|commands|what do you)/,
        () => `I can answer questions about: fleet status, active convoys, fuel levels, offline vehicles, maintenance, alerts, regional breakdowns, and specific vehicle or convoy details. ${!apiKey ? 'Add ANTHROPIC_API_KEY to .env for full natural language AI.' : 'Powered by Claude AI.'}`],
    ];

    for (const [pattern, handler] of matchers) {
      if (pattern.test(q)) {
        return res.json({ response: handler(), actions: [], source: 'pattern' });
      }
    }

    // Default
    const summary = `Fleet has ${context.total_vehicles} vehicles (${context.active} active), ${convoyRows.filter(c=>c.status==='active').length} active convoys, ${alertRows.length} open alerts.`;
    res.json({
      response: summary + (apiKey ? '' : ' Set ANTHROPIC_API_KEY in backend .env for full AI capabilities.'),
      actions: [],
      source: 'pattern',
    });

  } catch (err) {
    logger.error('AI dispatch error: ' + err.message);
    res.status(500).json({ response: 'AI engine error. Please try again.', actions: [], source: 'error' });
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
    const base = { critical:25, high:15, medium:5, low:0 }[priority] || 0;
    const score = Math.min(100, count * 12 + base);
    const level = score>=70?'CRITICAL':score>=40?'HIGH':score>=20?'MEDIUM':'LOW';
    res.json({ data: { score, level, openAlerts: count } });
  } catch (err) { next(err); }
});

module.exports = router;
