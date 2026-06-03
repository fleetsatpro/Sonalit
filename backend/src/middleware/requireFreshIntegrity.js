/**
 * requireFreshIntegrity(maxAgeMinutes) — T1.4
 * Rejects destructive commands if the device's last Play Integrity verdict
 * is older than maxAgeMinutes or is not MEETS_DEVICE_INTEGRITY.
 *
 * Expects req.device to be populated by deviceAuth middleware.
 * On stale verdict: returns 412 and enqueues a REQUEST_INTEGRITY command.
 */
const { query } = require('../config/database');
const logger = require('../utils/logger');

function requireFreshIntegrity(maxAgeMinutes) {
  return async (req, res, next) => {
    const device = req.device;
    if (!device) return res.status(401).json({ error: 'Device auth required' });

    const verdict = device.last_integrity_verdict;
    const checkedAt = device.last_integrity_verdict_at;

    const staleCutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const isStale = !checkedAt || new Date(checkedAt) < staleCutoff;
    const isBad = !verdict || verdict !== 'MEETS_DEVICE_INTEGRITY';

    if (isStale || isBad) {
      // Enqueue a force-attestation command so the device re-attests
      try {
        await query(
          `INSERT INTO device_commands (device_id, command_type, payload, status)
           VALUES ($1, 'REQUEST_INTEGRITY', '{}', 'pending')`,
          [device.id]
        );
      } catch (err) {
        logger.error(`Failed to enqueue REQUEST_INTEGRITY: ${err.message}`);
      }
      return res.status(412).json({
        error: 'Device integrity verification required',
        code: 'integrity_required',
        detail: isStale ? 'Integrity verdict is stale' : 'Device does not meet integrity requirements',
      });
    }

    next();
  };
}

module.exports = { requireFreshIntegrity };
