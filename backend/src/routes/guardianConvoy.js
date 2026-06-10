/**
 * Guardian Convoy App API — Mounted at /api/v1/guardian/convoy
 * JWT-based auth (mobile app facing)
 */
require('dotenv').config();
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');
const logger = require('../utils/logger');

async function jwtAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.cfo = { id: payload.id, org_id: payload.org_id, name: payload.name, convoy_id: payload.convoy_id };
    next();
  } catch (err) {
    next(err);
  }
}

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) return null;
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
}

// POST /login — no auth required
router.post('/login', async (req, res, next) => {
  try {
    const { cfo_id, pin, convoy_id } = req.body;
    if (!cfo_id || typeof cfo_id !== 'string' || !cfo_id.trim())
      return res.status(400).json({ error: 'cfo_id is required' });
    if (!pin || typeof pin !== 'string')
      return res.status(400).json({ error: 'pin is required' });
    if (!convoy_id || typeof convoy_id !== 'string' || !convoy_id.trim())
      return res.status(400).json({ error: 'convoy_id is required' });

    // Resolve convoy by UUID or name (case-insensitive)
    const convoyResult = await query(
      `SELECT id, name, status, route_origin, route_destination, org_id
       FROM convoys
       WHERE (id::text = $1 OR LOWER(name) = LOWER($1))
         AND deleted_at IS NULL
       LIMIT 1`,
      [convoy_id.trim()]
    );
    if (!convoyResult.rows.length)
      return res.status(200).json({ success: false, error: 'Convoy not found' });

    const convoy = convoyResult.rows[0];

    const userResult = await query(
      `SELECT u.id, u.name, u.email, u.org_id, u.status, u.password_hash
       FROM users u
       WHERE LOWER(u.email) = LOWER($1)
         AND EXISTS (
           SELECT 1 FROM convoy_cfos cc WHERE cc.cfo_user_id = u.id AND cc.convoy_id = $2
         )
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [cfo_id.trim(), convoy.id]
    );

    const dummyHash = '$2a$10$dummyhashtopreventtimingattacks00000000000';
    const hashToCompare = userResult.rows[0]?.password_hash || dummyHash;
    const valid = userResult.rows.length > 0 && await bcrypt.compare(pin, hashToCompare);

    if (!valid) return res.status(200).json({ success: false, error: 'Invalid credentials' });

    const user = userResult.rows[0];
    if (user.status !== 'active')
      return res.status(200).json({ success: false, error: 'Account is not active' });

    const [trucksResult, sealsResult] = await Promise.all([
      query(
        `SELECT ct.id, ct.position, ct.driver_name, ct.driver_phone,
                v.registration, v.make, v.model, v.color
         FROM convoy_trucks ct LEFT JOIN vehicles v ON v.id = ct.vehicle_id
         WHERE ct.convoy_id = $1 ORDER BY ct.position`,
        [convoy.id]
      ),
      query(
        `SELECT cs.id, cs.convoy_truck_id, cs.seal_position, cs.rfid_code, cs.session, cs.status
         FROM convoy_seals cs JOIN convoy_trucks ct ON ct.id = cs.convoy_truck_id
         WHERE ct.convoy_id = $1 AND cs.report_date = CURRENT_DATE
         ORDER BY cs.convoy_truck_id, cs.seal_position`,
        [convoy.id]
      ),
    ]);

    const nameParts = user.name ? user.name.split(' ') : ['?'];
    const initials = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : (user.name || '?').slice(0, 2).toUpperCase();

    const token = jwt.sign(
      { id: user.id, org_id: user.org_id || convoy.org_id, name: user.name, convoy_id: convoy.id },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.json({
      success: true,
      token,
      cfo: { id: user.id, name: user.name, initials },
      convoy: {
        id: convoy.id,
        origin: convoy.route_origin,
        destination: convoy.route_destination,
        trucks: trucksResult.rows,
        seals: sealsResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /photos/upload — accept binary, upload to R2 server-side (avoids browser CORS)
router.post(
  '/photos/upload',
  jwtAuth,
  require('express').raw({ type: ['image/*', 'application/octet-stream'], limit: '20mb' }),
  async (req, res, next) => {
    try {
      const { photo_type, convoy_id, phase, plate_number, lat, lng, accuracy } = req.query;
      if (!photo_type || typeof photo_type !== 'string')
        return res.status(400).json({ error: 'photo_type is required' });
      if (!convoy_id || typeof convoy_id !== 'string')
        return res.status(400).json({ error: 'convoy_id is required' });
      if (!phase || !['sod', 'eod'].includes(phase))
        return res.status(400).json({ error: 'phase must be sod or eod' });
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ error: 'Request body must be image binary data' });

      const { R2_BUCKET, R2_PUBLIC_URL, R2_ACCOUNT_ID } = process.env;
      if (!R2_BUCKET) return res.status(501).json({ error: 'Photo storage not configured on this server' });

      let PutObjectCommand;
      try {
        ({ PutObjectCommand } = require('@aws-sdk/client-s3'));
      } catch {
        return res.status(501).json({ error: 'Photo storage SDK not installed' });
      }

      const s3 = getR2Client();
      if (!s3) return res.status(501).json({ error: 'Photo storage credentials not configured' });

      const photoId = uuidv4();
      const key = `convoy-app/${convoy_id}/${phase}/${photo_type}_${photoId}.jpg`;
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: req.body,
        ContentType: 'image/jpeg',
      }));

      const r2Url = `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;

      const result = await query(
        `INSERT INTO photo_uploads
           (id, org_id, convoy_id, cfo_id, phase, photo_type, r2_key, r2_url,
            lat, lng, accuracy_m, plate_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         RETURNING id, r2_url`,
        [
          photoId, req.cfo.org_id, convoy_id, req.cfo.id, phase, photo_type, key, r2Url,
          lat != null ? parseFloat(lat) : null,
          lng != null ? parseFloat(lng) : null,
          accuracy != null ? parseInt(accuracy) : null,
          plate_number || null,
        ]
      );

      return res.status(201).json({ photo_id: result.rows[0].id, r2_url: result.rows[0].r2_url });
    } catch (err) {
      next(err);
    }
  }
);

// POST /photos/upload-url — get presigned R2 PUT URL
router.post('/photos/upload-url', jwtAuth, async (req, res, next) => {
  try {
    const { photo_type, convoy_id, phase, plate_number } = req.body;
    if (!photo_type || typeof photo_type !== 'string')
      return res.status(400).json({ error: 'photo_type is required' });
    if (!convoy_id || typeof convoy_id !== 'string')
      return res.status(400).json({ error: 'convoy_id is required' });
    if (!phase || !['sod', 'eod'].includes(phase))
      return res.status(400).json({ error: 'phase must be sod or eod' });

    const { R2_BUCKET, R2_PUBLIC_URL, R2_ACCOUNT_ID } = process.env;
    if (!R2_BUCKET) return res.status(501).json({ error: 'Photo storage not configured on this server' });

    let PutObjectCommand, getSignedUrl;
    try {
      ({ PutObjectCommand } = require('@aws-sdk/client-s3'));
      ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    } catch {
      return res.status(501).json({ error: 'Photo storage SDK not installed' });
    }

    const s3 = getR2Client();
    if (!s3) return res.status(501).json({ error: 'Photo storage not configured on this server' });

    const photoId = uuidv4();
    const key = `convoy-app/${convoy_id}/${phase}/${photo_type}_${photoId}.jpg`;
    const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'image/jpeg' });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const r2Url = `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;

    return res.json({ upload_url: uploadUrl, photo_id: photoId, r2_url: r2Url });
  } catch (err) {
    next(err);
  }
});

// POST /photos/commit — record committed photo in DB
router.post('/photos/commit', jwtAuth, async (req, res, next) => {
  try {
    const { photo_id, photo_type, convoy_id, phase, lat, lng, accuracy, plate_number, timestamp } = req.body;
    if (!photo_id || typeof photo_id !== 'string')
      return res.status(400).json({ error: 'photo_id is required' });
    if (!photo_type || typeof photo_type !== 'string')
      return res.status(400).json({ error: 'photo_type is required' });
    if (!convoy_id || typeof convoy_id !== 'string')
      return res.status(400).json({ error: 'convoy_id is required' });
    if (!phase || !['sod', 'eod'].includes(phase))
      return res.status(400).json({ error: 'phase must be sod or eod' });

    const { R2_BUCKET, R2_PUBLIC_URL, R2_ACCOUNT_ID } = process.env;
    const key = `convoy-app/${convoy_id}/${phase}/${photo_type}_${photo_id}.jpg`;
    const r2Url = `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;

    const result = await query(
      `INSERT INTO photo_uploads
         (id, org_id, convoy_id, cfo_id, phase, photo_type, r2_key, r2_url,
          lat, lng, accuracy_m, plate_number, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, r2_url`,
      [
        photo_id, req.cfo.org_id, convoy_id, req.cfo.id, phase, photo_type, key, r2Url,
        lat != null ? lat : null, lng != null ? lng : null,
        accuracy != null ? parseInt(accuracy) : null,
        plate_number || null,
        timestamp ? new Date(timestamp) : new Date(),
      ]
    );

    return res.status(201).json({ photo_id: result.rows[0].id, r2_url: result.rows[0].r2_url });
  } catch (err) {
    next(err);
  }
});

