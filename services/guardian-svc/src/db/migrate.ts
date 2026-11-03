import { pool } from '../db.js';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS guardian_devices (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id             TEXT NOT NULL UNIQUE,
        name                  TEXT,
        org_id                UUID,
        operator_code         TEXT NOT NULL,
        token_hash            TEXT,
        token_lookup_hash     TEXT UNIQUE,
        play_integrity_token  TEXT,
        integrity_verdict     JSONB,
        integrity_checked_at  TIMESTAMPTZ,
        fcm_token             TEXT,
        platform              TEXT NOT NULL DEFAULT 'android',
        app_version           TEXT,
        status                TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','enrolled','revoked','suspended')),
        assignment_type       TEXT NOT NULL DEFAULT 'unassigned',
        assignment_id         UUID,
        battery_pct           INT,
        last_lat              NUMERIC(10,7),
        last_lon              NUMERIC(10,7),
        last_heartbeat_at     TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at            TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS guardian_devices_token_lookup_hash_idx
        ON guardian_devices (token_lookup_hash) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS guardian_devices_org_id_idx
        ON guardian_devices (org_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS guardian_devices_status_idx
        ON guardian_devices (status) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS device_commands (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id     UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        command_type  TEXT NOT NULL
                      CHECK (command_type IN ('reboot','lock','wipe','photo','locate')),
        params        JSONB NOT NULL DEFAULT '{}',
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','acknowledged','completed','failed')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acked_at      TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS device_commands_device_id_pending_idx
        ON device_commands (device_id, created_at)
        WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS panic_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   UUID NOT NULL,
        org_id      UUID NOT NULL,
        lat         NUMERIC(10,7) NOT NULL,
        lon         NUMERIC(10,7) NOT NULL,
        driver_id   UUID,
        note        TEXT,
        event_uuid  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS panic_events_org_id_idx ON panic_events (org_id, created_at DESC);
    `);
    await client.query('COMMIT');
    process.stdout.write('guardian-svc migrations complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

migrate().catch((err: Error) => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
