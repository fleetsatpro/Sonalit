/**
 * Guardian CFO Device API — Phase C
 * Mounted at /api/v1/guardian/cfo
 */
require('dotenv').config();
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { isCfoModuleEnabled } = require('../utils/cfoFlag');
const { haversine } = require('../utils/haversine');
const logger = require('../utils/logger');

// ─── Device Auth ─────────────────────────────────────────────────────────────

async function deviceAuth(req, res, next) {
  try {
    const token = req.headers['x-device-token'];
    if (!token) return res.status(401).json({ error: 'Missing X-Device-Token header' });

    const result = await query(
      `SELECT * FROM guardian_devices WHERE token = $1 AND deleted_at IS NULL`,
      [token]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid device token' });

    const device = result.rows[0];
    if (device.status === 'revoked' || device.status === 'suspended') {
      return res.status(403).json({ error: `Device is ${device.status}` });
    }
    req.device = device;
    next();
  } catch (err) {
    logger.error(`deviceAuth (cfo) error: ${err.message}`);
    next(err);
  }
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const photoUploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.device?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many photo uploads, slow down' },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConvoyDate(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function gAudit(actor_id, action, target_type, target_id, payload, ip) {
  query(
    `INSERT INTO guardian_audit_log
       (actor_type, actor_id, action, target_type, target_id, payload, ip_address)
     VALUES ('device',$1,$2,$3,$4,$5,$6)`,
    [actor_id || null, action, target_type || null, target_id || null,
      payload ? JSON.stringify(payload) : null, ip || null]
  ).catch((err) => logger.error(`gAudit (cfo) error: ${err.message}`));
}

async function requireCfoModule(res) {
  if (!await isCfoModuleEnabled()) {
    res.status(403).json({ error: 'cfo_module_disabled' });
    return false;
  }
  return true;
}

// ─── C1: CFO Context ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/guardian/cfo/context
 * Device fetches its CFO assignment for the current active convoy.
 */
router.get('/context', deviceAuth, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const assignmentResult = await query(
      `SELECT cc.convoy_id, cc.cfo_user_id, c.name, c.status, c.timezone,
              c.start_date, c.end_date, c.seal_count_per_truck
       FROM convoy_cfos cc
       JOIN convoys c ON c.id = cc.convoy_id
       WHERE cc.guardian_device_id = $1
         AND c.status IN ('planned','active')
         AND c.deleted_at IS NULL
       ORDER BY c.start_date DESC
       LIMIT 1`,
      [req.device.id]
    );

    if (!assignmentResult.rows.length) {
      return res.status(404).json({ error: 'No active convoy assignment for this device' });
    }

    const { convoy_id, cfo_user_id, ...convoyFields } = assignmentResult.rows[0];
    const reportDate = getConvoyDate(convoyFields.timezone);

    const [trucksResult, photosResult] = await Promise.all([
      query(
        `SELECT ct.*
         FROM convoy_cfo_truck_assignments ccta
         JOIN convoy_trucks ct ON ct.id = ccta.convoy_truck_id
         WHERE ccta.convoy_id = $1 AND ccta.cfo_user_id = $2
         ORDER BY ct.position`,
        [convoy_id, cfo_user_id]
      ),
      query(
        `SELECT id, convoy_truck_id, session, photo_type, seal_position, taken_at, uploaded_at
         FROM convoy_truck_photos
         WHERE convoy_id = $1 AND cfo_user_id = $2 AND report_date = $3`,
        [convoy_id, cfo_user_id, reportDate]
      ),
    ]);

    res.json({
      data: {
        convoy: { id: convoy_id, ...convoyFields },
        cfo_user_id,
        assigned_trucks: trucksResult.rows,
        report_date: reportDate,
        photos_today: photosResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── C2: Presigned Upload URL ─────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/cfo/photo-upload-url
 * Returns a 5-minute presigned R2 PUT URL for a CFO truck photo.
 */
router.post('/photo-upload-url', deviceAuth, photoUploadLimiter, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const { convoy_id, convoy_truck_id, session, photo_type, seal_position, report_date } = req.body;

    if (!convoy_id || !convoy_truck_id || !session || !photo_type || !report_date) {
      return res.status(400).json({ error: 'convoy_id, convoy_truck_id, session, photo_type, report_date required' });
    }
    if (!['sod', 'eod'].includes(session)) return res.status(400).json({ error: 'session must be sod or eod' });
    if (!['front', 'rear', 'seal'].includes(photo_type)) return res.status(400).json({ error: 'photo_type must be front, rear, or seal' });
    if (photo_type === 'seal' && !seal_position) return res.status(400).json({ error: 'seal_position required for seal photos' });
    if (photo_type !== 'seal' && seal_position) return res.status(400).json({ error: 'seal_position only valid for seal photos' });

    const auth = await query(
      `SELECT ccta.id
       FROM convoy_cfos cc
       JOIN convoy_cfo_truck_assignments ccta
         ON ccta.convoy_id = cc.convoy_id AND ccta.cfo_user_id = cc.cfo_user_id
       WHERE cc.guardian_device_id = $1
         AND cc.convoy_id = $2
         AND ccta.convoy_truck_id = $3`,
      [req.device.id, convoy_id, convoy_truck_id]
    );
    if (!auth.rows.length) {
      return res.status(403).json({ error: 'device_not_authorised_for_this_truck' });
    }

    const {
      R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL,
    } = process.env;

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
      return res.status(501).json({ error: 'Photo storage not configured on this server' });
    }

    let S3Client, PutObjectCommand, getSignedUrl;
    try {
      ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
      ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    } catch {
      return res.status(501).json({ error: 'Photo storage SDK not installed' });
    }

    const sealSuffix = seal_position ? `_${seal_position}` : '';
    const key = `cfo/${convoy_id}/${report_date}/${convoy_truck_id}/${session}/${photo_type}${sealSuffix}_${uuidv4()}.jpg`;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    });
    const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'image/jpeg' });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;

    res.json({ upload_url: uploadUrl, public_url: publicUrl, key });
  } catch (err) {
    next(err);
  }
});

