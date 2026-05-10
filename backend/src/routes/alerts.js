const router = require('express').Router();
const c = require('../controllers/alertController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate);

router.get('/', c.getAlerts);
router.post('/', auditLog('alerts'), c.createAlert);
router.get('/:id', c.getAlert);
router.patch('/:id/acknowledge', auditLog('alerts'), c.acknowledgeAlert);
router.patch('/:id/resolve', auditLog('alerts'), c.resolveAlert);

module.exports = router;
