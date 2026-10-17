'use strict';

const { Pool } = require('pg');
const router = require('../../src/routes/cds');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeIfDb = HAS_DB ? describe : describe.skip;
const TEST_ORG = 'eeeeeeee-1211-4111-8111-000000000091';

function analyticsHandler() {
  const layer = router.stack.find(item =>
    item.route && item.route.path === '/analytics' && item.route.methods.get
  );
  if (!layer) throw new Error('GET /cds/analytics route is not registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function responseCapture() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describeIfDb('CDS analytics SQL integration', () => {
  jest.setTimeout(30_000);
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('executes the complete analytics snapshot against the migrated PostgreSQL schema', async () => {
    const res = responseCapture();
    const req = {
      query: { days: '30' },
      user: { org_id: TEST_ORG },
      // This integration test intentionally executes the actual route query
      // against PostgreSQL. Unit tests separately assert the tenant ID binding.
      db: (sql, params) => pool.query(sql, params),
    };

    await analyticsHandler()(req, res, err => {
      if (err) throw err;
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('data.meta.window_days', 30);
    expect(res.body.data.daily).toHaveLength(30);
    expect(res.body.data.trip_statuses).toHaveLength(13);
    expect(res.body.data.container_statuses).toHaveLength(7);
    expect(res.body.data.container_conditions).toHaveLength(5);
    expect(res.body.data.risk_mix).toHaveLength(4);
    expect(res.body.data.lock_statuses).toHaveLength(6);
    expect(res.body.data.booking_pipeline).toHaveLength(9);
    expect(res.body.data.lanes).toEqual(expect.any(Array));
    expect(res.body.data.alerts).toEqual(expect.any(Array));
    expect(res.body.data.operator_leaderboard).toEqual(expect.any(Array));
    expect(res.body.data.overdue_clamps).toEqual(expect.any(Array));
    expect(res.body.data.clamp_state_mix).toHaveLength(4);
    expect(res.body.data.daily[0]).toEqual(expect.objectContaining({
      bookings_received: expect.any(Number),
      containers_clamped: expect.any(Number),
      containers_unclamped: expect.any(Number),
    }));
    expect(res.body.data.summary).toEqual(expect.objectContaining({
      bookings_received: expect.any(Number),
      containers_clamped: expect.any(Number),
      containers_unclamped: expect.any(Number),
      containers_currently_clamped: expect.any(Number),
      containers_clamped_over_24h: expect.any(Number),
      unclamps_after_24h: expect.any(Number),
      locks_in_use: expect.any(Number),
      unclamped_locks: expect.any(Number),
      avg_clamp_duration_hours: expect.anything(),
      total_containers: expect.any(Number),
      overdue_inspections: expect.any(Number),
      inspections_due_30_days: expect.any(Number),
      containers_missing_location: expect.any(Number),
      total_vehicles: expect.any(Number),
      total_locks: expect.any(Number),
      active_drivers: expect.any(Number),
      open_incidents: expect.any(Number),
      unacknowledged_alerts: expect.any(Number),
    }));
  });
});
