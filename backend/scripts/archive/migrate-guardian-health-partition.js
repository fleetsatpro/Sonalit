/**
 * Guardian — Partition device_health by RANGE(recorded_at) monthly.
 *
 * Rationale: At 1 heartbeat/minute per device, 100 active devices = ~144k rows/day.
 * This exceeds the 10k/day threshold. Partitioning enables efficient GDPR retention
 * drops and keeps query plans lean.
 *
 * Mirrors the device_locations partitioning approach from p2t2.js.
 *
 * Rollback:
 *   The migration renames the existing table to device_health_legacy then swaps in the
 *   new partitioned table. If COMMIT succeeds, rollback requires:
 *     BEGIN;
 *     DROP TABLE device_health CASCADE;
 *     ALTER TABLE device_health_legacy RENAME TO device_health;
 *     COMMIT;
 *   Run this BEFORE step 5 (DROP TABLE device_health_legacy) completes.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Partitions: 2025-04 through 2026-12
const PARTITIONS = [];
for (let y = 2025; y <= 2026; y++) {
  const startM = (y === 2025) ? 4 : 1;
  const endM   = 12;
  for (let m = startM; m <= endM; m++) {
    const from = `${y}-${String(m).padStart(2,'0')}-01`;
    const toDate = m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`;
    PARTITIONS.push({
      name: `device_health_${y}_${String(m).padStart(2,'0')}`,
      from, to: toDate,
    });
  }
}
// Add 2027-01 as the upper fence
PARTITIONS.push({ name: 'device_health_2027_01', from: '2027-01-01', to: '2027-02-01' });

async function main() {
  const client = await pool.connect();
  try {
    console.log('Guardian health-partition: starting...');

    // Check if device_health is already partitioned
    const check = await client.query(
      `SELECT relkind FROM pg_class WHERE relname = 'device_health'`
    );
    if (check.rows[0]?.relkind === 'p') {
      console.log('device_health is already partitioned — running idempotent partition creation only.');
      for (const p of PARTITIONS) {
        const exists = await client.query(
          `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`, [p.name]
        );
        if (exists.rowCount > 0) { console.log(`  ${p.name} already exists, skip.`); continue; }
        await client.query(`
          CREATE TABLE ${p.name} PARTITION OF device_health
          FOR VALUES FROM ('${p.from}') TO ('${p.to}')
        `);
        console.log(`  Created ${p.name}`);
      }
      console.log('Done.');
      return;
    }

    await client.query('BEGIN');

    console.log('  Step 1: rename device_health -> device_health_legacy');
    await client.query(`ALTER TABLE device_health RENAME TO device_health_legacy`);

    console.log('  Step 2: create partitioned parent table');
    await client.query(`
      CREATE TABLE device_health (
        id               BIGSERIAL,
        device_id        UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
        battery_level    INT,
        battery_charging BOOLEAN,
        signal_strength  INT,
        network_type     TEXT,
        storage_free_mb  INT,
        ram_free_mb      INT,
        app_version      TEXT,
        recorded_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
      ) PARTITION BY RANGE (recorded_at)
    `);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS device_health_id_seq`);
    await client.query(
      `ALTER TABLE device_health ALTER COLUMN id SET DEFAULT nextval('device_health_id_seq')`
    );

    console.log('  Step 3: create monthly partitions...');
    for (const p of PARTITIONS) {
      await client.query(`
        CREATE TABLE ${p.name} PARTITION OF device_health
        FOR VALUES FROM ('${p.from}') TO ('${p.to}')
      `);
      console.log(`    ${p.name}`);
    }

    console.log('  Step 4: copy data from device_health_legacy');
    const copied = await client.query(
      `INSERT INTO device_health SELECT * FROM device_health_legacy`
    );
    console.log(`    Copied ${copied.rowCount} rows`);

    console.log('  Step 5: create index');
    await client.query(
      `CREATE INDEX idx_dh_device_ts ON device_health(device_id, recorded_at DESC)`
    );

    console.log('  Step 6: drop legacy table');
    await client.query(`DROP TABLE device_health_legacy`);

    await client.query('COMMIT');
    console.log('Guardian health-partition: complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Guardian health-partition: failed, rolled back.', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
