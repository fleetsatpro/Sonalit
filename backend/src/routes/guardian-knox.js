const router = require('express').Router();
const { query, pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { publish } = require('../realtime/centrifugo');
const { getQueues } = require('../config/queue');
const logger = require('../utils/logger');

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

router.use(authenticate);

const VALID_KEYS = ['HOME', 'BACK', 'RECENTS', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN'];
const VALID_COMMANDS = ['request_location', 'trigger_siren', 'lock_screen', 'force_checkin', 'restart_app', 'clear_app_data', 'remote_wipe'];

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// POST /devices/:id/remote-session/start
router.post('/devices/:id/remote-session/start', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const deviceRes = await client.query(
        `SELECT id, knox_do_enrolled FROM guardian_devices WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [deviceId, orgId]
      );
      if (!deviceRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Device not found' });
      }
      if (!deviceRes.rows[0].knox_do_enrolled) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'NOT_DEVICE_OWNER' });
      }
      const existing = await client.query(
        `SELECT id FROM knox_remote_sessions WHERE device_id = $1 AND status IN ('initializing','live') LIMIT 1`,
        [deviceId]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'SESSION_ACTIVE', session_id: existing.rows[0].id });
      }
      const { rows } = await client.query(
        `INSERT INTO knox_remote_sessions (org_id, device_id, operator_id, status, triggered_by)
         VALUES ($1, $2, $3, 'initializing', $4) RETURNING id`,
        [orgId, deviceId, req.user.id, (['sos','manual','scheduled'].includes(req.body.triggered_by) ? req.body.triggered_by : 'manual')]
      );
      const sessionId = rows[0].id;
      await client.query(
        `UPDATE guardian_devices SET active_session_id = $1 WHERE id = $2`,
        [sessionId, deviceId]
      );
      await client.query('COMMIT');
      const centrifugoChannel = `org:${orgId}:session:${sessionId}`;
      publish(`org:${orgId}:device:${deviceId}:commands`, {
        type: 'knox:start_session',
        session_id: sessionId,
        centrifugo_channel: centrifugoChannel,
      }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: { session_id: sessionId, centrifugo_channel: centrifugoChannel } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/webrtc-signal
router.post('/devices/:id/remote-session/webrtc-signal', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const { type, payload, session_id } = req.body;
    if (!session_id || !type || !payload) {
      return res.status(400).json({ error: 'session_id, type and payload are required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      if (type === 'offer') {
        await client.query(
          `UPDATE knox_remote_sessions SET webrtc_offer = $1 WHERE id = $2 AND org_id = $3`,
          [payload, session_id, orgId]
        );
      } else if (type === 'answer') {
        await client.query(
          `UPDATE knox_remote_sessions SET webrtc_answer = $1, status = 'live' WHERE id = $2 AND org_id = $3`,
          [payload, session_id, orgId]
        );
      } else if (type === 'ice_candidate') {
        await client.query(
          `UPDATE knox_remote_sessions SET ice_candidates = ice_candidates || $1::jsonb WHERE id = $2 AND org_id = $3`,
          [JSON.stringify(payload), session_id, orgId]
        );
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid signal type. Must be offer, answer, or ice_candidate' });
      }
      await client.query('COMMIT');
      publish(`org:${orgId}:session:${session_id}`, { type: `webrtc:${type}`, payload }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: { ok: true } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/end
router.post('/devices/:id/remote-session/end', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `UPDATE knox_remote_sessions
         SET status = 'ended', ended_at = NOW(),
             duration_secs = EXTRACT(EPOCH FROM (NOW() - started_at))::int
         WHERE id = $1 AND org_id = $2
         RETURNING id, duration_secs, recording_key`,
        [session_id, orgId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Session not found' });
      }
      await client.query(
        `UPDATE guardian_devices SET active_session_id = NULL WHERE id = $1 AND org_id = $2`,
        [deviceId, orgId]
      );
      await client.query('COMMIT');
      publish(`org:${orgId}:device:${deviceId}:commands`, { type: 'knox:end_session', session_id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      try {
        const { knoxQueue } = getQueues();
        if (knoxQueue) {
          await knoxQueue.add('knox:finalize_recording', { session_id });
        }
      } catch (e) {
        logger.warn(`knox:finalize_recording queue unavailable: ${e.message}`);
      }
      res.json({ data: { session_id, duration_secs: rows[0].duration_secs, recording_key: rows[0].recording_key } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/screenshot
router.post('/devices/:id/remote-session/screenshot', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { frame_data, session_id } = req.body;
    if (!frame_data || !session_id) return res.status(400).json({ error: 'frame_data and session_id are required' });
    const bucket = process.env.R2_BUCKET;
    const screenshotKey = `sessions/${session_id}/screenshots/${Date.now()}.png`;
    const r2 = getR2Client();
    const imageBuffer = Buffer.from(frame_data, 'base64');
    await r2.send(new PutObjectCommand({
      Bucket: bucket,
      Key: screenshotKey,
      Body: imageBuffer,
      ContentType: 'image/png',
    }));
    const presignedUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: screenshotKey }), { expiresIn: 900 });
    const event = JSON.stringify({ type: 'screenshot', key: screenshotKey, ts: new Date().toISOString() });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      await client.query(
        `UPDATE knox_remote_sessions
         SET screenshot_keys = screenshot_keys || $1::jsonb,
             event_log = event_log || $2::jsonb
         WHERE id = $3 AND org_id = $4`,
        [JSON.stringify(screenshotKey), event, session_id, orgId]
      );
      await client.query('COMMIT');
    } finally { client.release(); }
    res.json({ data: { screenshot_key: screenshotKey, presigned_url: presignedUrl } });
  } catch (err) { next(err); }
});

// GET /devices/:id/remote-session/recordings
router.get('/devices/:id/remote-session/recordings', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT * FROM knox_remote_sessions
         WHERE device_id = $1 AND org_id = $2 AND recording_key IS NOT NULL
         ORDER BY started_at DESC LIMIT 20`,
        [deviceId, orgId]
      );
      await client.query('COMMIT');
      const r2 = getR2Client();
      const bucket = process.env.R2_BUCKET;
      const sessions = await Promise.all(rows.map(async (session) => {
        try {
          const presignedUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: session.recording_key }), { expiresIn: 900 });
          return { ...session, presigned_url: presignedUrl };
        } catch (_) {
          return { ...session, presigned_url: null };
        }
      }));
      res.json({ data: { sessions } });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/inject-touch
