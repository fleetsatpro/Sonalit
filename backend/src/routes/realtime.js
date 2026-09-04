const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { dualAuthenticate } = require('../middleware/fieldAuth');
const { authorizeChannel } = require('../security/channels');
const { resolveSecurityContext } = require('../security/context');

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
  const token = jwt.sign(
    { sub: String(req.user.org_id ?? req.user.id) },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
});

/**
 * Issue a subscription token for one channel.
 *
 * This previously authorized exactly one channel shape — org#<orgId> — and
 * refused everything else. Every other channel Sonalit publishes to
 * (org:<orgId>:device:<id>:telemetry, risk:updates:<orgId>, alert:<orgId>,
 * convoy:<id>:report and the rest) carries no '#', so Centrifugo does not
 * user-limit it either; those subscriptions only work because the broker runs
 * with allow_subscribe_for_client=true, which lets any connected client join
 * any such channel with no token and no check. Refusing to mint tokens for
 * them did not protect them — it just meant the permissive broker setting could
 * never be turned off.
 *
 * Authorization now runs through the channel grammar in security/channels.js,
 * which derives the tenant from the server-resolved security context and
 * verifies resource ownership through the tenant-scoped pool. Once every
 * channel here can obtain a token, Centrifugo should be switched to
 * allow_subscribe_for_client=false so a token becomes mandatory.
 */
router.post('/subscription-token', async (req, res, next) => {
  try {
    const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
    if (!secret) return res.status(503).json({ error: 'Realtime not configured' });

    const { channel } = req.body;
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ error: 'channel required' });
    }

    const orgId = String(req.user.org_id ?? req.user.id);

    // Field and portal sessions authenticate through dualAuthenticate and carry
    // no membership row, so they cannot resolve a full security context. They
    // keep the original behaviour: their own org broadcast channel and nothing
    // else.
    let context = req.security || null;
    if (!context) {
      try {
        context = await resolveSecurityContext(req.user);
      } catch (_) {
        context = null;
      }
    }

    if (!context) {
      if (channel !== `org#${orgId}`) {
        return res.status(403).json({ error: 'Not authorized for this channel' });
      }
    } else {
      const decision = await authorizeChannel(context, channel, req);
      if (!decision.ok) {
        return res.status(403).json({ error: 'Not authorized for this channel' });
      }
    }

    // 'sub' stays the org id: Centrifugo's user-limited channel check keys on
    // it for the '#' channels, and changing it would silently unprotect them.
    const token = jwt.sign(
      { sub: orgId, channel },
      secret,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    res.json({ token });
  } catch (err) { next(err); }
});

module.exports = router;
