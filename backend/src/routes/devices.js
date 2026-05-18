const router = require('express').Router();
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM devices WHERE deleted_at IS NULL ORDER BY created_at DESC`);
    res.json({ data: rows });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { name, imei, sim_number, phone_number, status = 'inactive' } = req.body;
    if (!name) return res.status(400).json({ error: 'Device name is required' });
    const { rows } = await pool.query(
      `INSERT INTO devices (name, imei, sim_number, phone_number, status) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, imei, sim_number, phone_number, status]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const { name, imei, sim_number, phone_number, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE devices SET name=COALESCE($1,name), imei=COALESCE($2,imei), sim_number=COALESCE($3,sim_number), phone_number=COALESCE($4,phone_number), status=COALESCE($5,status), updated_at=NOW() WHERE id=$6 AND deleted_at IS NULL RETURNING *`,
      [name, imei, sim_number, phone_number, status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});
router.get('/:id/health', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM devices WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: { ...rows[0], battery: rows[0].battery ?? 100, signal: rows[0].signal ?? 'good' } });
  } catch (err) { next(err); }
});
module.exports = router;
