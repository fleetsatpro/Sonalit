/**
 * T1.3 — Guardian command replay protection test
 * Issues the same signed command twice; second attempt must return 409.
 *
 * Uses supertest against the running app. Requires DATABASE_URL.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request = require('supertest');
const { app } = require('../../src/app');

const skip = () => !process.env.DATABASE_URL;

let adminToken = '';
let testDeviceId = '';
const nonce = `replay-test-nonce-${Date.now()}`;

beforeAll(async () => {
  if (skip()) return;
  // Login as admin
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@fleetops.local', password: 'password123' });
  adminToken = loginRes.body.token || '';

  if (!adminToken) return;

  // Get first available device
  const devRes = await request(app)
    .get('/api/v1/guardian/devices?limit=1')
    .set('Authorization', `Bearer ${adminToken}`);
  testDeviceId = devRes.body.data?.[0]?.id || devRes.body[0]?.id || '';
});

test('first command with nonce returns 201', async () => {
  if (skip() || !adminToken || !testDeviceId) return;

  const res = await request(app)
    .post(`/api/v1/guardian/devices/${testDeviceId}/command`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ command_type: 'request_location', nonce, issued_at: new Date().toISOString() });

  expect(res.status).toBe(201);
});

test('replaying the same nonce returns 409 replay_detected', async () => {
  if (skip() || !adminToken || !testDeviceId) return;

  const res = await request(app)
    .post(`/api/v1/guardian/devices/${testDeviceId}/command`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ command_type: 'request_location', nonce, issued_at: new Date().toISOString() });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('replay_detected');
});

test('command without nonce returns 400', async () => {
  if (skip() || !adminToken || !testDeviceId) return;

  const res = await request(app)
    .post(`/api/v1/guardian/devices/${testDeviceId}/command`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ command_type: 'request_location' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/nonce/i);
});
