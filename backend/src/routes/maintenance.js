const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { vehicle_id, status, priority, limit = 50 } = req.query;
    const filters = ['1=1'];
    const params = [];
    if (vehicle_id) { params.push(vehicle_id); filters.push(`mr.vehicle_id=$${params.length}`); }
    if (status) { params.push(status); filters.push(`mr.status=$${params.length}`); }
    if (priority) { params.push(priority); filters.push(`mr.priority=$${params.length}`); }
    params.push(limit);
    const result = await query(
      `SELECT mr.*, v.registration, v.type, v.region FROM maintenance_records mr
       JOIN vehicles v ON v.id=mr.vehicle_id
       WHERE ${filters.join(' AND ')}
       ORDER BY CASE mr.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                mr.scheduled_at NULLS LAST
       LIMIT $${params.length}`, params
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post('/', authorize('admin', 'dispatcher', 'operator'), async (req, res, next) => {
  try {
    const { vehicle_id, type, title, description, priority = 'medium', cost, workshop, scheduled_at, next_service_km } = req.body;
    if (!vehicle_id || !type || !title) return res.status(400).json({ error: 'vehicle_id, type, title required' });
    const result = await query(
      `INSERT INTO maintenance_records (vehicle_id, type, title, description, priority, cost, workshop, scheduled_at, next_service_km, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [vehicle_id, type, title, description, priority, cost, workshop, scheduled_at, next_service_km, req.user.id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { status, cost, completed_at, notes, technician } = req.body;
    const result = await query(
      `UPDATE maintenance_records SET
        status=COALESCE($1,status), cost=COALESCE($2,cost),
        completed_at=COALESCE($3,completed_at), notes=COALESCE($4,notes),
        technician=COALESCE($5,technician), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [status, cost, completed_at, notes, technician, req.params.id]
    );
    if (status === 'completed') {
      await query('UPDATE vehicles SET last_service_date=NOW(), maintenance_score=0 WHERE id=(SELECT vehicle_id FROM maintenance_records WHERE id=$1)', [req.params.id]);
    }
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /maintenance/overdue
router.get('/overdue', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT mr.*, v.registration, v.region FROM maintenance_records mr
      JOIN vehicles v ON v.id=mr.vehicle_id
      WHERE mr.status IN ('scheduled','in_progress')
        AND (mr.scheduled_at < NOW() OR v.maintenance_score > 80)
      ORDER BY v.maintenance_score DESC, mr.scheduled_at
      LIMIT 20
    `);
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
