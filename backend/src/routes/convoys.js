const router = require('express').Router();
const c = require('../controllers/convoyController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');

router.use(authenticate);

router.get('/', c.getConvoys);
router.post('/', authorize('admin', 'dispatcher'), auditLog('convoys'), c.createConvoy);
router.get('/:id', c.getConvoy);
router.put('/:id', authorize('admin', 'dispatcher'), auditLog('convoys'), c.updateConvoy);
router.patch('/:id/status', authorize('admin', 'dispatcher', 'operator'), auditLog('convoys'), c.updateConvoyStatus);
router.post('/:id/assign', authorize('admin', 'dispatcher'), auditLog('convoy_assignments'), c.assignVehicles);
router.delete('/:id', authorize('admin'), auditLog('convoys'), c.deleteConvoy);
router.get('/:id/events', c.getConvoyEvents);

module.exports = router;
