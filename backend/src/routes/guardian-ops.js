const router = require('express').Router();
const { query, pool } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { publish } = require('../realtime/centrifugo');
const { getQueues } = require('../config/queue');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { sendCommandPush } = require('../utils/fcm');
const { signCommand } = require('../utils/commandSigning');
const captureVision = require('../utils/captureVision');

router.use(authenticate);

// show_message: display an operator text on the device as a high-priority
// notification (the Live Fleet "Msg" action) — payload: { text }
// play_voice_message: play a dispatch voice recording out loud on the device
// (the Live Fleet "Voice" action) — payload: { voice_id, url, duration_ms };
// issued by POST /devices/:id/voice-message below, which stores the audio.
const VALID_COMMANDS = ['request_location', 'trigger_siren', 'lock_screen', 'force_checkin', 'restart_app', 'clear_app_data', 'remote_wipe', 'show_message', 'play_voice_message', 'capture_photo'];

const DEFAULT_ALERT_RULES = [
  { name: 'Battery Low', trigger: 'battery_low', threshold: 15, action: 'notify', enabled: true },
  { name: 'Signal Lost', trigger: 'signal_lost', threshold: 10, action: 'notify', enabled: true },
  { name: 'SOS Triggered', trigger: 'sos', threshold: null, action: 'notify', enabled: true },
  { name: 'App Outdated', trigger: 'app_outdated', threshold: null, action: 'notify', enabled: true },
];

