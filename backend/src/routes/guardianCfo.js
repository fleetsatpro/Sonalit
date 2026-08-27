/**
 * Guardian CFO Device API — Phase C
 * Mounted at /api/v1/guardian/cfo
 */
require('dotenv').config();
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { isCfoModuleEnabled } = require('../utils/cfoFlag');
const { haversine } = require('../utils/haversine');
const logger = require('../utils/logger');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/webp'];

async function validatePhotoUrl(photo_url, claimedLat, claimedLng) {
  try {
    const resp = await fetch(photo_url, { method: 'HEAD' });
    if (!resp.ok) return { error: `photo_url HEAD returned ${resp.status}` };

    const ct = resp.headers.get('content-type') || '';
    if (!ALLOWED_PHOTO_TYPES.some(t => ct.startsWith(t))) {
      return { error: `photo content-type must be image/jpeg or image/webp, got: ${ct}` };
    }
    const size = parseInt(resp.headers.get('content-length') || '0', 10);
    if (size > MAX_PHOTO_BYTES) {
      return { error: `photo exceeds 8 MB limit (${size} bytes)` };
    }

    // EXIF GPS check: fetch first 64 KB to read EXIF, compare with claimed lat/lng
    if (claimedLat != null && claimedLng != null) {
      try {
        const getRange = await fetch(photo_url, { headers: { Range: 'bytes=0-65535' } });
        const buf = Buffer.from(await getRange.arrayBuffer());
        const exifLatLng = extractExifLatLng(buf);
        if (exifLatLng) {
          const dist = haversine(claimedLat, claimedLng, exifLatLng.lat, exifLatLng.lng);
          if (dist > 0.5) {
            return { error: `photo EXIF GPS (${exifLatLng.lat.toFixed(4)},${exifLatLng.lng.toFixed(4)}) conflicts with claimed location (>${dist.toFixed(1)} km apart)` };
          }
        }
      } catch (_) {} // EXIF parse failures are non-fatal
    }
  } catch (err) {
    return { error: `photo_url validation failed: ${err.message}` };
  }
  return null;
}

// Real JPEG/EXIF GPS parser (replaces the old stub that always returned null,
// so the anti-spoofing check in POST /photos never actually ran). Walks JPEG
// segments to the APP1/EXIF block, then the TIFF → IFD0 → GPS-IFD structure to
// pull GPSLatitude/Longitude and their N/S/E/W refs.
function extractExifLatLng(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // not JPEG
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) break;
    const marker = buf[i + 1];
    if (marker === 0xDA || marker === 0xD9) break; // start-of-scan / end-of-image
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) break;
    if (marker === 0xE1) { // APP1 — EXIF
      const gps = parseGpsFromApp1(buf.slice(i + 4, i + 2 + segLen));
      if (gps) return gps;
    }
    i += 2 + segLen;
  }
  return null;
}

function parseGpsFromApp1(app1) {
  // "Exif\0\0" header, then a self-contained TIFF block (all offsets below are
  // relative to the TIFF start, per the EXIF spec).
  if (app1.length < 14 || app1.toString('ascii', 0, 4) !== 'Exif') return null;
  const tiff = app1.slice(6);
  if (tiff.length < 8) return null;
  const bo = tiff.toString('ascii', 0, 2);
  const le = bo === 'II';
  if (!le && bo !== 'MM') return null;
  const u16 = (o) => (o + 2 > tiff.length ? null : (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o)));
  const u32 = (o) => (o + 4 > tiff.length ? null : (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o)));
  if (u16(2) !== 0x002A) return null;
  const ifd0 = u32(4);
  if (ifd0 == null) return null;

  // Find the GPS Info IFD pointer (tag 0x8825) in IFD0.
  const count0 = u16(ifd0);
  if (count0 == null) return null;
  let gpsIfd = null;
  for (let e = 0; e < count0; e++) {
    const entry = ifd0 + 2 + e * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x8825) { gpsIfd = u32(entry + 8); break; }
  }
  if (gpsIfd == null) return null;

  // Walk the GPS IFD for lat/lng and their refs.
  const gpsCount = u16(gpsIfd);
  if (gpsCount == null) return null;
  const rational = (off) => {
    const n = u32(off), d = u32(off + 4);
    return n == null || d == null || d === 0 ? null : n / d;
  };
  const dms = (off) => {
    const deg = rational(off), min = rational(off + 8), sec = rational(off + 16);
    return deg == null || min == null || sec == null ? null : deg + min / 60 + sec / 3600;
  };
  let lat = null, lng = null, latRef = 'N', lngRef = 'E';
  for (let e = 0; e < gpsCount; e++) {
    const entry = gpsIfd + 2 + e * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const cnt = u32(entry + 4);
    if (tag === 0x0001) latRef = String.fromCharCode(tiff[entry + 8]);
    else if (tag === 0x0003) lngRef = String.fromCharCode(tiff[entry + 8]);
    else if (tag === 0x0002 && type === 5 && cnt === 3) lat = dms(u32(entry + 8));
    else if (tag === 0x0004 && type === 5 && cnt === 3) lng = dms(u32(entry + 8));
  }
  if (lat == null || lng == null) return null;
  return { lat: lat * (latRef === 'S' ? -1 : 1), lng: lng * (lngRef === 'W' ? -1 : 1) };
}

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

