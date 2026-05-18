/**
 * Guardian CFO Phase 1 — Convoy, truck, and CFO assignment tables
 *
 * Forward-only migration (all DDL uses IF NOT EXISTS / IF EXISTS).
 *
 * Rollback:
 *   DROP TRIGGER  IF EXISTS trg_enforce_cfo_truck_limit   ON convoy_cfo_truck_assignments;
 *   DROP TRIGGER  IF EXISTS trg_enforce_convoy_truck_limit ON convoy_trucks;
 *   DROP FUNCTION IF EXISTS enforce_cfo_truck_limit();
 *   DROP FUNCTION IF EXISTS enforce_convoy_truck_limit();
 *   DROP TABLE    IF EXISTS convoy_cfo_truck_assignments;
 *   DROP TABLE    IF EXISTS convoy_cfos;
 *   DROP TABLE    IF EXISTS convoy_trucks;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS org_id;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS timezone;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS start_date;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS end_date;
 *   ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_status_cfo_check;
 *   ALTER TABLE convoys ADD CONSTRAINT convoys_status_check
 *     CHECK (status IN ('planned','active','completed','aborted'));
 *   ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_cfo_check;
 *   ALTER TABLE users ADD CONSTRAINT users_role_check
 *     CHECK (role IN ('admin','dispatcher','operator','analyst'));
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[cfo-p1] Starting migration...');
    await client.query('BEGIN');

    // ── 1. Extend users.role CHECK constraint to include 'cfo' ─────────────
    // The original inline constraint is auto-named users_role_check in PG.
    // Drop it and replace with one that includes 'cfo'.
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    // Also drop any previous CFO-aware version if re-running
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_cfo_check`);
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_cfo_check
        CHECK (role IN ('admin','dispatcher','operator','analyst','cfo'))
    `);
    console.log('[cfo-p1] users.role constraint updated to include cfo');

    // ── 2. Add missing columns to convoys ───────────────────────────────────
    await client.query(`ALTER TABLE convoys ADD COLUMN IF NOT EXISTS org_id UUID`);
    await client.query(`ALTER TABLE convoys ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'`);
    await client.query(`ALTER TABLE convoys ADD COLUMN IF NOT EXISTS start_date DATE`);
    await client.query(`ALTER TABLE convoys ADD COLUMN IF NOT EXISTS end_date DATE`);
    console.log('[cfo-p1] convoys columns added');

    // ── 3. Extend convoys.status CHECK to include 'cancelled' ───────────────
    // Existing: ('planned','active','completed','aborted')
    // New:      ('planned','active','completed','aborted','cancelled')
    await client.query(`ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_status_check`);
    await client.query(`ALTER TABLE convoys DROP CONSTRAINT IF EXISTS convoys_status_cfo_check`);
    await client.query(`
      ALTER TABLE convoys ADD CONSTRAINT convoys_status_cfo_check
        CHECK (status IN ('planned','active','completed','aborted','cancelled'))
    `);
    console.log('[cfo-p1] convoys.status constraint updated');

    // ── 4. convoy_trucks ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoy_trucks (
        id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        convoy_id        UUID    NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        vehicle_id       UUID    NOT NULL,
        driver_name      TEXT    NOT NULL,
        driver_phone     TEXT,
        driver_license_no TEXT,
        position         INT     NOT NULL CHECK (position BETWEEN 1 AND 6),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (convoy_id, vehicle_id),
        UNIQUE (convoy_id, position)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_convoy_trucks_convoy_id
        ON convoy_trucks(convoy_id)
    `);
    console.log('[cfo-p1] convoy_trucks created');

    // ── 5. 6-truck-per-convoy trigger ───────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_convoy_truck_limit() RETURNS trigger AS $$
      BEGIN
        IF (SELECT COUNT(*) FROM convoy_trucks WHERE convoy_id = NEW.convoy_id) >= 6 THEN
          RAISE EXCEPTION 'convoy_truck_limit_exceeded: a convoy may have at most 6 trucks';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_enforce_convoy_truck_limit ON convoy_trucks
    `);
    await client.query(`
      CREATE TRIGGER trg_enforce_convoy_truck_limit
      BEFORE INSERT ON convoy_trucks
      FOR EACH ROW EXECUTE FUNCTION enforce_convoy_truck_limit()
    `);
    console.log('[cfo-p1] 6-truck trigger installed');

    // ── 6. convoy_cfos ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoy_cfos (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        convoy_id           UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        cfo_user_id         UUID NOT NULL REFERENCES users(id),
        guardian_device_id  UUID REFERENCES guardian_devices(id),
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (convoy_id, cfo_user_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_convoy_cfos_cfo_user_id
        ON convoy_cfos(cfo_user_id)
    `);
    console.log('[cfo-p1] convoy_cfos created');

    // ── 7. convoy_cfo_truck_assignments ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoy_cfo_truck_assignments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        convoy_id        UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        cfo_user_id      UUID NOT NULL REFERENCES users(id),
        convoy_truck_id  UUID NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (convoy_id, cfo_user_id, convoy_truck_id),
        UNIQUE (convoy_truck_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_convoy_cfo_truck_asgn
        ON convoy_cfo_truck_assignments(convoy_id, cfo_user_id)
    `);
    console.log('[cfo-p1] convoy_cfo_truck_assignments created');

    // ── 8. 2-trucks-per-CFO trigger ─────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION enforce_cfo_truck_limit() RETURNS trigger AS $$
      BEGIN
        IF (SELECT COUNT(*) FROM convoy_cfo_truck_assignments
             WHERE convoy_id = NEW.convoy_id AND cfo_user_id = NEW.cfo_user_id) >= 2 THEN
          RAISE EXCEPTION 'cfo_truck_limit_exceeded: a CFO may cover at most 2 trucks in a convoy';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_enforce_cfo_truck_limit ON convoy_cfo_truck_assignments
    `);
    await client.query(`
      CREATE TRIGGER trg_enforce_cfo_truck_limit
      BEFORE INSERT ON convoy_cfo_truck_assignments
      FOR EACH ROW EXECUTE FUNCTION enforce_cfo_truck_limit()
    `);
    console.log('[cfo-p1] 2-truck-per-CFO trigger installed');

    await client.query('COMMIT');
    console.log('[cfo-p1] Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cfo-p1] Migration FAILED — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
