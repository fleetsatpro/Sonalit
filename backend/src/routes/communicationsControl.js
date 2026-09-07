const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const { listCustomerPulseTargets, generateAndQueueScopedClientPulse } = require('../services/email/scopedClientPulse.service');
const { withOrg } = require('../utils/orgScopedDb');

// Mounted below /admin, whose parent router already enforces admin/super_admin.
// These endpoints are deliberately read-heavy and customer-scoped.
router.get('/health', async (req, res, next) => {
  try {
    const [queued, delivery, recipients] = await Promise.all([
      withOrg(req.user.org_id, c => c.query(`SELECT COUNT(*)::int AS n FROM email_notifications WHERE org_id=$1 AND status='queued' AND created_at > NOW()-INTERVAL '24 hours'`, [req.user.org_id])),
      withOrg(req.user.org_id, c => c.query(`SELECT status, COUNT(*)::int AS n FROM communication_delivery_events WHERE org_id=$1 AND created_at > NOW()-INTERVAL '24 hours' GROUP BY status ORDER BY status`, [req.user.org_id])),
      withOrg(req.user.org_id, c => c.query(`SELECT COUNT(*)::int AS n FROM client_email_recipients WHERE org_id=$1 AND enabled=true AND deleted_at IS NULL`, [req.user.org_id])),
    ]);
    res.json({ data: { status: 'operational', queued_24h: queued.rows[0].n, recipients: recipients.rows[0].n, delivery_24h: Object.fromEntries(delivery.rows.map(r => [r.status, r.n])), checkedAt: new Date().toISOString() } });
  } catch (err) { next(err); }
});

router.get('/deliveries', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const rows = await withOrg(req.user.org_id, c => c.query(
      `SELECT e.id,e.event_type,e.channel,e.status,e.provider_message_id,e.provider_event_id,e.correlation_id,e.error_code,e.error_message,e.created_at,e.sent_at,e.delivered_at,e.failed_at,
              n.recipient,n.recipient_name,n.notification_type,n.subject
         FROM communication_delivery_events e
         LEFT JOIN email_notifications n ON n.org_id=e.org_id AND n.provider_email_id=e.provider_message_id
        WHERE e.org_id=$1 ORDER BY e.created_at DESC LIMIT $2`, [req.user.org_id, limit]
    ));
    res.json({ data: rows.rows });
  } catch (err) { next(err); }
});

router.post('/client-pulse/dispatch', async (req, res, next) => {
  try {
    const snapshotAt = new Date();
    const targets = await listCustomerPulseTargets(req.user.org_id);
    const requested = Array.isArray(req.body?.customerIds) && req.body.customerIds.length
      ? [...new Set(req.body.customerIds.map(String))]
      : targets;
    const invalid = requested.filter(id => !targets.includes(id));
    if (invalid.length) return res.status(403).json({ error: 'customer_scope_violation', invalidCustomerIds: invalid });

    // A stable five-minute operator window prevents accidental rapid-fire manual sends.
    // The unique correlation token remains per dispatch, while the guard is based on
    // org + customer + snapshot window, so a deliberate later send is still possible.
    const windowStart = new Date(Math.floor(snapshotAt.getTime() / 300000) * 300000);
    const results = [];
    for (const customerId of requested) {
      const recent = await withOrg(req.user.org_id, c => c.query(
        `SELECT id,status,created_at FROM cds_client_pulse_runs WHERE org_id=$1 AND customer_id=$2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
        [req.user.org_id, customerId, windowStart]
      ));
      if (recent.rows.length && ['generating','queued','sent'].includes(recent.rows[0].status)) {
        results.push({ customerId, skipped: true, reason: 'recent_dispatch_in_progress_or_complete', runId: recent.rows[0].id });
        continue;
      }
      try {
        results.push(await generateAndQueueScopedClientPulse(req.user.org_id, customerId, { snapshotAt, reason: 'manual_canonical', idempotencyKey: `manual-cds-client-pulse:${customerId}:${windowStart.toISOString()}` }));
      } catch (err) {
        results.push({ customerId, skipped: true, reason: 'delivery_failed', error: String(err.message || err).slice(0, 1000) });
      }
    }
    res.json({ data: { dispatchId: crypto.randomUUID(), snapshotAt: snapshotAt.toISOString(), requested: requested.length, results } });
  } catch (err) { next(err); }
});

module.exports = router;
