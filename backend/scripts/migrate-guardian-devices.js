/**
 * Guardian Devices — creates guardian_devices and all related tables.
 *
 * Must run BEFORE migrate-guardian-cfo-p1.js, which references guardian_devices
 * as a foreign key in convoy_cfos.
 *
 * All DDL uses IF NOT EXISTS — safe to re-run on every deploy.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[guardian-devices] Starting migration...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS guardian_devices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        name            TEXT NOT NULL,
        imei            TEXT,
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
    console.log('[guardian-devices] guardian_devices ok');

    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    // v2 columns
    await client.query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS convoy_code TEXT`);
    await client.query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS guardian_config (
        key         TEXT PRIMARY KEY,
        value_int   INT,
        value_text  TEXT,
        description TEXT,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('min_apk_version_code', 5,
              'Heartbeat rejects APKs below this versionCode with HTTP 426')
      ON CONFLICT (key) DO UPDATE
        SET value_int = GREATEST(guardian_config.value_int, EXCLUDED.value_int),
            updated_at = NOW()
    `);
    await client.query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('audit_log_archive_enabled', 0, 'Archive audit log rows to R2 before GDPR deletion (0=off,1=on)')
      ON CONFLICT (key) DO NOTHING
    `);
    await client.query(`
      INSERT INTO guardian_config (key, value_int, description) VALUES
        ('dms_default_interval_minutes', 60, 'Default dead-man switch interval in minutes'),
        ('dms_max_interval_minutes', 120, 'Maximum allowed DMS interval (hard ceiling)')
      ON CONFLICT (key) DO NOTHING
    `);
    await client.query(`
      UPDATE guardian_config SET value_int = 120, updated_at = NOW()
      WHERE key = 'dms_max_interval_minutes' AND value_int > 120
    `);
    console.log('[guardian-devices] guardian_config ok');

    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    // Extra columns added in later phases
    await client.query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS signature TEXT`);
    await client.query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_panic_events_event_uuid
        ON panic_events(event_uuid) WHERE event_uuid IS NOT NULL
    `);
    await client.query(`ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS event_uuid UUID`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_field_reports_event_uuid
        ON field_reports(event_uuid) WHERE event_uuid IS NOT NULL
    `);
    await client.query(`ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT`);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_locations_device_id ON device_locations(device_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_locations_timestamp ON device_locations(timestamp DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_health_device_id ON device_health(device_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_commands_device_status ON device_commands(device_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_panic_events_device_id ON panic_events(device_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_panic_events_resolved ON panic_events(resolved_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_field_reports_device_id ON field_reports(device_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON guardian_audit_log(actor_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON guardian_audit_log(target_type, target_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON guardian_audit_log(action, created_at DESC)`);

    console.log('[guardian-devices] Migration completed successfully');
  } catch (err) {
    console.error('[guardian-devices] Migration FAILED:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
