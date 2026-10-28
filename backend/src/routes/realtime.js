const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { dualAuthenticate } = require('../middleware/fieldAuth');
const { asyncHandler } = require('../middleware/error');

// dualAuthenticate, not authenticate: yard and port tablets need this token
// too. Without it the field app could only ever poll, which is exactly the
// lag the CDS realtime fan-out (routes/cds.js publishCds) exists to remove —
// a controller correcting a seal number, or a yard clamp arriving in the port
// queue, would still take a full poll cycle to reach the crew holding the
// device. The token below is keyed by org either way, so a field session
// subscribes to precisely the same channel with precisely the same scope.
router.use(dualAuthenticate);

router.post('/token', (req, res) => {
  const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Realtime not configured' });
  if (!req.user?.id || !req.user?.org_id) return res.status(403).json({ error: 'tenant_scope_required' });
  const token = jwt.sign(
    { sub: String(req.user.id) },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
});

router.post('/subscription-token', asyncHandler(async (req, res) => {
  const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Realtime not configured' });

  const { channel } = req.body;
  if (!channel || typeof channel !== 'string') {
    return res.status(400).json({ error: 'channel required' });
  }

  if (!req.user?.id || !req.user?.org_id) return res.status(403).json({ error: 'tenant_scope_required' });
  const orgId = String(req.user.org_id);
  const allowedChannels = new Set([
    `org#${orgId}`,
    `risk:updates:${orgId}`,
  ]);

  // Private Ops Comms subscriptions are granted only after checking the exact
  // tenant-owned channel and current membership. For SJM-managed channels a
  // shared journey lock serializes token issuance against the roster update
  // transaction, which holds FOR UPDATE while removing channel membership.
  const commsPrefix = `org#${orgId}#comms#`;
  if (channel.startsWith(commsPrefix)) {
    const channelId = channel.slice(commsPrefix.length);
    const channelUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!channelUuid.test(channelId) || typeof req.dbTx !== 'function') {
      return res.status(403).json({ error: 'Not authorized for this channel' });
    }

    const authorized = await req.dbTx(async (client) => {
      const result = await client.query(
        'SELECT id, org_id, sjm_journey_id FROM channels WHERE id = $1 AND org_id = $2',
        [channelId, orgId],
      );
      const ownedChannel = result.rows[0];
      if (!ownedChannel) return false;

      if (ownedChannel.sjm_journey_id) {
        const mission = await client.query(
          'SELECT id FROM sjm_journeys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL FOR SHARE',
          [ownedChannel.sjm_journey_id, orgId],
        );
        if (!mission.rows.length) return false;
        const manager = ['admin', 'dispatcher'].includes(String(req.user.role || '').toLowerCase());
        if (!manager) {
          const assignment = await client.query(
            `SELECT 1
               FROM sjm_journey_participants p
               JOIN users u ON u.id = p.user_id AND u.org_id = p.org_id
                            AND u.deleted_at IS NULL AND u.status = 'active'
              WHERE p.org_id = $1 AND p.journey_id = $2 AND p.user_id = $3
                AND p.removed_at IS NULL
              LIMIT 1`,
            [orgId, ownedChannel.sjm_journey_id, req.user.id],
          );
          if (!assignment.rows.length) return false;
        }
      }

      const member = await client.query(
        'SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id = $2',
        [channelId, req.user.id],
      );
      return member.rows.length > 0 || String(req.user.role || '').toLowerCase() === 'admin';
    });

    if (!authorized) return res.status(403).json({ error: 'Not authorized for this channel' });
    allowedChannels.add(channel);
  }

  if (!allowedChannels.has(channel)) {
    return res.status(403).json({ error: 'Not authorized for this channel' });
  }

  const token = jwt.sign(
    { sub: String(req.user.id), channel },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
}));

module.exports = router;
