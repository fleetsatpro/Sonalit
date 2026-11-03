const router = require('express').Router();
const c = require('../controllers/vehicleController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const vehicleDocRouter = require('./vehicleDocuments');

router.use(authenticate);

router.get('/', c.getVehicles);
router.post('/', authorize('admin', 'dispatcher'), auditLog('vehicles'), c.createVehicle);
router.get('/:id', c.getVehicle);
router.put('/:id', authorize('admin', 'dispatcher'), auditLog('vehicles'), c.updateVehicle);
router.patch('/:id/status', authorize('admin', 'dispatcher', 'operator'), auditLog('vehicles'), c.updateVehicleStatus);
router.delete('/:id', authorize('admin'), auditLog('vehicles'), c.deleteVehicle);
router.get('/:id/history', c.getVehicleHistory);

router.use('/:vehicleId/documents', vehicleDocRouter);

module.exports = router;
