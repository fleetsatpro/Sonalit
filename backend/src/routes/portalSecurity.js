/**
 * Portal security routes.
 * Client (§00-scoped, sanitised):
 *   GET  /portal/convoy/:convoy_id/security    → PortalSecurityStatus
 *   GET  /portal/convoy/:convoy_id/incidents   → PortalIncident[]
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { clientAuth } = require('../middleware/clientAuth');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');
const { toPortalIncident, buildSecurityStatus } = require('../utils/portalSanitiser');

function checkAccess(client, convoy_id, res) {
  if (!client.convoy_ids.includes(convoy_id)) {
    res.status(403).json({ error: 'Not authorised for this convoy' });
    return false;
  }
  return true;
}

async function fetchAlerts(convoy_id, org_id) {
  return query(
    `SELECT a.id, a.convoy_id, a.type, a.severity,
            a.acknowledged_at, a.resolved_at, a.created_at
     FROM alerts a
     JOIN convoys c ON c.id = a.convoy_id
    WHERE a.convoy_id = $1 AND c.org_id = $2 AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC
    LIMIT 50`,
    [convoy_id, org_id],
  );
}

// ── Security status ────────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/security', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const [alertsRes, convoyRes] = await Promise.all([
    fetchAlerts(req.params.convoy_id, org_id),
    query(
      `SELECT c.id, c.updated_at,
              (SELECT gl.timestamp FROM gps_logs gl
               JOIN convoy_trucks ct ON ct.vehicle_id = gl.vehicle_id
               WHERE ct.convoy_id = c.id ORDER BY gl.timestamp DESC LIMIT 1) AS last_ping_at
       FROM convoys c WHERE c.id = $1 AND c.org_id = $2 AND c.deleted_at IS NULL`,
      [req.params.convoy_id, org_id],
    ),
  ]);

  if (!convoyRes.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const sanitised = alertsRes.rows.map(toPortalIncident);
  const status = buildSecurityStatus(req.params.convoy_id, sanitised, convoyRes.rows[0]);
  res.json({ data: status });
}));

// ── Incident feed ──────────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/incidents', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const alertsRes = await fetchAlerts(req.params.convoy_id, org_id);
  const sanitised = alertsRes.rows.map(toPortalIncident);
  res.json({ data: sanitised });
}));

// ── Operator: acknowledge alert + push sanitised portal event ─────────────────

router.post('/convoy/:convoy_id/incidents/:alert_id/acknowledge',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const check = await req.db(
      `SELECT a.id, a.convoy_id, a.type, a.severity, a.acknowledged_at, a.resolved_at, a.created_at
       FROM alerts a JOIN convoys c ON c.id = a.convoy_id
       WHERE a.id = $1 AND a.convoy_id = $2 AND c.org_id = $3 AND a.deleted_at IS NULL`,
      [req.params.alert_id, req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Incident not found' });
    if (check.rows[0].acknowledged_at) return res.status(409).json({ error: 'Already acknowledged' });

    const result = await req.db(
      `UPDATE alerts SET acknowledged_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.alert_id],
    );
    const sanitised = toPortalIncident(result.rows[0]);
    const status = buildSecurityStatus(req.params.convoy_id, [sanitised], null);

    await publish(`portal#${req.params.convoy_id}`, { type: 'security', level: status.level, incident: sanitised });

    res.json({ data: sanitised });
  }),
);

// ── Operator: resolve alert + push sanitised portal event ─────────────────────

router.post('/convoy/:convoy_id/incidents/:alert_id/resolve',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const check = await req.db(
      `SELECT a.id, a.convoy_id, a.type, a.severity, a.acknowledged_at, a.resolved_at, a.created_at
       FROM alerts a JOIN convoys c ON c.id = a.convoy_id
       WHERE a.id = $1 AND a.convoy_id = $2 AND c.org_id = $3 AND a.deleted_at IS NULL`,
      [req.params.alert_id, req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Incident not found' });
    if (check.rows[0].resolved_at) return res.status(409).json({ error: 'Already resolved' });

    const result = await req.db(
      `UPDATE alerts SET resolved_at = NOW(), acknowledged_at = COALESCE(acknowledged_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.alert_id],
    );
    const sanitised = toPortalIncident(result.rows[0]);

    await publish(`portal#${req.params.convoy_id}`, { type: 'security', level: 'secure', incident: sanitised });

    res.json({ data: sanitised });
  }),
);

module.exports = router;
