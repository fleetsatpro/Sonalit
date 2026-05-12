const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try {
    const r = await query('SELECT id, type, title, created_at FROM reports ORDER BY created_at DESC LIMIT 50');
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.post('/generate', async (req, res, next) => {
  try {
    const { type, date } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
    const d = date || new Date().toISOString().slice(0,10);
    let data = {}, title = '';
    if (type === 'daily_ops') {
      const [v,c,a] = await Promise.all([
        query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='active') active FROM vehicles WHERE deleted_at IS NULL"),
        query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE status='active') active FROM convoys WHERE deleted_at IS NULL"),
        query("SELECT COUNT(*) total, COUNT(*) FILTER (WHERE severity='critical') critical FROM alerts WHERE DATE(created_at)=$1 AND deleted_at IS NULL",[d])
      ]);
      data = { date: d, vehicles: v.rows[0], convoys: c.rows[0], alerts: a.rows[0] };
      title = 'Daily Operations Report — ' + d;
    } else if (type === 'sla_compliance') {
      const r = await query("SELECT COUNT(*) total_completed, COUNT(*) FILTER (WHERE arrival_time <= estimated_arrival) on_time FROM convoys WHERE status='completed' AND arrival_time IS NOT NULL AND deleted_at IS NULL");
      const row = r.rows[0];
      data = { ...row, sla_pct: row.total_completed > 0 ? Math.round((row.on_time/row.total_completed)*100) : 100 };
      title = 'SLA Compliance Report';
    } else if (type === 'fuel_efficiency') {
      const r = await query("SELECT v.registration, AVG(f.fuel_level) avg_fuel FROM vehicles v JOIN fuel_logs f ON f.vehicle_id=v.id GROUP BY v.id, v.registration ORDER BY avg_fuel ASC LIMIT 20");
      data = { vehicles: r.rows };
      title = 'Fuel Efficiency Report';
    } else {
      data = { generated: new Date().toISOString() };
      title = type + ' Report';
    }
    const r = await query('INSERT INTO reports (type, title, data) VALUES ($1,$2,$3) RETURNING *', [type, title, JSON.stringify(data)]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) { next(err); }
});
router.get('/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM reports WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: r.rows[0] });
  } catch (err) { next(err); }
});
module.exports = router;
