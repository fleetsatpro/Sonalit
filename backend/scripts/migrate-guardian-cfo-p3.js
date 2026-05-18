/**
 * Guardian CFO Phase 3 — Daily report table and convoy seal/archive columns
 *
 * Forward-only migration.
 *
 * Rollback:
 *   DROP TABLE   IF EXISTS convoy_daily_reports;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS seal_count_per_truck;
 *   ALTER TABLE convoys DROP COLUMN IF EXISTS archive_pdf_url;
 *   DROP INDEX   IF EXISTS idx_cdr_status;
 *   DROP INDEX   IF EXISTS idx_cdr_convoy_date;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[cfo-p3] Starting migration...');
    await client.query('BEGIN');

    // ── Extend convoys with seal count and archive URL ───────────────────────
    await client.query(`
      ALTER TABLE convoys
        ADD COLUMN IF NOT EXISTS seal_count_per_truck INT NOT NULL DEFAULT 3
    `);
    // Add the CHECK separately so IF NOT EXISTS works on column add
    // (PostgreSQL doesn't support ADD COLUMN IF NOT EXISTS ... CHECK inline reliably)
    await client.query(`
      ALTER TABLE convoys
        DROP CONSTRAINT IF EXISTS convoys_seal_count_check
    `);
    await client.query(`
      ALTER TABLE convoys
        ADD CONSTRAINT convoys_seal_count_check
        CHECK (seal_count_per_truck BETWEEN 1 AND 6)
    `);
    await client.query(`
      ALTER TABLE convoys
        ADD COLUMN IF NOT EXISTS archive_pdf_url TEXT
    `);
    console.log('[cfo-p3] convoys.seal_count_per_truck and archive_pdf_url added');

    // ── convoy_daily_reports ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoy_daily_reports (
        id                    UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
        convoy_id             UUID   NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        report_date           DATE   NOT NULL,
        status                TEXT   NOT NULL CHECK (status IN ('pending','partial','complete','generated','failed')),
        required_photo_count  INT    NOT NULL,
        received_photo_count  INT    NOT NULL DEFAULT 0,
        pdf_url               TEXT,
        content_hash          TEXT,
        generated_at          TIMESTAMPTZ,
        generation_error      TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (convoy_id, report_date)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cdr_status
        ON convoy_daily_reports(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cdr_convoy_date
        ON convoy_daily_reports(convoy_id, report_date DESC)
    `);
    console.log('[cfo-p3] convoy_daily_reports created');

    // ── guardian_config: cfo_module_enabled feature flag ────────────────────
    // Default OFF per spec (Task F1).
    await client.query(`
      INSERT INTO guardian_config (key, value_int, value_text, updated_at)
      VALUES ('cfo_module_enabled', 0, NULL, NOW())
      ON CONFLICT (key) DO NOTHING
    `);
    console.log('[cfo-p3] cfo_module_enabled flag inserted (default 0)');

    await client.query('COMMIT');
    console.log('[cfo-p3] Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cfo-p3] Migration FAILED — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
