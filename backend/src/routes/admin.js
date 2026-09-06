const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb, withOrg } = require('../utils/orgScopedDb');
const { dispatchClientPulse } = require('../services/email/clientPulseDispatch.service');
const logger = require('../utils/logger');

router.use(authenticate, authorize('admin'), attachOrgDb);

router.post('/cds-client-pulse/send', async (req, res, next) => {
  try {
    const result = await dispatchClientPulse(req.user.org_id, { snapshotAt: new Date(), reason: 'manual' });
    res.status(202).json({ data: result });
  } catch (err) {
    logger.error(`Manual Client Pulse failed: org=${req.user.org_id} error=${err.message}`);
    next(err);
  }
});

module.exports = router;
