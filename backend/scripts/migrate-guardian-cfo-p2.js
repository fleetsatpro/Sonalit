/**
 * Guardian CFO Phase 2 — Convoy truck photo storage table
 *
 * Forward-only migration.
 *
 * Rollback:
 *   DROP INDEX  IF EXISTS ux_truck_photo_seal;
 *   DROP INDEX  IF EXISTS ux_truck_photo_front_rear;
 *   DROP TABLE  IF EXISTS convoy_truck_photos;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[cfo-p2] Starting migration...');
    await client.query('BEGIN');

    // ── convoy_truck_photos ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoy_truck_photos (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        convoy_id           UUID         NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        convoy_truck_id     UUID         NOT NULL REFERENCES convoy_trucks(id) ON DELETE CASCADE,
        cfo_user_id         UUID         NOT NULL REFERENCES users(id),
        guardian_device_id  UUID         REFERENCES guardian_devices(id),
        session             TEXT         NOT NULL CHECK (session IN ('sod','eod')),
        photo_type          TEXT         NOT NULL CHECK (photo_type IN ('front','rear','seal')),
        seal_position       TEXT,
        report_date         DATE         NOT NULL,
        photo_url           TEXT         NOT NULL,
        taken_at            TIMESTAMPTZ  NOT NULL,
        uploaded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        lat                 DOUBLE PRECISION,
        lng                 DOUBLE PRECISION,
        event_uuid          UUID         NOT NULL,
        location_mismatch   BOOLEAN      NOT NULL DEFAULT false,
        notes               TEXT,
        created_at          TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE (event_uuid)
      )
    `);

    // seal photos require a seal_position; front/rear must NOT have one
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'seal_position_consistency'
        ) THEN
          ALTER TABLE convoy_truck_photos
            ADD CONSTRAINT seal_position_consistency
            CHECK (
              (photo_type = 'seal' AND seal_position IS NOT NULL)
              OR
              (photo_type IN ('front','rear') AND seal_position IS NULL)
            );
        END IF;
      END $$
    `);

    // covering indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ctp_convoy_date
        ON convoy_truck_photos(convoy_id, report_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ctp_truck_date_session
        ON convoy_truck_photos(convoy_truck_id, report_date, session, photo_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ctp_cfo_date
        ON convoy_truck_photos(cfo_user_id, report_date)
    `);

    // each truck-day-session front/rear is unique
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_truck_photo_front_rear
        ON convoy_truck_photos(convoy_truck_id, report_date, session, photo_type)
        WHERE photo_type IN ('front','rear')
    `);

    // each truck-day-session-sealPosition is unique
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_truck_photo_seal
        ON convoy_truck_photos(convoy_truck_id, report_date, session, seal_position)
        WHERE photo_type = 'seal'
    `);

    console.log('[cfo-p2] convoy_truck_photos created with all indexes');

    await client.query('COMMIT');
    console.log('[cfo-p2] Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cfo-p2] Migration FAILED — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
