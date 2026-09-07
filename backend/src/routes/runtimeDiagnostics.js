const router = require('express').Router();
const { query } = require('../config/database');

// This router is mounted beneath an already-authenticated admin-only surface.
// Keep the authorization check explicit as a second line of defence.
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}

router.use(adminOnly);

router.get('/summary', async (req, res, next) => {
  try {
    const [recent, levels, events] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM runtime_diagnostics WHERE occurred_at > NOW() - INTERVAL '24 hours'`),
      query(`SELECT level, COUNT(*)::int AS n FROM runtime_diagnostics WHERE occurred_at > NOW() - INTERVAL '24 hours' GROUP BY level ORDER BY level`),
      query(`SELECT event, COUNT(*)::int AS n, MAX(occurred_at) AS last_seen FROM runtime_diagnostics WHERE occurred_at > NOW() - INTERVAL '24 hours' GROUP BY event ORDER BY n DESC, last_seen DESC LIMIT 20`),
    ]);
    res.json({
      window: '24h',
      total: recent.rows[0]?.n || 0,
      levels: Object.fromEntries(levels.rows.map(r => [r.level, r.n])),
      top_events: events.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

router.get('/recent', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const level = req.query.level ? String(req.query.level) : null;
    const event = req.query.event ? String(req.query.event) : null;
    const { rows } = await query(
      `SELECT id, service, environment, level, event, message, metadata, request_id, org_id, occurred_at
         FROM runtime_diagnostics
        WHERE ($1::text IS NULL OR level = $1)
          AND ($2::text IS NULL OR event = $2)
        ORDER BY occurred_at DESC
        LIMIT $3`,
      [level, event, limit]
    );
    res.json({ items: rows, count: rows.length });
  } catch (err) { next(err); }
});

router.get('/health', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        MAX(occurred_at) AS last_event_at,
        MAX(occurred_at) FILTER (WHERE level IN ('error','fatal')) AS last_failure_at,
        COUNT(*) FILTER (WHERE level IN ('error','fatal') AND occurred_at > NOW() - INTERVAL '1 hour')::int AS failures_1h,
        COUNT(*) FILTER (WHERE level = 'warn' AND occurred_at > NOW() - INTERVAL '1 hour')::int AS warnings_1h
      FROM runtime_diagnostics
    `);
    const row = rows[0] || {};
    res.json({
      status: Number(row.failures_1h || 0) > 0 ? 'degraded' : 'healthy',
      ...row,
      checked_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