router.post('/devices/:id/remote-session/inject-touch', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const { x, y, action = 'tap', session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!['tap', 'swipe'].includes(action)) return res.status(400).json({ error: 'action must be tap or swipe' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const sessionRes = await client.query(
        `SELECT id, status FROM knox_remote_sessions WHERE id = $1 AND org_id = $2`,
        [session_id, orgId]
      );
      if (!sessionRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Session not found' });
      }
      if (sessionRes.rows[0].status !== 'live') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Session not live' });
      }
      const event = JSON.stringify({ type: 'inject_touch', action, x, y, ts: new Date().toISOString() });
      await client.query(
        `UPDATE knox_remote_sessions SET event_log = event_log || $1::jsonb WHERE id = $2`,
        [event, session_id]
      );
      await client.query('COMMIT');
      publish(`org:${orgId}:device:${deviceId}:remote_control`, { type: 'inject_touch', action, x, y }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: { ok: true } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/inject-key
router.post('/devices/:id/remote-session/inject-key', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const { key, session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!VALID_KEYS.includes(key)) {
      return res.status(400).json({ error: 'Invalid key', valid: VALID_KEYS });
    }
    const event = JSON.stringify({ type: 'inject_key', key, ts: new Date().toISOString() });
    await query(
      `UPDATE knox_remote_sessions SET event_log = event_log || $1::jsonb WHERE id = $2 AND org_id = $3`,
      [event, session_id, orgId]
    );
    publish(`org:${orgId}:device:${deviceId}:remote_control`, { type: 'inject_key', key }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// POST /devices/:id/remote-session/mdm-action
router.post('/devices/:id/remote-session/mdm-action', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const deviceId = req.params.id;
    const { action, session_id, confirm } = req.body;
    if (!action || !session_id) return res.status(400).json({ error: 'action and session_id are required' });
    if (!VALID_COMMANDS.includes(action)) {
      return res.status(400).json({ error: 'Invalid action', valid: VALID_COMMANDS });
    }
    if (action === 'remote_wipe' && confirm !== true) {
      return res.status(400).json({ error: 'WIPE_REQUIRES_CONFIRM' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `INSERT INTO device_commands (org_id, device_id, command, status, issued_by, expires_at)
         VALUES ($1, $2, $3, 'pending', $4, NOW() + INTERVAL '6 hours')
         RETURNING id`,
        [orgId, deviceId, action, req.user.id]
      );
      const commandId = rows[0].id;
      const event = JSON.stringify({ type: 'mdm_action', action, command_id: commandId, ts: new Date().toISOString() });
      await client.query(
        `UPDATE knox_remote_sessions SET event_log = event_log || $1::jsonb WHERE id = $2 AND org_id = $3`,
        [event, session_id, orgId]
      );
      await client.query('COMMIT');
      res.json({ data: { ok: true, command_id: commandId } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
