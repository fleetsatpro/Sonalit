const router = require('../src/routes/cds');

describe('CDS alert acknowledgement contract', () => {
  it('exposes acknowledgement as POST, matching the client mutation', () => {
    const post = router.stack.find(layer => layer.route && layer.route.path === '/alerts/:id/acknowledge' && layer.route.methods.post);
    const patch = router.stack.find(layer => layer.route && layer.route.path === '/alerts/:id/acknowledge' && layer.route.methods.patch);
    expect(post).toBeTruthy();
    expect(patch).toBeFalsy();
  });

  it('writes acknowledgement to the database and returns the persisted alert', async () => {
    const layer = router.stack.find(entry => entry.route && entry.route.path === '/alerts/:id/acknowledge' && entry.route.methods.post);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const calls = [];
    const alert = { id: 'alert-1', acknowledged: true };
    let body;
    const req = {
      params: { id: 'alert-1' },
      user: { id: 'user-1' },
      db: async (sql, params) => { calls.push({ sql, params }); return { rows: [alert] }; },
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    await handler(req, res, error => { if (error) throw error; });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('UPDATE cds_alerts SET acknowledged=true');
    expect(calls[0].params).toEqual(['user-1', 'alert-1']);
    expect(body).toEqual({ data: alert });
  });
});
