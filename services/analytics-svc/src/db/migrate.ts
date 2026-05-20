import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT create_hypertable('gps_fixes','time', if_not_exists => TRUE)`);
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS gps_hourly
      WITH (timescaledb.continuous) AS
        SELECT time_bucket('1 hour', time) AS hour, device_id, org_id,
               COUNT(*) AS fix_count, AVG(speed_kmh) AS avg_speed
        FROM gps_fixes GROUP BY 1, 2, 3
      WITH NO DATA;
    `);
    await client.query('COMMIT');
    process.stdout.write('analytics-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
