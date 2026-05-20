import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS guardian_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id TEXT NOT NULL UNIQUE,
        org_id UUID,
        operator_code TEXT NOT NULL,
        play_integrity_token TEXT,
        fcm_token TEXT,
        platform TEXT NOT NULL DEFAULT 'android',
        app_version TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        battery_pct INT,
        last_lat NUMERIC(10,7),
        last_lon NUMERIC(10,7),
        last_heartbeat_at TIMESTAMPTZ,
        integrity_verdict JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS device_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL,
        command_type TEXT NOT NULL,
        params JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acked_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS panic_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL,
        org_id UUID NOT NULL,
        lat NUMERIC(10,7) NOT NULL,
        lon NUMERIC(10,7) NOT NULL,
        driver_id UUID,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query('COMMIT');
    process.stdout.write('guardian-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
