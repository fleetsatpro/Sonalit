/**
 * Departure over HTTP — the endpoint the yard actually taps, and the gate that
 * decides who may tap it.
 *
 * Two regressions these pin down, both invisible until real crews use them:
 *
 *  1. A field device authenticates as a real user with an id and an org, so
 *     classifying the actor by `req.user.id` files every yard departure as a
 *     control-room action. The distinction is the entire reason the column
 *     exists, and nothing downstream would flag the lie.
 *
 *  2. Yard accounts are least-privilege by design — the gate 403s everything
 *     outside the clamp flow. Adding a departure endpoint without widening the
 *     gate ships a screen whose every request is rejected, and the crew is the
 *     one that finds out.
 */
const router = require('../src/routes/cds');
const D = require('../src/utils/tripDeparture');

function routeLayer(path, method) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method.toUpperCase()} route registered for ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/**
 * The router-level role gate, found by what it does rather than by position —
 * an index would silently start testing a different middleware the next time
 * one is inserted above it.
 */
function roleGate() {
  const layer = router.stack.find(
    l => !l.route && typeof l.handle === 'function' && /field_role_restricted/.test(l.handle.toString()));
  if (!layer) throw new Error('role gate middleware not found on the cds router');
  return layer.handle;
}

/** Run the gate for one role/method/path and report whether it let the call through. */
function gate(role, method, path) {
  let allowed = false;
  let status = null;
  const res = { status: s => { status = s; return res; }, json: () => res };
  roleGate()({ user: { role }, method: method.toUpperCase(), path }, res, () => { allowed = true; });
  return { allowed, status };
}

describe('yard role gate', () => {
  test('a yard account can see and mark departures', () => {
    expect(gate('yard_agent', 'get', '/field/departures').allowed).toBe(true);
    expect(gate('yard_agent', 'post', '/trips/abc-123/depart').allowed).toBe(true);
  });

  test('departure does not open the rest of the trip surface', () => {
    // Marking a departure sets one timestamp. It must not become a way for a
    // shared yard tablet to read or edit trips generally.
    expect(gate('yard_agent', 'get', '/trips').allowed).toBe(false);
    expect(gate('yard_agent', 'get', '/trips/abc-123').allowed).toBe(false);
    expect(gate('yard_agent', 'post', '/trips/abc-123/transition').allowed).toBe(false);
    expect(gate('yard_agent', 'get', '/trips/abc-123/depart').allowed).toBe(false);
  });

  test('the port team is not given the yard’s job', () => {
    expect(gate('port_agent', 'get', '/field/departures').allowed).toBe(false);
    expect(gate('port_agent', 'post', '/trips/abc-123/depart').allowed).toBe(false);
  });

  test('control-room roles are untouched by the gate', () => {
    expect(gate('dispatcher', 'post', '/trips/abc-123/depart').allowed).toBe(true);
    expect(gate('admin', 'get', '/trips').allowed).toBe(true);
  });

  test('a rejected call says why, with a 403', () => {
    expect(gate('yard_agent', 'get', '/trips').status).toBe(403);
  });
});

