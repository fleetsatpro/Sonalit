const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try { const db = req.db || query; const { rows } = await db(`SELECT * FROM incidents ORDER BY created_at DESC LIMIT 100`); res.json({ data: rows }); } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try { const db = req.db || query; const { convoy_id, title, description, severity = 'medium' } = req.body; if (!title) return res.status(400).json({ error: 'Title is required' }); const { rows } = await db(`INSERT INTO incidents (convoy_id, title, description, severity, status, org_id) VALUES ($1,$2,$3,$4,'open',$5) RETURNING *`, [convoy_id || null, title, description, severity, req.user.org_id || null]); res.status(201).json({ data: rows[0] }); } catch (err) { next(err); }
});
router.patch('/:id', async (req, res, next) => {
  try { const db = req.db || query; const { status, severity, description } = req.body; const { rows } = await db(`UPDATE incidents SET status=COALESCE($1,status), severity=COALESCE($2,severity), description=COALESCE($3,description), updated_at=NOW() WHERE id=$4 RETURNING *`, [status, severity, description, req.params.id]); if (!rows[0]) return res.status(404).json({ error: 'Incident not found' }); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
router.post('/:id/comments', async (req, res, next) => {
  try { const db = req.db || query; const { content } = req.body; const { rows } = await db(`UPDATE incidents SET description=COALESCE(description,'')||E'\n[Comment] '||$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [content, req.params.id]); res.json({ data: rows[0] }); } catch (err) { next(err); }
});
module.exports = router;
