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
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }
}

async function autoSeed() {
  const bcrypt = require('bcryptjs');
  const { query } = require('../src/config/database');

  const { rows } = await query('SELECT COUNT(*) AS count FROM users');
  if (parseInt(rows[0].count, 10) > 0) {
    console.log('ℹ️  Users already exist — skipping seed');
    return;
  }

  console.log('🌱 No users found — running initial seed...');
  const hash = await bcrypt.hash('password123', 10);

  const users = await Promise.all([
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['admin@fleetops.local', 'Admin User', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'dispatcher') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['dispatcher@fleetops.local', 'Jane Dispatcher', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'operator') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['operator@fleetops.local', 'Tom Operator', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'analyst') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['analyst@fleetops.local', 'Sara Analyst', hash]),
  ]);

  const adminId = users[0].rows[0].id;
  const driverIds = users.map((u) => u.rows[0].id);
  console.log(`✅ ${users.length} users seeded`);

  const regionCoords = {
    Kenya:    { lat: -1.2921, lng: 36.8219 },
    DRC:      { lat: -4.3217, lng: 15.3215 },
    Tanzania: { lat: -6.7924, lng: 39.2083 },
    Mali:     { lat: 12.6392, lng: -8.0029 },
  };
  const vehicleData = [
    ['SUV','KEN-001','Kenya',6],['APC','KEN-002','Kenya',8],['Truck','KEN-003','Kenya',12],['SUV','KEN-004','Kenya',6],
    ['Van','DRC-001','DRC',9],['APC','DRC-002','DRC',10],['SUV','DRC-003','DRC',6],
    ['Truck','TAN-001','Tanzania',15],['SUV','TAN-002','Tanzania',6],['Motorcycle','TAN-003','Tanzania',2],['SUV','TAN-004','Tanzania',6],
    ['APC','MLI-001','Mali',10],['SUV','MLI-002','Mali',6],['Van','MLI-003','Mali',8],['Truck','MLI-004','Mali',12],
  ];
  const STATUSES = ['idle','idle','idle','active','maintenance'];
  const vehicles = [];
  for (let i = 0; i < vehicleData.length; i++) {
    const [type, reg, region, capacity] = vehicleData[i];
    const coords = regionCoords[region];
    const v = await query(
      `INSERT INTO vehicles (type, registration, region, status, capacity, driver_id, latitude, longitude, last_ping)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (registration) DO UPDATE SET status=$4, latitude=$7, longitude=$8, updated_at=NOW()
       RETURNING id`,
      [type, reg, region, STATUSES[i % STATUSES.length], capacity, driverIds[i % driverIds.length],
       coords.lat + (Math.random() - 0.5) * 2, coords.lng + (Math.random() - 0.5) * 2]
    );
    vehicles.push(v.rows[0].id);
  }
  console.log(`✅ ${vehicles.length} vehicles seeded`);

  const convoys = [];
  for (const c of [
    { name: 'Operation Alpha', region: 'Kenya', status: 'active', priority: 'high', origin: 'Nairobi', dest: 'Mombasa' },
    { name: 'Operation Bravo', region: 'DRC', status: 'planned', priority: 'critical', origin: 'Kinshasa', dest: 'Kigali' },
    { name: 'Operation Charlie', region: 'Tanzania', status: 'completed', priority: 'medium', origin: 'Dar es Salaam', dest: 'Dodoma' },
  ]) {
    const r = await query(
      `INSERT INTO convoys (name, region, status, priority, route_origin, route_destination, created_by, departure_time, estimated_arrival)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - INTERVAL '2 hours',NOW() + INTERVAL '4 hours') RETURNING id`,
      [c.name, c.region, c.status, c.priority, c.origin, c.dest, adminId]
    );
    convoys.push(r.rows[0].id);
  }
  for (let i = 0; i < 4 && i < vehicles.length; i++) {
    await query(`INSERT INTO convoy_assignments (convoy_id, vehicle_id, role) VALUES ($1,$2,'escort') ON CONFLICT DO NOTHING`, [convoys[0], vehicles[i]]);
    await query(`UPDATE vehicles SET assigned_convoy_id=$1, status='active' WHERE id=$2`, [convoys[0], vehicles[i]]);
  }

  await query(`INSERT INTO alerts (vehicle_id, convoy_id, type, severity, message, created_by) VALUES ($1,$2,'speed','high','Vehicle KEN-001 exceeded speed limit at 135 km/h',$3)`, [vehicles[0], convoys[0], adminId]);
  await query(`INSERT INTO incidents (convoy_id, title, description, severity, status) VALUES ($1,'Roadblock detected','Unknown vehicle blockade on A109 highway','high','investigating')`, [convoys[0]]);

  console.log('✅ Convoys, alerts, and incidents seeded');
  console.log('\n📋 Demo Credentials:');
  console.log('  admin@fleetops.local      — admin      — password123');
  console.log('  dispatcher@fleetops.local — dispatcher — password123');
  console.log('  operator@fleetops.local   — operator   — password123');
  console.log('  analyst@fleetops.local    — analyst    — password123');
}

async function run() {
  await migrate();
  await autoSeed();
  await pool.end();
}

run().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
