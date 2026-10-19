import { pool } from '../db.js';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  let migrationLockAcquired = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('sonalit_telemetry_ingest_migrations'))");
    migrationLockAcquired = true;
    await client.query('SET search_path TO public');
    await client.query('BEGIN');

    // Create gps_fixes table before converting to hypertable.
    await client.query(`
      CREATE TABLE IF NOT EXISTS gps_fixes (
        time        TIMESTAMPTZ NOT NULL,
        device_id   UUID        NOT NULL,
        org_id      UUID        NOT NULL,
        lat         DOUBLE PRECISION NOT NULL,
        lon         DOUBLE PRECISION NOT NULL,
        alt_m       REAL,
        accuracy_m  REAL,
        speed_kmh   REAL,
        heading_deg REAL,
        hdop        REAL,
        satellites  SMALLINT,
        seq_no      BIGINT NOT NULL
      );
    `);

    // Idempotent hypertable creation (1h chunks for 100k RPS write throughput).
    await client.query(`
      SELECT create_hypertable('gps_fixes', 'time',
        chunk_time_interval => INTERVAL '1 hour',
        if_not_exists => TRUE);
    `);

    // Replay-safe identity. Timescale unique indexes on a hypertable must include its time partition key.
    // This fails closed if existing duplicates exist; reconcile them without discarding raw evidence.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS gps_fixes_device_seq_time_uidx
        ON gps_fixes (device_id, seq_no, time);
    `);

    // Index for per-device lookups (most common query pattern).
    await client.query(`
      CREATE INDEX IF NOT EXISTS gps_fixes_device_time_idx
        ON gps_fixes (device_id, time DESC);
    `);

    // Index for org-scoped analytics queries.
    await client.query(`
      CREATE INDEX IF NOT EXISTS gps_fixes_org_time_idx
        ON gps_fixes (org_id, time DESC);
    `);

    // Continuous aggregate: 1-minute resolution bucketed data for real-time dashboards.
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS gps_fixes_1min
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket('1 minute', time) AS bucket,
               device_id,
               org_id,
               COUNT(*)            AS fix_count,
               AVG(speed_kmh)      AS avg_speed_kmh,
               AVG(lat)            AS avg_lat,
               AVG(lon)            AS avg_lon
        FROM gps_fixes
        GROUP BY 1, 2, 3
      WITH NO DATA;
    `);

    // Continuous aggregate: 1-hour resolution for analytics service.
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS gps_fixes_1h
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket('1 hour', time) AS bucket,
               device_id,
               org_id,
               COUNT(*)            AS fix_count,
               AVG(speed_kmh)      AS avg_speed_kmh,
               -- Speed multiplied by a fixed interval invents distance when fix cadence varies.
               -- Keep this legacy aggregate field unavailable; analytics-svc derives distance
               -- from consecutive GPS coordinates with explicit gap/outlier checks.
               NULL::double precision AS distance_km
        FROM gps_fixes
        GROUP BY 1, 2, 3
      WITH NO DATA;
    `);

    await client.query(`
      ALTER TABLE gps_fixes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE gps_fixes FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_service ON gps_fixes;
      CREATE POLICY tenant_isolation_service ON gps_fixes AS RESTRICTIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
      DROP POLICY IF EXISTS tenant_base_service ON gps_fixes;
      CREATE POLICY tenant_base_service ON gps_fixes AS PERMISSIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    `);
    // Raw fixes and their event publication intent are committed together by the ingest handler.
    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry_ingest_outbox (
        id BIGSERIAL PRIMARY KEY,
        org_id UUID NOT NULL,
        device_id UUID NOT NULL,
        seq_no BIGINT NOT NULL,
        time TIMESTAMPTZ NOT NULL,
        subject TEXT NOT NULL,
        payload JSONB NOT NULL,
        message_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT,
        CONSTRAINT telemetry_ingest_outbox_identity UNIQUE (device_id, seq_no, time)
      );
      CREATE INDEX IF NOT EXISTS telemetry_ingest_outbox_pending_idx
        ON telemetry_ingest_outbox (next_attempt_at, id);
      ALTER TABLE telemetry_ingest_outbox ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS telemetry_ingest_outbox_org_isolation ON telemetry_ingest_outbox;
      DROP POLICY IF EXISTS telemetry_ingest_outbox_tenant_hardening ON telemetry_ingest_outbox;
      CREATE POLICY telemetry_ingest_outbox_org_isolation ON telemetry_ingest_outbox AS PERMISSIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
      CREATE POLICY telemetry_ingest_outbox_tenant_hardening ON telemetry_ingest_outbox AS RESTRICTIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
      GRANT SELECT, INSERT ON gps_fixes TO sonalit_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON telemetry_ingest_outbox TO sonalit_app;
      GRANT USAGE, SELECT ON SEQUENCE public.telemetry_ingest_outbox_id_seq TO sonalit_app;
    `);
    await client.query('COMMIT');
    process.stdout.write('telemetry-ingest-svc migrations complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    if (migrationLockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('sonalit_telemetry_ingest_migrations'))");
      } catch (unlockErr) {
        process.stderr.write(`Could not release telemetry migration lock: ${(unlockErr as Error).message}\\n`);
      }
    }
    client.release();
  }
}

