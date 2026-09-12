const router = require('express').Router();
const c = require('../controllers/alertController');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { auditLog } = require('../middleware/audit');
const requireIdempotencyKey = require('../middleware/idempotency');

router.use(authenticate, attachOrgDb);

// attachOrgDb only sets req.db when req.user.org_id is present. Fail closed
// instead of silently falling back to an unscoped connection.
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

router.get('/', c.getAlerts);
router.post('/', requireIdempotencyKey, auditLog('alerts'), c.createAlert);
router.get('/:id', c.getAlert);
router.patch('/:id/acknowledge', auditLog('alerts'), c.acknowledgeAlert);
router.patch('/:id/resolve', auditLog('alerts'), c.resolveAlert);
router.post('/:id/promote', auditLog('alerts'), c.promoteToIncident);

module.exports = router;