// GET /devices
router.get('/devices', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT gd.*, fo.name AS officer_name, fo.badge_number, fo.status AS officer_status
         FROM guardian_devices gd
         LEFT JOIN field_officers fo ON fo.device_id = gd.id AND fo.org_id = $1
         WHERE gd.org_id = $1 AND gd.deleted_at IS NULL
         ORDER BY gd.last_seen DESC NULLS LAST`,
        [orgId]
      );
      await client.query('COMMIT');
      res.json({ data: rows });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// GET /devices/:id
router.get('/devices/:id', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT gd.*, fo.id AS officer_id, fo.name AS officer_name, fo.badge_number,
           fo.status AS officer_status, fo.current_convoy_id
         FROM guardian_devices gd
         LEFT JOIN field_officers fo ON fo.device_id = gd.id AND fo.org_id = $1
         WHERE gd.id = $2 AND gd.org_id = $1 AND gd.deleted_at IS NULL`,
        [orgId, req.params.id]
      );
      await client.query('COMMIT');
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json({ data: rows[0] });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// PATCH /devices/:id/telemetry — APK heartbeat
router.patch('/devices/:id/telemetry', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const {
      battery_pct, signal_pct, gps_locked, gps_lat, gps_lng, gps_accuracy_m, gps_satellites,
      cpu_pct, ram_pct, app_version, android_version, knox_version, knox_do_enrolled,
      dms_configured, battery_level, signal_level,
    } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `UPDATE guardian_devices SET
           battery_pct = COALESCE($1, battery_pct),
           signal_pct = COALESCE($2, signal_pct),
           gps_locked = COALESCE($3, gps_locked),
           gps_lat = COALESCE($4, gps_lat),
           gps_lng = COALESCE($5, gps_lng),
           gps_accuracy_m = COALESCE($6, gps_accuracy_m),
           gps_satellites = COALESCE($7, gps_satellites),
           cpu_pct = COALESCE($8, cpu_pct),
           ram_pct = COALESCE($9, ram_pct),
           app_version = COALESCE($10, app_version),
           android_version = COALESCE($11, android_version),
           knox_version = COALESCE($12, knox_version),
           knox_do_enrolled = COALESCE($13, knox_do_enrolled),
           dms_configured = COALESCE($14, dms_configured),
           battery_level = COALESCE($15, battery_level),
           signal_level = COALESCE($16, signal_level),
           telemetry_at = NOW(),
           last_seen = NOW()
         WHERE id = $17 AND org_id = $18 AND deleted_at IS NULL
         RETURNING *`,
        [battery_pct, signal_pct, gps_locked, gps_lat, gps_lng, gps_accuracy_m, gps_satellites,
          cpu_pct, ram_pct, app_version, android_version, knox_version, knox_do_enrolled,
          dms_configured, battery_level, signal_level, req.params.id, orgId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Not found' });
      }
      // Update linked officer last_seen_at
      await client.query(
        `UPDATE field_officers SET last_seen_at = NOW(), updated_at = NOW()
         WHERE device_id = $1 AND org_id = $2`,
        [req.params.id, orgId]
      );
      // Evaluate battery_low alert rule
      const effectiveBattery = battery_pct ?? rows[0].battery_pct;
      if (effectiveBattery != null) {
        const ruleRes = await client.query(
          `SELECT * FROM alert_rules WHERE org_id = $1 AND trigger = 'battery_low' AND enabled = true LIMIT 1`,
          [orgId]
        );
        const rule = ruleRes.rows[0];
        if (rule && effectiveBattery < (rule.threshold ?? 15)) {
          // Dedup: only fire once per hour per device
          const recentAlert = await client.query(
            `SELECT id FROM device_commands WHERE device_id = $1 AND command = 'request_location'
             AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
            [req.params.id]
          );
          if (!recentAlert.rows.length) {
            try {
              const { alertQueue } = getQueues();
              if (alertQueue) {
                await alertQueue.add('alert:battery_low', { device_id: req.params.id, battery_pct: effectiveBattery, org_id: orgId });
              }
            } catch (e) {
              logger.warn(`alert:battery_low queue unavailable: ${e.message}`);
            }
          }
        }
      }
      await client.query('COMMIT');
      publish(`org:${orgId}:device:${req.params.id}:telemetry`, rows[0]).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ data: { ok: true } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// GET /devices/:id/command-history
router.get('/devices/:id/command-history', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT * FROM device_commands WHERE device_id = $1 AND org_id = $2
         ORDER BY created_at DESC LIMIT $3`,
        [req.params.id, orgId, limit]
      );
      await client.query('COMMIT');
      res.json({ data: rows });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/commands — issue command
router.post('/devices/:id/commands', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { command, payload = null, ttl_hours = 6, confirm } = req.body;
    if (!command || !VALID_COMMANDS.includes(command)) {
      return res.status(400).json({ error: 'Invalid command', valid: VALID_COMMANDS });
    }
    if (command === 'remote_wipe' && confirm !== true) {
      return res.status(400).json({ error: 'WIPE_REQUIRES_CONFIRM' });
    }
    const effectiveTtl = Math.min(ttl_hours || 6, 24);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const deviceCheck = await client.query(
        `SELECT id, fcm_token FROM guardian_devices WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [req.params.id, orgId]
      );
      if (!deviceCheck.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Device not found' });
      }
      const device = deviceCheck.rows[0];
      const { rows } = await client.query(
        // $5 must not be reused inside the interval expression below — the ttl_hours
        // column infers it as integer while `$5 * INTERVAL` infers double precision,
        // and Postgres rejects a single placeholder with two conflicting inferred
        // types ("inconsistent types deduced for parameter") before the query runs
        // at all. Binding the same value again as its own placeholder ($7) sidesteps
        // the conflict entirely.
        `INSERT INTO device_commands (org_id, device_id, command, command_type, status, payload, ttl_hours, issued_by, issued_at, expires_at)
         VALUES ($1, $2, $3, $3, 'pending', $4, $5, $6, NOW(), NOW() + ($7 * INTERVAL '1 hour'))
         RETURNING id, issued_at, expires_at`,
        [orgId, req.params.id, command, payload, effectiveTtl, req.user.id, effectiveTtl]
      );
      const cmd = rows[0];
      // The heartbeat poll fallback (guardian.js /heartbeat) only claims commands
      // WHERE signature IS NOT NULL, so this path needs one too or it can only
      // ever be delivered via the FCM push below.
      const signature = signCommand(cmd.id, command, payload, cmd.issued_at, cmd.expires_at);
      await client.query(`UPDATE device_commands SET signature = $1 WHERE id = $2`, [signature, cmd.id]);
      await client.query('COMMIT');
      publish(`org:${orgId}:device:${req.params.id}:commands`, { type: 'command_issued', command, command_id: rows[0].id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      publish(`org#${orgId}`, { type: 'command:queued', device_id: req.params.id, command, command_id: rows[0].id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      if (device.fcm_token) {
        sendCommandPush(device.fcm_token, command, rows[0].id, payload).catch(e => logger.warn(`Command FCM push failed: ${e.message}`));
      }
      res.json({ data: { command_id: rows[0].id, status: 'queued' } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:id/voice-message — record-and-send from the dashboard.
// Body is the raw audio bytes (audio/webm|ogg|mp4|mpeg, ≤2 MB; the global
// express.json parser ignores non-JSON content types so this route-level raw
// parser receives the body untouched). Stores the clip in
// guardian_voice_messages, then issues a signed play_voice_message command
// through the same pipeline as every other device command (FCM push for
// instant delivery, 60s in-service poll / heartbeat as fallback).
router.post(
  '/devices/:id/voice-message',
  require('express').raw({ type: ['audio/*'], limit: '2mb' }),
  async (req, res, next) => {
    try {
      const orgId = req.user.org_id;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Request body must be raw audio bytes with an audio/* content type' });
      }
      const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
      const durationMs = parseInt(req.query.duration_ms) || null;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
        const deviceCheck = await client.query(
          `SELECT id, fcm_token FROM guardian_devices WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
          [req.params.id, orgId]
        );
        if (!deviceCheck.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Device not found' });
        }
        const device = deviceCheck.rows[0];

        const { rows: voiceRows } = await client.query(
          `INSERT INTO guardian_voice_messages (org_id, device_id, issued_by, mime, duration_ms, audio)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [orgId, req.params.id, req.user.id, mime, durationMs, req.body]
        );
        const voice = voiceRows[0];
        // Without BACKEND_URL this produced a RELATIVE url ("/api/v1/...")
        // — the app's HTTP client throws on it before any request is made,
        // so voice commands silently acked 'failed' while text commands
        // (no URL in payload) worked fine. Fall back to the request host;
        // production always terminates TLS so https is safe to assume.
        const backendBase = (process.env.BACKEND_URL || `https://${req.get('host')}`).replace(/\/$/, '');
        const payload = {
          voice_id: voice.id,
          url: `${backendBase}/api/v1/guardian/voice-messages/${voice.id}/audio`,
          duration_ms: durationMs,
        };

        // Same shape as POST /devices/:id/commands — see that route for why
        // ttl is bound twice ($5/$7).
        const ttl = 6;
        const { rows: cmdRows } = await client.query(
          `INSERT INTO device_commands (org_id, device_id, command, command_type, status, payload, ttl_hours, issued_by, issued_at, expires_at)
           VALUES ($1, $2, $3, $3, 'pending', $4, $5, $6, NOW(), NOW() + ($7 * INTERVAL '1 hour'))
           RETURNING id, issued_at, expires_at`,
          [orgId, req.params.id, 'play_voice_message', payload, ttl, req.user.id, ttl]
        );
        const cmd = cmdRows[0];
        const signature = signCommand(cmd.id, 'play_voice_message', payload, cmd.issued_at, cmd.expires_at);
        await client.query(`UPDATE device_commands SET signature = $1 WHERE id = $2`, [signature, cmd.id]);
        await client.query('COMMIT');

        publish(`org#${orgId}`, { type: 'command:queued', device_id: req.params.id, command: 'play_voice_message', command_id: cmd.id }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
        if (device.fcm_token) {
          sendCommandPush(device.fcm_token, 'play_voice_message', cmd.id, payload).catch(e => logger.warn(`Voice command FCM push failed: ${e.message}`));
        }
        logger.info(`Voice message queued: device=${req.params.id} voice=${voice.id} bytes=${req.body.length} by user ${req.user.id}`);
        res.json({ data: { voice_id: voice.id, command_id: cmd.id, status: 'queued' } });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally { client.release(); }
    } catch (err) { next(err); }
  }
);

// GET /devices/:id/voice-messages — reverse direction of the route above:
// voice notes a field officer recorded and sent up (direction='from_device',
// see POST /guardian/voice-message in guardian.js). No RLS on this table
// (see migration 062's comment on why), so org scoping is explicit here.
router.get('/devices/:id/voice-messages', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT id, duration_ms, created_at
       FROM guardian_voice_messages
       WHERE device_id = $1 AND org_id = $2 AND direction = 'from_device'
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.params.id, orgId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /voice-messages/recent — org-wide recent field-officer voice notes,
// newest first, for the homepage live feed + its auto-play/globe-zoom backstop.
// Carries each note's record-time location (falling back to the device's last
// known position for rows predating that column) so the globe can fly to the
// exact spot a note was sent, even if the live websocket event was missed.
router.get('/voice-messages/recent', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT v.id, v.device_id, d.name AS device_name, v.duration_ms, v.created_at,
              COALESCE(v.lat, d.last_lat) AS lat,
              COALESCE(v.lng, d.last_lng) AS lng
       FROM guardian_voice_messages v
       LEFT JOIN guardian_devices d ON d.id = v.device_id
       WHERE v.org_id = $1 AND v.direction = 'from_device'
       ORDER BY v.created_at DESC
       LIMIT 15`,
      [orgId]
    );
    res.json({ data: rows.map(r => ({
      id: r.id,
      device_id: r.device_id,
      device_name: r.device_name ?? 'Field officer',
      duration_ms: r.duration_ms,
      created_at: r.created_at,
      lat: r.lat != null ? parseFloat(r.lat) : null,
      lng: r.lng != null ? parseFloat(r.lng) : null,
    })) });
  } catch (err) { next(err); }
});

// GET /devices/:id/captures — photos this device captured in response to
// capture_photo commands (see POST /guardian/capture-photo in guardian.js).
// No RLS on guardian_captures (migration 064), so org scoping is explicit.
router.get('/devices/:id/captures', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT id, url, command_id, created_at, lat, lng, camera
       FROM guardian_captures
       WHERE device_id = $1 AND org_id = $2
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.params.id, orgId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /capture/status — is covert-photo storage (Cloudflare R2) configured?
// The Surveillance app uses this to explain why captures aren't landing rather
// than leaving the operator staring at an empty gallery.
router.get('/capture/status', (req, res) => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  const configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL);
  res.json({ configured, ai_configured: captureVision.hasVision() });
});

// GET /captures/recent — org-wide covert captures, newest first, for the
// Surveillance gallery. Labelled with the assigned field officer's name
// (falling back to the device code). Uses an org-scoped tx so the RLS-FORCEd
// field_officers join resolves.
router.get('/captures/recent', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        // command_id is TEXT here and device_commands.id is UUID — compare as
        // text so a non-UUID/legacy command_id can't throw a cast error.
        `SELECT c.id, c.device_id, c.url, c.created_at, c.camera,
                COALESCE(c.lat, d.last_lat) AS lat,
                COALESCE(c.lng, d.last_lng) AS lng,
                COALESCE(fo.name, d.name) AS device_name,
                fo.name AS officer_name,
                dc.payload->>'reason' AS trigger_reason,
                c.ai_summary, c.ai_labels, c.ai_person_count, c.ai_has_weapon,
                c.ai_plates, c.ai_vehicles, c.ai_threat_level, c.ai_analyzed_at
         FROM guardian_captures c
         LEFT JOIN guardian_devices d ON d.id = c.device_id
         LEFT JOIN field_officers fo ON fo.device_id = c.device_id
         LEFT JOIN device_commands dc ON dc.id::text = c.command_id
         WHERE c.org_id = $1
         ORDER BY c.created_at DESC
         LIMIT 200`,
        [orgId]
      );
      await client.query('COMMIT');
      res.json({ data: rows.map(r => ({
        id: r.id, device_id: r.device_id, url: r.url,
        created_at: r.created_at, device_name: r.device_name ?? 'Device',
        officer_name: r.officer_name ?? null,
        trigger_reason: r.trigger_reason ?? null,
        camera: r.camera ?? null,
        lat: r.lat != null ? parseFloat(r.lat) : null,
        lng: r.lng != null ? parseFloat(r.lng) : null,
        ai: r.ai_analyzed_at ? {
          summary: r.ai_summary,
          labels: r.ai_labels ?? [],
          person_count: r.ai_person_count,
          has_weapon: r.ai_has_weapon,
          plates: r.ai_plates ?? [],
          vehicles: r.ai_vehicles ?? [],
          threat_level: r.ai_threat_level,
        } : null,
      })) });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /captures/:id/analyze — (re)run AI auto-tagging for one capture, on
// demand. Used to tag captures that predate the feature, or to re-tag after a
// bad read. Returns the fresh tags so the console can update in place.
router.post('/captures/:id/analyze', async (req, res, next) => {
  try {
    if (!captureVision.hasVision()) return res.status(501).json({ error: 'AI vision not configured on this server' });
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT id, url FROM guardian_captures WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Capture not found' });
    const tags = await captureVision.analyzeCaptureAndStore(rows[0].id, orgId, rows[0].url);
    if (!tags) return res.status(502).json({ error: 'Analysis failed' });
    res.json({ data: tags });
  } catch (err) { next(err); }
});

// POST /captures/analyze-untagged — backfill: tag up to N of the org's captures
// that were never analysed (bounded so one click can't fan out unboundedly).
router.post('/captures/analyze-untagged', async (req, res, next) => {
  try {
    if (!captureVision.hasVision()) return res.status(501).json({ error: 'AI vision not configured on this server' });
    const orgId = req.user.org_id;
    const limit = Math.min(parseInt(req.body?.limit) || 10, 25);
    const { rows } = await query(
      `SELECT id, url FROM guardian_captures
        WHERE org_id = $1 AND ai_analyzed_at IS NULL
        ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    // Sequential so we don't burst the vision API; each stores itself.
    let analyzed = 0;
    for (const r of rows) {
      const tags = await captureVision.analyzeCaptureAndStore(r.id, orgId, r.url);
      if (tags) analyzed++;
    }
    res.json({ data: { requested: rows.length, analyzed } });
  } catch (err) { next(err); }
});

// DELETE /captures/:id — admin removes a covert capture (photo). Deletes the
// stored R2 object (best-effort) and the DB row, then tells the org channel so
// open Surveillance consoles drop it live. Admin-only: destroying surveillance
// evidence is a privileged action.
router.delete('/captures/:id', authorize('admin'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT id, storage_key FROM guardian_captures WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Capture not found' });

    // Best-effort object delete — a storage failure must not block removing the
    // record from the gallery.
    const key = rows[0].storage_key;
    if (key) {
      try {
        const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET } = process.env;
        if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET) {
          const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
          const s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
          });
          await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        }
      } catch (e) {
        logger.warn(`R2 object delete failed for capture ${req.params.id}: ${e.message}`);
      }
    }

    await query(`DELETE FROM guardian_captures WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
    publish(`org#${orgId}`, { type: 'capture.deleted', id: req.params.id });
    logger.info(`Capture ${req.params.id} deleted by admin ${req.user.id} (org ${orgId})`);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) { next(err); }
});

// GET /devices/:id/voice-messages/:msgId/audio — operator playback of a
// from_device clip. Distinct path from guardian.js's device-token-authed
// GET /voice-messages/:id/audio (dispatch->device direction) so the two
// routers, both mounted at /api/v1/guardian, never collide.
router.get('/devices/:id/voice-messages/:msgId/audio', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT mime, audio FROM guardian_voice_messages
       WHERE id = $1 AND device_id = $2 AND org_id = $3 AND direction = 'from_device'`,
      [req.params.msgId, req.params.id, orgId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Voice message not found' });
    res.set('Content-Type', row.mime || 'audio/webm');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(row.audio);
  } catch (err) { next(err); }
});

// POST /commands/broadcast
router.post('/commands/broadcast', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { command, target = 'all_active', payload = null } = req.body;
    if (!command || !VALID_COMMANDS.includes(command)) {
      return res.status(400).json({ error: 'Invalid command', valid: VALID_COMMANDS });
    }
    if (command === 'remote_wipe') {
      return res.status(400).json({ error: 'BROADCAST_WIPE_FORBIDDEN' });
    }
    const whereActive = target === 'all_active' ? `AND gd.status = 'active' AND gd.telemetry_at > NOW() - INTERVAL '10 minutes'` : '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const devices = await client.query(
        `SELECT id FROM guardian_devices WHERE org_id = $1 AND deleted_at IS NULL ${whereActive}`,
        [orgId]
      );
      if (devices.rows.length > 50) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'BROADCAST_LIMIT_EXCEEDED', count: devices.rows.length });
      }
      const commandIds = [];
      for (const device of devices.rows) {
        const { rows } = await client.query(
          `INSERT INTO device_commands (org_id, device_id, command, status, payload, ttl_hours, issued_by, expires_at)
           VALUES ($1, $2, $3, 'pending', $4, 6, $5, NOW() + INTERVAL '6 hours')
           RETURNING id`,
          [orgId, device.id, command, payload, req.user.id]
        );
        commandIds.push(rows[0].id);
      }
      await client.query('COMMIT');
      res.json({ data: { queued_count: commandIds.length, command_ids: commandIds } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// GET /command-queue
router.get('/command-queue', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT dc.*, gd.name AS device_name, fo.name AS officer_name
         FROM device_commands dc
         LEFT JOIN guardian_devices gd ON gd.id = dc.device_id
         LEFT JOIN field_officers fo ON fo.device_id = dc.device_id AND fo.org_id = $1
         WHERE dc.org_id = $1
         ORDER BY dc.created_at DESC LIMIT 20`,
        [orgId]
      );
      await client.query('COMMIT');
      res.json({ data: rows });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /command-queue/:commandId
router.delete('/command-queue/:commandId', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `UPDATE device_commands SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'pending'
       RETURNING id`,
      [req.params.commandId, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Command not found or not cancellable' });
    res.json({ data: { id: rows[0].id, status: 'cancelled' } });
  } catch (err) { next(err); }
});

// GET /alert-rules
router.get('/alert-rules', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await query(
      `SELECT * FROM alert_rules WHERE org_id = $1 ORDER BY created_at`,
      [orgId]
    );
    if (rows.length > 0) return res.json({ data: rows });
    // Seed defaults
    const seeded = [];
    for (const rule of DEFAULT_ALERT_RULES) {
      const { rows: inserted } = await query(
        `INSERT INTO alert_rules (org_id, name, trigger, threshold, action, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING RETURNING *`,
        [orgId, rule.name, rule.trigger, rule.threshold, rule.action, rule.enabled]
      );
      if (inserted[0]) seeded.push(inserted[0]);
    }
    res.json({ data: seeded });
  } catch (err) { next(err); }
});

// POST /devices/:id/approve — approve pending enrollment
router.post('/devices/:id/approve', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `UPDATE guardian_devices SET status = 'enrolled', updated_at = NOW()
         WHERE id = $1 AND org_id = $2 AND status = 'pending' AND deleted_at IS NULL
         RETURNING id, status`,
        [req.params.id, orgId]
      );
      await client.query('COMMIT');
      if (!rows[0]) return res.status(404).json({ error: 'Device not found or not in pending state' });
      res.json({ data: rows[0] });
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// PUT /alert-rules/:ruleId
router.put('/alert-rules/:ruleId', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    const { rows } = await query(
      `UPDATE alert_rules SET enabled = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [enabled, req.params.ruleId, orgId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Rule not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /commands/:commandId/ack — PEGAGENT reports command execution result
router.post('/commands/:commandId/ack', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const { status, acked_at, latency_ms, device_id } = req.body;
    const validStatuses = ['executed', 'failed', 'expired'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'status must be one of: executed, failed, expired' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `UPDATE device_commands SET
           status     = $1,
           acked_at   = COALESCE(to_timestamp($2::bigint / 1000.0), NOW()),
           latency_ms = $3,
           updated_at = NOW()
         WHERE id = $4 AND org_id = $5
         RETURNING id, status, device_id`,
        [status, acked_at || null, latency_ms || null, req.params.commandId, orgId]
      );
      await client.query('COMMIT');
      if (!rows[0]) return res.status(404).json({ error: 'Command not found' });
      publish(`org:${orgId}:activity`, {
        type: 'command_acked',
        command_id: req.params.commandId,
        device_id: rows[0].device_id,
        status,
        latency_ms: latency_ms || null,
        ts: Date.now(),
      }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// GET /devices/:deviceId/commands/pending — PEGAGENT HTTP fallback poll
router.get('/devices/:deviceId/commands/pending', async (req, res, next) => {
  try {
    const orgId = req.user.org_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT id, command, payload, issued_at, ttl_hours
         FROM device_commands
         WHERE device_id = $1
           AND org_id    = $2
           AND status    = 'pending'
           AND issued_at + (ttl_hours || ' hours')::interval > NOW()
         ORDER BY issued_at ASC
         LIMIT 20`,
        [req.params.deviceId, orgId]
      );
      await client.query('COMMIT');
      res.json(rows);
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /devices/:deviceId/ws-token — issue Centrifugo connection JWT for PEGAGENT
router.post('/devices/:deviceId/ws-token', async (req, res, next) => {
  try {
    const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
    if (!secret) return res.status(503).json({ error: 'Realtime not configured' });
    const orgId = req.user.org_id;
    const deviceId = req.params.deviceId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
      const { rows } = await client.query(
        `SELECT id FROM guardian_devices WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [deviceId, orgId]
      );
      await client.query('COMMIT');
      if (!rows[0]) return res.status(404).json({ error: 'Device not found' });
    } finally { client.release(); }
    const token = jwt.sign(
      {
        sub: deviceId,
        info: { device_id: deviceId, org_id: orgId, type: 'pegagent' },
      },
      secret,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
    res.json({ token });
  } catch (err) { next(err); }
});

module.exports = router;
