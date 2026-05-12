const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
router.use(authenticate);
router.post('/dispatch', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });
  const c = command.toLowerCase();
  const vehicles = await query('SELECT registration, status, region, fuel_level FROM vehicles WHERE deleted_at IS NULL LIMIT 20').then(r=>r.rows).catch(()=>[]);
  const convoys = await query("SELECT name, status, priority, region FROM convoys WHERE deleted_at IS NULL AND status != 'completed' LIMIT 10").then(r=>r.rows).catch(()=>[]);
  const alerts = await query("SELECT type, severity, message FROM alerts WHERE resolved_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5").then(r=>r.rows).catch(()=>[]);
  let response = '';
  if (c.includes('fuel') || c.includes('low fuel')) response = 'Vehicles with fuel below 25%: ' + (vehicles.filter(v=>(v.fuel_level||100)<25).map(v=>v.registration).join(', ')||'none');
  else if (c.includes('active convoy') || c.includes('active convoys')) response = 'Active convoys: ' + (convoys.filter(c=>c.status==='active').map(c=>c.name).join(', ')||'none');
  else if (c.includes('alert')) response = 'Open alerts: '+alerts.length+'. Critical: '+alerts.filter(a=>a.severity==='critical').length;
  else if (c.includes('offline')) response = 'Offline vehicles: '+(vehicles.filter(v=>v.status==='offline').map(v=>v.registration).join(', ')||'none');
  else if (c.includes('kenya')) response = 'Vehicles in Kenya: '+vehicles.filter(v=>v.region==='Kenya').length;
  else response = 'Command received: "'+command+'". Set ANTHROPIC_API_KEY in .env to enable full AI processing.';
  res.json({ response, actions: [], source: 'pattern' });
});
router.get('/anomalies', async (req, res, next) => {
  try {
    const r = await query("SELECT a.*, v.registration FROM alerts a LEFT JOIN vehicles v ON v.id=a.vehicle_id WHERE a.resolved_at IS NULL AND a.deleted_at IS NULL AND a.type IN ('speed','route_deviation') ORDER BY a.created_at DESC LIMIT 50");
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.get('/risk/:convoyId', async (req, res, next) => {
  try {
    const alerts = await query("SELECT COUNT(*) FROM alerts WHERE convoy_id=$1 AND resolved_at IS NULL AND deleted_at IS NULL", [req.params.convoyId]);
    const count = parseInt(alerts.rows[0].count);
    const score = Math.min(100, count * 10);
    const level = score>=70?'CRITICAL':score>=40?'HIGH':score>=20?'MEDIUM':'LOW';
    res.json({ data: { score, level, openAlerts: count } });
  } catch (err) { next(err); }
});
module.exports = router;
