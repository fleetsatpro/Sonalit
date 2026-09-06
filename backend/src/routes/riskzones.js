const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         id::text        AS h3_index,
         name,
         CASE risk_level
           WHEN 'critical' THEN 'high'
           WHEN 'no_go'    THEN 'high'
           ELSE risk_level
         END              AS risk_level,
         0                AS event_count,
         lat              AS center_lat,
         lng              AS center_lon,
         radius_km,
         zone_type,
         active,
         created_at
       FROM risk_zones
       WHERE active = true
       ORDER BY CASE risk_level
         WHEN 'critical' THEN 1 WHEN 'no_go' THEN 1
         WHEN 'high'     THEN 2
         WHEN 'medium'   THEN 3
         ELSE 4
       END`
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, description, risk_level = 'medium', zone_type = 'general', lat, lng, radius_km = 5 } = req.body;
    if (!name || !lat || !lng) return res.status(400).json({ error: 'name, lat, lng required' });
    const result = await query(
      'INSERT INTO risk_zones (name, description, risk_level, zone_type, lat, lng, radius_km, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [name, description, risk_level, zone_type, lat, lng, radius_km, req.user.id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await query('UPDATE risk_zones SET active=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
