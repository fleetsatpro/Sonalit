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

const validInput = () => ({
  number: 'MSCU6639870',
  iso_type: '20GP',
  container_type: "20' General Purpose",
  container_size: 20,
  ownership: 'leased',
  condition: 'good',
  manufacturer: 'Example manufacturer',
  year_built: 2022,
  max_weight_kg: 28000,
  tare_weight_kg: 2200,
  status: 'in_transit',
});

describe('CDS container register', () => {
  test('rejects an invalid ISO 6346 check digit before writing', async () => {
    const res = response();
    let dbCalls = 0;
    await routeLayer('/containers', 'post')({
      body: { ...validInput(), number: 'MSCU6639871' },
      user: { org_id: 'org-1' },
      db: async () => { dbCalls += 1; return { rows: [] }; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(400);
    expect(res.result.body.error).toBe('invalid_container_number');
    expect(dbCalls).toBe(0);
  });

  test('creates a validated record in available state, never using a client movement status', async () => {
    const res = response();
    let statement = '';
    let parameters = [];
    await routeLayer('/containers', 'post')({
      body: validInput(),
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        statement = sql;
        parameters = values;
        return { rows: [{ id: 'container-1', number: 'MSCU6639870', status: 'available' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(201);
    expect(res.result.body.data.status).toBe('available');
    expect(statement).toContain('INSERT INTO cds_containers');
    expect(statement.match(/INSERT INTO cds_containers \(([^)]+)\)/)?.[1]).not.toMatch(/\bstatus\b/);
    expect(parameters).toContain('MSCU6639870');
    expect(parameters).toContain('org-1');
  });

  test('maps a duplicate ISO container number to a conflict response', async () => {
    const res = response();
    await routeLayer('/containers', 'post')({
      body: validInput(),
      user: { org_id: 'org-1' },
      db: async () => { const error = new Error('duplicate'); error.code = '23505'; throw error; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(409);
    expect(res.result.body.error).toBe('container_number_exists');
  });

  test('applies condition and ownership filters in SQL using bound values', async () => {
    const res = response();
    const calls = [];
    await routeLayer('/containers', 'get')({
      query: { condition: 'damaged', ownership: 'owned', search: 'MSCU', limit: '25', offset: '0' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return /COUNT\(\*\)/.test(sql) ? { rows: [{ count: '2' }] } : { rows: [{ id: 'container-1' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.body.total).toBe(2);
    expect(calls[0].sql).toContain('t.condition=$2');
    expect(calls[0].sql).toContain('t.ownership=$3');
    expect(calls[0].values).toEqual(['%MSCU%', 'damaged', 'owned', 25, 0]);
  });

  test('rejects unknown condition filters rather than silently widening results', async () => {
    const res = response();
    let dbCalls = 0;
    await routeLayer('/containers', 'get')({
      query: { condition: 'unsafe-filter' },
      db: async () => { dbCalls += 1; return { rows: [] }; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(400);
    expect(res.result.body.error).toBe('invalid_condition_filter');
    expect(dbCalls).toBe(0);
  });

  test('does not permit generic PATCH to change operational movement status', async () => {
    const res = response();
    let dbCalls = 0;
    await routeLayer('/containers/:id', 'patch')({
      params: { id: 'container-1' },
      body: { status: 'delivered' },
      db: async () => { dbCalls += 1; return { rows: [] }; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(400);
    expect(res.result.body.error).toBe('No fields to update');
    expect(dbCalls).toBe(0);
  });
});
