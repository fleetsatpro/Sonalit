const router = require('express').Router();

// Resend provider webhooks authenticate with Svix signatures, not Sonalit
// operator sessions. Mount this BEFORE the authenticated webhook surface.
router.use('/resend', require('./resendWebhook'));

const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.get('/', (req, res) => res.json({ data: [] }));
module.exports = router;
