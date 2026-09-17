const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

const router = express.Router();
router.use(authenticate);

// Operator notification feed. Notifications are user-scoped; an organisation
// is never inferred from client-supplied query parameters.
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const { rows } = await (req.db || query)(
    `SELECT id, type, title, body,
            CASE WHEN read_at IS NULL THEN false ELSE true END AS read,
            created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [req.user.id, limit],
  );
  res.json({ data: rows });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  const result = await (req.db || query)(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, NOW())
      WHERE user_id = $1
        AND read_at IS NULL`,
    [req.user.id],
  );
  res.json({ ok: true, updated: result.rowCount ?? 0 });
}));

module.exports = router;
