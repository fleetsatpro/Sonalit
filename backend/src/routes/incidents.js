const router = require('express').Router();
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try { const { rows } = await pool.query(`SELECT * FROM incidents ORDER BY created_at DESC LIMIT 100`); res.json({ data: rows }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const { convoy_id, title, description, severity = 'medium' } = req.body; if (!title) return res.status(400).json({ error: 'Title is required' }); const { rows } = await pool.query(`INSERT INTO incidents (convoy_id, title, description, severity, status) VALUES ($1,$2,$3,$4,'open') RETURNING *`, [convoy_id || null, title, description, severity]); res.status(201).json({ data: rows[0] }); } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => {
  try { const { status, severity, description } = req.body; const { rows } = await pool.query(`UPDATE incidents SET status=COALESCE($1,status), severity=COALESCE($2,severity), description=COALESCE($3,description), updated_at=NOW() WHERE id=$4 RETURNING *`, [status, severity, description, req.params.id]); if (!rows[0]) return res.status(404).json({ error: 'Incident not found' }); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
router.post('/:id/comments', async (req, res, next) => {
  try { const { content } = req.body; const { rows } = await pool.query(`UPDATE incidents SET description=COALESCE(description,'')||E'\n[Comment] '||$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [content, req.params.id]); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
module.exports = router;