// ─── C2: Commit Photo Record ──────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/cfo/photos
 * Records a committed CFO truck photo. Idempotent via event_uuid.
 */
router.post('/photos', deviceAuth, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const {
      event_uuid, convoy_id, convoy_truck_id, session, photo_type, seal_position,
      report_date, photo_url, taken_at, lat, lng, notes,
    } = req.body;

    if (!event_uuid || !convoy_id || !convoy_truck_id || !session || !photo_type || !report_date || !photo_url || !taken_at) {
      return res.status(400).json({ error: 'event_uuid, convoy_id, convoy_truck_id, session, photo_type, report_date, photo_url, taken_at required' });
    }
    if (!['sod', 'eod'].includes(session)) return res.status(400).json({ error: 'session must be sod or eod' });
    if (!['front', 'rear', 'seal'].includes(photo_type)) return res.status(400).json({ error: 'photo_type must be front, rear, or seal' });
    if (photo_type === 'seal' && !seal_position) return res.status(400).json({ error: 'seal_position required for seal photos' });

    const authResult = await query(
      `SELECT cc.cfo_user_id
       FROM convoy_cfos cc
       JOIN convoy_cfo_truck_assignments ccta
         ON ccta.convoy_id = cc.convoy_id AND ccta.cfo_user_id = cc.cfo_user_id
       WHERE cc.guardian_device_id = $1
         AND cc.convoy_id = $2
         AND ccta.convoy_truck_id = $3`,
      [req.device.id, convoy_id, convoy_truck_id]
    );
    if (!authResult.rows.length) {
      return res.status(403).json({ error: 'device_not_authorised_for_this_truck' });
    }
    const cfo_user_id = authResult.rows[0].cfo_user_id;

    // C4: location mismatch — flag if photo GPS differs >2 km from device last known position
    let location_mismatch = false;
    if (lat && lng && req.device.last_lat && req.device.last_lng) {
      location_mismatch = haversine(lat, lng, req.device.last_lat, req.device.last_lng) > 2;
    }

    const insertResult = await query(
      `INSERT INTO convoy_truck_photos
         (convoy_id, convoy_truck_id, cfo_user_id, guardian_device_id, session, photo_type,
          seal_position, report_date, photo_url, taken_at, lat, lng, event_uuid, location_mismatch, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (event_uuid) DO NOTHING
       RETURNING *`,
      [convoy_id, convoy_truck_id, cfo_user_id, req.device.id, session, photo_type,
        seal_position || null, report_date, photo_url, taken_at,
        lat || null, lng || null, event_uuid, location_mismatch, notes || null]
    );

    if (!insertResult.rows.length) {
      const existing = await query(
        `SELECT * FROM convoy_truck_photos WHERE event_uuid = $1`, [event_uuid]
      );
      return res.json({ data: existing.rows[0], duplicate: true });
    }

    // Update daily report progress
    await updateDailyReport(convoy_id, report_date).catch(() => {});

    // Enqueue report-check if queue exists
    try {
      const { getQueues } = require('../config/queue');
      const queues = getQueues();
      if (queues.convoyReportQueue) {
        queues.convoyReportQueue.add('checkProgress', { convoy_id, report_date }).catch(() => {});
      }
    } catch {}

    gAudit(req.device.id, 'cfo_photo_committed', 'convoy_truck_photo', insertResult.rows[0].id,
      { convoy_id, convoy_truck_id, photo_type, session }, req.ip);

    res.status(201).json({ data: insertResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

async function updateDailyReport(convoy_id, report_date) {
  // Calculate required photo count for this convoy
  const reqResult = await query(
    `SELECT COUNT(ct.id) AS truck_count, c.seal_count_per_truck
     FROM convoys c
     JOIN convoy_trucks ct ON ct.convoy_id = c.id
     WHERE c.id = $1
     GROUP BY c.seal_count_per_truck`,
    [convoy_id]
  );
  if (!reqResult.rows.length) return;

  const { truck_count, seal_count_per_truck } = reqResult.rows[0];
  const required = parseInt(truck_count) * (2 + parseInt(seal_count_per_truck)) * 2;

  const recvResult = await query(
    `SELECT COUNT(*) AS received FROM convoy_truck_photos
     WHERE convoy_id = $1 AND report_date = $2`,
    [convoy_id, report_date]
  );
  const received = parseInt(recvResult.rows[0].received);
  const status = received >= required ? 'complete' : (received > 0 ? 'partial' : 'pending');

  await query(
    `INSERT INTO convoy_daily_reports
       (convoy_id, report_date, required_photo_count, received_photo_count, status)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (convoy_id, report_date) DO UPDATE
       SET received_photo_count = $4,
           status = CASE WHEN convoy_daily_reports.status IN ('generated') THEN convoy_daily_reports.status ELSE $5 END,
           updated_at = NOW()`,
    [convoy_id, report_date, required, received, status]
  );
}

module.exports = router;
