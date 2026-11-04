const router = require('../src/routes/cds');

function handlerFor(path, method) {
  const layer = router.stack.find(item => item.route && item.route.path === path && item.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} route registered for ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function response() {
  let statusCode = 200;
  let body;
  const res = {
    status(code) { statusCode = code; return res; },
    json(value) { body = value; return res; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return res;
}

const VALID_CONTAINER = {
  number: 'CSQU3054383',
  iso_type: '40HC',
  ownership: 'leased',
  condition: 'good',
  status: 'available',
  max_weight_kg: 28000,
  tare_weight_kg: 2200,
  manufacturer: 'Example Works',
  year_built: 2022,
};

describe('POST /containers', () => {
  function makeRequest(overrides = {}) {
    const statements = [];
    const inserted = {
      id: 'container-1',
      number: VALID_CONTAINER.number,
      iso_type: '40HC',
      container_type: "40' High Cube",
      container_size: 40,
      ownership: 'leased',
      condition: 'good',
      status: 'available',
      max_weight_kg: '28000.00',
      tare_weight_kg: '2200.00',
      manufacturer: 'Example Works',
      year_built: 2022,
    };
    const client = {
      query: async (sql, params) => {
        statements.push({ sql, params });
        if (/INSERT INTO cds_containers/.test(sql)) return { rows: [inserted] };
        if (/INSERT INTO cds_audit_logs/.test(sql)) return { rows: [] };
        throw new Error('unexpected SQL in container create test');
      },
    };
    const req = {
      body: { ...VALID_CONTAINER },
      user: { id: 'operator-1', name: 'Operations Desk', org_id: 'org-1' },
      ip: '192.0.2.10',
      get: header => header === 'user-agent' ? 'CDS test agent' : undefined,
      dbTx: async fn => fn(client),
      ...overrides,
    };
    req.statements = statements;
    return req;
  }

  async function call(req) {
    const res = response();
    let forwarded;
    await handlerFor('/containers', 'post')(req, res, error => { forwarded = error; });
    if (forwarded) throw forwarded;
    return res;
  }

  test('creates the container and its audit record in one tenant transaction', async () => {
    const req = makeRequest();
    const res = await call(req);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'container-1', number: 'CSQU3054383' });
    expect(req.statements).toHaveLength(2);
    expect(req.statements[0].sql).toContain('INSERT INTO cds_containers');
    expect(req.statements[1].sql).toContain('INSERT INTO cds_audit_logs');
    expect(req.statements[1].params).toEqual(expect.arrayContaining([
      'container-1', 'operator-1', 'Operations Desk', '192.0.2.10', 'CDS test agent', 'org-1',
    ]));
    expect(req.statements[1].params[3]).toContain('"number":"CSQU3054383"');
  });

  test('rejects a wrong check digit before opening a transaction', async () => {
    const req = makeRequest({ body: { ...VALID_CONTAINER, number: 'CSQU3054384' } });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_container_check_digit');
    expect(req.statements).toHaveLength(0);
  });

  test('rejects a non-freight equipment category', async () => {
    // A valid check digit is required before the category rule can be applied.
    const { checkDigit } = require('../src/utils/containerNumber');
    const firstTen = 'CSQJ305438';
    const number = firstTen + String(checkDigit(firstTen));
    const req = makeRequest({ body: { ...VALID_CONTAINER, number } });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('freight_container_category_must_be_U');
    expect(req.statements).toHaveLength(0);
  });

  test('rejects equipment values outside the register vocabulary', async () => {
    const req = makeRequest({ body: { ...VALID_CONTAINER, iso_type: '53HC' } });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_container_equipment_type');
  });

  test('prevents registering a new asset as already in transit or delivered', async () => {
    const req = makeRequest({ body: { ...VALID_CONTAINER, status: 'in_transit' } });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('new_container_status_must_be_available_or_maintenance');
  });

  test('damaged and retired containers must start in maintenance', async () => {
    const req = makeRequest({ body: { ...VALID_CONTAINER, condition: 'damaged' } });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('damaged_or_retired_container_requires_maintenance_status');
  });

  test('maps a duplicate identifier to HTTP 409', async () => {
    const client = {
      query: async () => { const error = new Error('duplicate'); error.code = '23505'; throw error; },
    };
    const req = makeRequest({ dbTx: async fn => fn(client) });
    const res = await call(req);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('container_number_already_registered');
  });

  test('does not return success when audit insertion fails inside the transaction', async () => {
    let calls = 0;
    const client = {
      query: async sql => {
        calls += 1;
        if (/INSERT INTO cds_containers/.test(sql)) return { rows: [{ id: 'container-1', number: VALID_CONTAINER.number }] };
        throw new Error('audit unavailable');
      },
    };
    const req = makeRequest({ dbTx: async fn => fn(client) });
    const res = response();
    let forwarded;
    await handlerFor('/containers', 'post')(req, res, error => { forwarded = error; });
    expect(forwarded).toBeInstanceOf(Error);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('GET /containers', () => {
  function makeRequest(query = {}) {
    const statements = [];
    const client = {
      query: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
        if (sql.includes('COUNT(*) FILTER')) return { rows: [{ registered: 8, available: 4, in_operational_flow: 3, review_required: 1 }] };
        if (sql.includes('SELECT\n         t.*')) return { rows: [{
          id: 'container-1', number: 'CSQU3054383',
          latest_booking_number: 'BK-104', latest_trip_number: null,
          latest_booking_container_status: 'assigned', latest_custody_kind: 'clamped', operational_status: 'booked',
        }] };
        throw new Error('unexpected SQL in container list test');
      },
    };
    return {
      query,
      dbTx: async fn => fn(client),
      statements,
    };
  }

  async function call(req) {
    const res = response();
    await handlerFor('/containers', 'get')(req, res, error => { if (error) throw error; });
    return res;
  }

  test('returns server-paginated rows and organisation-wide summary counts', async () => {
    const req = makeRequest({ limit: '25', offset: '50', search: 'CSQU', status: 'available' });
    const res = await call(req);
    expect(res.body).toMatchObject({
      data: [{ id: 'container-1', number: 'CSQU3054383', latest_booking_number: 'BK-104', latest_trip_number: null, latest_booking_container_status: 'assigned', latest_custody_kind: 'clamped', operational_status: 'booked' }],
      total: 1,
      limit: 25,
      offset: 50,
      summary: { registered: 8, available: 4, in_operational_flow: 3, review_required: 1 },
    });
    expect(req.statements[0].sql).toContain('ORDER BY t.created_at DESC, t.id DESC LIMIT $3 OFFSET $4');
    expect(req.statements[0].sql).toContain('FROM cds_booking_containers bc');
    expect(req.statements[0].sql).toContain('FROM cds_custody_events ce');
    expect(req.statements[0].sql).toContain('= ANY($1::text[])');
    expect(req.statements[0].params).toContain('available');
    expect(req.statements[0].sql).toContain('ce.org_id = t.org_id');
    expect(req.statements[0].sql).toContain('latest_booking_container.id IS NOT NULL AND tr.id = latest_booking_container.trip_id');
    expect(req.statements[0].sql).toContain('AS operational_status');
    expect(req.statements[0].sql).toContain("WHEN latest_booking_container.status = 'assigned' THEN 'booked'");
    expect(req.statements[0].sql).toContain("WHEN latest_booking_container.status IN ('in_transit','at_port','delivered')");
    expect(req.statements[0].sql).toContain('ILIKE $2');
    expect(req.statements[0].params).toEqual([['available'], '%CSQU%', 25, 50]);
  });

  test('rejects unknown status filters rather than silently returning no rows', async () => {
    const req = makeRequest({ status: 'en_route' });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_container_status_filter');
    expect(req.statements).toHaveLength(0);
  });


  test('rejects negative offsets before opening a database transaction', async () => {
    const req = makeRequest({ offset: '-1' });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_container_offset');
    expect(req.statements).toHaveLength(0);
  });

  test('rejects excessively long search input', async () => {
    const req = makeRequest({ search: 'x'.repeat(121) });
    const res = await call(req);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('container_search_too_long');
    expect(req.statements).toHaveLength(0);
  });
});


describe('GET /audit', () => {
  async function call(query = {}) {
    const statements = [];
    const req = {
      query,
      db: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '245' }] };
        return { rows: [{
          id: 'audit-1', action: 'create', entity_type: 'container',
          entity_id: 'container-1', user_name: 'Operations Desk',
        }] };
      },
    };
    const res = response();
    await handlerFor('/audit', 'get')(req, res, error => { if (error) throw error; });
    return { res, statements };
  }

  test('searches the full organisation audit result set before pagination', async () => {
    const { res, statements } = await call({
      search: 'lock', entity_type: 'container', limit: '100', offset: '200',
    });
    expect(res.body).toMatchObject({
      total: 245,
      limit: 100,
      offset: 200,
      data: [{ id: 'audit-1', action: 'create', entity_type: 'container' }],
    });
    expect(statements[0].sql).toContain('action ILIKE $2');
    expect(statements[0].sql).toContain('entity_id::text ILIKE $2');
    expect(statements[0].sql).toContain('ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4');
    expect(statements[0].params).toEqual(['container', '%lock%', 100, 200]);
    expect(statements[1].params).toEqual(['container', '%lock%']);
  });

  test('rejects excessively long audit search before querying', async () => {
    const statements = [];
    const req = { query: { search: 'x'.repeat(151) }, db: async (...args) => { statements.push(args); return { rows: [] }; } };
    const res = response();
    await handlerFor('/audit', 'get')(req, res, error => { if (error) throw error; });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('audit_search_too_long');
    expect(statements).toHaveLength(0);
  });
});


