const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/convoyController');
const cfo = require('../controllers/convoysCfoController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const requireIdempotencyKey = require('../middleware/idempotency');

const convoyReportRegenerateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.user?.id || req.ip}:${req.params.id || ''}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

router.use(authenticate);

// Standard convoy routes
router.get('/', c.getConvoys);
router.post('/', requireIdempotencyKey, authorize('admin', 'dispatcher'), auditLog('convoys'), (req, res, next) => {
  if (req.body.trucks !== undefined || req.body.cfos !== undefined) {
    return cfo.createConvoyCfo(req, res, next);
  }
  return c.createConvoy(req, res, next);
});
router.get('/:id', c.getConvoy);
router.put('/:id', authorize('admin', 'dispatcher'), auditLog('convoys'), c.updateConvoy);
router.patch('/:id/status', authorize('admin', 'dispatcher', 'operator'), auditLog('convoys'), c.updateConvoyStatus);
router.post('/:id/assign', authorize('admin', 'dispatcher'), auditLog('convoy_assignments'), c.assignVehicles);
router.delete('/:id', authorize('admin'), auditLog('convoys'), c.deleteConvoy);
router.get('/:id/events', c.getConvoyEvents);

// CFO truck management (B2)
router.post('/:id/trucks', authorize('admin', 'dispatcher'), cfo.addTruck);
router.delete('/:id/trucks/:truckId', authorize('admin', 'dispatcher'), cfo.removeTruck);

// CFO user management (B2)
router.post('/:id/cfos', authorize('admin', 'dispatcher'), cfo.addCfo);
router.delete('/:id/cfos/:cfoId', authorize('admin', 'dispatcher'), cfo.removeCfo);
router.patch('/:id/cfos/:cfoId/device', authorize('admin', 'dispatcher'), cfo.linkDevice);

// CFO truck assignment management (B2)
router.post('/:id/cfo-assignments', authorize('admin', 'dispatcher'), cfo.assignTruckToCfo);
router.delete('/:id/cfo-assignments/:assignmentId', authorize('admin', 'dispatcher'), cfo.removeAssignment);

// Daily report admin (E5)
// E5 — org-wide report overview (must come before /:id routes)
router.get('/reports/overview', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportsOverview);
router.get('/:id/reports', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReports);
router.get('/:id/reports/:date/detail', authorize('admin', 'dispatcher', 'analyst'), cfo.getConvoyReportDetail);
router.post('/:id/reports/:date/regenerate', authorize('admin', 'dispatcher'), convoyReportRegenerateLimiter, cfo.regenerateReport);
router.get('/:id/reports/:date/download', authorize('admin', 'dispatcher', 'analyst'), cfo.downloadReport);

module.exports = router;
