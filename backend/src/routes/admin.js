const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { getQueues } = require('../config/queue');
const logger = require('../utils/logger');

router.use(authenticate, authorize('admin'));

router.get('/queues', async (req, res, next) => {
  try {
    const queues = getQueues();
    const stats = {};
    for (const [name, q] of Object.entries(queues)) {
      if (!q) { stats[name] = null; continue; }
      try {
        const [waiting, active, failed, completed] = await Promise.all([
          q.getWaitingCount(),
          q.getActiveCount(),
          q.getFailedCount(),
          q.getCompletedCount(),
        ]);
        const deadJobs = await q.getFailed(0, 20);
        stats[name] = {
          waiting,
          active,
          failed,
          completed,
          dead: deadJobs.map(j => ({
            id: j.id,
            name: j.name,
            failedReason: j.failedReason,
            attemptsMade: j.attemptsMade,
            timestamp: j.timestamp,
          })),
        };
      } catch (err) {
        stats[name] = { error: err.message };
      }
    }
    res.json({ data: stats });
  } catch (err) { next(err); }
});

module.exports = router;
