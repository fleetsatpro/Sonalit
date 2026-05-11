const router = require('express').Router();
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try { const { rows } = await pool.query(`SELECT * FROM geofences ORDER BY created_at DESC`); res.json({ data: rows }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const { name, type = 'circle', coordinates, radius, region } = req.body; if (!name) return res.status(400).json({ error: 'Name is required' }); const { rows } = await pool.query(`INSERT INTO geofences (name, type, coordinates, radius, region) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, type, JSON.stringify(coordinates), radius, region]); res.status(201).json({ data: rows[0] }); } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try { const { name, active, coordinates, radius } = req.body; const { rows } = await pool.query(`UPDATE geofences SET name=COALESCE($1,name), active=COALESCE($2,active), coordinates=COALESCE($3,coordinates), radius=COALESCE($4,radius), updated_at=NOW() WHERE id=$5 RETURNING *`, [name, active, coordinates ? JSON.stringify(coordinates) : null, radius, req.params.id]); if (!rows[0]) return res.status(404).json({ error: 'Geofence not found' }); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await pool.query(`DELETE FROM geofences WHERE id=$1`, [req.params.id]); res.json({ ok: true }); } catch (err) { next(err); }
});
module.exports = router;