async function optionalDeviceAuth(req, _res, next) {
  try {
    const token = req.headers['x-device-token'];
    if (token) {
      const result = await query(
        `SELECT * FROM guardian_devices WHERE token = $1 AND deleted_at IS NULL`,
        [token]
      );
      if (result.rows.length && !['revoked','suspended'].includes(result.rows[0].status)) {
        req.device = result.rows[0];
      }
    }
    next();
  } catch (err) {
    logger.error(`optionalDeviceAuth error: ${err.message}`);
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

const cfoLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts — try again in 15 minutes' }),
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Builds the list of report dates a CFO may browse: convoy start_date through
// today (capped at end_date if the convoy already finished).
const MAX_AVAILABLE_DATES = 90; // convoys run for weeks, not years — guards against bogus start_date

// Walks backward from the cap date so the most recent days are always
// selectable even if a bogus/very-old start_date would otherwise blow past
// MAX_AVAILABLE_DATES.
function buildAvailableDates(startDate, endDate, today) {
  if (!startDate) return [today];
  const cap = endDate && endDate < today ? endDate : today;
  const startMs = new Date(startDate + 'T00:00:00Z').getTime();
  const dates = [];
  let cursorMs = new Date(cap + 'T00:00:00Z').getTime();
  while (cursorMs >= startMs && dates.length < MAX_AVAILABLE_DATES) {
    dates.push(new Date(cursorMs).toISOString().slice(0, 10));
    cursorMs -= 86400000;
  }
  return dates.length ? dates.reverse() : [today];
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

// Resolve cfo_user_id for a device — first by direct device link, then by user assignment
async function resolveCfoUserId(device, convoy_id) {
  const direct = await query(
    `SELECT cfo_user_id FROM convoy_cfos WHERE guardian_device_id = $1 AND convoy_id = $2`,
    [device.id, convoy_id]
  );
  if (direct.rows.length) return direct.rows[0].cfo_user_id;

  // Fallback: device has assignment_id pointing to a CFO user (any assignment_type accepted)
  if (device.assignment_id) {
    const byUser = await query(
      `SELECT cfo_user_id FROM convoy_cfos WHERE cfo_user_id = $1 AND convoy_id = $2`,
      [device.assignment_id, convoy_id]
    );
    if (byUser.rows.length) return byUser.rows[0].cfo_user_id;
  }
  return null;
}

// ─── C1: CFO Context ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/guardian/cfo/context
 * Device fetches its CFO assignment for the current active convoy.
 */
router.get('/context', deviceAuth, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    // 'completing' is included alongside 'planned'/'active': dispatch moves a
    // convoy there the instant "End Convoy" is pressed, but CFOs still need
    // this endpoint to finish EOD photos/reports for that day before the
    // convoy reaches its terminal 'completed' state.
    let assignmentResult = await query(
      `SELECT cc.convoy_id, cc.cfo_user_id, c.org_id, c.name, c.status, c.timezone,
              c.start_date, c.end_date, c.seal_count_per_truck, c.local_consignment
       FROM convoy_cfos cc
       JOIN convoys c ON c.id = cc.convoy_id
       WHERE cc.guardian_device_id = $1
         AND c.status IN ('planned','active','completing')
         AND c.deleted_at IS NULL
       ORDER BY c.start_date DESC
       LIMIT 1`,
      [req.device.id]
    );

    // Fallback: device has assignment_id pointing to a CFO user (assignment_type check removed —
    // UUIDs are specific enough and requiring 'user' type blocked legitimately enrolled devices)
    if (!assignmentResult.rows.length && req.device.assignment_id) {
      assignmentResult = await query(
        `SELECT cc.convoy_id, cc.cfo_user_id, c.org_id, c.name, c.status, c.timezone,
                c.start_date, c.end_date, c.seal_count_per_truck, c.local_consignment
         FROM convoy_cfos cc
         JOIN convoys c ON c.id = cc.convoy_id
         WHERE cc.cfo_user_id = $1
           AND c.status IN ('planned','active','completing')
           AND c.deleted_at IS NULL
         ORDER BY c.start_date DESC
         LIMIT 1`,
        [req.device.assignment_id]
      );
      if (assignmentResult.rows.length) {
        query(
          `UPDATE convoy_cfos SET guardian_device_id = $1
           WHERE convoy_id = $2 AND cfo_user_id = $3 AND guardian_device_id IS NULL`,
          [req.device.id, assignmentResult.rows[0].convoy_id, assignmentResult.rows[0].cfo_user_id]
        ).catch((e) => logger.warn(`auto-link device failed: ${e.message}`));
      }
    }

    if (!assignmentResult.rows.length) {
      // No active convoy — look for the most recently completed one so the
      // CFO app can show a "convoy completed" summary instead of a scary 404.
      const recentResult = await query(
        `SELECT cc.convoy_id, cc.cfo_user_id, c.org_id, c.name, c.status, c.timezone,
                c.start_date, c.end_date, c.completed_at
         FROM convoy_cfos cc
         JOIN convoys c ON c.id = cc.convoy_id
         WHERE (cc.guardian_device_id = $1 ${req.device.assignment_id ? 'OR cc.cfo_user_id = $2' : ''})
           AND c.status = 'completed'
           AND c.deleted_at IS NULL
         ORDER BY c.completed_at DESC NULLS LAST, c.end_date DESC
         LIMIT 1`,
        req.device.assignment_id ? [req.device.id, req.device.assignment_id] : [req.device.id]
      );
      if (recentResult.rows.length) {
        const r = recentResult.rows[0];
        return res.json({
          data: {
            convoy: { id: r.convoy_id, name: r.name, status: r.status, timezone: r.timezone,
                      start_date: r.start_date, end_date: r.end_date, completed_at: r.completed_at },
            completed: true,
            cfo_user_id: r.cfo_user_id,
            assigned_trucks: [],
            photos_today: [],
            daily_report: null,
          },
        });
      }
      return res.json({ data: null, no_assignment: true });
    }

    const { convoy_id, cfo_user_id, org_id, ...convoyFields } = assignmentResult.rows[0];

    // Self-heal orphaned trucks: convoysCfoController's addConvoyTruck auto-assigns
    // a newly-added truck to the sole CFO (see comment there), but that only covers
    // trucks added through that one endpoint — a truck present since convoy
    // creation (e.g. seeded/imported data) with no convoy_cfo_truck_assignments row
    // at all is invisible here and permanently unphotographable. If this convoy has
    // exactly one CFO, sweep up any such orphaned truck for them now, same 2-truck
    // cap the DB trigger enforces (cfo_truck_limit_exceeded).
    await query(`
      INSERT INTO convoy_cfo_truck_assignments (convoy_id, cfo_user_id, convoy_truck_id)
      SELECT $1, $2, ct.id
      FROM convoy_trucks ct
      WHERE ct.convoy_id = $1
        AND NOT EXISTS (SELECT 1 FROM convoy_cfo_truck_assignments ccta WHERE ccta.convoy_truck_id = ct.id)
        AND (SELECT COUNT(*) FROM convoy_cfos WHERE convoy_id = $1) = 1
        AND (SELECT COUNT(*) FROM convoy_cfo_truck_assignments WHERE convoy_id = $1 AND cfo_user_id = $2) < 2
      ORDER BY ct.position
      LIMIT 2
    `, [convoy_id, cfo_user_id]).catch((e) => logger.warn(`orphaned-truck self-heal failed: ${e.message}`));

    const todayDate = getConvoyDate(convoyFields.timezone);
    const startDate = convoyFields.start_date ? String(convoyFields.start_date).slice(0, 10) : null;
    const endDate = convoyFields.end_date ? String(convoyFields.end_date).slice(0, 10) : null;
    const availableDates = buildAvailableDates(startDate, endDate, todayDate);

    const requestedDate = typeof req.query.date === 'string' && DATE_RE.test(req.query.date)
      ? req.query.date : null;
    const reportDate = requestedDate && availableDates.includes(requestedDate)
      ? requestedDate : todayDate;

    const [trucksResult, photosResult, reportResult] = await Promise.all([
      query(
        `SELECT ct.*, COALESCE(ct.registration, v.registration) AS plate_number, v.make, v.model
         FROM convoy_cfo_truck_assignments ccta
         JOIN convoy_trucks ct ON ct.id = ccta.convoy_truck_id
         LEFT JOIN vehicles v ON v.id = ct.vehicle_id
         WHERE ccta.convoy_id = $1 AND ccta.cfo_user_id = $2
         ORDER BY ct.position`,
        [convoy_id, cfo_user_id]
      ),
      query(
        // DISTINCT ON keeps only the most recent upload per slot — the CFO
        // app allows retaking a photo, which inserts a new row rather than
        // replacing the old one, so every consumer of this list must dedupe.
        `SELECT DISTINCT ON (convoy_truck_id, session, photo_type, COALESCE(seal_position, ''))
                id, convoy_truck_id, session, photo_type, seal_position, taken_at, uploaded_at
         FROM convoy_truck_photos
         WHERE convoy_id = $1 AND cfo_user_id = $2 AND report_date = $3
         ORDER BY convoy_truck_id, session, photo_type, COALESCE(seal_position, ''), uploaded_at DESC`,
        [convoy_id, cfo_user_id, reportDate]
      ),
      query(
        `SELECT status, received_photo_count, required_photo_count, generated_at, pdf_url
         FROM convoy_daily_reports
         WHERE convoy_id = $1 AND report_date = $2`,
        [convoy_id, reportDate]
      ),
    ]);

    const dailyReport = reportResult.rows[0] || null;

    // Whole-convoy handover record, if the CFO already submitted one — only
    // meaningful for local_consignment convoys (see /handover-upload-url).
    let handover = null;
    if (convoyFields.local_consignment) {
      const handoverResult = await query(
        `SELECT form_url, signed_off_at FROM convoy_handovers
         WHERE convoy_id = $1 AND convoy_truck_id IS NULL AND deleted_at IS NULL`,
        [convoy_id]
      );
      handover = handoverResult.rows[0] || null;
    }

    res.json({
      data: {
        convoy: { id: convoy_id, ...convoyFields },
        cfo_user_id,
        handover,
        assigned_trucks: trucksResult.rows,
        report_date: reportDate,
        today_date: todayDate,
        available_dates: availableDates,
        photos_today: photosResult.rows,
        daily_report: dailyReport ? {
          status: dailyReport.status,
          received_photo_count: dailyReport.received_photo_count,
          required_photo_count: dailyReport.required_photo_count,
          generated_at: dailyReport.generated_at,
          pdf_url: dailyReport.pdf_url,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── C0: CFO Login ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/cfo/login
 * CFO officer authenticates with their Sonalit account from the Guardian device.
 * Links the device to the user's account and restores all active convoy CFO slot
 * assignments, making convoy data immediately available after a reinstall.
 */
router.post('/login', optionalDeviceAuth, cfoLoginLimiter, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required' });
    }

    const emailClean = email.trim().toLowerCase();
    // cfo_login_attempts.device_id is UUID — only req.device?.id qualifies.
    // req.ip (e.g. "::ffff:100.64.0.2") is not a valid fallback key: passing it
    // here throws "invalid input syntax for type uuid", which isn't caught on
    // the SELECT below and 500s/400s the whole login. Callers without a
    // recognized device token (e.g. a not-yet-enrolled CFO app) skip this
    // per-device lockout entirely and fall back to the IP-based
    // cfoLoginLimiter already applied to this route.
    const rateLimitKey = req.device?.id || null;

    // ── Brute-force check (per-device only) ──────────────────────────────────
    if (rateLimitKey) {
      await query(`
        INSERT INTO cfo_login_attempts (device_id, attempts, window_start)
        VALUES ($1, 0, NOW())
        ON CONFLICT (device_id) DO NOTHING
      `, [rateLimitKey]).catch(() => {});

      const attemptRow = await query(
        `SELECT attempts, locked_until, window_start FROM cfo_login_attempts WHERE device_id = $1`,
        [rateLimitKey]
      );
      if (attemptRow.rows.length) {
        const row = attemptRow.rows[0];
        if (row.locked_until && new Date(row.locked_until) > new Date()) {
          gAudit(rateLimitKey, 'cfo_login_locked', null, null, { email: emailClean }, req.ip);
          return res.status(423).json({ error: 'Account locked due to too many failed attempts', code: 'account_locked' });
        }
        if (new Date(row.window_start) < new Date(Date.now() - 15 * 60 * 1000)) {
          await query(`UPDATE cfo_login_attempts SET attempts=0, window_start=NOW(), locked_until=NULL WHERE device_id=$1`, [rateLimitKey]).catch(() => {});
        }
      }
    }

    const userResult = await query(
      `SELECT id, name, email, role, status, password_hash
       FROM users WHERE LOWER(email) = $1 AND role = 'cfo' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [emailClean]
    );

    const bcrypt = require('bcryptjs');
    const hashToCompare = userResult.rows[0]?.password_hash || '$2a$10$dummyhashtopreventtimingattacks00000000000';
    const valid = userResult.rows.length > 0 && await bcrypt.compare(password, hashToCompare);

    if (!userResult.rows.length || !valid) {
      await query(`
        UPDATE cfo_login_attempts
        SET attempts = attempts + 1,
            locked_until = CASE WHEN attempts + 1 >= 5
              THEN NOW() + INTERVAL '15 minutes' * POWER(2, GREATEST(0, attempts - 4))
              ELSE locked_until END
        WHERE device_id = $1
      `, [rateLimitKey]).catch(() => {});
      gAudit(rateLimitKey, 'cfo_login_failed', null, null, { email: emailClean }, req.ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    await query(`UPDATE cfo_login_attempts SET attempts=0, locked_until=NULL WHERE device_id=$1`, [rateLimitKey]).catch(() => {});

    // Auto-provision a device record for CFO-only users without enrollment
    let deviceId = req.device?.id;
    let deviceToken = req.headers['x-device-token'] || null;

    if (!deviceId) {
      const newDevice = await query(
        `INSERT INTO guardian_devices (name, status, assignment_type, assignment_id)
         VALUES ($1, 'active', 'user', $2)
         RETURNING id, token`,
        [`CFO-${user.name}`, user.id]
      );
      deviceId = newDevice.rows[0].id;
      deviceToken = newDevice.rows[0].token;
    } else {
      await query(
        `UPDATE guardian_devices SET assignment_id = $1, assignment_type = 'user', updated_at = NOW() WHERE id = $2`,
        [user.id, deviceId]
      );
    }

    await query(
      `UPDATE convoy_cfos SET guardian_device_id = $1
       WHERE cfo_user_id = $2
         AND convoy_id IN (SELECT id FROM convoys WHERE status IN ('planned','active') AND deleted_at IS NULL)
         AND (guardian_device_id IS NULL OR guardian_device_id = $1
           OR NOT EXISTS (SELECT 1 FROM guardian_devices gd WHERE gd.id = convoy_cfos.guardian_device_id
             AND gd.deleted_at IS NULL AND gd.status NOT IN ('revoked','suspended')))`,
      [deviceId, user.id]
    );

    gAudit(deviceId, 'cfo_login', 'user', user.id, { email: emailClean }, req.ip);
    logger.info(`CFO login: device=${deviceId} user=${user.id} email=${emailClean}`);

    return res.json({
      user_id: user.id, name: user.name, email: user.email, role: user.role,
      device_token: deviceToken,
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

    const cfoUserId = await resolveCfoUserId(req.device, convoy_id);
    if (!cfoUserId) {
      return res.status(403).json({ error: 'device_not_authorised_for_this_truck' });
    }
    const auth = await query(
      `SELECT id FROM convoy_cfo_truck_assignments WHERE convoy_id = $1 AND cfo_user_id = $2 AND convoy_truck_id = $3`,
      [convoy_id, cfoUserId, convoy_truck_id]
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
    // R2's native endpoint has no public-read addressing (unlike S3's virtual-
    // hosted style) — a photo_url built without R2_PUBLIC_URL would never be
    // fetchable, silently breaking the EXIF/content-type check in POST /photos
    // (which HEADs this exact URL) for every submission. Fail the request
    // clearly here instead of handing the CFO app an unusable public_url.
    if (!R2_PUBLIC_URL) {
      return res.status(501).json({ error: 'Photo storage public URL (R2_PUBLIC_URL) not configured on this server' });
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
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

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

    // T5.2: validate photo URL — content-type, size, EXIF GPS
    if (photo_url && !photo_url.startsWith('data:')) {
      const photoErr = await validatePhotoUrl(photo_url, lat ?? null, lng ?? null);
      if (photoErr) return res.status(422).json({ error: photoErr.error });

      // SHA-256 dedup: reject if same hash exists for this convoy+session
      const urlHash = crypto.createHash('sha256').update(photo_url).digest('hex');
      const dupCheck = await query(
        `SELECT id FROM convoy_truck_photos WHERE convoy_id = $1 AND session = $2 AND photo_url_hash = $3`,
        [convoy_id, session, urlHash]
      );
      if (dupCheck.rows.length) {
        return res.status(409).json({ error: 'duplicate_photo', detail: 'A photo with this content hash already exists for this convoy+session' });
      }
    }

    const cfo_user_id = await resolveCfoUserId(req.device, convoy_id);
    if (!cfo_user_id) {
      return res.status(403).json({ error: 'device_not_authorised_for_this_truck' });
    }
    const authResult = await query(
      `SELECT id FROM convoy_cfo_truck_assignments WHERE convoy_id = $1 AND cfo_user_id = $2 AND convoy_truck_id = $3`,
      [convoy_id, cfo_user_id, convoy_truck_id]
    );
    if (!authResult.rows.length) {
      return res.status(403).json({ error: 'device_not_authorised_for_this_truck' });
    }

    // C4: location mismatch — flag if photo GPS differs >2 km from device last known position
    let location_mismatch = false;
    if (lat && lng && req.device.last_lat && req.device.last_lng) {
      location_mismatch = haversine(lat, lng, req.device.last_lat, req.device.last_lng) > 2;
    }

    // Allow retakes: replace any existing photo occupying the same slot so the unique
    // index (ux_truck_photo_front_rear / ux_truck_photo_seal) never fires a 409.
    if (photo_type === 'seal') {
      await query(
        `DELETE FROM convoy_truck_photos
         WHERE convoy_truck_id = $1 AND report_date = $2 AND session = $3
           AND photo_type = 'seal' AND seal_position = $4`,
        [convoy_truck_id, report_date, session, seal_position]
      );
    } else {
      await query(
        `DELETE FROM convoy_truck_photos
         WHERE convoy_truck_id = $1 AND report_date = $2 AND session = $3
           AND photo_type = $4`,
        [convoy_truck_id, report_date, session, photo_type]
      );
    }

    const urlHash = photo_url && !photo_url.startsWith('data:')
      ? crypto.createHash('sha256').update(photo_url).digest('hex')
      : null;

    const insertResult = await query(
      `INSERT INTO convoy_truck_photos
         (convoy_id, convoy_truck_id, cfo_user_id, guardian_device_id, session, photo_type,
          seal_position, report_date, photo_url, photo_url_hash, taken_at, lat, lng, event_uuid, location_mismatch, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (event_uuid) DO NOTHING
       RETURNING *`,
      [convoy_id, convoy_truck_id, cfo_user_id, req.device.id, session, photo_type,
        seal_position || null, report_date, photo_url, urlHash, taken_at,
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

// ─── C6: CFO Self-Handover (local_consignment convoys only) ──────────────────
//
// Most convoys are handed over by a dedicated handover_officer (see
// convoyHandover.js). A convoy created/marked as local_consignment skips
// that — the CFO hands it over themselves, uploading the same handover form
// from this app once their EOD photos are in. Uploading it is the terminal
// action: it satisfies convoy_handovers' completion gate immediately, so the
// convoy flips straight to 'completed' (see finalizeConvoyCompletion) and
// this endpoint's response is what turns "Photo Progress 20/20" into
// "Convoy Ended" on the dashboard.

/**
 * POST /api/v1/guardian/cfo/handover-upload-url
 * Returns a 5-minute presigned R2 PUT URL for the handover form (image or PDF).
 */
router.post('/handover-upload-url', deviceAuth, photoUploadLimiter, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const { convoy_id, content_type } = req.body;
    if (!convoy_id || typeof convoy_id !== 'string') {
      return res.status(400).json({ error: 'convoy_id is required' });
    }
    const isPdf = content_type === 'application/pdf';
    if (content_type && !isPdf && content_type !== 'image/jpeg') {
      return res.status(400).json({ error: 'content_type must be image/jpeg or application/pdf' });
    }

    const cfoUserId = await resolveCfoUserId(req.device, convoy_id);
    if (!cfoUserId) return res.status(403).json({ error: 'device_not_authorised_for_this_convoy' });

    const convoyResult = await query(
      `SELECT status, local_consignment FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
      [convoy_id]
    );
    if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    if (!convoyResult.rows[0].local_consignment) {
      return res.status(403).json({ error: 'not_local_consignment', detail: 'This convoy is handed over by a handover officer, not the CFO.' });
    }
    if (convoyResult.rows[0].status !== 'completing') {
      return res.status(422).json({ error: 'convoy_not_completing', detail: 'Handover can only be uploaded once the convoy is in the completing stage.' });
    }

    const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
      return res.status(501).json({ error: 'Handover storage not configured on this server' });
    }
    if (!R2_PUBLIC_URL) {
      return res.status(501).json({ error: 'Storage public URL (R2_PUBLIC_URL) not configured on this server' });
    }

    let S3Client, PutObjectCommand, getSignedUrl;
    try {
      ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
      ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    } catch {
      return res.status(501).json({ error: 'Storage SDK not installed' });
    }

    const ext = isPdf ? 'pdf' : 'jpg';
    const key = `cfo/${convoy_id}/handover/handover_${uuidv4()}.${ext}`;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    });
    const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: isPdf ? 'application/pdf' : 'image/jpeg' });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({ upload_url: uploadUrl, public_url: `${R2_PUBLIC_URL}/${key}`, key });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/cfo/handover
 * Commits the uploaded handover form and, since a local_consignment convoy's
 * only handover requirement is this one whole-convoy record, immediately
 * completes the convoy.
 */
router.post('/handover', deviceAuth, async (req, res, next) => {
  try {
    if (!await requireCfoModule(res)) return;

    const { convoy_id, form_key, form_url, notes } = req.body;
    if (!convoy_id || !form_key || !form_url) {
      return res.status(400).json({ error: 'convoy_id, form_key, form_url required' });
    }

    const cfoUserId = await resolveCfoUserId(req.device, convoy_id);
    if (!cfoUserId) return res.status(403).json({ error: 'device_not_authorised_for_this_convoy' });

    const convoyResult = await query(
      `SELECT org_id, status, local_consignment FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
      [convoy_id]
    );
    if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    const convoy = convoyResult.rows[0];
    if (!convoy.local_consignment) {
      return res.status(403).json({ error: 'not_local_consignment', detail: 'This convoy is handed over by a handover officer, not the CFO.' });
    }
    if (convoy.status !== 'completing') {
      return res.status(422).json({ error: 'convoy_not_completing', detail: 'Handover can only be uploaded once the convoy is in the completing stage.' });
    }

    const handoverResult = await query(
      `INSERT INTO convoy_handovers
         (org_id, convoy_id, convoy_truck_id, handed_over_by_role, handed_over_by_user_id, form_key, form_url, notes)
       VALUES ($1,$2,NULL,'cfo',$3,$4,$5,$6)
       ON CONFLICT (convoy_id) WHERE convoy_truck_id IS NULL AND deleted_at IS NULL
       DO UPDATE SET form_key = EXCLUDED.form_key, form_url = EXCLUDED.form_url,
         notes = EXCLUDED.notes, signed_off_at = NOW()
       RETURNING *`,
      [convoy.org_id, convoy_id, cfoUserId, form_key, form_url, notes || null]
    );

    const { finalizeConvoyCompletion } = require('../controllers/convoyController');
    const completed = await finalizeConvoyCompletion(convoy_id, convoy.org_id, cfoUserId);

    gAudit(req.device.id, 'cfo_handover_submitted', 'convoy', convoy_id, { form_url }, req.ip);

    res.status(201).json({ data: handoverResult.rows[0], convoy_completed: !!completed });
  } catch (err) {
    next(err);
  }
});

async function updateDailyReport(convoy_id, report_date) {
  // Only count trucks with a CFO assignment: an unassigned truck can never be
  // photographed, so counting it here would make required_photo_count
  // unreachable and the daily report would sit at 'partial' forever.
  const reqResult = await query(
    `SELECT COUNT(DISTINCT ct.id) AS truck_count, c.seal_count_per_truck
     FROM convoys c
     JOIN convoy_trucks ct ON ct.convoy_id = c.id
     WHERE c.id = $1
       AND EXISTS (SELECT 1 FROM convoy_cfo_truck_assignments ccta WHERE ccta.convoy_truck_id = ct.id)
     GROUP BY c.seal_count_per_truck`,
    [convoy_id]
  );
  if (!reqResult.rows.length) return;

  const { truck_count, seal_count_per_truck } = reqResult.rows[0];
  const required = parseInt(truck_count) * (2 + parseInt(seal_count_per_truck)) * 2;

  // Count distinct slots, not rows — retaking a photo inserts a new row
  // alongside the old one rather than replacing it, so a raw COUNT(*) would
  // inflate progress past 100% while some slots are still actually empty.
  // seal_position is the CFO-entered RFID code, not a fixed slot index, so
  // if it drifts across attempts (typo, re-scan, genuine reseal) a truck can
  // accumulate more distinct seal_position values than seal_count_per_truck
  // allows — cap each truck+session's seal contribution at seal_count_per_truck
  // so received_photo_count can never exceed required_photo_count.
  const recvResult = await query(
    `WITH slot_counts AS (
       SELECT convoy_truck_id, session, photo_type,
              COUNT(DISTINCT COALESCE(seal_position, '')) AS n
       FROM convoy_truck_photos
       WHERE convoy_id = $1 AND report_date = $2
       GROUP BY convoy_truck_id, session, photo_type
     )
     SELECT COALESCE(SUM(
       CASE WHEN photo_type = 'seal' THEN LEAST(n, $3::int) ELSE LEAST(n, 1) END
     ), 0) AS received
     FROM slot_counts`,
    [convoy_id, report_date, seal_count_per_truck]
  );
  // Final backstop: a truck can have photos from before it was unassigned/
  // removed, which the per-slot cap above doesn't know to exclude since it
  // sums across whatever trucks have photo rows, not just currently-required
  // ones. received must never be able to exceed required.
  const received = Math.min(parseInt(recvResult.rows[0].received), required);
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
// Exposed for unit testing the EXIF GPS parser.
module.exports.extractExifLatLng = extractExifLatLng;
