require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/config/database');

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
const VEHICLE_TYPES = ['SUV', 'Truck', 'APC', 'Van', 'Motorcycle'];
const STATUSES = ['idle', 'idle', 'idle', 'active', 'maintenance'];

async function seed() {
  console.log('🌱 Seeding database...');

  // Users
  const hash = await bcrypt.hash('password123', 10);
  const users = await Promise.all([
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['admin@fleetops.local', 'Admin User', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'dispatcher') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['dispatcher@fleetops.local', 'Jane Dispatcher', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'operator') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['operator@fleetops.local', 'Tom Operator', hash]),
    query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'analyst') ON CONFLICT (email) DO UPDATE SET name=$2 RETURNING id`, ['analyst@fleetops.local', 'Sara Analyst', hash]),
  ]);

  const adminId = users[0].rows[0].id;
  const dispatcherId = users[1].rows[0].id;
  const driverIds = users.map((u) => u.rows[0].id);

  console.log(`✅ ${users.length} users seeded`);

  // Vehicles — 15 across 4 regions
  const vehicles = [];
  const vehicleData = [
    ['SUV',        'KEN-001', 'Kenya',    6],
    ['APC',        'KEN-002', 'Kenya',    8],
    ['Truck',      'KEN-003', 'Kenya',   12],
    ['SUV',        'KEN-004', 'Kenya',    6],
    ['Van',        'DRC-001', 'DRC',      9],
    ['APC',        'DRC-002', 'DRC',     10],
    ['SUV',        'DRC-003', 'DRC',      6],
    ['Truck',      'TAN-001', 'Tanzania', 15],
    ['SUV',        'TAN-002', 'Tanzania',  6],
    ['Motorcycle', 'TAN-003', 'Tanzania',  2],
    ['SUV',        'TAN-004', 'Tanzania',  6],
    ['APC',        'MLI-001', 'Mali',     10],
    ['SUV',        'MLI-002', 'Mali',      6],
    ['Van',        'MLI-003', 'Mali',      8],
    ['Truck',      'MLI-004', 'Mali',     12],
  ];

  // Coordinates for each region (centre-ish)
  const regionCoords = {
    Kenya:    { lat: -1.2921, lng: 36.8219 },
    DRC:      { lat: -4.3217, lng: 15.3215 },
    Tanzania: { lat: -6.7924, lng: 39.2083 },
    Mali:     { lat: 12.6392, lng: -8.0029 },
  };

  for (let i = 0; i < vehicleData.length; i++) {
    const [type, reg, region, capacity] = vehicleData[i];
    const coords = regionCoords[region];
    const status = STATUSES[i % STATUSES.length];
    const driverId = driverIds[i % driverIds.length];
    const lat = coords.lat + (Math.random() - 0.5) * 2;
    const lng = coords.lng + (Math.random() - 0.5) * 2;

    const v = await query(
      `INSERT INTO vehicles (type, registration, region, status, capacity, driver_id, latitude, longitude, last_ping)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (registration) DO UPDATE SET status=$4, latitude=$7, longitude=$8, updated_at=NOW()
       RETURNING id`,
      [type, reg, region, status, capacity, driverId, lat, lng]
    );
    vehicles.push(v.rows[0].id);
  }
  console.log(`✅ ${vehicles.length} vehicles seeded`);

  // Convoys — 3 in different statuses
  const convoyData = [
    { name: 'Operation Alpha', region: 'Kenya', status: 'active', priority: 'high', origin: 'Nairobi', dest: 'Mombasa' },
    { name: 'Operation Bravo', region: 'DRC', status: 'planned', priority: 'critical', origin: 'Kinshasa', dest: 'Kigali' },
    { name: 'Operation Charlie', region: 'Tanzania', status: 'completed', priority: 'medium', origin: 'Dar es Salaam', dest: 'Dodoma' },
  ];

  const convoyIds = [];
  for (const c of convoyData) {
    const result = await query(
      `INSERT INTO convoys (name, region, status, priority, route_origin, route_destination, created_by, departure_time, estimated_arrival)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() - INTERVAL '2 hours', NOW() + INTERVAL '4 hours')
       RETURNING id`,
      [c.name, c.region, c.status, c.priority, c.origin, c.dest, adminId]
    );
    convoyIds.push(result.rows[0].id);
  }
  console.log(`✅ ${convoyIds.length} convoys seeded`);

  // Assign first 4 vehicles to convoy Alpha
  for (let i = 0; i < 4 && i < vehicles.length; i++) {
    await query(
      `INSERT INTO convoy_assignments (convoy_id, vehicle_id, role) VALUES ($1,$2,'escort') ON CONFLICT DO NOTHING`,
      [convoyIds[0], vehicles[i]]
    );
    await query('UPDATE vehicles SET assigned_convoy_id=$1, status=\'active\' WHERE id=$2', [convoyIds[0], vehicles[i]]);
  }

  // Sample alerts
  await query(
    `INSERT INTO alerts (vehicle_id, convoy_id, type, severity, message, created_by)
     VALUES ($1,$2,'speed','high','Vehicle KEN-001 exceeded speed limit at 135 km/h',$3)`,
    [vehicles[0], convoyIds[0], adminId]
  );
  await query(
    `INSERT INTO alerts (vehicle_id, type, severity, message, created_by)
     VALUES ($1,'geofence','critical','Vehicle DRC-002 deviated 8.3 km from convoy route',$2)`,
    [vehicles[5], adminId]
  );

  // Sample GPS logs
  for (let i = 0; i < 20; i++) {
    await query(
      'INSERT INTO gps_logs (vehicle_id, lat, lng, speed, timestamp) VALUES ($1,$2,$3,$4,$5)',
      [vehicles[0], -1.2921 + i * 0.01, 36.8219 + i * 0.01, 80 + Math.random() * 40, new Date(Date.now() - i * 60000)]
    );
  }

  // Sample incident
  await query(
    `INSERT INTO incidents (convoy_id, title, description, severity, status)
     VALUES ($1,'Roadblock detected','Unknown vehicle blockade on A109 highway','high','investigating')`,
    [convoyIds[0]]
  );

  console.log('✅ Sample alerts, GPS logs, and incidents seeded');
  console.log('\n📋 Demo Credentials:');
  console.log('  admin@fleetops.local     — admin       — password123');
  console.log('  dispatcher@fleetops.local — dispatcher  — password123');
  console.log('  operator@fleetops.local  — operator    — password123');
  console.log('  analyst@fleetops.local   — analyst     — password123');
  console.log('\n🚀 Seed complete!');

  await pool.end();
}

seed().catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
