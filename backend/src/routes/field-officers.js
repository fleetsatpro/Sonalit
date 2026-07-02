const router = require('express').Router();
const { query, pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { publish } = require('../realtime/centrifugo');
const { getQueues } = require('../config/queue');
const logger = require('../utils/logger');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.user?.org_id ?? null;
    const { rows } = await query(
      `SELECT * FROM field_officers WHERE ($1::uuid IS NULL OR org_id = $1) ORDER BY name`,
      [orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = req.user?.org_id ?? null;
    const { name, badge_number, phone, assigned_zone = null } = req.body;
    if (!name || !badge_number || !phone) {
      return res.status(400).json({ error: 'name, badge_number, and phone are required' });
    }
    const { rows } = await query(
      `INSERT INTO field_officers (org_id, name, badge_number, phone, assigned_zone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, name, badge_number, phone, assigned_zone],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const orgId = req.user?.org_id ?? null;
    const { status, assigned_zone, device_id } = req.body;

    if (device_id !== undefined) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (orgId) await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
        if (device_id) {
          // Unlink this device from any other officer that currently has it
          await client.query(
            `UPDATE field_officers SET device_id = NULL, updated_at = NOW()
             WHERE device_id = $1 AND id != $2 AND ($3::uuid IS NULL OR org_id = $3)`,
            [device_id, req.params.id, orgId]
          );
        }
        const { rows } = await client.query(
          `UPDATE field_officers
           SET status = COALESCE($1, status),
               assigned_zone = COALESCE($2, assigned_zone),
               device_id = $3,
               updated_at = NOW()
           WHERE id = $4 AND ($5::uuid IS NULL OR org_id = $5) RETURNING *`,
          [status ?? null, assigned_zone ?? null, device_id, req.params.id, orgId]
        );
        await client.query('COMMIT');
        if (!rows[0]) return res.status(404).json({ error: 'Not found' });
        return res.json({ data: rows[0] });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally { client.release(); }
    }

    const { rows } = await query(
      `UPDATE field_officers
       SET status = COALESCE($1, status),
           assigned_zone = COALESCE($2, assigned_zone),
           updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status ?? null, assigned_zone ?? null, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// GET /:id — single officer with device telemetry + convoy info
router.get('/:id', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT fo.*,
           gd.battery_pct, gd.signal_pct, gd.gps_locked, gd.gps_lat, gd.gps_lng, gd.telemetry_at,
           gd.app_version, gd.active_session_id,
           c.reference AS convoy_reference
         FROM field_officers fo
         LEFT JOIN guardian_devices gd ON gd.id = fo.device_id
         LEFT JOIN convoys c ON c.id = fo.current_convoy_id
         WHERE fo.id = $1 AND fo.org_id = $2`,
        [req.params.id, orgId]
      );
      await client.query('COMMIT');
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json({ data: rows[0] });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `DELETE FROM field_officers WHERE id = $1 AND org_id = $2 RETURNING id`,
      [req.params.id, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ data: { id: rows[0].id, deleted: true } });
  } catch (err) { next(err); }
});

// GET /:id/activity — cursor-based activity events
router.get('/:id/activity', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const before = req.query.before || null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT * FROM officer_activity_events
         WHERE officer_id = $1 AND org_id = $2
         AND ($3::timestamptz IS NULL OR occurred_at < $3)
         ORDER BY occurred_at DESC
         LIMIT $4`,
        [req.params.id, orgId, before, limit]
      );
      await client.query('COMMIT');
      res.json({ data: rows });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /:id/assign-convoy
router.post('/:id/assign-convoy', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { convoy_id } = req.body;
    if (!convoy_id) return res.status(400).json({ error: 'convoy_id is required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      // Validate convoy belongs to same org
      const convoy = await client.query(
        `SELECT id FROM convoys WHERE id = $1 AND org_id = $2`,
        [convoy_id, orgId]
      );
      if (!convoy.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Convoy not found' });
      }
      const { rows } = await client.query(
        `UPDATE field_officers
         SET current_convoy_id = $1, status = 'on_mission', updated_at = NOW()
         WHERE id = $2 AND org_id = $3 RETURNING *`,
        [convoy_id, req.params.id, orgId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Officer not found' });
      }
      await client.query(
        `INSERT INTO officer_activity_events (org_id, officer_id, event_type, convoy_id, occurred_at)
         VALUES ($1, $2, 'mission_started', $3, NOW())`,
        [orgId, req.params.id, convoy_id]
      );
      await client.query('COMMIT');
      publish(`org:${orgId}:officers`, { type: 'officer_updated', officer_id: req.params.id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /:id/unassign-convoy
router.delete('/:id/unassign-convoy', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `UPDATE field_officers
         SET current_convoy_id = NULL, status = 'available', updated_at = NOW()
         WHERE id = $1 AND org_id = $2 RETURNING *`,
        [req.params.id, orgId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Officer not found' });
      }
      await client.query(
        `INSERT INTO officer_activity_events (org_id, officer_id, event_type, occurred_at)
         VALUES ($1, $2, 'mission_ended', NOW())`,
        [orgId, req.params.id]
      );
      await client.query('COMMIT');
      publish(`org:${orgId}:officers`, { type: 'officer_updated', officer_id: req.params.id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /:id/ping-device
router.post('/:id/ping-device', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT fo.id, gd.id AS gd_id, gd.device_id AS device_token
       FROM field_officers fo
       LEFT JOIN guardian_devices gd ON gd.id = fo.device_id
       WHERE fo.id = $1 AND fo.org_id = $2`,
      [req.params.id, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (!rows[0].gd_id) return res.status(422).json({ error: 'NO_DEVICE_LINKED' });
    try {
      const { deviceQueue } = getQueues();
      if (deviceQueue) {
        await deviceQueue.add('device:ping', {
          device_id: rows[0].gd_id,
          officer_id: req.params.id,
          org_id: orgId,
        });
      }
    } catch (e) {
      logger.warn(`device:ping queue unavailable: ${e.message}`);
    }
    res.status(202).json({ data: { job_id: 'queued' } });
  } catch (err) { next(err); }
});

module.exports = router;
