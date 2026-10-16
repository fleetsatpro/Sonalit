
const router = require('../src/routes/cds');

function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error('no GET route registered for ' + path);
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

describe('GET /cds/analytics', () => {
  it('is registered as a first-class CDS route', () => {
    expect(router.stack.some(layer => layer.route && layer.route.path === '/analytics' && layer.route.methods.get)).toBe(true);
  });

  it.each([0, 8, 14, 366, 'abc'])('rejects unsupported window %s instead of silently changing the reporting period', async days => {
    const res = responseCapture();
    let dbCalls = 0;
    const req = { query: { days: String(days) }, user: { org_id: 'org-1' }, db: async () => { dbCalls += 1; return { rows: [] }; } };
    await handlerFor('/analytics')(req, res, err => { if (err) throw err; });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_analytics_window', allowed_days: [7, 30, 90, 365] });
    expect(dbCalls).toBe(0);
  });

  it('defaults to 30 days and calculates all panels from one tenant-scoped SQL snapshot', async () => {
    const payload = {
      meta: { window_days: 30, period_start: '2026-09-17', period_end: '2026-10-16', generated_at: '2026-10-16T00:00:00.000Z' },
      summary: { trips_started: 0, deliveries_completed: 0, active_trips: 0, eta_attainment_pct: null },
      daily: [], trip_statuses: [], risk_mix: [], lock_statuses: [], booking_pipeline: [], lanes: [], alerts: [],
    };
    const res = responseCapture();
    const captured = [];
    const req = {
      query: {},
      user: { org_id: 'org-1' },
      db: async (sql, params) => { captured.push({ sql, params }); return { rows: [{ analytics: payload }] }; },
    };
    await handlerFor('/analytics')(req, res, err => { if (err) throw err; });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(payload);
    expect(captured).toHaveLength(1);
    expect(captured[0].params).toEqual([30, 'org-1']);
    expect(captured[0].sql).toContain('t.org_id = $2');
    expect(captured[0].sql).toContain('a.org_id = $2');
    expect(captured[0].sql).toContain('generate_series');
    expect(captured[0].sql).toContain('eta_attainment_pct');
    expect(captured[0].sql).toContain('trips_missing_vehicle');
    expect(captured[0].sql).toContain('battery_level < 25');
    expect(captured[0].sql).toContain("'archived'");
    expect(captured[0].sql).toContain("'completed'), ('billed'), ('cancelled'");
  });

  it('passes the requested supported window through without changing tenant scope', async () => {
    const res = responseCapture();
    let call;
    const payload = { meta: { window_days: 7 }, summary: {}, daily: [], trip_statuses: [], risk_mix: [], lock_statuses: [], booking_pipeline: [], lanes: [], alerts: [] };
    await handlerFor('/analytics')({
      query: { days: '7' }, user: { org_id: 'tenant-42' },
      db: async (sql, params) => { call = { sql, params }; return { rows: [{ analytics: payload }] }; },
    }, res, err => { if (err) throw err; });
    expect(res.statusCode).toBe(200);
    expect(call.params).toEqual([7, 'tenant-42']);
  });
});
