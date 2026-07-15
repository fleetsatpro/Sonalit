const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireFreshIntegrity } = require('../middleware/requireFreshIntegrity');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { sendCommandPush, sendPanicAck } = require('../utils/fcm');
const { publish } = require('../realtime/centrifugo');
const requireIdempotencyKey = require('../middleware/idempotency');
const { COMMAND_SIGNING_SECRET, signCommand } = require('../utils/commandSigning');

// ─── Integrity age thresholds per command type (T1.4) ────────────────────────
const INTEGRITY_MAX_AGE = {
  WIPE: 5,
  LOCKDOWN: 15,
  UPDATE_PINS: 15,
  // All other commands default to 60 min (checked inline)
};

// ─── Config cache (60-second TTL) ────────────────────────────────────────────
let _minApkVersionCode = 0;
let _minApkVersionCodeExpiry = 0;

async function getMinApkVersionCode() {
  const now = Date.now();
  if (now < _minApkVersionCodeExpiry) return _minApkVersionCode;
  const row = await query(`SELECT value_int FROM guardian_config WHERE key = 'min_apk_version_code'`);
  _minApkVersionCode = row.rows[0]?.value_int ?? 0;
  _minApkVersionCodeExpiry = now + 60_000;
  return _minApkVersionCode;
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const enrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

// T5.1: rate-limit keys are device_id (set by deviceAuth) with IP as fallback
const panicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.device && req.device.id) || req.headers['x-device-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => (req.device && req.device.id) || req.headers['x-device-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => (req.device && req.device.id) || req.headers['x-device-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.device && req.device.id) || req.headers['x-device-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

// Per-admin-per-target-device: 10 commands/min per (admin, device) pair
const commandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${(req.user && req.user.id) ? req.user.id : req.ip}:${req.params.id || ''}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

// Resolve a device's org_id (from guardian_devices) and its linked field-officer id
// (by device link or badge/name). Additive: used to backfill enrollment responses so
// the agent can subscribe to the correct realtime channel (org#<org_id>).
async function resolveOrgOfficer(deviceId, badgeName) {
  let orgId = null;
  let officerId = null;
  try {
    const devRow = await query(`SELECT org_id FROM guardian_devices WHERE id = $1`, [deviceId]);
    orgId = devRow.rows[0]?.org_id ?? null;
    const offRow = await query(
      `SELECT id FROM field_officers
       WHERE (device_id = $1 OR badge_number = $2)
       ORDER BY (device_id = $1) DESC LIMIT 1`,
      [deviceId, badgeName || null]
    );
    officerId = offRow.rows[0]?.id ?? null;
  } catch (e) {
    logger.warn(`resolveOrgOfficer failed for ${deviceId}: ${e.message}`);
  }
  return { orgId, officerId };
}

// ─── Table Initialisation ────────────────────────────────────────────────────

async function ensureTables() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS guardian_devices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        name            TEXT NOT NULL,
        imei            TEXT,
        imei_hash       TEXT,
        model           TEXT,
        os_version      TEXT,
        app_version     TEXT,
        status          TEXT DEFAULT 'pending',
        assignment_type TEXT,
        assignment_id   UUID,
        panic_active    BOOLEAN DEFAULT false,
        last_seen       TIMESTAMPTZ,
        last_lat        DECIMAL(10,7),
        last_lng        DECIMAL(10,7),
        last_speed      DECIMAL(6,2),
        enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_locations (
        id        BIGSERIAL PRIMARY KEY,
        device_id UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        lat       DECIMAL(10,7) NOT NULL,
        lng       DECIMAL(10,7) NOT NULL,
        altitude  DECIMAL(8,2),
        heading   DECIMAL(6,2),
        speed     DECIMAL(6,2),
        accuracy  DECIMAL(8,2),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_health (
        id               BIGSERIAL PRIMARY KEY,
        device_id        UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        battery_level    INT,
        battery_charging BOOLEAN,
        signal_strength  INT,
        network_type     TEXT,
        storage_free_mb  INT,
        ram_free_mb      INT,
        app_version      TEXT,
        recorded_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS panic_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   UUID NOT NULL REFERENCES guardian_devices(id),
        mode        TEXT NOT NULL,
        lat         DECIMAL(10,7),
        lng         DECIMAL(10,7),
        message     TEXT,
        resolved_at TIMESTAMPTZ,
        resolved_by UUID,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS device_commands (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id    UUID NOT NULL REFERENCES guardian_devices(id),
        command_type TEXT NOT NULL,
        payload      JSONB,
        status       TEXT DEFAULT 'pending',
        result       TEXT,
        issued_by    UUID,
        issued_at    TIMESTAMPTZ DEFAULT NOW(),
        executed_at  TIMESTAMPTZ
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS field_reports (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   UUID NOT NULL REFERENCES guardian_devices(id),
        category    TEXT NOT NULL,
        severity    TEXT DEFAULT 'medium',
        description TEXT,
        lat         DECIMAL(10,7),
        lng         DECIMAL(10,7),
        photo_url   TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // v2 columns — safe to run repeatedly
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS org_id UUID`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS convoy_code TEXT`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS android_id TEXT`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS manufacturer TEXT`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS imei_hash TEXT`);
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT`).catch(() => {}); // also added below
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_imei_hash
        ON guardian_devices(imei_hash)
        WHERE imei_hash IS NOT NULL AND deleted_at IS NULL
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_android_id
        ON guardian_devices(android_id)
        WHERE android_id IS NOT NULL AND android_id <> 'unknown' AND deleted_at IS NULL
    `);

    // One-time cleanup: soft-delete PENDING records where an ACTIVE record exists
    // for the same name + model (catches duplicates created before hardware-ID dedup was added).
    await query(`
      UPDATE guardian_devices SET deleted_at = NOW()
      WHERE status = 'pending' AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM guardian_devices active
          WHERE active.deleted_at IS NULL
            AND active.status = 'active'
            AND active.name = guardian_devices.name
            AND (active.model = guardian_devices.model OR active.model IS NULL OR guardian_devices.model IS NULL)
            AND active.id <> guardian_devices.id
        )
    `);

    // p1t1 — server-side config table (feature flags, version enforcement)
    await query(`
      CREATE TABLE IF NOT EXISTS guardian_config (
        key         TEXT PRIMARY KEY,
        value_int   INT,
        value_text  TEXT,
        description TEXT,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('min_apk_version_code', 5,
              'Heartbeat rejects APKs below this versionCode with HTTP 426')
      ON CONFLICT (key) DO UPDATE
        SET value_int = GREATEST(guardian_config.value_int, EXCLUDED.value_int),
            updated_at = NOW()
    `);

    // Remove deprecated flags replaced by unconditional enforcement (Task E)
    await query(`
      DELETE FROM guardian_config
      WHERE key IN ('command_signing_enabled', 'cert_pinning_enabled')
    `);

    // Audit log archive flag (default off — must be explicitly enabled)
    await query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('audit_log_archive_enabled', 0, 'Archive audit log rows to R2 before GDPR deletion (0=off,1=on)')
      ON CONFLICT (key) DO NOTHING
    `);

    // Indexes for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_device_locations_device_id ON device_locations(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_locations_timestamp ON device_locations(timestamp DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_health_device_id ON device_health(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON device_commands(device_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_panic_events_device_id ON panic_events(device_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_panic_events_resolved ON panic_events(resolved_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_field_reports_device_id ON field_reports(device_id)`);

    // p2t5 — audit log table
    await query(`
      CREATE TABLE IF NOT EXISTS guardian_audit_log (
        id          BIGSERIAL PRIMARY KEY,
        actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin','device','system')),
        actor_id    UUID,
        action      TEXT NOT NULL,
        target_type TEXT,
        target_id   UUID,
        payload     JSONB,
        ip_address  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON guardian_audit_log(actor_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON guardian_audit_log(target_type, target_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON guardian_audit_log(action, created_at DESC)`);

    // p3t1 — enrollment codes
    await query(`
      CREATE TABLE IF NOT EXISTS enrollment_codes (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id     UUID,
        code       TEXT NOT NULL UNIQUE,
        used_at    TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // p3t5 — DMS server-side config seed rows
    await query(`
      INSERT INTO guardian_config (key, value_int, description) VALUES
        ('dms_default_interval_minutes', 60, 'Default dead-man switch interval in minutes'),
        ('dms_max_interval_minutes', 120, 'Maximum allowed DMS interval (hard ceiling)')
      ON CONFLICT (key) DO NOTHING
    `);
    // Cap any existing dms_max_interval_minutes above the new 120-minute ceiling
    await query(`
      UPDATE guardian_config SET value_int = 120, updated_at = NOW()
      WHERE key = 'dms_max_interval_minutes' AND value_int > 120
    `);

    // p3t6 — convoy codes
    await query(`
      CREATE TABLE IF NOT EXISTS convoy_codes (
        code        TEXT PRIMARY KEY,
        created_by  UUID REFERENCES users(id),
        org_id      UUID,
        max_members INT DEFAULT 50,
        expires_at  TIMESTAMPTZ,
        active      BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // p3t7 — command signing: signature column
    await query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS signature TEXT`);

    // p1t3 — command delivery timestamps
    await query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);

    // p2t3 — command expiry
    await query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);

    // p1t5 — idempotency UUIDs for panic events and field reports
    await query(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_panic_events_event_uuid
        ON panic_events(event_uuid)
        WHERE event_uuid IS NOT NULL
    `);
    await query(`ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_field_reports_event_uuid
        ON field_reports(event_uuid)
        WHERE event_uuid IS NOT NULL
    `);

    // p4t1 — FCM push token on device
    await query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT`);

    // p5t1 — nonce column for command replay protection
    await query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS nonce TEXT`);

    // p5t2 — nonce deduplication table (PRIMARY KEY enforces uniqueness per device)
    await query(`
      CREATE TABLE IF NOT EXISTS guardian_command_nonces (
        device_id UUID NOT NULL REFERENCES guardian_devices(id),
        nonce     TEXT NOT NULL,
        seen_at   TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, nonce)
      )
    `);

    // p5t3 — command lifecycle event log
    await query(`
      CREATE TABLE IF NOT EXISTS device_command_events (
        id         BIGSERIAL PRIMARY KEY,
        command_id UUID NOT NULL,
        status     TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_device_command_events_command ON device_command_events(command_id)`);

    logger.info('Guardian tables initialised');
  } catch (err) {
    logger.error(`Guardian ensureTables error: ${err.message}`);
  }
}

// ─── Audit Log Helper ─────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit log insert. Never throws — errors are caught and logged.
 */
function auditLog(actor_type, actor_id, action, target_type, target_id, payload, ip) {
  query(
    `INSERT INTO guardian_audit_log
       (actor_type, actor_id, action, target_type, target_id, payload, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor_type,
      actor_id || null,
      action,
      target_type || null,
      target_id || null,
      payload ? JSON.stringify(payload) : null,
      ip || null,
    ]
  ).catch((err) => logger.error(`auditLog error: ${err.message}`));
}

// ─── Command Expiry Background Job ───────────────────────────────────────────

async function runCommandExpiryJob() {
  try {
    const result = await query(
      `UPDATE device_commands
       SET status = 'expired'
       WHERE status IN ('pending', 'sent') AND expires_at < NOW()`
    );
    if (result.rowCount > 0) {
      logger.info(`Command expiry job: expired ${result.rowCount} commands`);
    }
  } catch (err) {
    logger.error(`Command expiry job error: ${err.message}`);
  }
}

// Run immediately on module load
ensureTables().then(() => {
  // Start command expiry job after tables are ready
  runCommandExpiryJob();
  setInterval(runCommandExpiryJob, 10 * 60 * 1000); // every 10 minutes
});

// ─── Device Auth Middleware ───────────────────────────────────────────────────

async function deviceAuth(req, res, next) {
  try {
    const token = req.headers['x-device-token'];
    if (!token) {
      return res.status(401).json({ error: 'Missing X-Device-Token header' });
    }

    const result = await query(
      `SELECT * FROM guardian_devices
       WHERE token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid device token' });
    }

    const device = result.rows[0];
    if (device.status === 'revoked' || device.status === 'suspended') {
      return res.status(403).json({ error: `Device is ${device.status}` });
    }

    req.device = device;
    next();
  } catch (err) {
    logger.error(`deviceAuth error: ${err.message}`);
    next(err);
  }
}

// ─── Device Routes (no JWT required) ─────────────────────────────────────────

/**
 * Points a field officer at `deviceId`, retiring whatever device they were
 * previously linked to (if different). A field officer only ever has one
 * meaningfully "current" device — an old one left behind after a factory
 * reset, signing-key change, or hand-me-down phone reassignment otherwise
 * lingers forever as an orphaned row that reads as a duplicate device for
 * the same officer in every device list.
 */
async function linkOfficerDevice(officer, deviceId) {
  if (officer.device_id && officer.device_id !== deviceId) {
    await query(
      `UPDATE guardian_devices SET status = 'revoked', deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [officer.device_id]
    );
    logger.info(`Retired stale device ${officer.device_id} for officer ${officer.id} (now ${deviceId})`);
  }
  if (officer.device_id !== deviceId) {
    await query(
      `UPDATE field_officers SET device_id = $1, updated_at = NOW() WHERE id = $2`,
      [deviceId, officer.id]
    );
  }
}

/**
 * POST /api/v1/guardian/enroll
 * Register a new device.
 * Accepts two formats:
 *   v4 (Guardian Agent APK): { device_id, operator_code, play_integrity_token, platform, fcm_token, app_version }
 *   legacy: { name, imei, android_id, manufacturer, model, os_version, app_version, org_token, enrollment_code }
 */
router.post('/enroll', enrollLimiter, async (req, res, next) => {
  try {
    // ── v4 format (Guardian Agent APK) ──────────────────────────────────────
    if (!req.body.org_token && req.body.operator_code) {
      const { device_id, operator_code, platform, fcm_token, app_version } = req.body;
      if (!device_id || !operator_code) {
        return res.status(400).json({ error: 'device_id and operator_code are required' });
      }

      // Find org via field officer badge number
      // (field_officers has no soft-delete column — a delete is a hard DELETE, see field-officers.js)
      const officerRes = await query(
        `SELECT id, org_id, device_id FROM field_officers WHERE badge_number = $1 LIMIT 1`,
        [operator_code]
      );
      // A mistyped/unknown badge number used to fall through silently: the
      // INSERT below still ran with org_id NULL (the column DEFAULT fires),
      // creating a device no admin's org view could ever see — the officer
      // was left staring at "Awaiting operator approval" forever, since
      // nothing was ever actually pending in any real organisation's queue.
      // Reject it up front instead, with a message the app can show as-is.
      if (!officerRes.rows[0]) {
        return res.status(404).json({ error: 'Badge number not recognized. Check with your dispatcher and try again.' });
      }
      const orgId = officerRes.rows[0].org_id;

      // Dedup: return existing if already enrolled with this android device id
      const existing = await query(
        `SELECT id, token, status FROM guardian_devices
         WHERE android_id = $1 AND deleted_at IS NULL
         ORDER BY enrolled_at DESC LIMIT 1`,
        [device_id]
      );
      if (existing.rows[0]) {
        const dev = existing.rows[0];
        // Re-establish (or retarget) the officer<->device link even on this
        // fast path — not just on fresh enrollment below — so an officer
        // reassigned to hardware that already has a guardian_devices row
        // (e.g. a spare/handed-down phone) still ends up correctly linked
        // instead of staying deviceless.
        if (officerRes.rows[0]) {
          await linkOfficerDevice(officerRes.rows[0], dev.id);
        }
        const mappedStatus = (dev.status === 'active' || dev.status === 'enrolled') ? 'enrolled' : dev.status;
        return res.json({
          status: mappedStatus,
          device_uuid: dev.id,
          device_token: dev.token,
          org_id: orgId,
          officer_id: officerRes.rows[0]?.id ?? null,
          command_signing_secret: COMMAND_SIGNING_SECRET,
        });
      }

      // New enrollment — omit org_id when null so the column DEFAULT fires
      // rather than explicitly passing NULL against a NOT NULL constraint.
      const enrollParams = [operator_code, device_id, fcm_token ?? null, app_version ?? null];
      const enrollSql = orgId !== null
        ? `INSERT INTO guardian_devices (name, android_id, fcm_token, app_version, org_id, status)
           VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id, token`
        : `INSERT INTO guardian_devices (name, android_id, fcm_token, app_version, status)
           VALUES ($1, $2, $3, $4, 'pending') RETURNING id, token`;
      if (orgId !== null) enrollParams.push(orgId);
      const { rows } = await query(enrollSql, enrollParams);

      // Auto-link device to field officer (see linkOfficerDevice — retires
      // any previous device this officer had so it doesn't linger as an
      // orphaned "duplicate" row).
      if (officerRes.rows[0]) {
        await linkOfficerDevice(officerRes.rows[0], rows[0].id);
      }

      auditLog('device', rows[0].id, 'v4_enroll', 'device', rows[0].id, { operator_code, platform }, req.ip);
      return res.status(202).json({
        status: 'pending_approval',
        device_uuid: rows[0].id,
        device_token: rows[0].token,
        org_id: orgId,
        officer_id: officerRes.rows[0]?.id ?? null,
        command_signing_secret: COMMAND_SIGNING_SECRET,
      });
    }

    // ── legacy format ────────────────────────────────────────────────────────
    const { name, imei, android_id, manufacturer, model, os_version, app_version, org_token, enrollment_code } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!org_token) {
      return res.status(400).json({ error: 'org_token is required' });
    }

    const expectedToken = process.env.GUARDIAN_ORG_TOKEN || 'fleet-guardian-2024';
    if (org_token !== expectedToken) {
      logger.warn(`Guardian enroll rejected: bad org_token from device "${name}"`);
      return res.status(403).json({ error: 'Invalid organisation token' });
    }

    // Deduplication: if this hardware is already enrolled return its existing token.
    // T5.5: hash IMEI with PEPPER — never store raw IMEI in persistent storage
    const IMEI_PEPPER = process.env.IMEI_PEPPER || 'guardian-imei-pepper-dev';
    const rawImei = imei && imei !== 'unknown' ? imei : null;
    const safeImei = rawImei
      ? crypto.createHash('sha256').update(rawImei + IMEI_PEPPER).digest('hex')
      : null;
    const safeAndroidId = android_id && android_id !== 'unknown' ? android_id : null;

    let existingDev = null;

    if (safeImei || safeAndroidId) {
      const r = await query(
        `SELECT id, token, status, enrolled_at FROM guardian_devices
         WHERE deleted_at IS NULL
           AND (
             ($1::TEXT IS NOT NULL AND imei_hash = $1)
             OR ($2::TEXT IS NOT NULL AND android_id = $2)
           )
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, enrolled_at DESC
         LIMIT 1`,
        [safeImei, safeAndroidId]
      );
      if (r.rows.length) existingDev = r.rows[0];
    }

    // Legacy fallback: records enrolled before android_id tracking have both hardware IDs null,
    // OR when a device reports unknown hardware IDs. Match by name + model.
    if (!existingDev) {
      const r = await query(
        `SELECT id, token, status, enrolled_at FROM guardian_devices
         WHERE deleted_at IS NULL AND android_id IS NULL AND imei IS NULL
           AND name = $1 AND (model = $2 OR $2 IS NULL)
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, enrolled_at DESC
         LIMIT 1`,
        [name, model || null]
      );
      if (r.rows.length) {
        existingDev = r.rows[0];
        // Backfill hardware IDs so the fast path works on every subsequent enrollment
        await query(
          `UPDATE guardian_devices SET android_id = $1, imei_hash = $2, manufacturer = $3 WHERE id = $4`,
          [safeAndroidId, safeImei, manufacturer || null, existingDev.id]
        );
        logger.info(`Guardian legacy device backfilled android_id: ${existingDev.id}`);
      }
    }

    if (existingDev) {
      const dev = existingDev;
      if (dev.status === 'revoked' || dev.status === 'suspended') {
        return res.status(403).json({ error: `Device is ${dev.status} — contact your administrator` });
      }
      // Re-enrollment: refresh metadata, keep token
      await query(
        `UPDATE guardian_devices
         SET name = $1, os_version = $2, app_version = $3,
             manufacturer = $4, model = $5, updated_at = NOW()
         WHERE id = $6`,
        [name, os_version || null, app_version || null, manufacturer || null, model || null, dev.id]
      );
      // Soft-delete any other PENDING records for the same physical device
      await query(
        `UPDATE guardian_devices SET deleted_at = NOW()
         WHERE id <> $1 AND status = 'pending' AND deleted_at IS NULL
           AND (
             ($2::TEXT IS NOT NULL AND imei_hash = $2)
             OR ($3::TEXT IS NOT NULL AND android_id = $3)
             OR (android_id IS NULL AND imei_hash IS NULL AND name = $4
                 AND (model = $5 OR $5 IS NULL))
           )`,
        [dev.id, safeImei, safeAndroidId, name, model || null]
      );
      logger.info(`Guardian re-enrollment: device ${dev.id}`);
      auditLog('device', dev.id, 're_enroll', 'device', dev.id, { name }, req.ip);
      const certPin = process.env.GUARDIAN_CERT_PIN || null;
      const { orgId: reOrgId, officerId: reOfficerId } = await resolveOrgOfficer(dev.id, name);
      return res.status(200).json({
        device_id: dev.id,
        token: dev.token,
        enrolled_at: dev.enrolled_at,
        cert_pin: certPin,
        command_signing_secret: COMMAND_SIGNING_SECRET,
        org_id: reOrgId,
        officer_id: reOfficerId,
      });
    }

    // Optional enrollment code validation (backward compat: skip if not provided)
    let enrollmentCodeId = null;
    if (enrollment_code && enrollment_code.trim()) {
      const codeRow = await query(
        `SELECT id FROM enrollment_codes
         WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [enrollment_code.trim().toUpperCase()]
      );
      if (!codeRow.rows.length) {
        return res.status(403).json({ error: 'Invalid or expired enrollment code' });
      }
      enrollmentCodeId = codeRow.rows[0].id;
    }

    const result = await query(
      `INSERT INTO guardian_devices
         (name, imei_hash, android_id, manufacturer, model, os_version, app_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id, token, enrolled_at`,
      [name, safeImei, safeAndroidId, manufacturer || null, model || null, os_version || null, app_version || null]
    );

    const device = result.rows[0];

    if (enrollmentCodeId) {
      await query(
        `UPDATE enrollment_codes SET used_at = NOW() WHERE id = $1`,
        [enrollmentCodeId]
      );
    }

    logger.info(`Guardian device enrolled: ${device.id} name="${name}"`);
    auditLog('device', null, 'enroll', 'device', device.id, { name, android_id }, req.ip);

    const certPin = process.env.GUARDIAN_CERT_PIN || null;
    const { orgId: newOrgId, officerId: newOfficerId } = await resolveOrgOfficer(device.id, name);

    res.status(201).json({
      device_id: device.id,
      token: device.token,
      enrolled_at: device.enrolled_at,
      cert_pin: certPin,
      command_signing_secret: COMMAND_SIGNING_SECRET,
      org_id: newOrgId,
      officer_id: newOfficerId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/heartbeat
 * Battery / health ping every 60 s. Returns queued commands.
 */
router.post('/heartbeat', deviceAuth, heartbeatLimiter, async (req, res, next) => {
  try {
    const {
      battery_charging,
      network_type,
      storage_free_mb,
      ram_free_mb,
      app_version,
      app_version_code,
      fcm_token,
    } = req.body;
    // Accept battery_pct (v4 APK) or battery_level (legacy).
    // APK sends -1 as an "unknown" sentinel — store NULL so it doesn't mask real data.
    const rawBattery = req.body.battery_level ?? req.body.battery_pct ?? null;
    const battery_level = rawBattery != null && rawBattery >= 0 ? rawBattery : null;
    // Accept signal_pct (v4 APK) or signal_strength (legacy)
    const rawSignal = req.body.signal_strength ?? req.body.signal_pct ?? null;
    const signal_strength = rawSignal != null && rawSignal >= 0 ? rawSignal : null;
    // Accept both lat/lng (legacy) and latitude/longitude (Guardian APK field names)
    const lat = req.body.lat ?? req.body.latitude ?? null;
    const lng = req.body.lng ?? req.body.longitude ?? null;
    const speed = req.body.speed ?? null;

    const deviceId = req.device.id;

    // Min-APK-version enforcement — cached 60 s to avoid per-heartbeat DB hit
    if (app_version_code != null) {
      const minCode = await getMinApkVersionCode();
      if (parseInt(app_version_code) < minCode) {
        const backendBase = process.env.BACKEND_URL || '';
        return res.status(426).json({
          error: 'upgrade_required',
          min_version_code: minCode,
          download_url: `${backendBase}/api/v1/guardian/apk/download`,
        });
      }
    }

    // Upsert health record (delete old for device then insert, or use plain insert)
    await query(
      `INSERT INTO device_health
         (device_id, battery_level, battery_charging, signal_strength, network_type,
          storage_free_mb, ram_free_mb, app_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        deviceId,
        battery_level ?? null,
        battery_charging ?? null,
        signal_strength ?? null,
        network_type || null,
        storage_free_mb ?? null,
        ram_free_mb ?? null,
        app_version || null,
      ]
    );

    // Update device last_seen and optionally location
    if (lat != null && lng != null) {
      await query(
        `UPDATE guardian_devices
         SET last_seen = NOW(), status = 'active',
             last_lat = $2, last_lng = $3, last_speed = $4, updated_at = NOW()
         WHERE id = $1`,
        [deviceId, lat, lng, speed ?? null]
      );
    } else {
      await query(
        `UPDATE guardian_devices
         SET last_seen = NOW(), status = 'active', updated_at = NOW()
         WHERE id = $1`,
        [deviceId]
      );
    }

    // Update FCM token if device sent one (Task 4.1)
    if (fcm_token) {
      await query(
        `UPDATE guardian_devices SET fcm_token = $2, updated_at = NOW() WHERE id = $1`,
        [deviceId, fcm_token]
      );
    }

    // Atomically claim and mark pending commands as 'sent' (FOR UPDATE SKIP LOCKED
    // prevents duplicate delivery when multiple heartbeats arrive concurrently)
    const commands = await query(
      `WITH claimed AS (
        SELECT id FROM device_commands
        WHERE device_id = $1 AND status = 'pending' AND signature IS NOT NULL
        ORDER BY issued_at ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      UPDATE device_commands dc
      SET status = 'sent', sent_at = NOW()
      FROM claimed
      WHERE dc.id = claimed.id
      RETURNING dc.id, dc.command_type, dc.payload, dc.status,
                dc.issued_at, dc.expires_at, dc.executed_at, dc.signature`,
      [deviceId]
    );

    // T5.4: include min_required_version so clients can proactively check
    const minCode = await getMinApkVersionCode();
    const forceUpdate = app_version_code != null && parseInt(app_version_code) < minCode;
    const backendBase = process.env.BACKEND_URL || '';

    // T5.3: mark commands as delivered
    if (commands.rows.length) {
      for (const cmd of commands.rows) {
        query(`INSERT INTO device_command_events (command_id, status) VALUES ($1, 'delivered')`, [cmd.id]).catch(() => {});
      }
    }

    res.json({
      status: 'ok',
      server_time: Date.now(),
      commands: commands.rows,
      command_signing_secret: COMMAND_SIGNING_SECRET,
      org_id: req.device.org_id ?? null,
      min_required_version: minCode,
      force_update: forceUpdate,
      ...(forceUpdate ? { download_url: `${backendBase}/api/v1/guardian/apk/download` } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/commands/poll
 * Lightweight command pickup for the app's 60s in-service poll — the same
 * atomic claim as the heartbeat path, without writing a device_health row,
 * so it's cheap enough to hit every minute. This keeps dashboard commands
 * (trigger_siren, show_message, ...) delivering in ≤60s even when FCM can't
 * reach the device: no registered token, missing Play services, or push
 * throttling by the OEM.
 */
router.post('/commands/poll', deviceAuth, heartbeatLimiter, async (req, res, next) => {
  try {
    const deviceId = req.device.id;
    const commands = await query(
      `WITH claimed AS (
        SELECT id FROM device_commands
        WHERE device_id = $1 AND status = 'pending' AND signature IS NOT NULL
        ORDER BY issued_at ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      UPDATE device_commands dc
      SET status = 'sent', sent_at = NOW()
      FROM claimed
      WHERE dc.id = claimed.id
      RETURNING dc.id, dc.command_type, dc.payload, dc.status,
                dc.issued_at, dc.expires_at, dc.signature`,
      [deviceId]
    );
    if (commands.rows.length) {
      for (const cmd of commands.rows) {
        query(`INSERT INTO device_command_events (command_id, status) VALUES ($1, 'delivered')`, [cmd.id]).catch(() => {});
      }
    }
    res.json({ commands: commands.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/location
 * GPS position update from device.
 */
router.post('/location', deviceAuth, locationLimiter, async (req, res, next) => {
  try {
    const { lat, lng, altitude, heading, speed, accuracy, timestamp } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const deviceId = req.device.id;

    const result = await query(
      `INSERT INTO device_locations (device_id, lat, lng, altitude, heading, speed, accuracy, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::TIMESTAMPTZ, NOW()))
       RETURNING id, timestamp`,
      [
        deviceId,
        lat,
        lng,
        altitude ?? null,
        heading ?? null,
        speed ?? null,
        accuracy ?? null,
        timestamp || null,
      ]
    );

    // Update last known position on device record
    await query(
      `UPDATE guardian_devices
       SET last_lat = $2, last_lng = $3, last_speed = $4,
           last_seen = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [deviceId, lat, lng, speed ?? null]
    );

    const locationPayload = {
      type: 'location',
      device_id: deviceId,
      name: req.device.name,
      lat,
      lng,
      altitude: altitude ?? null,
      heading: heading ?? null,
      speed: speed ?? null,
      accuracy: accuracy ?? null,
      timestamp: result.rows[0].timestamp,
    };
    if (req.device.org_id) {
      publish(`org#${req.device.org_id}`, locationPayload);
    } else {
      publish('device:location', locationPayload);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/panic
 * Trigger SOS alert from device.
 */
router.post('/panic', deviceAuth, requireIdempotencyKey, panicLimiter, async (req, res, next) => {
  try {
    const { lat, lng, message } = req.body;
    // Accept both "mode" and "panic_mode" for backward compatibility with older APKs
    const mode = req.body.mode || req.body.panic_mode;
    // event_uuid is optional for backward compatibility; generate one server-side if omitted
    const event_uuid = req.body.event_uuid || uuidv4();

    // voice_distress: fired by VoiceTriggerService detecting "PAN PAN PAN" —
    // distinct from the other modes because it means the agent verbally
    // called out under duress, so the dashboard plays a more urgent siren
    // for it (see apps/web/src/lib/siren.ts's `mayday` style).
    const validModes = ['silent', 'loud', 'medical', 'security', 'hijack', 'voice_distress'];
    if (!mode || !validModes.includes(mode)) {
      return res.status(400).json({
        error: `mode is required and must be one of: ${validModes.join(', ')}`,
      });
    }

    const deviceId = req.device.id;

    // Step 1: attempt idempotent insert
    const orgId = req.device.org_id || null;

    const insertResult = await query(
      `INSERT INTO panic_events (event_uuid, device_id, org_id, mode, lat, lng, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (event_uuid) WHERE event_uuid IS NOT NULL DO NOTHING
       RETURNING *`,
      [event_uuid, deviceId, orgId, mode, lat ?? null, lng ?? null, message || null]
    );

    let panicEvent;
    let isNew;

    if (insertResult.rows.length > 0) {
      // New insert
      panicEvent = insertResult.rows[0];
      isNew = true;
    } else {
      // Step 2: duplicate — fetch existing row
      const existingResult = await query(
        `SELECT * FROM panic_events WHERE event_uuid = $1`,
        [event_uuid]
      );
      panicEvent = existingResult.rows[0];
      isNew = false;
    }

    // Trigger handles panic_active — no manual UPDATE needed

    const payload = {
      panic_id: panicEvent.id,
      event_uuid: panicEvent.event_uuid,
      device_id: deviceId,
      device_name: req.device.name,
      mode: panicEvent.mode,
      lat: panicEvent.lat ?? null,
      lng: panicEvent.lng ?? null,
      message: panicEvent.message || null,
      created_at: panicEvent.created_at,
      triggered_at: panicEvent.created_at,
    };

    if (isNew) {
      // Mark device panic_active so dashboard shows alert immediately on reload.
      // A panic that carries coordinates is also the freshest position we have —
      // fold it into last_lat/last_lng/last_seen, which is all Live Fleet reads.
      // Otherwise a device whose continuous GPS stream is down shows OFF on the
      // map at a stale position while its SOS sits in Panic Center with exact
      // coordinates a few pixels away.
      await query(
        `UPDATE guardian_devices
            SET panic_active = true,
                updated_at = NOW(),
                last_lat = COALESCE($2::float8, last_lat),
                last_lng = COALESCE($3::float8, last_lng),
                last_seen = CASE WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL
                                 THEN NOW() ELSE last_seen END
          WHERE id = $1`,
        [deviceId, lat ?? null, lng ?? null]
      );

      const panicPublishPayload = { type: 'panic', ...payload };
      if (orgId) {
        publish(`org#${orgId}`, panicPublishPayload);
      } else {
        publish('device:panic', panicPublishPayload);
      }
      logger.warn(`PANIC triggered: device=${deviceId} name="${req.device.name}" mode=${mode} org=${orgId ?? 'unknown'}`);
      // FCM ack to device confirming SOS was received (Task 4.1, fire-and-forget)
      if (req.device.fcm_token) {
        sendPanicAck(req.device.fcm_token, panicEvent.id).catch(() => {});
      }
    }

    res.status(isNew ? 201 : 200).json(payload);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/report
 * Field incident report from device.
 */
router.post('/report', deviceAuth, reportLimiter, async (req, res, next) => {
  try {
    const { category, severity = 'medium', description, lat, lng, photo_url } = req.body;
    // event_uuid is optional for backward compatibility; generate one server-side if omitted
    const event_uuid = req.body.event_uuid || uuidv4();

    // T3.7: reject data URI photos — devices must upload to pre-signed URL first
    if (photo_url && photo_url.startsWith('data:')) {
      return res.status(400).json({ error: 'photo_url must be an HTTPS URL, not a data URI. Upload via pre-signed URL first.' });
    }

    const validCategories = [
      'suspicious', 'roadblock', 'theft', 'attack', 'accident',
      'medical', 'checkpoint', 'delivery_issue', 'vehicle_issue',
      'road_hazard', 'route_change', 'cargo_issue', 'personnel_issue', 'other',
    ];
    if (!category || !validCategories.includes(category)) {
      return res.status(400).json({
        error: `category is required and must be one of: ${validCategories.join(', ')}`,
      });
    }

    const deviceId = req.device.id;

    // Step 1: attempt idempotent insert
    const insertResult = await query(
      `INSERT INTO field_reports (event_uuid, device_id, category, severity, description, lat, lng, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_uuid) WHERE event_uuid IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        event_uuid,
        deviceId,
        category,
        severity,
        description || null,
        lat ?? null,
        lng ?? null,
        photo_url || null,
      ]
    );

    let report;
    let isNew;

    if (insertResult.rows.length > 0) {
      // New insert
      report = insertResult.rows[0];
      isNew = true;
    } else {
      // Step 2: duplicate — fetch existing row
      const existingResult = await query(
        `SELECT * FROM field_reports WHERE event_uuid = $1`,
        [event_uuid]
      );
      report = existingResult.rows[0];
      isNew = false;
    }

    if (isNew) {
      const reportChannel = req.device.org_id ? `org#${req.device.org_id}` : 'device:report';
      publish(reportChannel, {
        type: 'device.report',
        report_id: report.id,
        event_uuid: report.event_uuid,
        device_id: deviceId,
        device_name: req.device.name,
        category: report.category,
        severity: report.severity,
        description: report.description || null,
        lat: report.lat ?? null,
        lng: report.lng ?? null,
        photo_url: report.photo_url || null,
        created_at: report.created_at,
      });
      logger.info(`Field report: device=${deviceId} category=${category} severity=${severity}`);
    }

    res.status(isNew ? 201 : 200).json({ report_id: report.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/reports/upload-url
 * Returns a 5-minute presigned PUT URL (Cloudflare R2 / S3-compatible) for a JPEG photo.
 * Device uploads the photo directly, then posts the returned public_url in /report.
 * If R2 credentials are absent, returns 501 — APK falls back to base64.
 */
router.post('/reports/upload-url', deviceAuth, async (req, res, next) => {
  try {
    const {
      R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY,
      R2_BUCKET, R2_PUBLIC_URL,
    } = process.env;

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
      return res.status(501).json({ error: 'Photo storage not configured on this server' });
    }
    // R2's native endpoint has no public-read addressing without a configured
    // public base URL — a URL built without it would never resolve. The APK
    // already treats 501 here as "fall back to base64" (see docstring above),
    // so failing fast is strictly safer than handing back a dead public_url.
    if (!R2_PUBLIC_URL) {
      return res.status(501).json({ error: 'Photo storage public URL (R2_PUBLIC_URL) not configured on this server' });
    }

    let S3Client, PutObjectCommand, getSignedUrl;
    try {
      ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
      ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    } catch (_) {
      return res.status(501).json({ error: 'Photo storage SDK not installed — run npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner' });
    }

    const key = `reports/${req.device.id}/${uuidv4()}.jpg`;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    });
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: 'image/jpeg',
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `${R2_PUBLIC_URL}/${key}`;

    res.json({ upload_url: uploadUrl, public_url: publicUrl, key });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/ack-command
 * Device acknowledges a command was received / executed.
 */
router.post('/ack-command', deviceAuth, async (req, res, next) => {
  try {
    const { command_id, status, result: cmdResult } = req.body;

    if (!command_id) {
      return res.status(400).json({ error: 'command_id is required' });
    }
    if (!['executed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "executed" or "failed"' });
    }

    const deviceId = req.device.id;

    // Accept ACKs for 'sent' (poll-delivered) AND 'pending' (WS-delivered before a
    // heartbeat marked it 'sent') so realtime command acknowledgements are recorded.
    const updated = await query(
      `UPDATE device_commands
       SET status = $2, result = $3, executed_at = NOW()
       WHERE id = $1 AND device_id = $4 AND status IN ('sent', 'pending')
       RETURNING id`,
      [command_id, status, cmdResult || null, deviceId]
    );

    if (!updated.rows.length) {
      // Distinguish between "wrong state" and "not found"
      const existing = await query(
        `SELECT id, status FROM device_commands WHERE id = $1 AND device_id = $2`,
        [command_id, deviceId]
      );
      if (existing.rows.length) {
        // Already executed/failed — idempotent success (device may re-ack after dedup).
        return res.json({ ok: true, already: existing.rows[0].status });
      }
      return res.status(404).json({ error: 'Command not found for this device' });
    }

    // T5.3: record acked/applied/failed event
    const evtStatus = status === 'executed' ? 'applied' : 'failed';
    query(`INSERT INTO device_command_events (command_id, status) VALUES ($1, $2)`, [command_id, evtStatus]).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/whoami
 * Lightweight identity/backfill endpoint. Lets an already-enrolled agent recover
 * org_id / officer_id after an update without re-enrolling (P0-2 migration).
 */
router.get('/whoami', deviceAuth, async (req, res, next) => {
  try {
    const { orgId, officerId } = await resolveOrgOfficer(req.device.id, req.device.name);
    res.json({
      device_id: req.device.id,
      name: req.device.name,
      org_id: orgId,
      officer_id: officerId,
      command_signing_secret: COMMAND_SIGNING_SECRET,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/panic/cancel
 * Device-initiated cancellation of its own active SOS (the "TAP TO CANCEL" path).
 * Resolves the device's unresolved panic events and broadcasts a cancel.
 */
router.post('/panic/cancel', deviceAuth, async (req, res, next) => {
  try {
    const deviceId = req.device.id;
    const resolved = await query(
      `UPDATE panic_events
       SET resolved_at = NOW()
       WHERE device_id = $1 AND resolved_at IS NULL
       RETURNING id`,
      [deviceId]
    );

    await query(
      `UPDATE guardian_devices SET panic_active = false, updated_at = NOW() WHERE id = $1`,
      [deviceId]
    );

    const cancelPayload = {
      type: 'panic_cancel',
      device_id: deviceId,
      device_name: req.device.name,
      cancelled: resolved.rows.map(r => r.id),
      cancelled_at: new Date().toISOString(),
    };
    if (req.device.org_id) {
      publish(`org#${req.device.org_id}`, cancelPayload);
    } else {
      publish('device:panic', cancelPayload);
    }

    logger.warn(`PANIC cancelled by device=${deviceId} count=${resolved.rows.length}`);
    res.json({ ok: true, cancelled: resolved.rows.length });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Routes (JWT required) ──────────────────────────────────────────────

/**
 * GET /api/v1/guardian/commands
 * Recent commands across all devices (admin view).
 */
router.get('/commands', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const params = [limit];
    const result = await query(
      `SELECT dc.id, dc.device_id, dc.command_type, dc.status,
              dc.issued_at, dc.executed_at, dc.result,
              gd.name AS device_name
       FROM device_commands dc
       JOIN guardian_devices gd ON gd.id = dc.device_id
       ORDER BY dc.issued_at DESC
       LIMIT $1`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/guardian/devices
 * List all guardian devices with last health, last location, pending command count.
 */
router.get('/devices', authenticate, async (req, res, next) => {
  try {
    const { status, search, after, limit = 50, offset = 0 } = req.query;

    const filters = ['gd.deleted_at IS NULL'];
    const params = [];

    if (req.user.org_id) {
      params.push(req.user.org_id);
      filters.push(`gd.org_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`gd.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(gd.name ILIKE $${params.length} OR gd.model ILIKE $${params.length})`
      );
    }
    if (after) {
      params.push(after);
      filters.push(`gd.created_at < $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const result = await query(
      `SELECT
         gd.id, gd.name, gd.model, gd.os_version, gd.app_version,
         gd.status, gd.assignment_type, gd.assignment_id,
         gd.panic_active, gd.last_seen, gd.last_lat, gd.last_lng, gd.last_speed,
         gd.enrolled_at, gd.created_at,
         h.battery_level, h.battery_charging, h.signal_strength,
         h.network_type, h.storage_free_mb, h.ram_free_mb, h.recorded_at AS health_recorded_at,
         COALESCE(pc.cnt, 0)::INT AS pending_commands,
         -- The officer<->device link's single source of truth is
         -- field_officers.device_id (written by enroll auto-link, the Field
         -- Officers page, and the Guardian LINK button). The old join used
         -- gd.assignment_id, which none of those paths set — so the officer
         -- name never showed here even when a device was clearly linked. Also
         -- surface officer_name/officer_badge/officer_phone under the names the
         -- Guardian frontend actually reads.
         fo.name         AS officer_name,
         fo.badge_number AS officer_badge,
         fo.phone        AS officer_phone,
         fo.id           AS officer_id
       FROM guardian_devices gd
       LEFT JOIN LATERAL (
         SELECT battery_level, battery_charging, signal_strength,
                network_type, storage_free_mb, ram_free_mb, recorded_at
         FROM device_health
         WHERE device_id = gd.id
         ORDER BY (battery_level IS NOT NULL) DESC, recorded_at DESC
         LIMIT 1
       ) h ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM device_commands
         WHERE device_id = gd.id AND status = 'pending'
       ) pc ON true
       LEFT JOIN field_officers fo ON fo.device_id = gd.id
         AND (gd.org_id IS NULL OR fo.org_id = gd.org_id)
       WHERE ${filters.join(' AND ')}
       ORDER BY gd.last_seen DESC NULLS LAST, gd.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM guardian_devices gd WHERE ${filters.join(' AND ')}`,
      params.slice(0, -2)
    );

    const rows = result.rows;

    // Attach active CFO convoy name per device — runs only if convoy_cfos table exists
    if (rows.length > 0) {
      try {
        const deviceIds = rows.map(r => r.id);
        const cfoRes = await query(
          `SELECT cc.guardian_device_id, c.name
           FROM convoy_cfos cc
           JOIN convoys c ON c.id = cc.convoy_id
           WHERE cc.guardian_device_id = ANY($1)
             AND c.status = 'active' AND c.deleted_at IS NULL`,
          [deviceIds]
        );
        const cfoMap = {};
        for (const r of cfoRes.rows) cfoMap[r.guardian_device_id] = r.name;
        for (const row of rows) row.cfo_convoy_name = cfoMap[row.id] || null;
      } catch (_) {
        // convoy_cfos table not yet migrated — skip gracefully
        for (const row of rows) row.cfo_convoy_name = null;
      }
    }

    const parsedLimit = parseInt(limit);
    const next_cursor =
      rows.length < parsedLimit
        ? null
        : rows[rows.length - 1].created_at instanceof Date
        ? rows[rows.length - 1].created_at.toISOString()
        : rows[rows.length - 1].created_at;

    res.json({ data: rows, total: parseInt(total.rows[0].count), next_cursor });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/devices/:id
 * Single device with full detail.
 */
router.get('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = result.rows[0];

    const [healthResult, locResult, cmdResult] = await Promise.all([
      query(
        `SELECT * FROM device_health WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [device.id]
      ),
      query(
        `SELECT lat, lng, altitude, heading, speed, accuracy, timestamp
         FROM device_locations WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 20`,
        [device.id]
      ),
      query(
        `SELECT id, command_type, payload, status, result, issued_at, executed_at
         FROM device_commands WHERE device_id = $1 ORDER BY issued_at DESC LIMIT 20`,
        [device.id]
      ),
    ]);

    res.json({
      data: {
        ...device,
        health: healthResult.rows[0] || null,
        recent_locations: locResult.rows,
        recent_commands: cmdResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/devices/:id
 * Update device assignment, status, or name.
 */
router.patch('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const { assignment_type, assignment_id, status, name } = req.body;

    const validAssignmentTypes = ['driver', 'officer', 'convoy', 'vehicle', 'asset', 'user'];
    if (assignment_type && !validAssignmentTypes.includes(assignment_type)) {
      return res.status(400).json({
        error: `assignment_type must be one of: ${validAssignmentTypes.join(', ')}`,
      });
    }

    // When assigning to an officer, verify the officer exists in the same org
    if (assignment_type === 'officer' && assignment_id) {
      const officerCheck = await query(
        `SELECT id FROM field_officers WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)`,
        [assignment_id, req.user.org_id || null]
      );
      if (!officerCheck.rows.length) {
        return res.status(404).json({ error: 'Field officer not found' });
      }
    }

    // Detect explicit clear: assignment_type is present in body but falsy (null/empty)
    const clearAssignment = 'assignment_type' in req.body && !assignment_type;

    const result = await query(
      `UPDATE guardian_devices
       SET name            = COALESCE($1, name),
           status          = COALESCE($2, status),
           assignment_type = CASE WHEN $6 THEN NULL ELSE COALESCE($3, assignment_type) END,
           assignment_id   = CASE WHEN $6 THEN NULL ELSE COALESCE($4::UUID, assignment_id) END,
           org_id          = COALESCE(org_id, $7::UUID),
           updated_at      = NOW()
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [name || null, status || null, assignment_type || null, assignment_id || null, req.params.id, clearAssignment, req.user.org_id || null]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    auditLog('admin', req.user.id, 'device_updated', 'device', req.params.id, req.body, req.ip);

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/guardian/devices/:id
 * Soft delete device.
 */
router.delete('/devices/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE guardian_devices
       SET deleted_at = NOW(), status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    auditLog('admin', req.user.id, 'device_deleted', 'device', req.params.id, {}, req.ip);
    logger.info(`Guardian device soft-deleted: ${req.params.id} by user ${req.user.id}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/devices/:id/command
 * Send a remote command to a device.
 */
router.post('/devices/:id/command', authenticate, requireIdempotencyKey, commandLimiter, async (req, res, next) => {
  try {
    const { command_type, payload, nonce, issued_at: clientIssuedAt } = req.body;

    const validCommandTypes = [
      'force_sync', 'start_live_tracking', 'stop_live_tracking',
      'lock_screen', 'trigger_siren', 'stop_siren', 'push_message',
      'restart_agent', 'request_location', 'enable_lost_mode',
      'WIPE', 'LOCKDOWN', 'UPDATE_PINS', 'CHANGE_MODE', 'SEND_MESSAGE', 'TAKE_PHOTO',
    ];
    if (!command_type || !validCommandTypes.includes(command_type)) {
      return res.status(400).json({
        error: `command_type must be one of: ${validCommandTypes.join(', ')}`,
      });
    }

    // ── Replay protection (T1.3) ──────────────────────────────────────────────
    if (!nonce || typeof nonce !== 'string' || nonce.length < 8) {
      return res.status(400).json({ error: 'nonce is required (min 8 chars)' });
    }
    if (clientIssuedAt) {
      const diff = Math.abs(Date.now() - new Date(clientIssuedAt).getTime());
      if (diff > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'issued_at is outside 5-minute window', code: 'clock_skew' });
      }
    }

    // Try device exists + get integrity state in one query
    const deviceCheck = await query(
      `SELECT id, fcm_token, last_integrity_verdict, last_integrity_verdict_at
       FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const device = deviceCheck.rows[0];

    // ── Play Integrity gating (T1.4) ─────────────────────────────────────────
    const destructiveMaxAge = INTEGRITY_MAX_AGE[command_type];
    if (destructiveMaxAge !== undefined) {
      const staleCutoff = new Date(Date.now() - destructiveMaxAge * 60 * 1000);
      const isStale = !device.last_integrity_verdict_at || new Date(device.last_integrity_verdict_at) < staleCutoff;
      const isBad = !device.last_integrity_verdict || device.last_integrity_verdict !== 'MEETS_DEVICE_INTEGRITY';
      if (isStale || isBad) {
        await query(
          `INSERT INTO device_commands (device_id, command_type, payload, status) VALUES ($1, 'REQUEST_INTEGRITY', '{}', 'pending')`,
          [device.id]
        ).catch(() => {});
        return res.status(412).json({ error: 'Device integrity verification required', code: 'integrity_required' });
      }
    }

    // ── Deduplicate nonce (INSERT will fail on PK violation) ─────────────────
    try {
      await query(
        `INSERT INTO guardian_command_nonces (device_id, nonce, seen_at) VALUES ($1, $2, NOW())`,
        [device.id, nonce]
      );
    } catch (nonceErr) {
      if (nonceErr.code === '23505') {
        return res.status(409).json({ error: 'Duplicate command — nonce already seen', code: 'replay_detected' });
      }
      throw nonceErr;
    }

    const insertResult = await query(
      `INSERT INTO device_commands (device_id, command_type, payload, issued_by, nonce, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), NOW() + INTERVAL '24 hours')
       RETURNING id, issued_at, expires_at`,
      [req.params.id, command_type, payload ? JSON.stringify(payload) : null, req.user.id, nonce, clientIssuedAt || null]
    );

    const cmd = insertResult.rows[0];
    const signature = signCommand(cmd.id, command_type, payload || null, cmd.issued_at, cmd.expires_at);

    await query(`UPDATE device_commands SET signature = $1 WHERE id = $2`, [signature, cmd.id]);

    auditLog('admin', req.user.id, 'command_issued', 'device', req.params.id, { command_type, payload, nonce }, req.ip);

    // expires_at MUST be included so the device can reconstruct the signed message
    // (signCommand binds expires_at) and verify the signature over the WS path.
    publish(`org#${req.user.org_id}`, { type: 'device.command', device_id: req.params.id, command_type, payload: payload || null, command_id: cmd.id, issued_at: cmd.issued_at, expires_at: cmd.expires_at, signature });

    // T5.3: record issued event
    query(`INSERT INTO device_command_events (command_id, status) VALUES ($1, 'issued')`, [cmd.id]).catch(() => {});

    logger.info(`Command issued: ${command_type} → device=${req.params.id} by user=${req.user.id}`);

    if (device.fcm_token) {
      sendCommandPush(device.fcm_token, command_type, cmd.id).catch(() => {});
    }

    res.status(201).json({ command_id: cmd.id, signature });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/devices/:id/commands
 * Recent command log for a device (newest first).
 */
router.get('/devices/:id/commands', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const deviceCheck = await query(
      `SELECT id FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await query(
      `SELECT dc.id, dc.command_type, dc.payload, dc.status,
              dc.result, dc.issued_at, dc.executed_at,
              u.name AS issued_by_name
       FROM device_commands dc
       LEFT JOIN users u ON u.id = dc.issued_by
       WHERE dc.device_id = $1
       ORDER BY dc.issued_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );

    res.json({ commands: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/commands/:id/events
 * Lifecycle event log for a specific command (admin). T5.3
 */
router.get('/commands/:id/events', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, status, occurred_at, detail FROM device_command_events
       WHERE command_id = $1 ORDER BY occurred_at ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/guardian/devices/:id/history
 * Recent GPS trail (last 500 points, default 24 hours).
 */
router.get('/devices/:id/history', authenticate, async (req, res, next) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // cap at 7 days

    const deviceCheck = await query(
      `SELECT id, name FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!deviceCheck.rows.length) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await query(
      `SELECT lat, lng, altitude, heading, speed, accuracy, timestamp
       FROM device_locations
       WHERE device_id = $1 AND timestamp >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY timestamp DESC
       LIMIT 500`,
      [req.params.id, hours]
    );

    res.json({
      device_id: req.params.id,
      device_name: deviceCheck.rows[0].name,
      hours,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/panic
 * List panic events, newest first. Optional ?active_only=true
 */
router.get('/panic', authenticate, async (req, res, next) => {
  try {
    const { active_only, device_id, after, limit = 50, offset = 0 } = req.query;

    const filters = [];
    const params = [];

    // Org scoping: prefer pe.org_id; fall back to device's org_id for older rows
    params.push(req.user.org_id);
    filters.push(`(pe.org_id = $${params.length} OR gd.org_id = $${params.length})`);

    if (active_only === 'true') {
      filters.push('pe.resolved_at IS NULL');
    }
    if (device_id) {
      params.push(device_id);
      filters.push(`pe.device_id = $${params.length}`);
    }
    if (after) {
      params.push(after);
      filters.push(`pe.created_at < $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    const result = await query(
      `SELECT pe.*, gd.name AS device_name, gd.model AS device_model
       FROM panic_events pe
       JOIN guardian_devices gd ON gd.id = pe.device_id
       ${whereClause}
       ORDER BY pe.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM panic_events pe JOIN guardian_devices gd ON gd.id = pe.device_id ${whereClause}`,
      params.slice(0, -2)
    );

    const panicRows = result.rows;
    const panicLimit = parseInt(limit);
    const next_cursor =
      panicRows.length < panicLimit
        ? null
        : panicRows[panicRows.length - 1].created_at instanceof Date
        ? panicRows[panicRows.length - 1].created_at.toISOString()
        : panicRows[panicRows.length - 1].created_at;

    res.json({ data: panicRows, total: parseInt(total.rows[0].count), next_cursor });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/panic/:id/resolve
 * Resolve a panic event.
 */
router.patch('/panic/:id/resolve', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE panic_events
       SET resolved_at = NOW(), resolved_by = $2
       WHERE id = $1 AND resolved_at IS NULL
       RETURNING id, device_id, resolved_at`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Panic event not found or already resolved' });
    }

    const panicEvent = result.rows[0];

    // Recompute panic_active: true only if unresolved panics remain for this device
    await query(
      `UPDATE guardian_devices
       SET panic_active = EXISTS(
         SELECT 1 FROM panic_events
         WHERE device_id = $1 AND resolved_at IS NULL
       ), updated_at = NOW()
       WHERE id = $1`,
      [panicEvent.device_id]
    );

    auditLog('admin', req.user.id, 'panic_resolved', 'panic_event', req.params.id, {}, req.ip);
    logger.info(`Panic resolved: ${req.params.id} by user=${req.user.id}`);

    res.json({ data: panicEvent });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/reports
 * List field reports. Params: {category, severity, device_id}
 */
router.get('/reports', authenticate, async (req, res, next) => {
  try {
    const { category, severity, device_id, after, limit = 50, offset = 0 } = req.query;

    const filters = [];
    const params = [];

    if (category) {
      params.push(category);
      filters.push(`fr.category = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      filters.push(`fr.severity = $${params.length}`);
    }
    if (device_id) {
      params.push(device_id);
      filters.push(`fr.device_id = $${params.length}`);
    }
    if (after) {
      params.push(after);
      filters.push(`fr.created_at < $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await query(
      `SELECT fr.*, gd.name AS device_name
       FROM field_reports fr
       JOIN guardian_devices gd ON gd.id = fr.device_id
       ${whereClause}
       ORDER BY fr.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const total = await query(
      `SELECT COUNT(*) FROM field_reports fr ${whereClause}`,
      params.slice(0, -2)
    );

    const reportRows = result.rows;
    const reportLimit = parseInt(limit);
    const next_cursor =
      reportRows.length < reportLimit
        ? null
        : reportRows[reportRows.length - 1].created_at instanceof Date
        ? reportRows[reportRows.length - 1].created_at.toISOString()
        : reportRows[reportRows.length - 1].created_at;

    res.json({ data: reportRows, total: parseInt(total.rows[0].count), next_cursor });
  } catch (err) {
    next(err);
  }
});

// ─── Dead Man's Switch Check-in ───────────────────────────────────────────────

/**
 * POST /api/v1/guardian/checkin
 * Reset the dead man's switch timer on the server side.
 */
router.post('/checkin', deviceAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE guardian_devices
       SET last_checkin_at = NOW(), last_seen = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [req.device.id]
    );
    res.json({ ok: true, checkin_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ─── Dead Man's Switch Admin ─────────────────────────────────────────────────

/**
 * GET /api/v1/guardian/devices/:id/dms
 * Return the DMS configuration for a device.
 */
router.get('/devices/:id/dms', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, dms_enabled, dms_timeout_minutes, dms_suspended_until, last_checkin_at
       FROM guardian_devices
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/devices/:id/dms
 * Update DMS configuration for a device.
 * Body: { dms_enabled?, dms_timeout_minutes?, suspend_minutes? }
 * suspend_minutes > 0 sets dms_suspended_until = NOW() + interval; 0 clears it.
 */
router.patch('/devices/:id/dms', authenticate, authorize('admin', 'dispatcher'), async (req, res, next) => {
  try {
    const { dms_enabled, dms_timeout_minutes, suspend_minutes } = req.body;
    const sets = [];
    const values = [req.params.id];
    let idx = 2;

    if (typeof dms_enabled === 'boolean') {
      sets.push(`dms_enabled = $${idx++}`);
      values.push(dms_enabled);
    }
    if (dms_timeout_minutes !== undefined) {
      if (dms_timeout_minutes !== null && (dms_timeout_minutes < 1 || dms_timeout_minutes > 1440)) {
        return res.status(400).json({ error: 'dms_timeout_minutes must be 1–1440' });
      }
      sets.push(`dms_timeout_minutes = $${idx++}`);
      values.push(dms_timeout_minutes);
    }
    if (suspend_minutes !== undefined) {
      if (suspend_minutes === 0 || suspend_minutes === null) {
        sets.push(`dms_suspended_until = NULL`);
      } else {
        sets.push(`dms_suspended_until = NOW() + ($${idx++} * INTERVAL '1 minute')`);
        values.push(suspend_minutes);
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = NOW()');

    const result = await query(
      `UPDATE guardian_devices SET ${sets.join(', ')}
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, dms_enabled, dms_timeout_minutes, dms_suspended_until, last_checkin_at`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Convoy ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/convoy/join
 * Device joins a convoy by code. Returns all members in the same convoy.
 */
router.post('/convoy/join', deviceAuth, async (req, res, next) => {
  try {
    const { convoy_code } = req.body;
    if (!convoy_code || typeof convoy_code !== 'string' || convoy_code.trim().length < 2) {
      return res.status(400).json({ error: 'convoy_code is required (min 2 chars)' });
    }
    const code = convoy_code.trim().toUpperCase();

    // Check convoy_codes table for managed codes (backward compat: legacy codes not in table are allowed)
    const codeRow = await query(
      `SELECT code, max_members, active, expires_at FROM convoy_codes WHERE code = $1`,
      [code]
    );

    if (codeRow.rows.length > 0) {
      const cc = codeRow.rows[0];
      // Reject if inactive or expired
      if (!cc.active || (cc.expires_at && new Date(cc.expires_at) < new Date())) {
        return res.status(403).json({ error: 'convoy_code_invalid' });
      }
      // Check member count
      const memberCount = await query(
        `SELECT COUNT(*) FROM guardian_devices WHERE convoy_code = $1 AND deleted_at IS NULL`,
        [code]
      );
      if (parseInt(memberCount.rows[0].count) >= cc.max_members) {
        return res.status(403).json({ error: 'convoy_full' });
      }
    }

    await query(
      `UPDATE guardian_devices SET convoy_code = $2, updated_at = NOW() WHERE id = $1`,
      [req.device.id, code]
    );
    const members = await query(
      `SELECT id, name, last_lat, last_lng, last_speed, last_seen, status
       FROM guardian_devices
       WHERE convoy_code = $1 AND deleted_at IS NULL
       ORDER BY name`,
      [code]
    );
    logger.info(`Device ${req.device.id} joined convoy ${code}`);
    res.json({ ok: true, convoy_code: code, members: members.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/convoy/leave
 * Device leaves its current convoy.
 */
router.post('/convoy/leave', deviceAuth, async (req, res, next) => {
  try {
    const code = req.device.convoy_code;
    await query(
      `UPDATE guardian_devices SET convoy_code = NULL, updated_at = NOW() WHERE id = $1`,
      [req.device.id]
    );
    logger.info(`Device ${req.device.id} left convoy ${code}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/convoy
 * Returns the current convoy members visible to this device.
 */
router.get('/convoy', deviceAuth, async (req, res, next) => {
  try {
    const code = req.device.convoy_code;
    if (!code) {
      return res.json({ in_convoy: false, convoy_code: null, members: [] });
    }
    const members = await query(
      `SELECT id, name, last_lat, last_lng, last_speed, last_seen, status
       FROM guardian_devices
       WHERE convoy_code = $1 AND deleted_at IS NULL
       ORDER BY name`,
      [code]
    );
    res.json({ in_convoy: true, convoy_code: code, members: members.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/convoys
 * Admin: list all active convoys and their member count.
 */
router.get('/convoys', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT convoy_code,
              COUNT(*)                          AS member_count,
              MAX(last_seen)                    AS last_active,
              json_agg(json_build_object(
                'id', id, 'name', name,
                'last_lat', last_lat, 'last_lng', last_lng,
                'last_speed', last_speed, 'last_seen', last_seen,
                'status', status
              ) ORDER BY name)                  AS members
       FROM guardian_devices
       WHERE convoy_code IS NOT NULL AND deleted_at IS NULL
       GROUP BY convoy_code
       ORDER BY last_active DESC`
    );
    res.json({ convoys: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Enrollment Codes ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/enrollment-codes
 * Generate a new enrollment code.
 */
router.post('/enrollment-codes', authenticate, async (req, res, next) => {
  try {
    const expiresInMinutes = Math.min(parseInt(req.body.expires_in_minutes) || 60, 1440);

    // Generate 12-char alphanumeric code
    const bytes = crypto.randomBytes(9);
    const code = bytes.toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12).padEnd(12, 'A');

    const result = await query(
      `INSERT INTO enrollment_codes (code, expires_at, created_by)
       VALUES ($1, NOW() + ($2 || ' minutes')::INTERVAL, $3)
       RETURNING id, code, expires_at`,
      [code, expiresInMinutes, req.user.id]
    );

    const row = result.rows[0];
    auditLog('admin', req.user.id, 'enrollment_code_created', 'enrollment_code', row.id,
      { expires_in_minutes: expiresInMinutes }, req.ip);

    res.status(201).json({ code: row.code, expires_at: row.expires_at, id: row.id });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/enrollment-codes
 * List all non-expired, unused codes.
 */
router.get('/enrollment-codes', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ec.id, ec.code, ec.expires_at, ec.created_at,
              u.name AS created_by_name
       FROM enrollment_codes ec
       LEFT JOIN users u ON u.id = ec.created_by
       WHERE ec.used_at IS NULL AND ec.expires_at > NOW()
       ORDER BY ec.created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Server Config ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/guardian/config
 * Returns all guardian_config as key→value object. Device uses this on startup.
 */
router.get('/config', deviceAuth, async (req, res, next) => {
  try {
    const result = await query(`SELECT key, value_int, value_text FROM guardian_config`);
    const config = {};
    for (const row of result.rows) {
      config[row.key] = row.value_int != null ? row.value_int : row.value_text;
    }
    res.json(config);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/guardian/config
 * Update a guardian config value.
 */
router.patch('/config', authenticate, async (req, res, next) => {
  try {
    const { key, value_int, value_text } = req.body;

    const allowlist = ['dms_default_interval_minutes', 'dms_max_interval_minutes', 'min_apk_version_code', 'audit_log_archive_enabled'];
    if (!key || !allowlist.includes(key)) {
      return res.status(400).json({ error: `key must be one of: ${allowlist.join(', ')}` });
    }

    const result = await query(
      `INSERT INTO guardian_config (key, value_int, value_text, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value_int = EXCLUDED.value_int,
             value_text = EXCLUDED.value_text,
             updated_at = NOW()
       RETURNING key, value_int, value_text`,
      [key, value_int != null ? value_int : null, value_text || null]
    );

    if (key === 'min_apk_version_code') _minApkVersionCodeExpiry = 0; // bust cache

    auditLog('admin', req.user.id, 'config_updated', 'config', null,
      { key, value_int, value_text }, req.ip);

    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Convoy Codes ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/guardian/convoy-codes
 * Generate a new convoy code.
 */
router.post('/convoy-codes', authenticate, async (req, res, next) => {
  try {
    const maxMembers = parseInt(req.body.max_members) || 50;
    const expiresInHours = parseInt(req.body.expires_in_hours) || 24;

    // Generate 6-char alphanumeric code
    const bytes = crypto.randomBytes(5);
    const code = bytes.toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, 'A');

    const result = await query(
      `INSERT INTO convoy_codes (code, created_by, max_members, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)
       RETURNING code, expires_at`,
      [code, req.user.id, maxMembers, expiresInHours]
    );

    const row = result.rows[0];
    auditLog('admin', req.user.id, 'convoy_code_created', 'convoy_code', null,
      { code: row.code, max_members: maxMembers, expires_in_hours: expiresInHours }, req.ip);

    res.status(201).json({ code: row.code, expires_at: row.expires_at });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guardian/convoy-codes
 * List all non-expired convoy codes.
 */
router.get('/convoy-codes', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cc.code, cc.max_members, cc.expires_at, cc.active, cc.created_at,
              u.name AS created_by_name,
              COUNT(gd.id) AS current_members
       FROM convoy_codes cc
       LEFT JOIN users u ON u.id = cc.created_by
       LEFT JOIN guardian_devices gd ON gd.convoy_code = cc.code AND gd.deleted_at IS NULL
       WHERE (cc.expires_at IS NULL OR cc.expires_at > NOW()) AND cc.active = true
       GROUP BY cc.code, cc.max_members, cc.expires_at, cc.active, cc.created_at, u.name
       ORDER BY cc.created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── APK Download ─────────────────────────────────────────────────────────────
// Serve the Guardian Agent APK. Configure via env:
//   APK_FILE_PATH  — absolute path to a pre-built APK on the server
//   APK_REDIRECT_URL — URL to redirect to (e.g. a GitHub release asset)

router.get('/apk/download', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  // Option 1: redirect to an external URL (GitHub release, S3, etc.)
  if (process.env.APK_REDIRECT_URL) {
    return res.redirect(302, process.env.APK_REDIRECT_URL);
  }

  // Option 2: serve a local file
  const apkPath = process.env.APK_FILE_PATH
    || path.join(__dirname, '../../static/guardian-agent.apk');

  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({
      error: 'APK not yet built',
      message: 'The Guardian Agent APK must be compiled before it can be downloaded. Build it with: cd guardian-agent && ./gradlew assembleDebug',
      apk_path: apkPath,
      build_instructions: 'https://developer.android.com/studio',
    });
  }

  const stat = fs.statSync(apkPath);
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="FleetOps-Guardian.apk"');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(apkPath).pipe(res);
});

// ─── Batch Location Upload (Task 4.6) ────────────────────────────────────────

/**
 * POST /api/v1/guardian/location/batch
 * Upload multiple GPS points at once (offline-collected history).
 * Body: { points: [{lat, lng, altitude, heading, speed, accuracy, timestamp}] }
 * Max points controlled by guardian_config.batch_location_max_points (default 500).
 */
// Shared by /location/batch and the legacy /api/v1/telemetry/batch alias
// (older shipped Guardian app builds call that path with a differently
// shaped body — see routes/telemetry.js). Both normalize to this same
// {lat, lng, altitude, heading, speed, accuracy, timestamp} point shape
// before calling in.
async function processLocationBatch(deviceId, points) {
  const cfgRow = await query(
    `SELECT value_int FROM guardian_config WHERE key = 'batch_location_max_points'`
  );
  const maxPoints = cfgRow.rows[0]?.value_int ?? 500;
  if (points.length > maxPoints) {
    const err = new Error(`Too many points. Max allowed: ${maxPoints}`);
    err.statusCode = 400;
    throw err;
  }

  let accepted = 0;
  let lastLat = null;
  let lastLng = null;
  let lastSpeed = null;

  // Bulk insert using unnest for efficiency
  const lats      = [];
  const lngs      = [];
  const alts      = [];
  const headings  = [];
  const speeds    = [];
  const accuracies= [];
  const timestamps= [];

  for (const pt of points) {
    if (pt.lat == null || pt.lng == null) continue;
    lats.push(pt.lat);
    lngs.push(pt.lng);
    alts.push(pt.altitude ?? null);
    headings.push(pt.heading ?? null);
    speeds.push(pt.speed ?? null);
    accuracies.push(pt.accuracy ?? null);
    timestamps.push(pt.timestamp || null);
    lastLat = pt.lat;
    lastLng = pt.lng;
    lastSpeed = pt.speed ?? null;
    accepted++;
  }

  if (accepted === 0) {
    const err = new Error('No valid points (lat/lng required)');
    err.statusCode = 400;
    throw err;
  }

  await query(
    `INSERT INTO device_locations (device_id, lat, lng, altitude, heading, speed, accuracy, timestamp)
     SELECT $1, unnest($2::decimal[]), unnest($3::decimal[]),
            unnest($4::decimal[]), unnest($5::decimal[]),
            unnest($6::decimal[]), unnest($7::decimal[]),
            unnest($8::timestamptz[])`,
    [deviceId, lats, lngs, alts, headings, speeds, accuracies, timestamps]
  );

  // Update last known position to the last point in the batch
  if (lastLat != null) {
    await query(
      `UPDATE guardian_devices
       SET last_lat = $2, last_lng = $3, last_speed = $4, last_seen = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [deviceId, lastLat, lastLng, lastSpeed]
    );
  }

  logger.info(`Batch location: device=${deviceId} accepted=${accepted}/${points.length}`);
  return { accepted, total: points.length };
}

router.post('/location/batch', deviceAuth, async (req, res, next) => {
  try {
    const { points } = req.body;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: 'points must be a non-empty array' });
    }
    const result = await processLocationBatch(req.device.id, points);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
module.exports.deviceAuth = deviceAuth;
module.exports.processLocationBatch = processLocationBatch;
