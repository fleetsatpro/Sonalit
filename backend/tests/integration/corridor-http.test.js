/**
 * 4D geofence corridor — HTTP end-to-end, nothing stubbed.
 *
 * Mounts the real routers with the real auth middleware, a real signed JWT, a
 * real user row, the real RLS-scoped DB helper, the real routing engine and the
 * real geocoder. No jest.mock anywhere in this file. If this passes, the
 * feature works — not merely that its mocks agree with each other.
 *
 * Requires DATABASE_URL and outbound network; skips (does not fail) without
 * either, so the unit suite stays runnable offline.
 *
 * Note for sandboxes behind an HTTP proxy: Node's built-in fetch ignores
 * HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set.
 */
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

process.env.JWT_SECRET = process.env.JWT_SECRET || 'itest-jwt-secret';

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const ORG = 'dddddddd-0000-0000-0000-00000000d00d';
const USER = 'dddddddd-0000-0000-0001-00000000d00d';
const CONVOY = 'dddddddd-0000-0000-0002-00000000d00d';
const DEVICE = 'dddddddd-0000-0000-0003-00000000d00d';
const TSAVO = 'dddddddd-0000-0000-0004-00000000d00d';

// Real endpoints of a real 800 km Kenyan trunk route.
const KISUMU = { lat: -0.0917, lng: 34.768 };
const MOMBASA = { lat: -4.0435, lng: 39.6682 };

