const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try {
    const { convoy_id } = req.query;
    const r = convoy_id
      ? await query('SELECT * FROM documents WHERE convoy_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [convoy_id])
      : await query('SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50');
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { convoy_id, type, title, metadata, valid_until } = req.body;
    if (!type || !title) return res.status(400).json({ error: 'type and title required' });
    const r = await query('INSERT INTO documents (convoy_id, type, title, metadata, valid_until) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [convoy_id||null, type, title, JSON.stringify(metadata||{}), valid_until||null]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    await query('UPDATE documents SET deleted_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
module.exports = router;
