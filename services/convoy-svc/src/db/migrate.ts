import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoys (
        id UUID PRIMARY KEY, org_id UUID NOT NULL, name TEXT NOT NULL,
        description TEXT, timezone TEXT NOT NULL DEFAULT 'UTC',
        start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
        seal_count_per_truck INT, notes TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS convoy_vehicles (convoy_id UUID NOT NULL, vehicle_id UUID NOT NULL, PRIMARY KEY (convoy_id, vehicle_id));
      CREATE TABLE IF NOT EXISTS convoy_drivers (convoy_id UUID NOT NULL, driver_id UUID NOT NULL, PRIMARY KEY (convoy_id, driver_id));
      CREATE TABLE IF NOT EXISTS convoy_cfos (convoy_id UUID NOT NULL, cfo_id UUID NOT NULL, pin_hash TEXT NOT NULL, PRIMARY KEY (convoy_id, cfo_id));
    `);
    await client.query('COMMIT');
    process.stdout.write('convoy-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
