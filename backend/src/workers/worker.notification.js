require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool, query } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startNotificationWorker } = require('./notificationWorker');
const { startResendEmailWorker } = require('./resendEmailWorker');
const { dispatchClientPulse } = require('../services/email/clientPulseDispatch.service');
const { startAdvisoryLeader } = require('../utils/workerExecutionGuard');
const { withAdvisoryLock } = require('../utils/workerExecutionGuard');

createQueues();
const fanoutWorker = startNotificationWorker();
const resendWorker = startResendEmailWorker();
let pulseTimer = null;
let lastPulseSlot = null;
let activePulsePromise = null;
let advisoryLeader = null;

const PULSE_HOURS_EAT = [0, 4, 8, 12, 16, 20];
const EAT_OFFSET_MINUTES = 180;

function getEatSlot(now = new Date()) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const eatMinutes = (utcMinutes + EAT_OFFSET_MINUTES) % 1440;
  return {
    hour: Math.floor(eatMinutes / 60),
    minute: eatMinutes % 60,
    date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now)
  };
}

async function runScheduledClientPulse(now = new Date(), { recovery = false } = {}) {
  const { hour, minute, date } = getEatSlot(now);
  if (!recovery && (minute !== 0 || !PULSE_HOURS_EAT.includes(hour))) {
    return { skipped: true, reason: 'not_pulse_slot' };
  }

  const snapshotAt = new Date(now);
  snapshotAt.setUTCSeconds(0, 0);
  const slotHour = recovery ? [...PULSE_HOURS_EAT].reverse().find(h => h <= hour) ?? 20 : hour;
  let slotDate = date;
  if (recovery && slotHour > hour) {
    const previousDay = new Date(`${date}T00:00:00+03:00`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    slotDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(previousDay);
  }
  if (recovery) {
    snapshotAt.setTime(new Date(`${slotDate}T${String(slotHour).padStart(2, '0')}:00:00+03:00`).getTime());
  }

  const slotKey = `${slotDate}:${String(slotHour).padStart(2, '0')}:00 EAT`;
  if (slotKey === lastPulseSlot) return { skipped: true, reason: 'slot_already_processed', slotKey };

  logger.info(`CDS Client Pulse ${recovery ? 'recovery' : 'scheduled'} dispatch starting: slot=${slotKey} snapshot=${snapshotAt.toISOString()}`);
  const orgs = await query(`
    SELECT DISTINCT org_id
    FROM users
    WHERE org_id IS NOT NULL
      AND deleted_at IS NULL
  `);
  let queued = 0, skipped = 0, failed = 0;

  for (const row of orgs.rows) {
    try {
      const result = await dispatchClientPulse(row.org_id, { snapshotAt, reason: recovery ? 'scheduled_recovery' : 'scheduled' });
      queued += Number(result?.queued || 0);
      skipped += Number(result?.skipped || 0);
      failed += Number(result?.failed || 0);
      logger.info(`CDS Client Pulse ${recovery ? 'recovery' : 'scheduled'} org complete: slot=${slotKey} org=${row.org_id} queued=${result?.queued || 0} skipped=${result?.skipped || 0} failed=${result?.failed || 0}`);
    } catch (error) {
      failed += 1;
      logger.error(`CDS Client Pulse ${recovery ? 'recovery' : 'scheduled'} org failed: slot=${slotKey} org=${row.org_id} error=${error.message}`);
    }
  }

  const result = { slotKey, organizations: orgs.rows.length, queued, skipped, failed, recovery };
  if (failed === 0) lastPulseSlot = slotKey;
  else lastPulseSlot = null;
  logger.info(`CDS Client Pulse ${recovery ? 'recovery' : 'scheduled'} dispatch complete: slot=${slotKey} organizations=${orgs.rows.length} queued=${queued} skipped=${skipped} failed=${failed}`);
  return result;
}

function scheduleClientPulse() {
  if (process.env.CDS_CLIENT_PULSE_ENABLED === 'false') {
    logger.warn('CDS Client Pulse scheduler disabled by CDS_CLIENT_PULSE_ENABLED=false');
    return;
  }

  const tick = () => {
    if (activePulsePromise) return;
    activePulsePromise = runScheduledClientPulse(new Date())
      .catch(error => logger.error(`CDS Client Pulse scheduler tick failed: ${error.message}`))
      .finally(() => { activePulsePromise = null; });
  };

  tick();
  pulseTimer = setInterval(tick, 15000);
  pulseTimer.unref?.();
  logger.info('CDS Client Pulse scheduler active: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 EAT');
}


async function drainPulseWork(reason) {
  if (pulseTimer) clearInterval(pulseTimer);
  pulseTimer = null;
  let drained = true;
  if (activePulsePromise) {
    drained = await Promise.race([
      activePulsePromise.then(() => true, () => true),
      new Promise(resolve => setTimeout(() => resolve(false), 20000))
    ]);
  }
  logger.info(`CDS Client Pulse scheduler quiesced (${reason}); drained=${drained}`);
  return drained;
}

async function shutdown() {
  logger.info('Notification/email workers shutting down');
  const drained = await drainPulseWork('shutdown');
  await advisoryLeader?.stop?.().catch(() => {});
  if (!drained) {
    logger.error('Notification worker shutdown drain timed out; exiting without closing the pool');
    process.exit(78);
  }
  await Promise.all([fanoutWorker.close().catch(() => {}), resendWorker.close().catch(() => {})]);
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  advisoryLeader = await startAdvisoryLeader('sonalit:notification:client-pulse-leader', {
    retryMs: 15000,
    logger,
    onAcquire: async () => {
      try {
        const now = new Date();
        const { hour, minute } = getEatSlot(now);
        const recentSlotAgeMinutes = minute + ((hour % 4) * 60);
        // Four-hour pulse cadence: allow recovery through 30 minutes before the next slot.\n        if (recentSlotAgeMinutes <= 210) {
          await runScheduledClientPulse(now, { recovery: true });
        }
      } catch (error) {
        logger.error(`CDS Client Pulse recovery-on-leader-acquisition failed: ${error.message}`);
      }
      scheduleClientPulse();
      logger.info('Notification worker client-pulse leader active');
    },
    onLose: async () => {
      const drained = await drainPulseWork('leadership loss');
      if (!drained) {
        logger.error('Notification worker could not drain Client Pulse after leader loss; exiting fail-closed');
        process.exit(78);
      }
    }
  });
  advisoryLeader.promise.catch(error => {
    logger.error(`Notification advisory leader loop stopped unexpectedly: ${error.message}`);
    void shutdown();
  });
})();