describe('legacy trip mutation guards', () => {
  async function call(path, method, action) {
    const statements = [];
    const req = {
      params: { id: 'trip-1' },
      body: action === 'clamp' ? { container_number: 'MSKU1234565' } : {},
      user: { id: 'operator-1', org_id: 'org-1' },
      db: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('SELECT id, booking_id FROM cds_trips')) {
          return { rows: [{ id: 'trip-1', booking_id: 'booking-1' }] };
        }
        if (sql.includes('SELECT id FROM cds_booking_containers')) {
          return { rows: [{ id: 'manifest-1' }] };
        }
        throw new Error('unexpected SQL for legacy trip guard');
      },
    };
    const res = response();
    await handlerFor(path, method)(req, res, error => { if (error) throw error; });
    return { res, statements };
  }

  test.each([
    ['/trips/:id/clamp', 'clamp'],
    ['/trips/:id/unclamp', 'unclamp'],
  ])('%s returns a manifest migration response and performs no mutation', async (path, action) => {
    const { res, statements } = await call(path, 'post', action);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'manifest_workflow_required',
      booking_id: 'booking-1',
      booking_container_id: 'manifest-1',
      required_endpoint: '/api/v1/cds/bookings/booking-1/containers/manifest-1/' + action,
    });
    expect(statements).toHaveLength(2);
    expect(statements.every(statement => statement.sql.trim().startsWith('SELECT'))).toBe(true);
  });
});