// POST /handover/upload — upload handover form document for final EOD report
router.post(
  '/handover/upload',
  jwtAuth,
  require('express').raw({ type: ['image/*', 'application/pdf', 'application/octet-stream'], limit: '20mb' }),
  async (req, res, next) => {
    try {
      const { convoy_id, report_id } = req.query;
      if (!convoy_id || typeof convoy_id !== 'string')
        return res.status(400).json({ error: 'convoy_id is required' });
      if (!report_id || typeof report_id !== 'string')
        return res.status(400).json({ error: 'report_id is required' });
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ error: 'Request body must be document binary data' });

      const { R2_BUCKET, R2_PUBLIC_URL, R2_ACCOUNT_ID } = process.env;
      if (!R2_BUCKET) return res.status(501).json({ error: 'Storage not configured on this server' });

      let PutObjectCommand;
      try {
        ({ PutObjectCommand } = require('@aws-sdk/client-s3'));
      } catch {
        return res.status(501).json({ error: 'Storage SDK not installed' });
      }

      const s3 = getR2Client();
      if (!s3) return res.status(501).json({ error: 'Storage credentials not configured' });

      const isPdf = req.headers['content-type']?.includes('pdf');
      const ext = isPdf ? 'pdf' : 'jpg';
      const key = `convoy-app/${convoy_id}/handover/handover_${report_id}.${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: req.body,
        ContentType: isPdf ? 'application/pdf' : 'image/jpeg',
      }));

      const r2Url = `${R2_PUBLIC_URL || `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}/${key}`;

      await query(
        `UPDATE convoy_reports SET handover_form_key = $1, handover_form_url = $2
         WHERE id = $3 AND cfo_id = $4`,
        [key, r2Url, report_id, req.cfo.id]
      );

      return res.status(201).json({ r2_url: r2Url });
    } catch (err) {
      next(err);
    }
  }
);

