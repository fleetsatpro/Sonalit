const router = require('../src/routes/cds');

function routeLayer(path, method) {
  const layer = router.stack.find(item => item.route && item.route.path === path && item.route.methods[method]);
  if (!layer) throw new Error('No ' + method.toUpperCase() + ' route registered for ' + path);
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

describe('CDS E-Lock catalogue and booking health queries', () => {
  test('lock catalogue applies server pagination, safe search, health and allowed sorting', async () => {
    const res = response();
    const calls = [];
    const rows = [{ id: 'lock-26', serial: 'SEC-0026' }];
    await routeLayer('/locks', 'get')({
      query: { search: 'SEC-00', health: 'tamper', sortBy: 'serial', sortOrder: 'asc', limit: '25', offset: '25' },
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return calls.length === 1 ? { rows } : { rows: [{ count: '126' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.body).toEqual({ data: rows, total: 126 });
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('FROM cds_electronic_locks t');
    expect(calls[0].sql).toContain('t.tamper_detected');
    expect(calls[0].sql).toContain("LOWER(COALESCE(lock_telemetry.reported_tamper_detected, '')) = 'true'");
    expect(calls[0].sql).toContain('t.serial ASC NULLS LAST');
    expect(calls[0].sql).toContain('LIMIT $2 OFFSET $3');
    expect(calls[0].values).toEqual(['%SEC-00%', 25, 25]);
    expect(calls[1].values).toEqual(['%SEC-00%']);
  });


  test('default risk ordering follows the device health badge precedence', async () => {
    const res = response();
    let statement = '';
    await routeLayer('/locks', 'get')({
      query: { sortBy: 'priority', sortOrder: 'asc', limit: '25', offset: '0' },
      user: { org_id: 'org-1' },
      db: async sql => {
        if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '0' }] };
        statement = sql;
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    const tamper = statement.indexOf('WHEN (COALESCE(t.tamper_detected');
    const offline = statement.indexOf("WHEN (t.status = 'offline'");
    const unverified = statement.indexOf('last_heartbeat_event_at IS NULL');
    const stale = statement.indexOf('last_heartbeat_event_at < NOW()');
    const lowBattery = statement.indexOf('reported_battery_level < 25');
    const weakSignal = statement.indexOf("= 'weak'");
    expect(tamper).toBeGreaterThan(-1);
    expect(tamper).toBeLessThan(offline);
    expect(offline).toBeLessThan(unverified);
    expect(unverified).toBeLessThan(stale);
    expect(stale).toBeLessThan(lowBattery);
    expect(lowBattery).toBeLessThan(weakSignal);
  });

  test('unrecognised lock sort keys cannot inject SQL fragments', async () => {
    const res = response();
    let statement = '';
    await routeLayer('/locks', 'get')({
      query: { sortBy: 'serial; DROP TABLE cds_electronic_locks', sortOrder: 'asc', limit: '10', offset: '0' },
      user: { org_id: 'org-1' },
      db: async sql => {
        if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '0' }] };
        statement = sql;
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(statement).toContain('ORDER BY t.created_at ASC NULLS LAST');
    expect(statement).not.toContain('DROP TABLE');
    expect(res.result.body.total).toBe(0);
  });

  test('tenant-wide booking summary is scoped to the authenticated organisation', async () => {
    const res = response();
    let statement = '';
    let parameters = [];
    const summary = {
      total: 320,
      active: 72,
      in_transit: 31,
      exceptions: 4,
      completed: 210,
      pending: 18,
      assigned: 23,
      at_port: 11,
      delayed: 3,
      delivered: 180,
      cancelled: 12,
      other: 2,
    };
    await routeLayer('/bookings/summary', 'get')({
      query: {},
      user: { org_id: 'org-tenant-a' },
      db: async (sql, values) => {
        statement = sql;
        parameters = values;
        return { rows: [summary] };
      },
    }, res, error => { if (error) throw error; });

    expect(statement).toContain('FROM cds_bookings t');
    expect(statement).toContain('WHERE t.org_id = $1 AND t.deleted_at IS NULL');
    expect(parameters).toEqual(['org-tenant-a']);
    expect(res.result.body.data).toEqual(summary);
  });

  test('booking register combines multi-status and exception filters with paginated search', async () => {
    const res = response();
    const calls = [];
    const rows = [{ id: 'booking-1', booking_number: 'SON-1001' }];
    await routeLayer('/bookings', 'get')({
      query: {
        status: 'dispatched,in_transit,at_port',
        health: 'exceptions',
        search: 'SON-10',
        sortBy: 'booking_number',
        sortOrder: 'asc',
        limit: '25',
        offset: '50',
      },
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return calls.length === 1 ? { rows } : { rows: [{ count: '71' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.body).toEqual({ data: rows, total: 71 });
    expect(calls[0].sql).toContain('t.status = ANY($1::text[])');
    expect(calls[0].sql).toContain("t.updated_at < NOW() - INTERVAL '48 hours'");
    expect(calls[0].sql).toContain('t.booking_number ILIKE $2');
    expect(calls[0].sql).toContain('ORDER BY t.booking_number ASC NULLS LAST');
    expect(calls[0].values).toEqual([['dispatched', 'in_transit', 'at_port'], '%SON-10%', 25, 50]);
    expect(calls[1].values).toEqual([['dispatched', 'in_transit', 'at_port'], '%SON-10%']);
  });

  test('port queue can find a container, attached lock, truck or transporter using database search', async () => {
    const res = response();
    const calls = [];
    await routeLayer('/trips', 'get')({
      query: { status: 'at_port', search: 'SEC-70', limit: '25', offset: '25' },
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return calls.length === 1 ? { rows: [{ id: 'trip-1', status: 'at_port' }] } : { rows: [{ count: '26' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.body.total).toBe(26);
    expect(calls[0].sql).toContain('co.number ILIKE $2');
    expect(calls[0].sql).toContain('el.serial ILIKE $2');
    expect(calls[0].sql).toContain('ve.registration ILIKE $2');
    expect(calls[0].sql).toContain('tr.company_name ILIKE $2');
    expect(calls[0].sql).toContain('LIMIT $3 OFFSET $4');
    expect(calls[0].values).toEqual(['at_port', '%SEC-70%', 25, 25]);
    expect(calls[1].values).toEqual(['at_port', '%SEC-70%']);
  });


  test('prototype property names are not accepted as sort or health allowlist entries', async () => {
    const res = response();
    let statement = '';
    await routeLayer('/bookings', 'get')({
      query: { sortBy: 'toString', sortOrder: 'asc', limit: '10', offset: '0' },
      user: { org_id: 'org-1' },
      db: async sql => {
        if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '0' }] };
        statement = sql;
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(statement).toContain('ORDER BY t.created_at DESC NULLS LAST');
    expect(statement).not.toContain('function toString');
    expect(res.result.body.total).toBe(0);
  });

  test('booking summary route is registered before the booking id route', () => {
    const paths = router.stack.filter(item => item.route).map(item => item.route.path);
    expect(paths.indexOf('/bookings/summary')).toBeLessThan(paths.indexOf('/bookings/:id'));
  });
});
