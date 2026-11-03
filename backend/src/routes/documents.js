const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { query } = require('../config/database');
router.use(authenticate, attachOrgDb);
router.get('/', async (req, res, next) => {
  try {
    const { convoy_id } = req.query;
    const r = convoy_id
      ? await req.db('SELECT * FROM documents WHERE convoy_id=$1 AND org_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC', [convoy_id, req.user.org_id])
      : await req.db('SELECT * FROM documents WHERE org_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50', [req.user.org_id]);
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { convoy_id, type, title, metadata, valid_until } = req.body;
    if (!type || !title) return res.status(400).json({ error: 'type and title required' });
    const r = await req.db('INSERT INTO documents (convoy_id, type, title, metadata, valid_until, org_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [convoy_id||null, type, title, JSON.stringify(metadata||{}), valid_until||null, req.user.org_id]);
    res.status(201).json({ data: r.rows[0] });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await req.db('UPDATE documents SET deleted_at=NOW() WHERE id=$1 AND org_id=$2 RETURNING id', [req.params.id, req.user.org_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
module.exports = router;
