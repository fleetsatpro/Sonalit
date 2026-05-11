require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');
async function migrateExtended() {
  const client = await pool.connect();
  try {
    console.log('Running extended migration...');
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        imei VARCHAR(20),
        sim_number VARCHAR(50),
        phone_number VARCHAR(30),
        status VARCHAR(50) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
        battery INTEGER,
        signal VARCHAR(20),
        last_ping TIMESTAMPTZ,
        vehicle_id UUID REFERENCES vehicles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        condition VARCHAR(100),
        action VARCHAR(100),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        priority VARCHAR(50) DEFAULT 'medium',
        cooldown_minutes INTEGER DEFAULT 15,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS geofences (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) DEFAULT 'circle',
        coordinates JSONB NOT NULL,
        radius DECIMAL(10,2),
        region VARCHAR(100),
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS linked_vehicle UUID REFERENCES vehicles(id);
      ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
    `);
    await client.query('COMMIT');
    console.log('✅ Migration complete — devices, rules, geofences tables created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
migrateExtended();
