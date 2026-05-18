/**
 * Guardian Phase 2 Task 5 — Audit log table
 *
 * Rollback path:
 *   DROP TABLE IF EXISTS guardian_audit_log CASCADE;
 *   (All three indexes will be dropped automatically via CASCADE.)
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Guardian p2t5: creating guardian_audit_log table...');

    await client.query('BEGIN');

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
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor
        ON guardian_audit_log(actor_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_target
        ON guardian_audit_log(target_type, target_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_action
        ON guardian_audit_log(action, created_at DESC)
    `);

    await client.query('COMMIT');
    console.log('Guardian p2t5: done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Guardian p2t5: failed, rolled back.', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
