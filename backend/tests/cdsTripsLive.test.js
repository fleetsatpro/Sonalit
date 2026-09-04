/**
 * GET /cds/trips/live — the query behind Live Operations.
 *
 * The panel used to call GET /trips?status=dispatched. That filter is a
 * single-value equality, so a truck that had passed a checkpoint, was running
 * late, or had reached the port was reported as zero active trips while it was
 * on the road. These tests pin the status set and the phase mapping, because
 * that regression is invisible in the UI until someone with real trips looks at
 * an empty board.
 */
const router = require('../src/routes/cds');

// Reaches into the router's own stack rather than re-implementing the handler,
// so the test exercises the route that actually serves requests.
function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`no GET route registered for ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callLive(rows = []) {
  const captured = {};
  const req = {
    query: {},
    db: (sql, params) => { captured.sql = sql; captured.params = params; return Promise.resolve({ rows }); },
  };
  let body;
  const res = { json: b => { body = b; } };
  await handlerFor('/trips/live')(req, res, err => { if (err) throw err; });
  return { body, ...captured };
}

describe('route registration', () => {
  it('registers /trips/live before /trips/:id, or the literal is read as an id', () => {
    const paths = router.stack.filter(l => l.route && l.route.methods.get).map(l => l.route.path);
    expect(paths).toContain('/trips/live');
    expect(paths.indexOf('/trips/live')).toBeLessThan(paths.indexOf('/trips/:id'));
  });
});

describe('which trips count as open', () => {
  it('includes every status a vehicle can be out on, not just dispatched', async () => {
    const { params } = await callLive();
    const statuses = params[0];
    for (const s of ['dispatched', 'checkpoint', 'delayed', 'at_port', 'lock_removed']) {
      expect(statuses).toContain(s);
    }
  });

  it('includes the pre-departure statuses, so assigned work is never invisible', async () => {
    const { params } = await callLive();
    const statuses = params[0];
    for (const s of ['created', 'vehicle_assigned', 'driver_assigned', 'awaiting_lock', 'locked']) {
      expect(statuses).toContain(s);
    }
  });

  it('excludes finished trips', async () => {
    const { params } = await callLive();
    for (const s of ['delivered', 'completed', 'archived']) {
      expect(params[0]).not.toContain(s);
    }
  });

  it('covers every status the trips table allows, so none is silently dropped', async () => {
    // Mirrors the CHECK constraint in migration 073. If a status is added to the
    // schema and not classified here, this fails rather than quietly vanishing
    // from the control room.
    const SCHEMA_STATUSES = [
      'created', 'vehicle_assigned', 'driver_assigned', 'awaiting_lock', 'locked',
      'dispatched', 'checkpoint', 'delayed', 'at_port', 'delivered', 'lock_removed',
      'completed', 'archived',
    ];
    const { params } = await callLive();
    const open = params[0];
    const finished = ['delivered', 'completed', 'archived'];
    expect([...open, ...finished].sort()).toEqual([...SCHEMA_STATUSES].sort());
  });

  it('filters soft-deleted trips and joins the last fix per vehicle', async () => {
    const { sql } = await callLive();
    expect(sql).toContain('t.deleted_at IS NULL');
    expect(sql).toContain('cds_gps_history');
    expect(sql).toMatch(/ORDER BY device_time DESC\s+LIMIT 1/);
  });

  it('sorts trips with a fix ahead of trips without one', async () => {
    const { sql } = await callLive();
    expect(sql).toContain('(gps.device_time IS NULL)');
  });
});

describe('phase', () => {
  const phaseOf = async status => {
    const { body } = await callLive([{ id: 't1', status }]);
    return body.data[0].phase;
  };

  it('calls a moving truck moving', async () => {
    expect(await phaseOf('dispatched')).toBe('moving');
    expect(await phaseOf('checkpoint')).toBe('moving');
    expect(await phaseOf('delayed')).toBe('moving');
  });

  it('separates at-port from moving, since the work there is different', async () => {
    expect(await phaseOf('at_port')).toBe('at_port');
    expect(await phaseOf('lock_removed')).toBe('at_port');
  });

  it('calls anything before departure staged', async () => {
    expect(await phaseOf('locked')).toBe('staged');
    expect(await phaseOf('created')).toBe('staged');
  });

  it('never leaves a row without a phase', async () => {
    expect(await phaseOf('some_status_added_later')).toBe('staged');
  });

  it('passes the trip rows through untouched apart from the phase', async () => {
    const row = { id: 't1', status: 'dispatched', trip_number: 'CDS-1001', lat: '-4.04', lng: '39.66' };
    const { body } = await callLive([row]);
    expect(body.data[0]).toMatchObject(row);
  });
});
