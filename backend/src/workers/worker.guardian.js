require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const logger = require('../utils/logger');

function startGuardianWorkers() {
  if (!process.env.REDIS_URL || process.env.DISABLE_REDIS === 'true') {
    logger.warn('Guardian workers disabled — REDIS_URL not set or DISABLE_REDIS=true');
    return [];
  }

  const url = new URL(process.env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };

  const deviceWorker = new Worker('device', async (job) => {
    if (job.name === 'device:ping') {
      const { device_id, officer_id, org_id } = job.data;
      await query(
        `INSERT INTO device_commands (org_id, device_id, command, status, expires_at)
         VALUES ($1, $2, 'request_location', 'pending', NOW() + INTERVAL '1 hour')`,
        [org_id, device_id]
      );
      logger.info(`device:ping queued request_location for device ${device_id}`);
    }

    if (job.name === 'device:heartbeat_check') {
      const { rows } = await query(
        `SELECT gd.id, gd.org_id FROM guardian_devices gd
         WHERE gd.telemetry_at < NOW() - INTERVAL '10 minutes'
           AND gd.deleted_at IS NULL AND gd.status = 'active'`
      );
      for (const device of rows) {
        const rule = await query(
          `SELECT id FROM alert_rules WHERE org_id = $1 AND trigger = 'signal_lost' AND enabled = true LIMIT 1`,
          [device.org_id]
        );
        if (!rule.rows.length) continue;
        const recent = await query(
          `SELECT id FROM device_commands WHERE device_id = $1 AND command = 'trigger_siren'
           AND created_at > NOW() - INTERVAL '30 minutes' LIMIT 1`,
          [device.id]
        );
        if (recent.rows.length) continue;
        await query(
          `INSERT INTO device_commands (org_id, device_id, command, status, expires_at)
           VALUES ($1, $2, 'trigger_siren', 'pending', NOW() + INTERVAL '1 hour')`,
          [device.org_id, device.id]
        );
        logger.info(`heartbeat_check: trigger_siren issued for offline device ${device.id}`);
      }
    }
  }, { connection });

  const knoxWorker = new Worker('knox', async (job) => {
    if (job.name === 'knox:finalize_recording') {
      const { session_id } = job.data;
      await query(
        `UPDATE knox_remote_sessions SET status = 'ended' WHERE id = $1 AND status != 'ended'`,
        [session_id]
      );
      logger.info(`Knox session ${session_id} finalized`);
    }
  }, { connection });

  const alertWorker2 = new Worker('alert', async (job) => {
    if (job.name === 'alert:battery_low') {
      const { device_id, battery_pct, org_id } = job.data;
      logger.info(`Battery low alert: device ${device_id} at ${battery_pct}% for org ${org_id}`);
    }
  }, { connection, concurrency: 1 });

  deviceWorker.on('failed', (job, err) => logger.error(`Device job ${job?.id} failed: ${err.message}`));
  knoxWorker.on('failed', (job, err) => logger.error(`Knox job ${job?.id} failed: ${err.message}`));
  alertWorker2.on('failed', (job, err) => logger.error(`Alert (guardian) job ${job?.id} failed: ${err.message}`));

  logger.info('Guardian workers started: device, knox, alert');
  return [deviceWorker, knoxWorker, alertWorker2];
}

module.exports = { startGuardianWorkers };
