require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration...');
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- USERS
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','dispatcher','operator','analyst')),
        status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE deleted_at IS NULL;

      -- CONVOYS (declared before vehicles for FK)
      CREATE TABLE IF NOT EXISTS convoys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        region VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','aborted')),
        priority VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
        description TEXT,
        departure_time TIMESTAMPTZ,
        arrival_time TIMESTAMPTZ,
        estimated_arrival TIMESTAMPTZ,
        route_origin VARCHAR(100),
        route_destination VARCHAR(100),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_convoys_status ON convoys(status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_convoys_region ON convoys(region) WHERE deleted_at IS NULL;

      -- VEHICLES
      CREATE TABLE IF NOT EXISTS vehicles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(100) NOT NULL,
        registration VARCHAR(50) UNIQUE NOT NULL,
        region VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','active','maintenance','offline')),
        capacity INTEGER NOT NULL DEFAULT 4,
        latitude DECIMAL(10,7),
        longitude DECIMAL(10,7),
        last_ping TIMESTAMPTZ,
        driver_id UUID REFERENCES users(id),
        assigned_convoy_id UUID REFERENCES convoys(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_vehicles_region ON vehicles(region) WHERE deleted_at IS NULL;

      -- CONVOY ASSIGNMENTS
      CREATE TABLE IF NOT EXISTS convoy_assignments (
        convoy_id UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL DEFAULT 'escort',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (convoy_id, vehicle_id)
      );

      -- ALERTS
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID REFERENCES vehicles(id),
        convoy_id UUID REFERENCES convoys(id),
        type VARCHAR(100) NOT NULL CHECK (type IN ('speed','geofence','mechanical','security','communication')),
        severity VARCHAR(50) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
        message TEXT NOT NULL,
        acknowledged_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_alerts_vehicle ON alerts(vehicle_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(created_at) WHERE resolved_at IS NULL AND deleted_at IS NULL;

      -- INCIDENTS
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        convoy_id UUID REFERENCES convoys(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        severity VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
        status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_convoy ON incidents(convoy_id);

      -- CHANNELS
      CREATE TABLE IF NOT EXISTS channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- MESSAGES
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);

      -- AUDIT LOGS
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        table_name VARCHAR(100) NOT NULL,
        record_id UUID,
        action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
        old_data JSONB,
        new_data JSONB,
        user_id UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_logs(table_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

      -- GPS LOGS
      CREATE TABLE IF NOT EXISTS gps_logs (
        id SERIAL PRIMARY KEY,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        lat DECIMAL(10,7) NOT NULL,
        lng DECIMAL(10,7) NOT NULL,
        speed DECIMAL(6,2) NOT NULL DEFAULT 0,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_gps_vehicle ON gps_logs(vehicle_id, timestamp DESC);

      -- Seed default channels
      INSERT INTO channels (name, description) VALUES
        ('ops-general', 'General operations channel'),
        ('kenya-convoy', 'Kenya region convoys'),
        ('drc-convoy', 'DRC region convoys'),
        ('alerts', 'System alerts and broadcasts')
      ON CONFLICT (name) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete — all tables created');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
