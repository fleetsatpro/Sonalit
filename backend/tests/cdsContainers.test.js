const router = require('../src/routes/cds');
const crypto = require('crypto');

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
    expect(statement.match(/INSERT INTO cds_containers \(([^)]+)\)/)?.[1]).toMatch(/\bstatus\b/);
    expect(parameters).toContain('MSCU6639870');
    expect(parameters).toContain('available');
    expect(parameters).not.toContain('in_transit');
    expect(parameters).toContain('org-1');
  });

  test('places damaged and retired intake records into maintenance', async () => {
    for (const condition of ['damaged', 'retired']) {
      const res = response();
      let parameters = [];
      await routeLayer('/containers', 'post')({
        body: { ...validInput(), condition, status: 'available' },
        user: { org_id: 'org-1' },
        db: async (_sql, values) => {
          parameters = values;
          return { rows: [{ id: 'container-1', number: 'MSCU6639870', status: 'maintenance' }] };
        },
      }, res, error => { if (error) throw error; });

      expect(res.result.status).toBe(201);
      expect(parameters).toContain('maintenance');
      expect(parameters).not.toContain('available');
    }
  });

  test('rejects an equipment size that conflicts with its selected type', async () => {
    const res = response();
    let dbCalls = 0;
    await routeLayer('/containers', 'post')({
      body: { ...validInput(), iso_type: '40GP', container_size: 20 },
      user: { org_id: 'org-1' },
      db: async () => { dbCalls += 1; return { rows: [] }; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(400);
    expect(res.result.body.error).toBe('invalid_container_size');
    expect(dbCalls).toBe(0);
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
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return /COUNT\(\*\)/.test(sql) ? { rows: [{ count: '2' }] } : { rows: [{ id: 'container-1' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.body.total).toBe(2);
    expect(calls[0].sql).toContain('c.org_id=$1');
    expect(calls[0].sql).toContain('c.condition=$3');
    expect(calls[0].sql).toContain('c.ownership=$4');
    expect(calls[0].values).toEqual(['org-1', '%MSCU%', 'damaged', 'owned', 25, 0]);
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
    expect(res.result.body.error).toBe('container_status_transition_required');
    expect(dbCalls).toBe(0);
  });

  test('does not permit generic PATCH to rewrite container identity', async () => {
    const res = response();
    let dbCalls = 0;
    await routeLayer('/containers/:id', 'patch')({
      params: { id: 'container-1' },
      body: { number: 'CSQU3054383' },
      db: async () => { dbCalls += 1; return { rows: [] }; },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(400);
    expect(res.result.body.error).toBe('container_identity_immutable');
    expect(dbCalls).toBe(0);
  });

  test('moves a damaged condition update into maintenance server-side', async () => {
    const res = response();
    let sql = '';
    let parameters = [];
    await routeLayer('/containers/:id', 'patch')({
      params: { id: 'container-1' },
      body: { condition: 'damaged' },
      db: async (query, values) => {
        sql = query;
        parameters = values;
        return { rows: [{ id: 'container-1', condition: 'damaged', status: 'maintenance' }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(200);
    expect(sql).toContain('status=$');
    expect(parameters).toContain('maintenance');
    expect(parameters).not.toContain('available');
  });
});


describe('CDS container custody history', () => {
  const orgId = 'org-1';
  const containerId = 'container-1';
  const bookingContainerId = 'booking-container-1';

  function validClampEvent(overrides = {}) {
    const values = {
      seq: 0,
      kind: 'clamped',
      booking_container_id: bookingContainerId,
      org_id: orgId,
      actor_user_id: 'user-1',
      actor_name: 'Yard lead',
      seal_number: 'SEAL-01',
      seal_intact: true,
      lock_serial: 'LOCK-01',
      lat: null,
      lng: null,
      notes: 'Clamped at yard',
      prev_hash: null,
      ...overrides,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
    return {
      event_id: 'custody-event-1',
      booking_container_id: bookingContainerId,
      trip_id: 'trip-1',
      ...values,
      hash,
      created_at: '2026-11-04T08:30:00.000Z',
      booking_number: 'BK-1001',
      trip_number: 'CDS-1001',
      transporter_name: 'Recorded Transport Ltd',
      vehicle_registration: 'KDA 123A',
      driver_name: 'Recorded Driver',
      driver_contact: '+254700000000',
      assigned_lock: 'LOCK-01',
      has_clamp_audit_snapshot: true,
    };
  }

  async function callHistory(rowsByCall) {
    const calls = [];
    const res = response();
    let index = 0;
    await routeLayer('/containers/:id/history', 'get')({
      params: { id: containerId },
      user: { org_id: orgId },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return rowsByCall[index++] || { rows: [] };
      },
    }, res, error => { if (error) throw error; });
    return { calls, result: res.result };
  }

  test('uses the clamp-time audit snapshot for each custody event assignment', async () => {
    const event = validClampEvent();
    const { calls, result } = await callHistory([
      { rows: [{ id: containerId, number: 'MSCU6639870' }] },
      { rows: [event] },
      { rows: [] },
    ]);

    expect(result.status).toBe(200);
    expect(result.body.chain_status).toBe('VERIFIED');
    expect(result.body.data[0]).toMatchObject({
      kind: 'clamped',
      lock_serial: 'LOCK-01',
      driver_name: 'Recorded Driver',
      vehicle_registration: 'KDA 123A',
      transporter_name: 'Recorded Transport Ltd',
      assignment_source: 'clamp_audit_snapshot',
    });
    expect(calls[1].sql).toContain("clamp_audit.after_data->>'driver_name'");
    expect(calls[1].sql).toContain("clamp_audit.after_data->>'truck_reg'");
    expect(calls[1].sql).toContain("COALESCE(ce.lock_serial, clamp_audit.after_data->>'lock_serial'");
    expect(calls[1].sql).toContain("a.action='clamp'");
    expect(calls[1].sql).toContain('a.org_id=bc.org_id');
    expect(calls[1].sql).toContain("COALESCE(clamp_audit.after_data->>'driver_name', bc.driver_name) AS driver_name");
    expect(calls[1].sql).toContain("COALESCE(clamp_audit.after_data->>'truck_reg', bc.horse_reg) AS vehicle_registration");
    expect(calls[1].sql).toContain("COALESCE(clamp_audit.after_data->>'transporter_name', bc.transporter_name) AS transporter_name");
  });

  test('keeps tenant scope on the container identity, custody chain and audit snapshot', async () => {
    const { calls, result } = await callHistory([
      { rows: [{ id: containerId, number: 'MSCU6639870' }] },
      { rows: [] },
      { rows: [] },
    ]);

    expect(result.status).toBe(200);
    expect(calls[0].sql).toContain('org_id=$2');
    expect(calls[1].sql).toContain('ce.org_id=$1');
    expect(calls[1].sql).toContain('bc.org_id=$1');
    expect(calls[1].sql).toContain('a.org_id=bc.org_id');
  });

  test('preserves clamp-time assignment context for legacy manifest-only events', async () => {
    const { calls, result } = await callHistory([
      { rows: [{ id: containerId, number: 'MSCU6639870' }] },
      { rows: [] },
      { rows: [{
        booking_container_id: bookingContainerId,
        booking_id: 'booking-1',
        clamped_at: '2026-11-04T08:30:00.000Z',
        unclamped_at: '2026-11-04T12:30:00.000Z',
        lock_number: 'LEGACY-LOCK',
        driver_name: 'Mutable manifest driver',
        driver_contact: '+254711111111',
        horse_reg: 'KDA 111A',
        transporter_name: 'Mutable manifest transporter',
        booking_number: 'BK-1001',
        trip_id: 'trip-1',
        trip_number: 'CDS-1001',
        clamp_actor: 'Yard lead',
        unclamp_actor: 'Port lead',
        audit_lock_serial: 'LOCK-AT-CLAMP',
        audit_driver_name: 'Original driver',
        audit_driver_contact: '+254700000012',
        audit_vehicle_registration: 'KDA 222B',
        audit_transporter_name: 'Original transporter',
        has_clamp_audit_snapshot: true,
      }] },
    ]);

    expect(result.body.chain_status).toBe('NO_LEDGER');
    expect(result.body.data).toHaveLength(2);
    expect(result.body.data[0]).toMatchObject({
      kind: 'clamped',
      lock_serial: 'LOCK-AT-CLAMP',
      driver_name: 'Original driver',
      driver_contact: '+254700000012',
      vehicle_registration: 'KDA 222B',
      transporter_name: 'Original transporter',
      assignment_source: 'clamp_audit_snapshot',
      evidence_source: 'manifest_timestamp',
      integrity_verified: null,
    });
    expect(result.body.data[1]).toMatchObject({
      kind: 'unclamped',
      lock_serial: 'LOCK-AT-CLAMP',
      driver_name: 'Original driver',
      driver_contact: '+254700000012',
      vehicle_registration: 'KDA 222B',
      transporter_name: 'Original transporter',
      assignment_source: 'clamp_audit_snapshot',
      evidence_source: 'manifest_timestamp',
      integrity_verified: null,
    });
    expect(calls[2].sql).toContain("ca.after_data->>'driver_name'");
    expect(calls[2].sql).toContain("ca.after_data->>'driver_phone'");
    expect(calls[2].sql).toContain("ca.after_data->>'truck_reg'");
  });
});

describe('CDS container register assignment snapshot query', () => {
  test('uses clamp-time audit data ahead of mutable trip and manifest fields', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/containers', 'get')({
      query: { limit: '25', offset: '0' },
      user: { org_id: 'org-1' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return /COUNT\(\*\)/.test(sql) ? { rows: [{ count: '0' }] } : { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(200);
    expect(calls[0].sql).toContain("clamp_audit.after_data->>'driver_name'");
    expect(calls[0].sql).toContain("clamp_audit.after_data->>'truck_reg'");
    expect(calls[0].sql).toContain("COALESCE(ce.lock_serial, clamp_audit.after_data->>'lock_serial'");
    expect(calls[0].sql).toContain('bc.org_id=c.org_id');
    expect(calls[0].sql).toContain('a.org_id=bc.org_id');
    expect(calls[0].sql).toContain("COALESCE(clamp_audit.after_data->>'driver_name', bc.driver_name) AS driver_name_resolved");
    expect(calls[0].sql).toContain("COALESCE(clamp_audit.after_data->>'truck_reg', bc.horse_reg) AS vehicle_registration");
  });
});

describe('CDS unclamp lock identity', () => {
  test('releases and records the lock from the clamp audit, not the mutable trip assignment', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/bookings/:id/containers/:cid/unclamp', 'post')({
      params: { id: 'booking-1', cid: 'booking-container-1' },
      body: { seal_intact: false, observed_seal: 'BROKEN', notes: 'Seal discrepancy' },
      user: { id: 'port-user', org_id: 'org-1', name: 'Port lead', email: 'port@example.test' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('SELECT bc.*, b.booking_number, t.id AS trip_id')) {
          return { rows: [{
            id: 'booking-container-1',
            booking_id: 'booking-1',
            booking_number: 'BK-1001',
            container_number: 'MSCU6639870',
            status: 'in_transit',
            lock_number: 'MUTABLE-MANIFEST-LOCK',
            lock_id: 'MUTABLE-TRIP-LOCK',
            clamp_lock_serial: 'LOCK-AT-CLAMP',
            clamp_lock_id: 'lock-original',
            trip_id: null,
            clamped_at: '2026-11-04T08:30:00.000Z',
            unclamped_at: null,
            seal_number: 'SEAL-01',
          }] };
        }
        if (sql.includes('UPDATE cds_booking_containers')) {
          return { rows: [{ id: 'booking-container-1' }] };
        }
        if (sql.includes('SELECT COUNT(*)::int AS c FROM cds_booking_containers')) {
          return { rows: [{ c: 1 }] };
        }
        if (sql.includes('SELECT hash, seq FROM cds_custody_events')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(200);
    const lookup = calls[0];
    expect(lookup.sql).toContain("COALESCE(clamp_audit.after_data->>'lock_serial', bc.lock_number) AS clamp_lock_serial");
    expect(lookup.sql).toContain('bc.org_id=$3 AND b.org_id=$3');
    const lockRelease = calls.find(call => call.sql.includes('UPDATE cds_electronic_locks'));
    expect(lockRelease.values).toEqual(['lock-original', 'org-1']);
    const custodyInsert = calls.find(call => call.sql.includes('INSERT INTO cds_custody_events'));
    expect(custodyInsert.values[11]).toBe('LOCK-AT-CLAMP');
    const tamperLockEvent = calls.find(call => call.sql.includes('INSERT INTO cds_lock_events'));
    expect(tamperLockEvent.values[1]).toBe('lock-original');
  });
});


describe('CDS unclamp evidence validation', () => {
  test('refuses to deliver or release a lock when the container has no open clamp', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/bookings/:id/containers/:cid/unclamp', 'post')({
      params: { id: 'booking-1', cid: 'booking-container-1' },
      body: { seal_intact: true, observed_seal: 'SEAL-01' },
      user: { id: 'port-user', org_id: 'org-1', name: 'Port lead' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{
          id: 'booking-container-1', booking_id: 'booking-1', booking_number: 'BK-1001',
          status: 'assigned', clamped_at: null, unclamped_at: null,
          seal_number: 'SEAL-01', clamp_lock_id: null, clamp_lock_serial: null,
        }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(409);
    expect(res.result.body.error).toBe('container_not_currently_clamped');
    expect(calls).toHaveLength(1);
  });

  test('does not treat a client-reported intact seal as verified without an observed comparison', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/bookings/:id/containers/:cid/unclamp', 'post')({
      params: { id: 'booking-1', cid: 'booking-container-1' },
      body: { seal_intact: true, notes: 'No physical seal number was entered' },
      user: { id: 'port-user', org_id: 'org-1', name: 'Port lead' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('SELECT bc.*, b.booking_number, t.id AS trip_id')) {
          return { rows: [{
            id: 'booking-container-1', booking_id: 'booking-1', booking_number: 'BK-1001',
            container_number: 'MSCU6639870', status: 'in_transit',
            lock_number: 'LOCK-01', clamp_lock_serial: 'LOCK-01', clamp_lock_id: null,
            trip_id: null, clamped_at: '2026-11-04T08:30:00.000Z', unclamped_at: null,
            seal_number: 'SEAL-01',
          }] };
        }
        if (sql.includes('UPDATE cds_booking_containers')) {
          return { rows: [{ id: 'booking-container-1' }] };
        }
        if (sql.includes('SELECT COUNT(*)::int AS c FROM cds_booking_containers')) {
          return { rows: [{ c: 1 }] };
        }
        if (sql.includes('SELECT hash, seq FROM cds_custody_events')) return { rows: [] };
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(200);
    const custodyInsert = calls.find(call => call.sql.includes('INSERT INTO cds_custody_events'));
    expect(custodyInsert.values[10]).toBeNull();
    const auditInsert = calls.find(call => call.sql.includes("VALUES ('unclamp','booking_container'"));
    expect(JSON.parse(auditInsert.values[3]).seal_intact).toBeNull();
    expect(JSON.parse(auditInsert.values[3]).seal_observed).toBeNull();
  });


  test('a concurrent second unclamp loses the compare-and-set and emits no duplicate custody event', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/bookings/:id/containers/:cid/unclamp', 'post')({
      params: { id: 'booking-1', cid: 'booking-container-1' },
      body: { seal_intact: false },
      user: { id: 'port-user', org_id: 'org-1', name: 'Port lead' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('SELECT bc.*, b.booking_number, t.id AS trip_id')) {
          return { rows: [{
            id: 'booking-container-1', booking_id: 'booking-1', booking_number: 'BK-1001',
            status: 'in_transit', clamped_at: '2026-11-04T08:30:00.000Z', unclamped_at: null,
            seal_number: 'SEAL-01', clamp_lock_id: 'lock-original', clamp_lock_serial: 'LOCK-01',
          }] };
        }
        if (sql.includes('UPDATE cds_booking_containers')) return { rows: [] };
        return { rows: [] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(409);
    expect(res.result.body.error).toBe('container_not_currently_clamped');
    expect(calls.some(call => call.sql.includes('UPDATE cds_electronic_locks'))).toBe(false);
    expect(calls.some(call => call.sql.includes('INSERT INTO cds_custody_events'))).toBe(false);
  });

  test('rejects an already-unclamped manifest row', async () => {
    const calls = [];
    const res = response();
    await routeLayer('/bookings/:id/containers/:cid/unclamp', 'post')({
      params: { id: 'booking-1', cid: 'booking-container-1' },
      body: {},
      user: { id: 'port-user', org_id: 'org-1', name: 'Port lead' },
      db: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [{
          id: 'booking-container-1', booking_id: 'booking-1', booking_number: 'BK-1001',
          status: 'in_transit',
          clamped_at: '2026-11-04T08:30:00.000Z',
          unclamped_at: '2026-11-04T12:30:00.000Z',
          seal_number: 'SEAL-01', clamp_lock_id: null,
        }] };
      },
    }, res, error => { if (error) throw error; });

    expect(res.result.status).toBe(409);
    expect(res.result.body.error).toBe('container_not_currently_clamped');
    expect(calls).toHaveLength(1);
  });
});
