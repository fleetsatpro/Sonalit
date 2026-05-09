const router = require('express').Router();
const c = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/dashboard', c.getDashboard);
router.get('/fleet-utilization', c.getFleetUtilization);
router.get('/convoy-metrics', c.getConvoyMetrics);
router.get('/incident-heatmap', c.getIncidentHeatmap);

module.exports = router;
