const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { dualAuthenticate } = require('../middleware/fieldAuth');

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
  // The app's realtime channels are user-limited Centrifugo channels keyed by
  // ORG id (`org#<org_id>`): '#' means only a connection whose token subject
  // equals the part after it may subscribe. Signing the USER id here meant
  // every subscribe was rejected with 103 permission denied the moment the
  // rest of the realtime stack came up. The org id as subject gives exactly
  // the intended isolation: members can subscribe to their own org's channel
  // and no one else's.
  const token = jwt.sign(
    { sub: String(req.user.org_id ?? req.user.id) },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
});

module.exports = router;
