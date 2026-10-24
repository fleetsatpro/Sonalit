'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { runWithOrgContext } = require('../../src/utils/tenantContext');
const { attachTruckProgress } = require('../../src/controllers/convoyController');

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const ORG = 'eeeeeeee-1000-4000-8000-00000000e001';
const CONVOY = 'eeeeeeee-1000-4000-8000-00000000e002';
const VEHICLE = 'eeeeeeee-1000-4000-8000-00000000e003';
const CONVOY_TRUCK = 'eeeeeeee-1000-4000-8000-00000000e004';
const REGISTRATION = 'ITEST-PROGRESS-E001';

let pool;

async function cleanFixtures() {
  await pool.query('DELETE FROM gps_logs WHERE vehicle_id = $1', [VEHICLE]);
  await pool.query('DELETE FROM convoy_trucks WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM convoy_route_waypoints WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM convoy_assignments WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM convoys WHERE id = $1', [CONVOY]);
  await pool.query('DELETE FROM vehicles WHERE id = $1', [VEHICLE]);
}

d('convoy truck progress against the migrated PostgreSQL schema', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanFixtures();

    await pool.query(
      `INSERT INTO convoys
         (id, name, region, status, priority, org_id, route_origin, route_destination, departure_time)
       VALUES ($1, 'ITEST GPS progress', 'East Africa', 'active', 'medium', $2,
               'Test origin', 'Test destination', now() - interval '1 hour')`,
      [CONVOY, ORG],
    );
    await pool.query(
      `INSERT INTO vehicles (id, type, registration, region, status, org_id)
       VALUES ($1, 'truck', $2, 'East Africa', 'active', $3)`,
      [VEHICLE, REGISTRATION, ORG],
    );
    await pool.query(
      `INSERT INTO convoy_trucks
         (id, convoy_id, vehicle_id, driver_name, registration, position, org_id)
       VALUES ($1, $2, $3, 'ITEST Driver', $4, 1, $5)`,
      [CONVOY_TRUCK, CONVOY, VEHICLE, REGISTRATION, ORG],
    );
    await pool.query(
      `INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km, active)
       VALUES ($1, $2, $3::jsonb, 2, true)`,
      [ORG, CONVOY, JSON.stringify([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }])],
    );
    await pool.query(
      `INSERT INTO gps_logs (vehicle_id, lat, lng, speed, timestamp, org_id)
       VALUES ($1, 0, 0.5, 42, now(), $2)`,
      [VEHICLE, ORG],
    );
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    try { await cleanFixtures(); } finally { await pool.end(); }
  }, 30000);

  test('reads the real roster, latest GPS fix and saved corridor under tenant RLS', async () => {
    const [result] = await runWithOrgContext(ORG, () =>
      attachTruckProgress([{ id: CONVOY, vehicle_count: 1 }], ORG)
    );

    expect(result.truck_progress_available).toBe(true);
    expect(result.vehicle_count).toBe(1);
    expect(result.truck_progress).toHaveLength(1);
    expect(result.truck_progress[0]).toMatchObject({
      id: CONVOY_TRUCK,
      vehicle_id: VEHICLE,
      registration: REGISTRATION,
      state: 'live',
      progress_pct: 50,
      route_source: 'corridor',
      speed_kph: 42,
    });
  }, 30000);
});
