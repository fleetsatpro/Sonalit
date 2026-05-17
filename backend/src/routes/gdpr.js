/**
 * GDPR / Data Retention routes (Task 5.3)
 * All routes require admin JWT authentication.
 *
 * Retention policy (configurable via guardian_config):
 *   device_locations  — 90 days
 *   device_health     — 30 days
 *   guardian_audit_log— 365 days
 */
const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const crypto = require('crypto');

// In-memory confirmation tokens (for DELETE /purge only): token → {device_id, exp}
const purgeTokens = new Map();

/**
 * GET /api/v1/gdpr/export/:device_id
 * Export all personal data for a device as JSON. Requires admin role.
 */
router.get('/export/:device_id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { device_id } = req.params;

    const [device, locations, health, panics, reports, commands] = await Promise.all([
      query(`SELECT * FROM guardian_devices WHERE id = $1`, [device_id]),
      query(`SELECT * FROM device_locations WHERE device_id = $1 ORDER BY timestamp DESC`, [device_id]),
      query(`SELECT * FROM device_health WHERE device_id = $1 ORDER BY recorded_at DESC`, [device_id]),
      query(`SELECT * FROM panic_events WHERE device_id = $1 ORDER BY created_at DESC`, [device_id]),
      query(`SELECT * FROM field_reports WHERE device_id = $1 ORDER BY created_at DESC`, [device_id]),
      query(`SELECT id, command_type, status, issued_at, executed_at FROM device_commands WHERE device_id = $1 ORDER BY issued_at DESC`, [device_id]),
    ]);

    if (!device.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    logger.info(`GDPR export: device=${device_id} by user=${req.user.id}`);

    res.json({
      exported_at: new Date().toISOString(),
      device: device.rows[0],
      location_history: locations.rows,
      health_records: health.rows,
      panic_events: panics.rows,
      field_reports: reports.rows,
      commands: commands.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/gdpr/purge-token/:device_id
 * Generate a one-time confirmation token (valid 10 min) required to hard-delete a device.
 */
router.post('/purge-token/:device_id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { device_id } = req.params;
    const deviceCheck = await query(
      `SELECT id, name FROM guardian_devices WHERE id = $1`,
      [device_id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    purgeTokens.set(token, { device_id, exp: Date.now() + 10 * 60_000 });
    logger.warn(`GDPR purge token issued: device=${device_id} by user=${req.user.id}`);
    res.json({ token, expires_in_seconds: 600, device_name: deviceCheck.rows[0].name });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/gdpr/purge/:device_id
 * Hard-delete ALL data for a device. Requires confirmation token from POST /purge-token.
 * Body: { confirmation_token: string }
 */
router.delete('/purge/:device_id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { device_id } = req.params;
    const { confirmation_token } = req.body;

    if (!confirmation_token) {
      return res.status(400).json({ error: 'confirmation_token is required' });
    }

    const entry = purgeTokens.get(confirmation_token);
    if (!entry || entry.device_id !== device_id || entry.exp < Date.now()) {
      purgeTokens.delete(confirmation_token);
      return res.status(403).json({ error: 'Invalid or expired confirmation token' });
    }
    purgeTokens.delete(confirmation_token);

    const client = await require('../config/database').pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM device_locations WHERE device_id = $1`, [device_id]);
      await client.query(`DELETE FROM device_health WHERE device_id = $1`, [device_id]);
      await client.query(`DELETE FROM panic_events WHERE device_id = $1`, [device_id]);
      await client.query(`DELETE FROM field_reports WHERE device_id = $1`, [device_id]);
      await client.query(`DELETE FROM device_commands WHERE device_id = $1`, [device_id]);
      await client.query(`DELETE FROM guardian_devices WHERE id = $1`, [device_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    logger.warn(`GDPR hard purge: device=${device_id} all data deleted by user=${req.user.id}`);
    res.json({ ok: true, device_id, purged_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/gdpr/run-retention
 * Manually trigger the data retention cleanup. Returns counts of deleted rows.
 * Requires admin role.
 */
router.post('/run-retention', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const [loc, health, audit] = await Promise.all([
      query(`DELETE FROM device_locations WHERE timestamp < NOW() - INTERVAL '90 days' RETURNING id`),
      query(`DELETE FROM device_health WHERE recorded_at < NOW() - INTERVAL '30 days' RETURNING id`),
      // Only purge audit log if table exists
      query(`DELETE FROM guardian_audit_log WHERE created_at < NOW() - INTERVAL '365 days' RETURNING id`)
        .catch(() => ({ rows: [] })),
    ]);

    const result = {
      device_locations_deleted: loc.rows.length,
      device_health_deleted: health.rows.length,
      audit_log_deleted: audit.rows.length,
      ran_at: new Date().toISOString(),
    };

    logger.info(`GDPR retention run: ${JSON.stringify(result)} by user=${req.user.id}`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