describe('POST /trips/:id/depart', () => {
  const handler = () => routeLayer('/trips/:id/depart', 'post');

  function call(req) {
    let body; let status = 200;
    const res = {
      status: s => { status = s; return res; },
      json: b => { body = b; return res; },
    };
    return handler()(
      { params: { id: 'trip-1' }, body: {}, ...req },
      res,
      err => { if (err) throw err; },
    ).then(() => ({ body, status }));
  }

  const dbFor = (trip) => (sql) => {
    if (/SELECT id, status, departed_at/.test(sql)) return Promise.resolve({ rows: trip ? [trip] : [] });
    return Promise.resolve({ rows: [] });
  };

  beforeEach(() => {
    jest.spyOn(D, 'markDeparted').mockResolvedValue({
      trip: { id: 'trip-1', status: 'dispatched', departed_at: '2026-09-04T06:10:00.000Z' },
      already: false,
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('unknown trip is a 404, not a silent success', async () => {
    const { status } = await call({ db: dbFor(null), user: { id: 'u1', org_id: 'o1' } });
    expect(status).toBe(404);
    expect(D.markDeparted).not.toHaveBeenCalled();
  });

  test('a delivered trip cannot depart', async () => {
    // Departing after delivery is a data error, not a late correction.
    const { status, body } = await call({
      db: dbFor({ id: 'trip-1', status: 'delivered', departed_at: null }),
      user: { id: 'u1', org_id: 'o1' },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/delivered/);
    expect(D.markDeparted).not.toHaveBeenCalled();
  });

  test('a field device is recorded as the yard, not the control room', async () => {
    await call({
      db: dbFor({ id: 'trip-1', status: 'locked', departed_at: null }),
      // fieldAuthenticate populates req.user with a real id and org for a field
      // device, so only req.fieldDevice separates the two.
      user: { id: 'worker-1', org_id: 'o1', role: 'yard_agent' },
      fieldDevice: { id: 'dev-1' },
      body: { note: 'left via north gate' },
    });
    expect(D.markDeparted).toHaveBeenCalledWith(
      expect.anything(), 'o1', 'trip-1',
      expect.objectContaining({ source: 'manual', actorId: 'worker-1', note: 'left via north gate' }),
    );
  });

  test('an operator is recorded as the control room', async () => {
    const { body } = await call({
      db: dbFor({ id: 'trip-1', status: 'locked', departed_at: null }),
      user: { id: 'op-1', org_id: 'o1', role: 'dispatcher' },
    });
    expect(D.markDeparted).toHaveBeenCalledWith(
      expect.anything(), 'o1', 'trip-1',
      expect.objectContaining({ source: 'operator', actorId: 'op-1' }),
    );
    expect(body.data.source).toBe('operator');
  });

  test('the time the yard says it left is the time recorded', async () => {
    // An offline tablet syncs hours later; the departure still belongs to the
    // moment the worker tapped, or every transit metric drifts.
    await call({
      db: dbFor({ id: 'trip-1', status: 'locked', departed_at: null }),
      user: { id: 'w1', org_id: 'o1' }, fieldDevice: { id: 'dev-1' },
      body: { at: '2026-09-04T06:10:00.000Z' },
    });
    expect(D.markDeparted).toHaveBeenCalledWith(
      expect.anything(), 'o1', 'trip-1',
      expect.objectContaining({ at: '2026-09-04T06:10:00.000Z' }),
    );
  });

  test('a repeat tap reports "already", not an error', async () => {
    D.markDeparted.mockResolvedValue({
      trip: { id: 'trip-1', status: 'dispatched', departed_at: '2026-09-04T06:10:00.000Z' },
      already: true,
    });
    const { status, body } = await call({
      db: dbFor({ id: 'trip-1', status: 'dispatched', departed_at: '2026-09-04T06:10:00.000Z' }),
      user: { id: 'w1', org_id: 'o1' }, fieldDevice: { id: 'dev-1' },
    });
    expect(status).toBe(200);
    expect(body.data.already_departed).toBe(true);
  });
});

describe('GET /field/departures', () => {
  test('lists only trips that are clamped and have not left', async () => {
    let sql = '';
    const req = { query: {}, db: (q) => { sql = q; return Promise.resolve({ rows: [] }); } };
    await routeLayer('/field/departures', 'get')(req, { json: () => {} }, err => { if (err) throw err; });

    expect(sql).toMatch(/t\.departed_at IS NULL/);
    expect(sql).toMatch(/t\.status = 'locked'/);
    // `scanned` is what tells the crew which trucks need them: one that is
    // tracking will depart on its own telemetry, one that is not never will.
    expect(sql).toMatch(/AS scanned/);
  });
});
