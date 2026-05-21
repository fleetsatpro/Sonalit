const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/token', (req, res) => {
  const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Realtime not configured' });
  const token = jwt.sign(
    { sub: String(req.user.id) },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
});

module.exports = router;
