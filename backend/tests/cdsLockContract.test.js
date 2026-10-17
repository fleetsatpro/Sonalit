const router = require('../src/routes/cds');

function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error('no GET route registered for ' + path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('GET /cds/locks operational joins', () => {
  it('returns container and vehicle identifiers using same-organisation joins', async () => {
    const calls = [];
    let body;
    const row = { id: 'lock-1', serial: 'LOCK-001', container_number: 'MSKU1234567', truck: 'KDA 123A' };
    const req = {
      query: {},
      db: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '1' }] };
        return { rows: [row] };
      },
    };
    const res = { json: value => { body = value; } };
    await handlerFor('/locks')(req, res, err => { if (err) throw err; });
    expect(body.data).toEqual([row]);
    expect(body.total).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('LEFT JOIN cds_containers c');
    expect(calls[0].sql).toContain('LEFT JOIN cds_vehicles v');
    expect(calls[0].sql).toContain('c.org_id=t.org_id');
    expect(calls[0].sql).toContain('v.org_id=t.org_id');
    expect(calls[0].sql).toContain('t.deleted_at IS NULL');
  });
});
