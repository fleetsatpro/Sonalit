/**
 * Guardian Phase 2 Task 2b — Add missing monthly partitions for device_locations
 *
 * p2t2 only created partitions for 2025-04 through 2025-07.
 * This script adds partitions from 2025-08 through 2026-12 so that
 * location inserts succeed for the current date range (2026+).
 *
 * Idempotent: uses IF NOT EXISTS on each partition.
 *
 * Rollback: DROP the individual partition tables. Any rows in them will be lost,
 * so take a backup before running in production if rollback may be needed.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PARTITIONS = [
  { name: 'device_locations_2025_08', from: '2025-08-01', to: '2025-09-01' },
  { name: 'device_locations_2025_09', from: '2025-09-01', to: '2025-10-01' },
  { name: 'device_locations_2025_10', from: '2025-10-01', to: '2025-11-01' },
  { name: 'device_locations_2025_11', from: '2025-11-01', to: '2025-12-01' },
  { name: 'device_locations_2025_12', from: '2025-12-01', to: '2026-01-01' },
  { name: 'device_locations_2026_01', from: '2026-01-01', to: '2026-02-01' },
  { name: 'device_locations_2026_02', from: '2026-02-01', to: '2026-03-01' },
  { name: 'device_locations_2026_03', from: '2026-03-01', to: '2026-04-01' },
  { name: 'device_locations_2026_04', from: '2026-04-01', to: '2026-05-01' },
  { name: 'device_locations_2026_05', from: '2026-05-01', to: '2026-06-01' },
  { name: 'device_locations_2026_06', from: '2026-06-01', to: '2026-07-01' },
  { name: 'device_locations_2026_07', from: '2026-07-01', to: '2026-08-01' },
  { name: 'device_locations_2026_08', from: '2026-08-01', to: '2026-09-01' },
  { name: 'device_locations_2026_09', from: '2026-09-01', to: '2026-10-01' },
  { name: 'device_locations_2026_10', from: '2026-10-01', to: '2026-11-01' },
  { name: 'device_locations_2026_11', from: '2026-11-01', to: '2026-12-01' },
  { name: 'device_locations_2026_12', from: '2026-12-01', to: '2027-01-01' },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log('Guardian p2t2b: adding device_locations partitions 2025-08 through 2026-12...');
    for (const p of PARTITIONS) {
      // PostgreSQL lacks IF NOT EXISTS on PARTITION OF; check existence first.
      const exists = await client.query(
        `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [p.name]
      );
      if (exists.rowCount > 0) {
        console.log(`  Partition ${p.name} already exists, skipping.`);
        continue;
      }
      await client.query(`
        CREATE TABLE ${p.name}
          PARTITION OF device_locations
          FOR VALUES FROM ('${p.from}') TO ('${p.to}')
      `);
      console.log(`  Partition ${p.name} created (${p.from} to ${p.to})`);
    }
    console.log('Guardian p2t2b: done.');
  } catch (err) {
    console.error('Guardian p2t2b: failed.', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