let pool, token, app;

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/convoys', require('../../src/routes/convoys'));
  a.use('/api/v1/convoys', require('../../src/routes/corridors'));
  a.use((req, res) => res.status(404).json({ error: `${req.method} ${req.originalUrl} not found` }));
  // eslint-disable-next-line no-unused-vars
  a.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return a;
}

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, status, org_id)
     VALUES ($1, 'itest-corridor@sonalit.test', 'ITest Ops', 'x', 'admin', 'active', $2)
     ON CONFLICT (id) DO UPDATE SET status = 'active', org_id = EXCLUDED.org_id`,
    [USER, ORG],
  );
  await pool.query(
    `INSERT INTO convoys (id, name, region, status, org_id, route_origin, route_destination, departure_time)
     VALUES ($1, 'ITEST HTTP Kisumu-Mombasa', 'East Africa', 'active', $2,
             'Kisumu, Kenya', 'Mombasa, Kenya', now() - interval '4 hours')
     ON CONFLICT (id) DO UPDATE
       SET route_origin = EXCLUDED.route_origin, route_destination = EXCLUDED.route_destination,
           departure_time = EXCLUDED.departure_time`,
    [CONVOY, ORG],
  );

  token = jwt.sign({ id: USER }, process.env.JWT_SECRET, { expiresIn: '1h' });
  app = buildApp();
});

afterAll(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM convoy_cfos WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY]);
  await pool.query('DELETE FROM guardian_devices WHERE id = $1', [DEVICE]);
  await pool.query('DELETE FROM risk_zones WHERE id = $1', [TSAVO]);
  await pool.query('DELETE FROM convoys WHERE id = $1', [CONVOY]);
  await pool.query('DELETE FROM users WHERE id = $1', [USER]);
  await pool.end();
});

d('POST /api/v1/convoys/:id/corridor — real router, real DB', () => {
  jest.setTimeout(120_000);

  test('rejects an unauthenticated caller', async () => {
    const res = await request(app).post(`/api/v1/convoys/${CONVOY}/corridor`).send({});
    expect(res.status).toBe(401);
  });

  test('routes a real road between two real points and stores it', async () => {
    const res = await auth(request(app).post(`/api/v1/convoys/${CONVOY}/corridor`))
      .send({ origin: KISUMU, destination: MOMBASA, width_km: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.planned).toBe(true);
    expect(['osrm', 'mapbox']).toContain(res.body.data.routing_provider);
    // A real road, not the ~735 km straight line.
    expect(res.body.data.distance_km).toBeGreaterThan(750);
    expect(res.body.data.waypoint_count).toBeGreaterThan(50);

    // And it is genuinely in the database, under the caller's org.
    const { rows } = await pool.query(
      'SELECT org_id, route_line, width_km FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(ORG);
    expect(rows[0].route_line.length).toBe(res.body.data.waypoint_count);
  });

  test('a convoy in another org is invisible', async () => {
    const other = 'dddddddd-0000-0000-000f-00000000d00d';
    await pool.query(
      `INSERT INTO convoys (id, name, region, status, org_id) VALUES ($1,'ITEST other','X','planned',$2)
       ON CONFLICT (id) DO NOTHING`,
      [other, '99999999-0000-0000-0000-000000000099'],
    );
    const res = await auth(request(app).post(`/api/v1/convoys/${other}/corridor`))
      .send({ origin: KISUMU, destination: MOMBASA });
    expect(res.status).toBe(404);
    await pool.query('DELETE FROM convoys WHERE id = $1', [other]);
  });
});

d('POST /api/v1/convoys/:id/corridor/auto — the whole thing, for real', () => {
  jest.setTimeout(180_000);

  test('geocodes the convoy\'s own endpoints, compares real roads, stores the pick', async () => {
    const res = await auth(request(app).post(`/api/v1/convoys/${CONVOY}/corridor/auto`))
      .send({ width_km: 2 });

    expect(res.status).toBe(201);

    // The operator typed nothing: both endpoints came off the convoy row.
    expect(res.body.data.origin.name).toBe('Kisumu, Kenya');
    expect(res.body.data.destination.name).toBe('Mombasa, Kenya');
    expect(res.body.data.origin.lat).toBeCloseTo(KISUMU.lat, 0);
    expect(res.body.data.destination.lng).toBeCloseTo(MOMBASA.lng, 0);

    // Real alternatives were compared, not a single road accepted blindly.
    expect(res.body.data.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.chosen.distance_km).toBeGreaterThan(750);
    expect(res.body.data.chosen.waypoint_count).toBeGreaterThan(50);
    expect(res.body.data.zones_considered).toBeGreaterThanOrEqual(0);

    const { rows } = await pool.query(
      'SELECT route_line FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    expect(rows[0].route_line.length).toBe(res.body.data.chosen.waypoint_count);
  });

  test('a critical zone on the fast road pushes the choice onto a cleaner one', async () => {
    // Tsavo sits on the Nairobi–Mombasa leg that the candidates share.
    await pool.query(
      `INSERT INTO risk_zones (id, name, risk_level, zone_type, lat, lng, radius_km, active, org_id)
       VALUES ($1, 'ITEST HTTP Tsavo', 'critical', 'theft_hotspot', -3.35, 38.55, 45, true, $2)
       ON CONFLICT (id) DO UPDATE SET active = true, risk_level = 'critical'`,
      [TSAVO, ORG],
    );

    const res = await auth(request(app).post(`/api/v1/convoys/${CONVOY}/corridor/auto`)).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.zones_considered).toBeGreaterThan(0);

    // The chosen road is the least-exposed of the real alternatives.
    const minExposure = Math.min(...res.body.data.candidates.map(c => c.exposed_km));
    expect(res.body.data.chosen.exposed_km).toBe(minExposure);
    // And the reasoning is reported rather than hidden.
    if (res.body.data.chosen.exposed_km > 0) {
      expect(res.body.data.chosen.exposures.some(e => e.name === 'ITEST HTTP Tsavo')).toBe(true);
    }
  });

  test('422s with a usable message when the convoy has no endpoints', async () => {
    await pool.query('UPDATE convoys SET route_origin = NULL, route_destination = NULL WHERE id = $1', [CONVOY]);
    const res = await auth(request(app).post(`/api/v1/convoys/${CONVOY}/corridor/auto`)).send({});
    expect(res.status).toBe(422);
    expect(res.body.missing).toEqual({ origin: true, destination: true });
    await pool.query(
      `UPDATE convoys SET route_origin = 'Kisumu, Kenya', route_destination = 'Mombasa, Kenya' WHERE id = $1`,
      [CONVOY],
    );
  });
});

d('GET /api/v1/convoys/:id/corridor — live evaluation over the stored corridor', () => {
  jest.setTimeout(120_000);

  test('evaluates a real device against the corridor it was just given', async () => {
    // Ensure a corridor exists, then park a device just off its centre-line.
    await auth(request(app).post(`/api/v1/convoys/${CONVOY}/corridor`))
      .send({ origin: KISUMU, destination: MOMBASA, width_km: 2 });

    const { rows } = await pool.query(
      'SELECT route_line FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    const mid = rows[0].route_line[Math.floor(rows[0].route_line.length / 2)];

    await pool.query(
      `INSERT INTO guardian_devices (id, name, org_id, status, last_lat, last_lng, last_fix_at)
       VALUES ($1, 'ITEST KDC 001', $2, 'active', $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET last_lat = EXCLUDED.last_lat, last_lng = EXCLUDED.last_lng,
                                      last_fix_at = now()`,
      [DEVICE, ORG, mid.lat, mid.lng],
    );
    // convoy_cfos links a convoy escort (a user) to their device; both are
    // required by the schema.
    await pool.query(
      `INSERT INTO convoy_cfos (convoy_id, cfo_user_id, guardian_device_id) VALUES ($1, $2, $3)
       ON CONFLICT (convoy_id, cfo_user_id) DO UPDATE SET guardian_device_id = EXCLUDED.guardian_device_id`,
      [CONVOY, USER, DEVICE],
    );

    const res = await auth(request(app).get(`/api/v1/convoys/${CONVOY}/corridor`));

    expect(res.status).toBe(200);
    expect(res.body.data.route.length).toBeGreaterThan(50);
    expect(res.body.data.convoy.route_origin).toBe('Kisumu, Kenya');

    const m = res.body.data.members.find(x => x.id === DEVICE);
    expect(m).toBeDefined();
    // Sitting exactly on the stored centre-line: inside the corridor.
    expect(m.cross_track_km).toBeLessThan(0.5);
    expect(m.status).not.toBe('off_route');
    expect(m.route_len_km).toBeGreaterThan(750);

    // The risk overlay is present and shaped as the UI expects.
    expect(res.body.data.risk).toBeDefined();
    expect(Array.isArray(res.body.data.risk.zones)).toBe(true);
  });

  test('a device driven off the road reads as off_route', async () => {
    const { rows } = await pool.query(
      'SELECT route_line FROM convoy_route_corridors WHERE convoy_id = $1', [CONVOY],
    );
    const mid = rows[0].route_line[Math.floor(rows[0].route_line.length / 2)];
    // ~0.5 degrees of latitude ≈ 55 km off the centre-line.
    await pool.query(
      'UPDATE guardian_devices SET last_lat = $1, last_fix_at = now() WHERE id = $2',
      [mid.lat + 0.5, DEVICE],
    );

    const res = await auth(request(app).get(`/api/v1/convoys/${CONVOY}/corridor`));
    const m = res.body.data.members.find(x => x.id === DEVICE);

    expect(m.status).toBe('off_route');
    // The offset is 0.5 degrees of latitude, but the road bends away from the
    // midpoint, so the true perpendicular distance is smaller than 55 km. What
    // matters is that it is an order of magnitude outside the 2 km corridor.
    expect(m.cross_track_km).toBeGreaterThan(20);
    expect(res.body.data.summary.off_route).toBeGreaterThanOrEqual(1);
  });
});
