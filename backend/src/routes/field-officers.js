const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.user?.org_id ?? null;
    const { rows } = await query(
      `SELECT * FROM field_officers WHERE ($1::uuid IS NULL OR org_id = $1) ORDER BY name`,
      [orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = req.user?.org_id ?? null;
    const { name, badge_number, phone, assigned_zone = null } = req.body;
    if (!name || !badge_number || !phone) {
      return res.status(400).json({ error: 'name, badge_number, and phone are required' });
    }
    const { rows } = await query(
      `INSERT INTO field_officers (org_id, name, badge_number, phone, assigned_zone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, name, badge_number, phone, assigned_zone],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { status, assigned_zone } = req.body;
    const { rows } = await query(
      `UPDATE field_officers
       SET status = COALESCE($1, status),
           assigned_zone = COALESCE($2, assigned_zone),
           updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status ?? null, assigned_zone ?? null, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
