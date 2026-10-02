const router = require('express').Router();
const { query, globalQuery } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireFreshIntegrity } = require('../middleware/requireFreshIntegrity');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { sendCommandPush, sendPanicAck } = require('../utils/fcm');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { publish } = require('../realtime/centrifugo');
const requireIdempotencyKey = require('../middleware/idempotency');
const { COMMAND_SIGNING_SECRET, signCommand } = require('../utils/commandSigning');
const captureVision = require('../utils/captureVision');
const { getOrgId } = require('../utils/tenantContext');
const { runWithOrgContext } = require('../utils/tenantContext');

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

const voiceMessageLimiter = rateLimit({
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
    const devRow = await globalQuery(`SELECT org_id FROM guardian_devices WHERE id = $1`, [deviceId]);
    orgId = devRow.rows[0]?.org_id ?? null;
    const offRow = await globalQuery(
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
    await globalQuery(`
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

    await globalQuery(`
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

    await globalQuery(`
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

    await globalQuery(`
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

    await globalQuery(`
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

    await globalQuery(`
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

    await globalQuery(`
      CREATE TABLE IF NOT EXISTS guardian_crash_reports (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id       UUID REFERENCES guardian_devices(id) ON DELETE CASCADE,
        org_id          UUID,
        app_version     TEXT,
        app_build       BIGINT,
        android_version TEXT,
        sdk_int         INT,
        device_model    TEXT,
        thread          TEXT,
        stack_trace     TEXT,
        occurred_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // v2 columns — safe to run repeatedly
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS org_id UUID`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS convoy_code TEXT`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS android_id TEXT`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS manufacturer TEXT`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS imei_hash TEXT`);
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT`).catch(() => {}); // also added below
    await globalQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_imei_hash
        ON guardian_devices(imei_hash)
        WHERE imei_hash IS NOT NULL AND deleted_at IS NULL
    `);
    await globalQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_android_id
        ON guardian_devices(android_id)
        WHERE android_id IS NOT NULL AND android_id <> 'unknown' AND deleted_at IS NULL
    `);

    // One-time cleanup: soft-delete PENDING records where an ACTIVE record exists
    // for the same name + model (catches duplicates created before hardware-ID dedup was added).
    await globalQuery(`
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
    await globalQuery(`
      CREATE TABLE IF NOT EXISTS guardian_config (
        key         TEXT PRIMARY KEY,
        value_int   INT,
        value_text  TEXT,
        description TEXT,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await globalQuery(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('min_apk_version_code', 5,
              'Heartbeat rejects APKs below this versionCode with HTTP 426')
      ON CONFLICT (key) DO UPDATE
        SET value_int = GREATEST(guardian_config.value_int, EXCLUDED.value_int),
            updated_at = NOW()
    `);

    // Remove deprecated flags replaced by unconditional enforcement (Task E)
    await globalQuery(`
      DELETE FROM guardian_config
      WHERE key IN ('command_signing_enabled', 'cert_pinning_enabled')
    `);

    // Audit log archive flag (default off — must be explicitly enabled)
    await globalQuery(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('audit_log_archive_enabled', 0, 'Archive audit log rows to R2 before GDPR deletion (0=off,1=on)')
      ON CONFLICT (key) DO NOTHING
    `);

    // Indexes for performance
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_device_locations_device_id ON device_locations(device_id)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_device_locations_timestamp ON device_locations(timestamp DESC)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_device_health_device_id ON device_health(device_id)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON device_commands(device_id, status)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_panic_events_device_id ON panic_events(device_id)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_panic_events_resolved ON panic_events(resolved_at)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_field_reports_device_id ON field_reports(device_id)`);

    // p2t5 — audit log table
    await globalQuery(`
      CREATE TABLE IF NOT EXISTS guardian_audit_log (
        id          BIGSERIAL PRIMARY KEY,
        org_id      UUID,
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
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON guardian_audit_log(actor_id, created_at DESC)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON guardian_audit_log(target_type, target_id, created_at DESC)`);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON guardian_audit_log(action, created_at DESC)`);

    // p3t1 — enrollment codes
    await globalQuery(`
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
    await globalQuery(`
      INSERT INTO guardian_config (key, value_int, description) VALUES
        ('dms_default_interval_minutes', 60, 'Default dead-man switch interval in minutes'),
        ('dms_max_interval_minutes', 120, 'Maximum allowed DMS interval (hard ceiling)')
      ON CONFLICT (key) DO NOTHING
    `);
    // Cap any existing dms_max_interval_minutes above the new 120-minute ceiling
    await globalQuery(`
      UPDATE guardian_config SET value_int = 120, updated_at = NOW()
      WHERE key = 'dms_max_interval_minutes' AND value_int > 120
    `);

    // p3t6 — convoy codes
    await globalQuery(`
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
    await globalQuery(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS signature TEXT`);

    // p1t3 — command delivery timestamps
    await globalQuery(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);

    // p2t3 — command expiry
    await globalQuery(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);

    // panic revamp — establish the tenant column before any index/policy can
    // reference it. This also repairs older databases where the table predates
    // tenant hardening.
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS org_id UUID`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS acknowledged_by UUID`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS resolution_note TEXT`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS reason_code TEXT`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS escalation_level INT DEFAULT 0`);
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ`);
    await globalQuery(`
      CREATE INDEX IF NOT EXISTS idx_panic_events_open_unacked
        ON panic_events(org_id, created_at)
        WHERE resolved_at IS NULL AND acknowledged_at IS NULL
    `);

    // p1t5 — idempotency UUIDs for panic events and field reports
    await globalQuery(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await globalQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_panic_events_event_uuid
        ON panic_events(event_uuid)
        WHERE event_uuid IS NOT NULL
    `);
    await globalQuery(`ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await globalQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_field_reports_event_uuid
        ON field_reports(event_uuid)
        WHERE event_uuid IS NOT NULL
    `);

    // p4t1 — FCM push token on device
    await globalQuery(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT`);

    // p5t1 — nonce column for command replay protection
    await globalQuery(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS nonce TEXT`);

    // p5t2 — nonce deduplication table (PRIMARY KEY enforces uniqueness per device)
    await globalQuery(`
      CREATE TABLE IF NOT EXISTS guardian_command_nonces (
        device_id UUID NOT NULL REFERENCES guardian_devices(id),
        org_id    UUID,
        nonce     TEXT NOT NULL,
        seen_at   TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (device_id, nonce)
      )
    `);

    // p5t3 — command lifecycle event log
    await globalQuery(`
      CREATE TABLE IF NOT EXISTS device_command_events (
        id         BIGSERIAL PRIMARY KEY,
        org_id     UUID,
        command_id UUID NOT NULL,
        status     TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await globalQuery(`CREATE INDEX IF NOT EXISTS idx_device_command_events_command ON device_command_events(command_id)`);

    await ensureGuardianTenantControlSecurity();
    logger.info('Guardian tables initialised');
  } catch (err) {
    logger.error(`Guardian ensureTables error: ${err.message}`);
  }
}

async function ensureGuardianTenantControlSecurity() {
  const tables = [
    'guardian_audit_log',
    'enrollment_codes',
    'convoy_codes',
    'guardian_command_nonces',
    'device_command_events',
  ];
  for (const table of tables) {
    await globalQuery('ALTER TABLE public.' + table + ' ENABLE ROW LEVEL SECURITY');
    if (table !== 'enrollment_codes' && table !== 'convoy_codes') {
      await globalQuery('ALTER TABLE public.' + table + ' FORCE ROW LEVEL SECURITY');
    }
    await globalQuery('DROP POLICY IF EXISTS guardian_tenant_isolation ON public.' + table);
    await globalQuery(
      "CREATE POLICY guardian_tenant_isolation ON public." + table +
      " USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)" +
      " WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)"
    );
    await globalQuery('GRANT SELECT, INSERT, UPDATE, DELETE ON public.' + table + ' TO sonalit_app');
  }
  await globalQuery('GRANT USAGE, SELECT ON SEQUENCE public.guardian_audit_log_id_seq TO sonalit_app');
  await globalQuery('GRANT USAGE, SELECT ON SEQUENCE public.device_command_events_id_seq TO sonalit_app');
}

// ─── Audit Log Helper ─────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit log insert. Never throws — errors are caught and logged.
 */
function auditLog(actor_type, actor_id, action, target_type, target_id, payload, ip, explicitOrgId = null) {
  const orgId = explicitOrgId || getOrgId();
  if (!orgId) return;
  query(
    `INSERT INTO guardian_audit_log
       (org_id, actor_type, actor_id, action, target_type, target_id, payload, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      orgId,
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
    const result = await globalQuery(
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

  // Purge replay-protection nonces past their 24h window. The
  // cleanup_command_nonces() function (migration 002) was defined but never
  // invoked, so guardian_command_nonces grew unbounded. Guarded separately so a
  // failure here never blocks command expiry above.
  try {
    await globalQuery('SELECT cleanup_command_nonces()');
  } catch (err) {
    logger.error(`Nonce cleanup job error: ${err.message}`);
  }
}

// ─── Dead Man's Switch Monitor ───────────────────────────────────────────────
// Server-authoritative DMS: a field officer's device sends periodic check-ins
// (POST /checkin); if a device with DMS enabled goes past its timeout without
// one, escalate to a silent SOS on its behalf. Doing this server-side (rather
// than on the device) is what makes it a real dead-man's switch — it still
// fires when the phone is destroyed, powered off, or out of signal, which is
// exactly when the officer most needs it and a device-side timer never could.
async function runDmsMonitorJob() {
  try {
    // Only devices that (a) have DMS on, (b) have actually checked in at least
    // once since it was enabled (last_checkin_at NULL = no baseline, never
    // fire blindly), (c) aren't temporarily suspended, and (d) are past their
    // window. A NULL dms_timeout_minutes yields NULL here and is skipped.
    const due = await globalQuery(
      `SELECT id, org_id, name, last_lat, last_lng
         FROM guardian_devices
        WHERE dms_enabled = true
          AND deleted_at IS NULL
          AND panic_active = false
          AND last_checkin_at IS NOT NULL
          AND (dms_suspended_until IS NULL OR dms_suspended_until < NOW())
          AND last_checkin_at < NOW() - (dms_timeout_minutes * INTERVAL '1 minute')`
    );

    for (const dev of due.rows) {
      // Claim the device atomically: flip dms_enabled off (operator re-enables
      // after resolving) and mark panic_active. The WHERE dms_enabled = true
      // guard means only one monitor tick can win, so we never double-fire.
      const claim = await globalQuery(
        `UPDATE guardian_devices
            SET dms_enabled = false, panic_active = true, updated_at = NOW()
          WHERE id = $1 AND dms_enabled = true
          RETURNING id`,
        [dev.id]
      );
      if (!claim.rows.length) continue;

      const eventUuid = uuidv4();
      const ins = await globalQuery(
        `INSERT INTO panic_events (event_uuid, device_id, org_id, mode, lat, lng, message, created_at)
         VALUES ($1, $2, $3, 'silent', $4, $5, $6, NOW())
         RETURNING id, created_at`,
        [eventUuid, dev.id, dev.org_id ?? null, dev.last_lat ?? null, dev.last_lng ?? null,
         "Dead Man's Switch: missed check-in"]
      );
      const row = ins.rows[0];

      // Same payload shape the POST /panic handler publishes, so the dashboard's
      // existing 'panic' realtime handler renders it identically.
      const payload = {
        type: 'panic',
        panic_id: row.id,
        event_uuid: eventUuid,
        device_id: dev.id,
        device_name: dev.name,
        mode: 'silent',
        lat: dev.last_lat ?? null,
        lng: dev.last_lng ?? null,
        message: "Dead Man's Switch: missed check-in",
        created_at: row.created_at,
        triggered_at: row.created_at,
      };
      if (!dev.org_id) { logger.error(`DMS timeout skipped: device=${dev.id} has no tenant scope`); continue; }
      publish(`org#${dev.org_id}`, payload);
      logger.warn(`DMS timeout PANIC: device=${dev.id} name="${dev.name}" org=${dev.org_id ?? 'unknown'}`);
      // Queue a burst too — a missed check-in is exactly when eyes on the scene
      // matter most. No fcm_token on this partial row, so it rides the device's
      // next heartbeat/poll claim (6h TTL covers a late reconnect).
      autoBurstOnPanic(dev, dev.org_id ?? null).catch(e => logger.warn(`autoBurstOnPanic (DMS) error: ${e.message}`));
    }
  } catch (err) {
    logger.error(`DMS monitor job error: ${err.message}`);
  }
}

// ─── Panic Escalation Background Job ─────────────────────────────────────────

// Minutes an unacknowledged panic waits before each escalation tier fires.
// Tier 1 fires at ESCALATION_MINUTES, tier 2 at 2x, tier 3 at 3x — then stops.
const ESCALATION_MINUTES = parseInt(process.env.PANIC_ESCALATION_MINUTES) || 3;
const MAX_ESCALATION_LEVEL = 3;

async function runPanicEscalationJob() {
  try {
    const due = await globalQuery(
      `SELECT pe.id, pe.org_id, pe.device_id, pe.mode, pe.escalation_level, pe.created_at,
              gd.name AS device_name
       FROM panic_events pe
       JOIN guardian_devices gd ON gd.id = pe.device_id
       WHERE pe.resolved_at IS NULL
         AND pe.acknowledged_at IS NULL
         AND pe.org_id IS NOT NULL
         AND pe.escalation_level < $1
         AND pe.created_at < NOW() - ((pe.escalation_level + 1) * $2 || ' minutes')::INTERVAL
       ORDER BY pe.created_at ASC
       LIMIT 100`,
      [MAX_ESCALATION_LEVEL, ESCALATION_MINUTES]
    );

    for (const row of due.rows) {
      const nextLevel = row.escalation_level + 1;
      await globalQuery(
        `UPDATE panic_events SET escalation_level = $2, escalated_at = NOW() WHERE id = $1`,
        [row.id, nextLevel]
      );

      publish(`org#${row.org_id}`, {
        type: 'panic_escalated',
        panic_id: row.id,
        device_id: row.device_id,
        device_name: row.device_name,
        mode: row.mode,
        escalation_level: nextLevel,
        escalated_at: new Date().toISOString(),
      });

      auditLog('system', null, 'panic_escalated', 'panic_event', row.id, { escalation_level: nextLevel }, null, row.org_id);
      logger.warn(`PANIC escalated: id=${row.id} device=${row.device_name} level=${nextLevel}`);

      // Notify org admins/dispatchers with a phone number on file, fire-and-forget.
      try {
        const contacts = await globalQuery(
          `SELECT phone FROM users WHERE org_id = $1 AND role IN ('admin', 'dispatcher') AND phone IS NOT NULL`,
          [row.org_id]
        );
        const minutesOpen = Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000);
        const text = `⚠️ PANIC unacknowledged ${minutesOpen}m — ${row.device_name} (${row.mode}). Escalation level ${nextLevel}. Open Panic Center now.`;
        for (const c of contacts.rows) {
          sendWhatsAppMessage(row.org_id, c.phone, text).catch(() => {});
        }
      } catch (notifyErr) {
        logger.error(`panic escalation notify error: ${notifyErr.message}`);
      }
    }
  } catch (err) {
    logger.error(`Panic escalation job error: ${err.message}`);
  }
}

// Run immediately on module load
ensureTables().then(() => {
  // Start command expiry job after tables are ready
  runCommandExpiryJob();
  setInterval(runCommandExpiryJob, 10 * 60 * 1000); // every 10 minutes

  // Start panic escalation job — checks every minute for unacknowledged panics
  runPanicEscalationJob();
  setInterval(runPanicEscalationJob, 60 * 1000);

  runDmsMonitorJob();
  setInterval(runDmsMonitorJob, 2 * 60 * 1000); // every 2 minutes
});

// ─── Device Auth Middleware ───────────────────────────────────────────────────

async function deviceAuth(req, res, next) {
  try {
    const token = req.headers['x-device-token'];
    if (!token) {
      return res.status(401).json({ error: 'Missing X-Device-Token header' });
    }

    const result = await globalQuery(
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

    if (!device.org_id) {
      return res.status(403).json({ error: 'device_tenant_scope_required' });
    }

    req.device = device;
    return runWithOrgContext(device.org_id, next);
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
  const orgId = officer.org_id;
  if (!orgId) throw new Error('officer_tenant_scope_required');
  const device = await globalQuery(
    'SELECT id, org_id FROM guardian_devices WHERE id=$1 AND deleted_at IS NULL',
    [deviceId],
  );
  if (!device.rows.length || !device.rows[0].org_id || String(device.rows[0].org_id) !== String(orgId)) {
    throw new Error('device_tenant_mismatch');
  }

  if (officer.device_id && officer.device_id !== deviceId) {
    await globalQuery(
      `UPDATE guardian_devices
          SET status = 'revoked', deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [officer.device_id, orgId],
    );
    logger.info(`Retired stale device ${officer.device_id} for officer ${officer.id} (now ${deviceId}) org=${orgId}`);
  }
  if (officer.device_id !== deviceId) {
    await globalQuery(
      `UPDATE field_officers SET device_id = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3`,
      [deviceId, officer.id, orgId],
    );
  }
}

/**
 * POST /api/v1/guardian/recover
 * Silent identity recovery: the app lost its stored credentials (fresh
 * reinstall, cleared data, logout) but the hardware is already registered.
 * The app calls this on launch with its ANDROID_ID before ever showing the
 * enrollment screen — a known device gets its identity back with no badge
 * typing and no operator involvement, so enrollment is a first-time-only
 * event. Trust level is identical to the enroll dedup fast path, which has
 * always returned the token for a matching android_id.
 */
router.post('/recover', enrollLimiter, async (req, res, next) => {
  try {
    const { device_id, operator_code } = req.body || {};
    if (!device_id || typeof device_id !== 'string') {
      return res.status(400).json({ error: 'device_id is required' });
    }
    if (!operator_code || typeof operator_code !== 'string') {
      return res.status(400).json({ error: 'operator_code is required for recovery' });
    }

    // Android ID is not a secret. It is therefore never sufficient to recover
    // a device token on its own. The operator badge provides the tenant context,
    // and the device must currently belong to that exact officer.
    const officerResult = await globalQuery(
      `SELECT id, org_id, device_id
         FROM field_officers
        WHERE badge_number = $1
        LIMIT 1`,
      [operator_code.trim()],
    );
    const officer = officerResult.rows[0];
    if (!officer?.org_id || !officer.device_id) {
      return res.status(404).json({ error: 'unknown_device' });
    }

    const result = await globalQuery(
      `SELECT id, token, status, org_id, enrolled_at
         FROM guardian_devices
        WHERE id = $1
          AND android_id = $2
          AND org_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [officer.device_id, device_id, officer.org_id],
    );
    const dev = result.rows[0];
    if (!dev) return res.status(404).json({ error: 'unknown_device' });
    if (dev.status === 'revoked' || dev.status === 'suspended') {
      return res.status(403).json({ error: `Device is ${dev.status}` });
    }

    const mappedStatus = (dev.status === 'active' || dev.status === 'enrolled') ? 'enrolled' : dev.status;
    runWithOrgContext(dev.org_id, () => {
      auditLog('device', dev.id, 'identity_recovered', 'device', dev.id, {}, req.ip);
    });
    res.json({
      status: mappedStatus,
      device_uuid: dev.id,
      device_token: dev.token,
      org_id: dev.org_id,
      officer_id: officer.id,
      command_signing_secret: COMMAND_SIGNING_SECRET,
    });
  } catch (err) {
    next(err);
  }
});

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
      const officerRes = await globalQuery(
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
      const existing = await globalQuery(
        `SELECT id, token, status, org_id FROM guardian_devices
         WHERE android_id = $1 AND org_id = $2 AND deleted_at IS NULL
         ORDER BY enrolled_at DESC LIMIT 1`,
        [device_id, orgId]
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

      // No android_id match, but the badge's officer already has a linked
      // live device — this is almost always the SAME phone re-enrolling
      // (fresh install wiped its stored credentials, or the row predates
      // android_id tracking). Adopt that row — backfill android_id, hand its
      // token back — instead of forking a new row and retiring the old one,
      // which silently discarded the device's entire position history and
      // flipped the officer to "NO FIX YET" until the fork caught up.
      if (officerRes.rows[0].device_id) {
        const adopt = await globalQuery(
          `UPDATE guardian_devices
              SET android_id = $2,
                  fcm_token = COALESCE($3, fcm_token),
                  app_version = COALESCE($4, app_version),
                  updated_at = NOW()
            WHERE id = $1 AND org_id = $5 AND deleted_at IS NULL
            RETURNING id, token, status, org_id`,
          [officerRes.rows[0].device_id, device_id, fcm_token ?? null, app_version ?? null, orgId]
        );
        if (adopt.rows[0]) {
          const dev = adopt.rows[0];
          const mappedStatus = (dev.status === 'active' || dev.status === 'enrolled') ? 'enrolled' : dev.status;
          auditLog('device', dev.id, 'v4_enroll_adopted', 'device', dev.id, { operator_code, platform }, req.ip);
          return res.json({
            status: mappedStatus,
            device_uuid: dev.id,
            device_token: dev.token,
            org_id: orgId,
            officer_id: officerRes.rows[0].id,
            command_signing_secret: COMMAND_SIGNING_SECRET,
          });
        }
      }

      // New enrollment — omit org_id when null so the column DEFAULT fires
      // rather than explicitly passing NULL against a NOT NULL constraint.
      const enrollParams = [operator_code, device_id, fcm_token ?? null, app_version ?? null];
      if (!orgId) {
        return res.status(403).json({ error: 'operator_code_tenant_scope_missing' });
      }
      const enrollSql = `INSERT INTO guardian_devices (name, android_id, fcm_token, app_version, org_id, status)
           VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id, token, org_id`;
      enrollParams.push(orgId);
      const { rows } = await globalQuery(enrollSql, enrollParams);

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

    if (!enrollment_code || typeof enrollment_code !== 'string' || !enrollment_code.trim()) {
      return res.status(400).json({ error: 'enrollment_code is required for tenant-scoped enrollment' });
    }

    const codeClaim = await globalQuery(
      `UPDATE enrollment_codes
          SET used_at = NOW()
        WHERE code = $1
          AND used_at IS NULL
          AND expires_at > NOW()
          AND org_id IS NOT NULL
        RETURNING id, org_id`,
      [enrollment_code.trim().toUpperCase()],
    );
    if (!codeClaim.rows.length) {
      return res.status(403).json({ error: 'Invalid or expired enrollment code' });
    }
    const orgId = codeClaim.rows[0].org_id;

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
      const r = await globalQuery(
        `SELECT id, token, status, enrolled_at FROM guardian_devices
         WHERE deleted_at IS NULL
           AND org_id = $3
           AND (
             ($1::TEXT IS NOT NULL AND imei_hash = $1)
             OR ($2::TEXT IS NOT NULL AND android_id = $2)
           )
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, enrolled_at DESC
         LIMIT 1`,
        [safeImei, safeAndroidId, orgId]
      );
      if (r.rows.length) existingDev = r.rows[0];
    }

    // Legacy fallback: records enrolled before android_id tracking have both hardware IDs null,
    // OR when a device reports unknown hardware IDs. Match by name + model.
    if (!existingDev) {
      const r = await globalQuery(
        `SELECT id, token, status, enrolled_at FROM guardian_devices
         WHERE deleted_at IS NULL AND org_id = $3 AND android_id IS NULL AND imei IS NULL
           AND name = $1 AND (model = $2 OR $2 IS NULL)
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, enrolled_at DESC
         LIMIT 1`,
        [name, model || null, orgId]
      );
      if (r.rows.length) {
        existingDev = r.rows[0];
        // Backfill hardware IDs so the fast path works on every subsequent enrollment
        await globalQuery(
          `UPDATE guardian_devices SET android_id = $1, imei_hash = $2, manufacturer = $3 WHERE id = $4 AND org_id = $5`,
          [safeAndroidId, safeImei, manufacturer || null, existingDev.id, orgId]
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
      await globalQuery(
        `UPDATE guardian_devices
         SET name = $1, os_version = $2, app_version = $3,
             manufacturer = $4, model = $5, updated_at = NOW()
         WHERE id = $6 AND org_id = $7`,
        [name, os_version || null, app_version || null, manufacturer || null, model || null, dev.id, orgId]
      );
      // Soft-delete any other PENDING records for the same physical device
      await globalQuery(
        `UPDATE guardian_devices SET deleted_at = NOW()
         WHERE id <> $1 AND org_id = $6 AND status = 'pending' AND deleted_at IS NULL
           AND (
             ($2::TEXT IS NOT NULL AND imei_hash = $2)
             OR ($3::TEXT IS NOT NULL AND android_id = $3)
             OR (android_id IS NULL AND imei_hash IS NULL AND name = $4
                 AND (model = $5 OR $5 IS NULL))
           )`,
        [dev.id, safeImei, safeAndroidId, name, model || null, orgId]
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

    const result = await globalQuery(
      `INSERT INTO guardian_devices
         (org_id, name, imei_hash, android_id, manufacturer, model, os_version, app_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING id, token, enrolled_at, org_id`,
      [orgId, name, safeImei, safeAndroidId, manufacturer || null, model || null, os_version || null, app_version || null]
    );

    const device = result.rows[0];

    logger.info(`Guardian device enrolled: ${device.id} name="${name}"`);
    auditLog('device', null, 'enroll', 'device', device.id, { name, android_id }, req.ip, orgId);

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
             last_lat = $2, last_lng = $3, last_speed = $4,
             last_fix_at = NOW(), updated_at = NOW()
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
        query(`INSERT INTO device_command_events (org_id, command_id, status)
         SELECT org_id, id, 'delivered' FROM device_commands WHERE id = $1`, [cmd.id]).catch(() => {});
      }
    }

    res.json({
      status: 'ok',
      server_time: Date.now(),
      commands: commands.rows.map(serializeCommandPayload),
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
    res.json({ commands: commands.rows.map(serializeCommandPayload) });
  } catch (err) {
    next(err);
  }
});

/**
 * The app treats a command's payload as an opaque string and parses it as
 * JSON itself (see CommandExecutor). When these endpoints returned the jsonb
 * payload as a nested OBJECT, the Kotlin client stringified it with
 * Map.toString() — "{url=https://...}" — whose unquoted values truncate at
 * ':' under lenient JSON parsing, so play_voice_message's URL parsed as
 * literally "https" and every voice command acked 'failed'. Plain-word
 * show_message texts survived by luck. Serialize payload to a JSON string
 * here — the same shape the FCM push path has always used — so all delivery
 * paths hand the app identical bytes.
 */
function serializeCommandPayload(cmd) {
  return {
    ...cmd,
    payload: cmd.payload == null
      ? null
      : (typeof cmd.payload === 'string' ? cmd.payload : JSON.stringify(cmd.payload)),
  };
}

/**
 * GET /api/v1/guardian/voice-messages/:id/audio
 * Audio bytes for a play_voice_message command. Device-token authenticated
 * and scoped to the requesting device, so a leaked URL is useless without
 * that device's token.
 */
router.get('/voice-messages/:id/audio', deviceAuth, async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid voice message id' });
    }
    const result = await query(
      `SELECT mime, audio FROM guardian_voice_messages WHERE id = $1 AND device_id = $2`,
      [req.params.id, req.device.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Voice message not found' });
    res.set('Content-Type', row.mime || 'audio/webm');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(row.audio);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/guardian/voice-message
 * Reverse direction of the route above: a field officer records a note and
 * sends it up to dispatch. Body is raw audio bytes (audio/*, ≤2 MB, same
 * cap as the dispatch->device route), stored with direction='from_device'
 * so GET /guardian/devices/:id/voice-messages (guardian-ops.js) can list
 * only these for the operator UI. No signed command/FCM push needed here —
 * dispatch is the web dashboard, which gets the update over the org's
 * existing Centrifugo channel instead of a device-command round-trip.
 */
router.post(
  '/voice-message',
  deviceAuth,
  voiceMessageLimiter,
  require('express').raw({ type: ['audio/*'], limit: '2mb' }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Request body must be raw audio bytes with an audio/* content type' });
      }
      const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
      const durationMs = parseInt(req.query.duration_ms) || null;
      const orgId = req.device.org_id || null;

      // Exact location of the note. Prefer the device's live GPS at record time
      // (sent as ?lat=&lng=), fall back to its last known position so the map
      // still zooms to a real place even on an older client. A fresh fix also
      // refreshes the device's stored position so its marker is accurate too.
      const qLat = parseFloat(req.query.lat), qLng = parseFloat(req.query.lng);
      const hasFix = Number.isFinite(qLat) && Number.isFinite(qLng) && Math.abs(qLat) <= 90 && Math.abs(qLng) <= 180;
      const lat = hasFix ? qLat : (req.device.last_lat != null ? parseFloat(req.device.last_lat) : null);
      const lng = hasFix ? qLng : (req.device.last_lng != null ? parseFloat(req.device.last_lng) : null);

      const { rows } = await query(
        `INSERT INTO guardian_voice_messages (org_id, device_id, mime, duration_ms, audio, direction, lat, lng)
         VALUES ($1, $2, $3, $4, $5, 'from_device', $6, $7)
         RETURNING id, created_at`,
        [orgId, req.device.id, mime, durationMs, req.body, lat, lng]
      );
      const voice = rows[0];

      if (hasFix) {
        await query(
          `UPDATE guardian_devices SET last_lat = $2, last_lng = $3, last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
          [req.device.id, qLat, qLng]
        ).catch(e => logger.warn(`voice-message position update failed: ${e.message}`));
      }

      if (orgId) {
        publish(`org#${orgId}`, {
          type: 'guardian_voice_message',
          device_id: req.device.id,
          device_name: req.device.name,
          voice_id: voice.id,
          duration_ms: durationMs,
          created_at: voice.created_at,
          lat, lng,
        }).catch(e => logger.warn(`Centrifugo publish failed: ${e.message}`));
      }

      logger.info(`Voice note received: device=${req.device.id} voice=${voice.id} bytes=${req.body.length}`);
      res.status(201).json({ data: { voice_id: voice.id, status: 'received' } });
    } catch (err) {
      next(err);
    }
  }
);

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
           last_seen = NOW(), last_fix_at = NOW(), updated_at = NOW()
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

// Auto-burst on panic: the instant an SOS fires, silently capture imagery from
// both lenses so dispatch has a located photo of the scene the moment the alert
// lands — no operator action, no waiting. Reuses the standard capture_photo
// pipeline (signed command → FCM push + heartbeat/poll claim → covert capture →
// R2 upload → located pin in Surveillance). Fire-and-forget: a failure here must
// never delay or break the panic response, so every step is guarded.
const PANIC_BURST_LENSES = ['back', 'front'];
async function autoBurstOnPanic(device, orgId) {
  const ttl = 6;
  for (const camera of PANIC_BURST_LENSES) {
    try {
      const payload = { camera, reason: 'panic' };
      // ttl bound twice ($5/$6): the same placeholder inferred as both the
      // integer ttl_hours column and the double-precision interval multiplier
      // makes Postgres reject the query — see guardian-ops.js for the full note.
      const { rows } = await query(
        `INSERT INTO device_commands (org_id, device_id, command, command_type, status, payload, ttl_hours, issued_by, issued_at, expires_at)
         VALUES ($1, $2, $3, $3, 'pending', $4, $5, NULL, NOW(), NOW() + ($6 * INTERVAL '1 hour'))
         RETURNING id, issued_at, expires_at`,
        [orgId, device.id, 'capture_photo', JSON.stringify(payload), ttl, ttl]
      );
      const cmd = rows[0];
      // Signature is what makes the heartbeat/poll claim (WHERE signature IS NOT
      // NULL) deliver it; without this the burst would only ever reach the device
      // via the FCM push below.
      const signature = signCommand(cmd.id, 'capture_photo', payload, cmd.issued_at, cmd.expires_at);
      await query(`UPDATE device_commands SET signature = $1 WHERE id = $2`, [signature, cmd.id]);
      if (orgId) {
        publish(`org#${orgId}`, { type: 'command:queued', device_id: device.id, command: 'capture_photo', command_id: cmd.id }).catch(() => {});
      }
      if (device.fcm_token) {
        sendCommandPush(device.fcm_token, 'capture_photo', cmd.id, payload).catch(() => {});
      }
    } catch (e) {
      logger.warn(`autoBurstOnPanic failed: device=${device.id} camera=${camera}: ${e.message}`);
    }
  }
}

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
      if (!orgId) {
        logger.error(`PANIC publish blocked: device=${deviceId} has no tenant scope`);
      } else {
        publish(`org#${orgId}`, panicPublishPayload);
      }
      logger.warn(`PANIC triggered: device=${deviceId} name="${req.device.name}" mode=${mode} org=${orgId ?? 'unknown'}`);
      // FCM ack to device confirming SOS was received (Task 4.1, fire-and-forget)
      if (req.device.fcm_token) {
        sendPanicAck(req.device.fcm_token, panicEvent.id).catch(() => {});
      }
      // Auto-burst: get eyes on the scene the instant the SOS lands. Detached so
      // it never delays the panic response.
      autoBurstOnPanic(req.device, orgId).catch(e => logger.warn(`autoBurstOnPanic error: ${e.message}`));
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
    query(`INSERT INTO device_command_events (org_id, command_id, status)
         SELECT org_id, id, $2 FROM device_commands WHERE id = $1`, [command_id, evtStatus]).catch(() => {});

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
    if (!req.device.org_id) {
      logger.error(`PANIC cancel publish blocked: device=${deviceId} has no tenant scope`);
    } else {
      publish(`org#${req.device.org_id}`, cancelPayload);
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