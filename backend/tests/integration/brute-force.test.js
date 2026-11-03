/**
 * T1.5 — CFO PIN brute-force protection test
 * After 5 wrong attempts the endpoint must return 423 Locked.
 *
 * Requires DATABASE_URL and an enrolled Guardian CFO device token.
 * Skips gracefully when not configured.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');
const { app } = require('../../src/app');
const { query } = require('../../src/config/database');

const skip = () => !process.env.DATABASE_URL || !process.env.TEST_DEVICE_TOKEN;
const DEVICE_TOKEN = process.env.TEST_DEVICE_TOKEN || '';

beforeAll(async () => {
  if (skip()) return;
  // Clear any existing lock state for this test device
  const devRes = await query(`SELECT id FROM guardian_devices WHERE token = $1`, [DEVICE_TOKEN]);
  if (devRes.rows.length) {
    await query(`DELETE FROM cfo_login_attempts WHERE device_id = $1`, [devRes.rows[0].id]);
  }
});

test('5 wrong attempts triggers 423 on 6th attempt', async () => {
  if (skip()) return;

  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/v1/guardian/cfo/login')
      .set('X-Device-Token', DEVICE_TOKEN)
      .send({ email: 'cfo@fleetops.local', password: 'wrongpassword' });
  }

  const res = await request(app)
    .post('/api/v1/guardian/cfo/login')
    .set('X-Device-Token', DEVICE_TOKEN)
    .send({ email: 'cfo@fleetops.local', password: 'wrongpassword' });

  expect(res.status).toBe(423);
  expect(res.body.code).toBe('account_locked');
});
