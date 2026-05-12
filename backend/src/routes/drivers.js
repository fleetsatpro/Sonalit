const router = require('express').Router();
const { authenticate, authorize } = require('../../../sonalit-fixed/backend/src/middleware/auth');
const { query } = require('../../../sonalit-fixed/backend/src/config/database');

router.use(authenticate);

// GET /drivers
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0, search } = req.query;
    const filters = ['d.deleted_at IS NULL'];
    const params = [];
    if (status) { params.push(status); filters.push(`d.status=$${params.length}`); }
    if (search) { params.push(`%${search}%`); filters.push(`(d.name ILIKE $${params.length} OR d.employee_id ILIKE $${params.length} OR d.phone ILIKE $${params.length})`); }
    params.push(limit, offset);
    const result = await query(
      `SELECT d.*, v.registration AS vehicle_registration, v.type AS vehicle_type
       FROM drivers d LEFT JOIN vehicles v ON v.id = d.current_vehicle_id
       WHERE ${filters.join(' AND ')}
       ORDER BY d.driver_score DESC, d.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*) FROM drivers d WHERE ${filters.join(' AND ')}`, params.slice(0, -2));
    res.json({ data: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) { next(err); }
});

// GET /drivers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT d.*, v.registration AS vehicle_registration
       FROM drivers d LEFT JOIN vehicles v ON v.id = d.current_vehicle_id
       WHERE d.id=$1 AND d.deleted_at IS NULL`, [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Driver not found' });
    
    const events = await query(
      'SELECT * FROM driver_events WHERE driver_id=$1 ORDER BY timestamp DESC LIMIT 20',
      [req.params.id]
    );
    const trips = await query(
      'SELECT * FROM trips WHERE driver_id=$1 ORDER BY started_at DESC LIMIT 10',
      [req.params.id]
    );
    res.json({ data: { ...result.rows[0], events: events.rows, recent_trips: trips.rows } });
  } catch (err) { next(err); }
});

// POST /drivers
router.post('/', authorize('admin', 'dispatcher'), async (req, res, next) => {
  try {
    const { name, employee_id, phone, email, license_number, license_class, license_expiry, status = 'active' } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const result = await query(
      `INSERT INTO drivers (name, employee_id, phone, email, license_number, license_class, license_expiry, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, employee_id, phone, email, license_number, license_class, license_expiry, status]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// PUT /drivers/:id
router.put('/:id', authorize('admin', 'dispatcher'), async (req, res, next) => {
  try {
    const { name, phone, email, license_number, license_class, license_expiry, status, current_vehicle_id } = req.body;
    const result = await query(
      `UPDATE drivers SET
        name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email),
        license_number=COALESCE($4,license_number), license_class=COALESCE($5,license_class),
        license_expiry=COALESCE($6,license_expiry), status=COALESCE($7,status),
        current_vehicle_id=COALESCE($8,current_vehicle_id), updated_at=NOW()
       WHERE id=$9 AND deleted_at IS NULL RETURNING *`,
      [name, phone, email, license_number, license_class, license_expiry, status, current_vehicle_id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Driver not found' });
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /drivers/:id/score-breakdown
router.get('/:id/scorecard', async (req, res, next) => {
  try {
    const driver = await query('SELECT * FROM drivers WHERE id=$1', [req.params.id]);
    if (!driver.rows.length) return res.status(404).json({ error: 'Not found' });
    const d = driver.rows[0];
    const recentTrips = await query(
      'SELECT COUNT(*) trips, AVG(driver_score) avg_score, SUM(distance_km) total_km FROM trips WHERE driver_id=$1 AND started_at > NOW() - INTERVAL \'30 days\'',
      [req.params.id]
    );
    const events = await query(
      'SELECT event_type, COUNT(*) count FROM driver_events WHERE driver_id=$1 AND timestamp > NOW() - INTERVAL \'30 days\' GROUP BY event_type',
      [req.params.id]
    );
    const eventMap = {};
    events.rows.forEach(e => { eventMap[e.event_type] = parseInt(e.count); });
    const scoreBreakdown = {
      overall: d.driver_score,
      speeding: Math.max(0, 100 - (eventMap.speeding || 0) * 5),
      harsh_braking: Math.max(0, 100 - (eventMap.harsh_braking || 0) * 3),
      harsh_acceleration: Math.max(0, 100 - (eventMap.harsh_acceleration || 0) * 3),
      idling: Math.max(0, 100 - Math.round((d.idling_minutes || 0) / 60)),
      route_discipline: Math.max(0, 100 - (eventMap.geofence_breach || 0) * 10),
    };
    res.json({ data: { driver: d, scorecard: scoreBreakdown, recentStats: recentTrips.rows[0], events: eventMap } });
  } catch (err) { next(err); }
});

module.exports = router;