// GET /convoys/:id/position — latest GPS position for convoy vehicles
router.get('/convoys/:id/position', jwtAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT gl.latitude AS lat, gl.longitude AS lng,
              NULL::float AS accuracy, gl.timestamp AS updated_at
       FROM gps_logs gl
       JOIN vehicles v ON v.id = gl.vehicle_id
       JOIN convoy_assignments ca ON ca.vehicle_id = v.id
       WHERE ca.convoy_id::text = $1
       ORDER BY gl.timestamp DESC
       LIMIT 1`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'No GPS data found for this convoy' });
    return res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /convoy-reports/:convoy_id — get or create today's report
router.get('/convoy-reports/:convoy_id', jwtAuth, async (req, res, next) => {
  try {
    const { convoy_id } = req.params;
    await query(
      `INSERT INTO convoy_reports (org_id, convoy_id, cfo_id, date, status)
       VALUES ($1,$2,$3,CURRENT_DATE,'in_progress')
       ON CONFLICT (convoy_id, cfo_id, date) DO NOTHING`,
      [req.cfo.org_id, convoy_id, req.cfo.id]
    );
    const reportResult = await query(
      `SELECT r.*,
              c.status AS convoy_status,
              (SELECT COUNT(*) FROM photo_uploads p
               WHERE p.convoy_id = r.convoy_id AND p.cfo_id = r.cfo_id
                 AND p.phase = 'sod' AND p.timestamp::date = r.date) AS sod_photo_count,
              (SELECT COUNT(*) FROM photo_uploads p
               WHERE p.convoy_id = r.convoy_id AND p.cfo_id = r.cfo_id
                 AND p.phase = 'eod' AND p.timestamp::date = r.date) AS eod_photo_count
       FROM convoy_reports r
       JOIN convoys c ON c.id::text = r.convoy_id
       WHERE r.convoy_id = $1 AND r.cfo_id = $2 AND r.date = CURRENT_DATE`,
      [convoy_id, req.cfo.id]
    );
    return res.json(reportResult.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /convoy-reports/:id/arrival — record arrival location
router.post('/convoy-reports/:id/arrival', jwtAuth, async (req, res, next) => {
  try {
    const { lat, lng, accuracy, timestamp } = req.body;
    if (lat == null || lng == null)
      return res.status(400).json({ error: 'lat and lng are required' });

    const result = await query(
      `UPDATE convoy_reports
       SET arrival_at = $1, arrival_lat = $2, arrival_lng = $3
       WHERE id = $4 AND cfo_id = $5 RETURNING *`,
      [timestamp ? new Date(timestamp) : new Date(), lat, lng, req.params.id, req.cfo.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Report not found or not owned by this CFO' });
    return res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /convoy-reports/:id/sod — submit start-of-day report
router.post('/convoy-reports/:id/sod', jwtAuth, async (req, res, next) => {
  try {
    const { photos, gps, submitted_at } = req.body;
    const check = await query(
      `SELECT status, convoy_id FROM convoy_reports WHERE id = $1 AND cfo_id = $2`,
      [req.params.id, req.cfo.id]
    );
    if (!check.rows.length)
      return res.status(404).json({ error: 'Report not found or not owned by this CFO' });
    if (check.rows[0].status !== 'in_progress')
      return res.status(409).json({ error: 'Report is not in in_progress status' });

    const result = await query(
      `UPDATE convoy_reports SET status = 'sod_complete', sod_submitted_at = $1
       WHERE id = $2 AND cfo_id = $3 RETURNING *`,
      [submitted_at ? new Date(submitted_at) : new Date(), req.params.id, req.cfo.id]
    );
    const report = result.rows[0];

    publish(`convoy:${report.convoy_id}:report`, {
      event: 'sod_submitted', report_id: report.id, convoy_id: report.convoy_id,
      cfo_id: report.cfo_id, status: report.status, sod_submitted_at: report.sod_submitted_at,
    }).catch((err) => logger.warn(`Centrifugo publish failed (sod): ${err.message}`));

    return res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /convoy-reports/:id/eod — submit end-of-day report
router.post('/convoy-reports/:id/eod', jwtAuth, async (req, res, next) => {
  try {
    const { photos, gps, submitted_at } = req.body;
    const check = await query(
      `SELECT status, convoy_id, arrival_at FROM convoy_reports WHERE id = $1 AND cfo_id = $2`,
      [req.params.id, req.cfo.id]
    );
    if (!check.rows.length)
      return res.status(404).json({ error: 'Report not found or not owned by this CFO' });
    if (!check.rows[0].arrival_at)
      return res.status(422).json({ error: 'arrival_not_confirmed', detail: 'Arrival must be confirmed before submitting EOD' });

    const result = await query(
      `UPDATE convoy_reports SET status = 'eod_complete', eod_submitted_at = $1
       WHERE id = $2 AND cfo_id = $3 RETURNING *`,
      [submitted_at ? new Date(submitted_at) : new Date(), req.params.id, req.cfo.id]
    );
    const report = result.rows[0];

    try {
      const { getQueues } = require('../config/queue');
      const queues = getQueues();
      if (queues.convoyReportQueue) {
        queues.convoyReportQueue.add(
          'generatePDFReport',
          { report_id: report.id, convoy_id: report.convoy_id, cfo_id: report.cfo_id, date: report.date },
          { jobId: `pdfReport:${report.id}`, removeOnComplete: { count: 200 } }
        ).catch((err) => logger.warn(`Failed to enqueue generatePDFReport: ${err.message}`));
      }
    } catch (err) {
      logger.warn(`Queue unavailable for EOD PDF job: ${err.message}`);
    }

    publish(`convoy:${report.convoy_id}:report`, {
      event: 'eod_submitted', report_id: report.id, convoy_id: report.convoy_id,
      cfo_id: report.cfo_id, status: report.status, eod_submitted_at: report.eod_submitted_at,
    }).catch((err) => logger.warn(`Centrifugo publish failed (eod): ${err.message}`));

    return res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /seal-verifications — record seal scan with optional tamper alert
router.post('/seal-verifications', jwtAuth, async (req, res, next) => {
  try {
    const { seal_id, convoy_id, phase, photo_id, status, lat, lng, vehicle_plate, position } = req.body;
    if (!seal_id || typeof seal_id !== 'string')
      return res.status(400).json({ error: 'seal_id is required' });
    if (!convoy_id || typeof convoy_id !== 'string')
      return res.status(400).json({ error: 'convoy_id is required' });
    if (!phase || !['sod', 'eod'].includes(phase))
      return res.status(400).json({ error: 'phase must be sod or eod' });
    if (status && !['ok', 'tampered', 'missing'].includes(status))
      return res.status(400).json({ error: 'status must be ok, tampered, or missing' });

    const reportResult = await query(
      `SELECT id FROM convoy_reports WHERE convoy_id = $1 AND cfo_id = $2 AND date = CURRENT_DATE`,
      [convoy_id, req.cfo.id]
    );

    const insertResult = await query(
      `INSERT INTO seal_verifications
         (org_id, report_id, seal_serial, vehicle_plate, position, phase, photo_id, status, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.cfo.org_id, reportResult.rows[0]?.id || null,
        seal_id, vehicle_plate || '', position || '',
        phase, photo_id || null, status || 'ok',
        lat != null ? lat : null, lng != null ? lng : null,
      ]
    );
    const record = insertResult.rows[0];

    if (record.status === 'tampered') {
      await publish(`alert:${req.cfo.org_id}`, {
        event: 'seal_tampered', seal_verification_id: record.id,
        seal_serial: record.seal_serial, convoy_id, cfo_id: req.cfo.id,
        phase, lat: record.lat, lng: record.lng, verified_at: record.verified_at,
      });
    }

    return res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// POST /sos-events — fire SOS panic event
