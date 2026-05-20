import { pool } from '../db.js';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
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
               SUM(speed_kmh * 0.00833) AS distance_km
        FROM gps_fixes
        GROUP BY 1, 2, 3
      WITH NO DATA;
    `);

    await client.query('COMMIT');
    process.stdout.write('telemetry-ingest-svc migrations complete\n');
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
