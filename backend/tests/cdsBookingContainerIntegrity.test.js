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

const beforeManifest = {
  id: 'manifest-1',
  booking_id: 'booking-1',
  org_id: 'org-1',
  container_number: 'CSQU3054383',
  seal_number: 'SEAL-00427',
  status: 'in_transit',
  yard_status: 'inbound',
  trip_id: 'trip-1',
  deleted_at: null,
};

async function callMutation(path, method, body, db) {
  const req = {
    params: { id: 'booking-1', cid: 'manifest-1' },
    body,
    user: { id: 'operator-1', name: 'Operations Desk', org_id: 'org-1' },
    ip: '192.0.2.10',
    get: () => 'CDS integrity test',
    db,
    dbTx: async fn => fn(),
  };
  const res = response();
  let forwarded;
  await handlerFor(path, method)(req, res, error => { forwarded = error; });
  if (forwarded) throw forwarded;
  return res;
}

describe('booking-container lifecycle integrity', () => {
  test('generic manifest patch cannot set lifecycle or custody fields', async () => {
    const statements = [];
    const db = async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT * FROM cds_booking_containers')) return { rows: [beforeManifest] };
      return { rows: [] };
    };
    const res = await callMutation('/bookings/:id/containers/:cid', 'patch', {
      status: 'delivered',
      clamped_at: new Date().toISOString(),
      unclamped_at: new Date().toISOString(),
      yard_status: 'complete',
    }, db);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('nothing_to_update');
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('FOR UPDATE');
  });

  test.each([
    [{ container_number: 'CSQU3054384' }, 'container_number'],
    [{ seal_number: 'SEAL-99999' }, 'seal_number'],
    [{ seal_number_2: 'SEAL-99998' }, 'seal_number_2'],
    [{ iso_type: '40HC' }, 'iso_type'],
  ])('locks container identity and seal fields after custody begins (%s)', async (body) => {
    const statements = [];
    const db = async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT * FROM cds_booking_containers')) return { rows: [beforeManifest] };
      if (sql.includes('SELECT COUNT(*)::int AS count FROM cds_custody_events')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    };
    const res = await callMutation('/bookings/:id/containers/:cid', 'patch', body, db);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('manifest_identity_fields_locked_after_custody_begins');
    expect(statements.some(statement => statement.sql.startsWith('UPDATE cds_booking_containers'))).toBe(false);
  });

  test('prevents deleting a manifest after custody events have been appended', async () => {
    const statements = [];
    const db = async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT * FROM cds_booking_containers')) return { rows: [beforeManifest] };
      if (sql.includes('SELECT COUNT(*)::int AS count FROM cds_custody_events')) return { rows: [{ count: 2 }] };
      return { rows: [] };
    };
    const res = await callMutation('/bookings/:id/containers/:cid', 'delete', {}, db);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('custody_tracked_manifest_cannot_be_removed');
    expect(statements.some(statement => statement.sql.startsWith('UPDATE cds_booking_containers'))).toBe(false);
  });

  test('prevents deleting a manifest while its trip is linked even if no custody event exists', async () => {
    const statements = [];
    const db = async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT * FROM cds_booking_containers')) return { rows: [{ ...beforeManifest, trip_id: 'trip-1' }] };
      if (sql.includes('SELECT COUNT(*)::int AS count FROM cds_custody_events')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    };
    const res = await callMutation('/bookings/:id/containers/:cid', 'delete', {}, db);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('custody_tracked_manifest_cannot_be_removed');
    expect(statements.some(statement => statement.sql.startsWith('UPDATE cds_booking_containers'))).toBe(false);
  });
});
