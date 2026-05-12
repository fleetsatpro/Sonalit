const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
router.use(authenticate);
router.get('/', async (req, res, next) => {
  try {
    const r = await query('SELECT id, name, key_prefix, permissions, rate_limit, last_used, created_at, revoked_at FROM api_keys ORDER BY created_at DESC');
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { name, permissions = ['read'], rate_limit = 1000 } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const rawKey = 'fops_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12) + '...';
    const r = await query('INSERT INTO api_keys (name, key_hash, key_prefix, permissions, rate_limit) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, key_prefix, created_at',
      [name, keyHash, keyPrefix, JSON.stringify(permissions), rate_limit]);
    res.status(201).json({ data: { ...r.rows[0], key: rawKey, warning: 'Store this key securely — not shown again' } });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    await query('UPDATE api_keys SET revoked_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
module.exports = router;
