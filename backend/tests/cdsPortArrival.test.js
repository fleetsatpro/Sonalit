const fs = require('fs');
const path = require('path');
const router = require('../src/routes/cds');

function routeLayer(pathname, method) {
  const layer = router.stack.find(item => item.route && item.route.path === pathname && item.route.methods[method]);
  if (!layer) throw new Error('No ' + method.toUpperCase() + ' route registered for ' + pathname);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function response() {
  const result = { status: 200, body: undefined };
  return {
    result,
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
}

describe('CDS port arrival evidence', () => {
  test('records the first at-port transition independently of delivery', async () => {
    const res = response();
    const calls = [];
    const arrival = '2026-11-09T09:30:00.000Z';
    await routeLayer('/trips/:id/transition', 'post')({
      params: { id: 'trip-1' },
      body: { to_status: 'at_port', notes: 'Arrived at terminal' },
      user: { id: 'operator-1', org_id: 'org-1', name: 'Port operator' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('SELECT id, status FROM cds_trips')) {
          return { rows: [{ id: 'trip-1', status: 'dispatched' }] };
        }
        if (sql.includes('UPDATE cds_trips SET status=$1')) {
          return { rows: [{ id: 'trip-1', status: 'at_port', arrived_at: arrival, delivered_at: null }] };
        }
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    const update = calls.find(call => call.sql.includes('UPDATE cds_trips SET status=$1'));
    const audit = calls.find(call => call.sql.includes('INSERT INTO cds_audit_logs'));
    expect(update).toBeDefined();
    expect(update.sql).toContain('arrived_at=COALESCE(arrived_at,NOW())');
    expect(update.sql).not.toContain('delivered_at=');
    expect(update.values).toEqual(['at_port', 'Arrived at terminal', 'trip-1']);
    expect(JSON.parse(audit.values[4])).toMatchObject({ status: 'at_port' });
    expect(res.result.body.data.arrived_at).toBe(arrival);
    expect(res.result.body.data.delivered_at).toBeNull();
  });

  test('backfills only actual recorded arrival transitions, not delivery or same-state observations', () => {
    const migrationPath = path.resolve(__dirname, '../migrations/20261109_001_cds_trip_port_arrival_timestamps.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("a.after_data->>'status' = 'at_port'");
    expect(sql).toContain("e.to_status = 'at_port'");
    expect(sql).toContain("e.from_status IS DISTINCT FROM 'at_port'");
    expect(sql).toContain('MIN(arrived_at)');
    expect(sql).toContain('trip.arrived_at IS NULL');
    expect(sql).not.toContain('delivered_at');
  });
});
