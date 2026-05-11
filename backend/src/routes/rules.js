const router = require('express').Router();
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try { const { rows } = await pool.query(`SELECT * FROM rules ORDER BY created_at DESC`); res.json({ data: rows }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const { name, condition, action, enabled = true, priority = 'medium', cooldown_minutes = 15 } = req.body; if (!name) return res.status(400).json({ error: 'Name is required' }); const { rows } = await pool.query(`INSERT INTO rules (name, condition, action, enabled, priority, cooldown_minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name, condition, action, enabled, priority, cooldown_minutes]); res.status(201).json({ data: rows[0] }); } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => {
  try { const { enabled } = req.body; const { rows } = await pool.query(`UPDATE rules SET enabled=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [enabled, req.params.id]); if (!rows[0]) return res.status(404).json({ error: 'Rule not found' }); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try { await pool.query(`DELETE FROM rules WHERE id=$1`, [req.params.id]); res.json({ ok: true }); } catch (err) { next(err); }
});
module.exports = router;
