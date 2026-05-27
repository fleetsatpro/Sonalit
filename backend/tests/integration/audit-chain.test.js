/**
 * T1.6 — Audit log hash chain concurrency test
 * Spawns 20 concurrent audit writes and verifies the chain is unbroken.
 *
 * Requires DATABASE_URL.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { auditLog } = require('../../src/middleware/audit');

const skip = () => !process.env.DATABASE_URL;

const TEST_ORG = 'cccccccc-0000-0000-0000-000000000001';

// Private pool so this file's afterAll doesn't end the shared pool used by
// app.js controllers that may still be initialising in the same --runInBand run.
let pool;

beforeAll(() => {
  if (skip()) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
});

test('50 concurrent audit writes produce an unbroken hash chain', async () => {
  if (skip()) return;

  const mockReqs = Array.from({ length: 50 }, (_, i) => ({
    user: { id: `00000000-0000-0000-0000-00000000000${String(i).padStart(4, '0').slice(-4)}`, org_id: TEST_ORG },
    auditAction: 'INSERT',
    auditRecordId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    auditBefore: null,
    auditAfter: { value: i },
  }));

  // Build minimal mock express response objects
  const fakeReqRes = mockReqs.map(r => {
    let jsonCb = null;
    const res = {
      statusCode: 200,
      json: (fn) => { jsonCb = fn; return res; },
      _trigger: () => jsonCb && jsonCb({ ok: true }),
    };
    return { req: r, res };
  });

  // Wire up the auditLog middleware
  await Promise.all(
    fakeReqRes.map(({ req, res }) => new Promise((resolve) => {
      const middleware = auditLog('test_table');
      // Patch res.json so we can intercept and trigger the audit write
      const origJson = res.json.bind(res);
      middleware(req, res, () => {
        res._trigger();
        // Wait briefly for the async audit write to fire
        setTimeout(resolve, 200);
      });
    }))
  );

  // Give all concurrent writes time to settle
  await new Promise(r => setTimeout(r, 1000));

  // Validate chain
  const validResult = await pool.query(`SELECT validate_audit_chain($1) AS ok`, [TEST_ORG]);
  expect(validResult.rows[0].ok).toBe(true);

  // Cleanup
  await pool.query(`DELETE FROM audit_logs WHERE org_id = $1`, [TEST_ORG]);
}, 30000);

afterAll(async () => {
  if (pool) await pool.end();
});
