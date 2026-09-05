require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startNotificationWorker } = require('./notificationWorker');
const { startResendEmailWorker } = require('./resendEmailWorker');

createQueues();
const fanoutWorker = startNotificationWorker();
const resendWorker = startResendEmailWorker();

async function shutdown() {
  logger.info('Notification/email workers shutting down');
  await Promise.all([
    fanoutWorker.close().catch(() => {}),
    resendWorker.close().catch(() => {}),
  ]);
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
