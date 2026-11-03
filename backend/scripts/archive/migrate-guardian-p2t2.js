/**
 * Guardian Phase 2 Task 2 — Partition device_locations by month
 *
 * Rollback path:
 *   Steps 1-5 run inside a single transaction; if anything fails before COMMIT
 *   the transaction is rolled back automatically and device_locations_legacy
 *   is left intact.
 *
 *   After step 6 (DROP TABLE device_locations_legacy), the only recovery path
 *   is to restore device_locations_legacy from a pre-migration backup, rename
 *   it back to device_locations, and drop the partitioned table.
 *
 *   Manual rollback (if legacy table still exists):
 *     BEGIN;
 *     DROP TABLE IF EXISTS device_locations CASCADE;
 *     ALTER TABLE device_locations_legacy RENAME TO device_locations;
 *     COMMIT;
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Guardian p2t2: starting device_locations partitioning migration...');

    await client.query('BEGIN');

    // Step 1: rename existing table to legacy
    console.log('  Step 1: renaming device_locations -> device_locations_legacy...');
    await client.query(`ALTER TABLE device_locations RENAME TO device_locations_legacy`);

    // Step 2: create new partitioned parent table (no PRIMARY KEY on parent —
    // PostgreSQL 10+ requires the partition key to be part of the PK, but BIGSERIAL
    // id is not the partition key (timestamp is), so we omit the PK constraint here)
    console.log('  Step 2: creating partitioned parent table...');
    await client.query(`
      CREATE TABLE device_locations (
        id        BIGSERIAL,
        device_id UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        lat       DECIMAL(10,7) NOT NULL,
        lng       DECIMAL(10,7) NOT NULL,
        altitude  DECIMAL(8,2),
        heading   DECIMAL(6,2),
        speed     DECIMAL(6,2),
        accuracy  DECIMAL(8,2),
        timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
      ) PARTITION BY RANGE (timestamp)
    `);

    // Wire up the BIGSERIAL sequence explicitly (the parent table's BIGSERIAL
    // creates a sequence; we just confirm the default is set)
    await client.query(`CREATE SEQUENCE IF NOT EXISTS device_locations_id_seq`);
    await client.query(
      `ALTER TABLE device_locations ALTER COLUMN id SET DEFAULT nextval('device_locations_id_seq')`
    );

    // Step 3: create 4 monthly partitions covering 2025-04 through 2025-07
    // (covers the expected deployment window ± 2 months from 2025-05)
    console.log('  Step 3: creating monthly partitions (2025-04 through 2025-07)...');

    const partitions = [
      { name: 'device_locations_2025_04', from: '2025-04-01', to: '2025-05-01' },
      { name: 'device_locations_2025_05', from: '2025-05-01', to: '2025-06-01' },
      { name: 'device_locations_2025_06', from: '2025-06-01', to: '2025-07-01' },
      { name: 'device_locations_2025_07', from: '2025-07-01', to: '2025-08-01' },
    ];

    for (const p of partitions) {
      await client.query(`
        CREATE TABLE ${p.name}
          PARTITION OF device_locations
          FOR VALUES FROM ('${p.from}') TO ('${p.to}')
      `);
      console.log(`    Partition ${p.name} created`);
    }

    // Step 4: copy data from legacy table
    console.log('  Step 4: copying data from device_locations_legacy...');
    const copied = await client.query(
      `INSERT INTO device_locations SELECT * FROM device_locations_legacy`
    );
    console.log(`    Copied ${copied.rowCount} rows`);

    // Step 5: create index on new partitioned table
    console.log('  Step 5: creating index idx_dl_device_ts...');
    await client.query(
      `CREATE INDEX idx_dl_device_ts ON device_locations(device_id, timestamp DESC)`
    );

    // Step 6: drop legacy table
    console.log('  Step 6: dropping device_locations_legacy...');
    await client.query(`DROP TABLE device_locations_legacy`);

    await client.query('COMMIT');
    console.log('Guardian p2t2: migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Guardian p2t2: migration failed, rolled back.', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