router.post('/sos-events', jwtAuth, async (req, res, next) => {
  try {
    const { convoy_id, cfo_id, incident_type, lat, lng, accuracy, timestamp } = req.body;
    if (!convoy_id || typeof convoy_id !== 'string')
      return res.status(400).json({ error: 'convoy_id is required' });

    const result = await query(
      `INSERT INTO sos_events
         (org_id, convoy_id, cfo_id, incident_type, lat, lng, accuracy_m, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.cfo.org_id, convoy_id, cfo_id || req.cfo.id,
        incident_type || 'unspecified',
        lat != null ? lat : null, lng != null ? lng : null,
        accuracy != null ? parseInt(accuracy) : null,
        timestamp ? new Date(timestamp) : new Date(),
      ]
    );
    const event = result.rows[0];

    await publish(`panic:${req.cfo.org_id}`, {
      event: 'sos', sos_id: event.id, convoy_id: event.convoy_id,
      cfo_id: event.cfo_id, incident_type: event.incident_type,
      lat: event.lat, lng: event.lng, accuracy_m: event.accuracy_m, created_at: event.created_at,
    });

    return res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// GET /history — past reports for this CFO, last 30
router.get('/history', jwtAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM photo_uploads p
               WHERE p.convoy_id = r.convoy_id AND p.cfo_id = r.cfo_id
                 AND p.phase = 'sod' AND p.timestamp::date = r.date) AS sod_photo_count,
              (SELECT COUNT(*) FROM photo_uploads p
               WHERE p.convoy_id = r.convoy_id AND p.cfo_id = r.cfo_id
                 AND p.phase = 'eod' AND p.timestamp::date = r.date) AS eod_photo_count
       FROM convoy_reports r WHERE r.cfo_id = $1 ORDER BY r.date DESC LIMIT 30`,
      [req.cfo.id]
    );
    return res.json({ reports: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