describe('GET /field/yard-resources', () => {
  test('returns only current-organisation eligible drivers, vehicles, transporters and locks', async () => {
    const statements = [];
    const req = {
      user: { org_id: 'org-1' },
      db: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM cds_drivers d')) return { rows: [{ id: 'driver-1', name: 'Registered Driver' }] };
        if (sql.includes('FROM cds_vehicles v')) return { rows: [{ id: 'vehicle-1', registration: 'KAA 123A' }] };
        if (sql.includes('FROM cds_transporters tr')) return { rows: [{ id: 'transporter-1', company_name: 'Registered Haulier' }] };
        if (sql.includes('FROM cds_electronic_locks l')) return { rows: [{ id: 'lock-1', serial: 'LOCK-001' }] };
        throw new Error('unexpected SQL for yard resources');
      },
    };
    const res = response();
    await handlerFor('/field/yard-resources', 'get')(req, res, error => { if (error) throw error; });

    expect(res.body.data).toMatchObject({
      drivers: [{ id: 'driver-1', name: 'Registered Driver' }],
      vehicles: [{ id: 'vehicle-1', registration: 'KAA 123A' }],
      transporters: [{ id: 'transporter-1', company_name: 'Registered Haulier' }],
      locks: [{ id: 'lock-1', serial: 'LOCK-001' }],
    });
    expect(statements).toHaveLength(4);
    for (const statement of statements) expect(statement.params).toEqual(['org-1']);
    expect(statements[0].sql).toContain('license_expiry >= CURRENT_DATE');
    expect(statements[0].sql).toContain("d.status='available'");
    expect(statements[0].sql).toContain("NOT IN ('PENDING','UNKNOWN','N/A','NA','TBC','-','')");
    expect(statements[1].sql).toContain("v.status='available'");
    expect(statements[2].sql).toContain('cds_transporters duplicate');
    expect(statements[3].sql).toContain("l.status='available'");
    expect(statements[3].sql).toContain("COALESCE(l.tamper_status,'normal')='normal'");
  });
});
