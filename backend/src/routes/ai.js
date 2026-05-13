const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../utils/logger');

router.use(authenticate);

// AI Dispatch — natural language → fleet intelligence
router.post('/dispatch', async (req, res) => {
  const { command, history = [] } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  try {
    const [vehicleRows, convoyRows, alertRows] = await Promise.all([
      query('SELECT registration, status, region, fuel_level, speed, maintenance_score FROM vehicles WHERE deleted_at IS NULL LIMIT 30').then(r=>r.rows).catch(()=>[]),
      query("SELECT name, status, priority, region, route_origin, route_destination FROM convoys WHERE deleted_at IS NULL AND status != 'completed' LIMIT 15").then(r=>r.rows).catch(()=>[]),
      query("SELECT type, severity, message, vehicle_id FROM alerts WHERE resolved_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10").then(r=>r.rows).catch(()=>[]),
    ]);

    const context = { vehicles: vehicleRows, convoys: convoyRows, open_alerts: alertRows };

    // Try Anthropic API if key is configured
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey.startsWith('sk-ant-')) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            system: `You are the AI dispatch assistant for FleetOps Pro, a logistics command platform.
Fleet context: ${JSON.stringify(context)}
Be concise. Answer in 1-3 sentences. For actions, respond with JSON: {"response":"explanation","actions":[]}
Focus on: vehicle status, convoy operations, fuel levels, alerts, maintenance.`,
            messages: [
              ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
              { role: 'user', content: command },
            ],
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.content?.[0]?.text || '';
          let parsed;
          try { parsed = JSON.parse(text); }
          catch { parsed = { response: text, actions: [] }; }
          return res.json({ response: parsed.response || text, actions: parsed.actions || [], source: 'claude' });
        }
      } catch (err) {
        logger.warn('Anthropic API error: ' + err.message + ' — falling back to pattern matching');
      }
    }

    // Pattern matching fallback
    const c = command.toLowerCase();
    let response = '';

    if (c.includes('low fuel') || (c.includes('fuel') && (c.includes('low') || c.includes('critical')))) {
      const low = vehicleRows.filter(v => parseFloat(v.fuel_level||100) < 25);
      response = low.length ? `${low.length} vehicle${low.length>1?'s':''} with fuel below 25%: ${low.map(v=>v.registration).join(', ')}` : 'All vehicles have fuel above 25%.';
    } else if (c.includes('active convoy') || (c.includes('active') && c.includes('convoy'))) {
      const active = convoyRows.filter(c=>c.status==='active');
      response = active.length ? `${active.length} active convoy${active.length>1?'s':''}: ${active.map(c=>c.name).join(', ')}` : 'No active convoys.';
    } else if (c.includes('alert') || c.includes('incident')) {
      const critical = alertRows.filter(a=>a.severity==='critical').length;
      response = `${alertRows.length} open alert${alertRows.length!==1?'s':''}, ${critical} critical.`;
    } else if (c.includes('offline') || c.includes('offline vehicle')) {
      const offline = vehicleRows.filter(v=>v.status==='offline');
      response = offline.length ? `${offline.length} vehicle${offline.length>1?'s':''} offline: ${offline.map(v=>v.registration).join(', ')}` : 'All vehicles are online.';
    } else if (c.includes('maintenance') || c.includes('service due')) {
      const due = vehicleRows.filter(v=>(v.maintenance_score||0)>=80);
      response = due.length ? `${due.length} vehicle${due.length>1?'s':''} overdue for maintenance: ${due.map(v=>v.registration).join(', ')}` : 'No vehicles overdue for maintenance.';
    } else if (c.includes('kenya')) {
      const kenya = vehicleRows.filter(v=>v.region==='Kenya');
      response = `Kenya fleet: ${kenya.length} vehicles (${kenya.filter(v=>v.status==='active').length} active).`;
    } else if (c.includes('drc') || c.includes('congo')) {
      const drc = vehicleRows.filter(v=>v.region==='DRC');
      response = `DRC fleet: ${drc.length} vehicles (${drc.filter(v=>v.status==='active').length} active).`;
    } else if (c.includes('fleet') && (c.includes('status') || c.includes('summary') || c.includes('overview'))) {
      const active = vehicleRows.filter(v=>v.status==='active').length;
      const idle = vehicleRows.filter(v=>v.status==='idle').length;
      const maintenance = vehicleRows.filter(v=>v.status==='maintenance').length;
      response = `Fleet: ${vehicleRows.length} total — ${active} active, ${idle} idle, ${maintenance} in maintenance.`;
    } else if (c.includes('convoy') && (c.includes('status') || c.includes('all'))) {
      const planned = convoyRows.filter(c=>c.status==='planned').length;
      const active = convoyRows.filter(c=>c.status==='active').length;
      response = `${convoyRows.length} convoy${convoyRows.length!==1?'s':''}: ${active} active, ${planned} planned.`;
    } else if (c.includes('help') || c.includes('what can')) {
      response = 'I can help with: fleet status, active convoys, fuel levels, alerts, offline vehicles, maintenance, and regional fleet summaries. Set ANTHROPIC_API_KEY in .env for full AI capabilities.';
    } else {
      response = `Understood: "${command}". ${vehicleRows.length} vehicles tracked, ${convoyRows.filter(c=>c.status==='active').length} active convoys, ${alertRows.length} open alerts. Add ANTHROPIC_API_KEY to .env for advanced AI dispatch.`;
    }

    res.json({ response, actions: [], source: 'pattern' });
  } catch (err) {
    logger.error('AI dispatch error: ' + err.message);
    res.json({ response: 'AI system temporarily unavailable. Please try again.', actions: [], source: 'error' });
  }
});

// Anomaly detection
router.get('/anomalies', async (req, res, next) => {
  try {
    const r = await query(`
      SELECT a.*, v.registration, v.region FROM alerts a 
      LEFT JOIN vehicles v ON v.id=a.vehicle_id
      WHERE a.resolved_at IS NULL AND a.deleted_at IS NULL 
        AND a.type IN ('speed','route_deviation','geofence')
      ORDER BY a.created_at DESC LIMIT 50
    `);
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});

// Convoy risk index
router.get('/risk/:convoyId', async (req, res, next) => {
  try {
    const [alertCount, convoy] = await Promise.all([
      query("SELECT COUNT(*) FROM alerts WHERE convoy_id=$1 AND resolved_at IS NULL AND deleted_at IS NULL", [req.params.convoyId]),
      query("SELECT priority, risk_score FROM convoys WHERE id=$1", [req.params.convoyId]),
    ]);
    const count = parseInt(alertCount.rows[0].count);
    const priority = convoy.rows[0]?.priority || 'medium';
    const priorityScore = { critical:25, high:15, medium:5, low:0 }[priority] || 0;
    const score = Math.min(100, count * 12 + priorityScore);
    const level = score>=70?'CRITICAL':score>=40?'HIGH':score>=20?'MEDIUM':'LOW';
    res.json({ data: { score, level, openAlerts: count } });
  } catch (err) { next(err); }
});

module.exports = router;
