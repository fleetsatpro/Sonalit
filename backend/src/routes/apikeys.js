const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { query } = require('../config/database');
router.use(authenticate, attachOrgDb);
router.get('/', async (req, res, next) => {
  try {
    const r = await req.db('SELECT id, name, key_prefix, permissions, rate_limit, last_used, created_at, revoked_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC', [req.user.org_id]);
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
    const r = await req.db('INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions, rate_limit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, key_prefix, created_at',
      [req.user.org_id, name, keyHash, keyPrefix, JSON.stringify(permissions), rate_limit]);
    res.status(201).json({ data: { ...r.rows[0], key: rawKey, warning: 'Store this key securely — not shown again' } });
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await req.db('UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND org_id=$2 RETURNING id', [req.params.id, req.user.org_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'API key not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
module.exports = router;
