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

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(50),
        permissions JSONB DEFAULT '["read"]',
        rate_limit INTEGER DEFAULT 1000,
        last_used TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        convoy_id UUID REFERENCES convoys(id),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        metadata JSONB DEFAULT '{}',
        valid_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_documents_convoy ON documents(convoy_id) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sensor_logs (
        id SERIAL PRIMARY KEY,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        temperature DECIMAL(6,2),
        humidity DECIMAL(6,2),
        shock_g DECIMAL(6,2),
        raw_payload JSONB,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sensor_logs_vehicle ON sensor_logs(vehicle_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS fuel_logs (
        id SERIAL PRIMARY KEY,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        fuel_level DECIMAL(6,2),
        liters DECIMAL(8,2),
        cost DECIMAL(10,2),
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id, timestamp DESC);

      ALTER TABLE convoys ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_service_date TIMESTAMPTZ;
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS maintenance_score INTEGER DEFAULT 0;
    `);
    await client.query('COMMIT');
    console.log('✅ Migration complete — devices, rules, geofences, api_keys, documents, reports, sensor_logs, fuel_logs tables created');
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
