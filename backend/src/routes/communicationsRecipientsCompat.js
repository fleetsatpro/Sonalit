const router = require('express').Router();
const { withOrg } = require('../utils/orgScopedDb');

// Compatibility read endpoint for the Communications Centre recipient panel.
// The legacy query used ORDER BY inside nested json_agg expressions and is
// rejected by the production PostgreSQL parser. Keep ordering at the outer
// row level and preserve the same response contract.
router.get('/recipients', async (req, res, next) => {
  try {
    const q = await withOrg(req.user.org_id, c => c.query(`
      SELECT
        r.id,r.email,r.name,r.company,r.enabled,r.authority_role,r.client_id,
        COALESCE(
          json_agg(
            json_build_object(
              'id',e.id,
              'domain',e.domain,
              'client_id',e.client_id,
              'cds_customer_id',e.cds_customer_id,
              'contact_role',e.contact_role,
              'locale',e.locale,
              'timezone',e.timezone,
              'status',e.status,
              'subscriptions',COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'id',s.id,
                    'event_type',s.event_type,
                    'channel',s.channel,
                    'enabled',s.enabled,
                    'delivery_mode',s.delivery_mode,
                    'critical_override',s.critical_override
                  )
                )
                FROM communication_subscriptions s
                WHERE s.enrollment_id=e.id
              ),'[]'::json)
            )
          ) FILTER (WHERE e.id IS NOT NULL),
          '[]'::json
        ) AS enrollments
      FROM client_email_recipients r
      LEFT JOIN communication_enrollments e
        ON e.org_id=r.org_id AND e.recipient_id=r.id
      WHERE r.org_id=$1 AND r.deleted_at IS NULL
      GROUP BY r.id
      ORDER BY lower(COALESCE(r.name,r.email)),lower(r.email)
    `, [req.user.org_id]));
    res.json({ data: q.rows });
  } catch (e) { next(e); }
});

module.exports = router;
