'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.CLIENT_JWT_SECRET = 'test-client-secret';
process.env.CENTRIFUGO_TOKEN_HMAC_SECRET = 'test-centrifugo-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const MINE = '11111111-1111-1111-1111-111111111111';
const THEIRS = '22222222-2222-2222-2222-222222222222';

// Stand in for clientAuth: a signed-in portal client linked to exactly one
// convoy. The point of these tests is what happens *after* authentication.
jest.mock('../src/middleware/clientAuth', () => ({
  clientAuth: (req, _res, next) => {
    req.client = { client_id: 'client-1', org_id: 'org-a', convoy_ids: [MINE] };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/portal/auth', require('../src/routes/portalAuth'));
  return app;
}

// Centrifugo trusts the channel named inside the token it is handed, so this
// endpoint decides what a portal client can read. It signed whatever channel
// the request body asked for; these cover the shapes that mattered.

describe('POST /portal/auth/rt-sub-token channel authorisation', () => {
  test('signs a token for a convoy the client is linked to', async () => {
    const res = await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({ channel: `portal#${MINE}` })
      .expect(200);

    const claims = jwt.verify(res.body.data.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.channel).toBe(`portal#${MINE}`);
    expect(claims.sub).toBe('portal_client:client-1');
  });

  test('refuses another client convoy', async () => {
    await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({ channel: `portal#${THEIRS}` })
      .expect(403);
  });

  test('refuses an operator org channel', async () => {
    await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({ channel: 'org#org-a' })
      .expect(403);
  });

  test('refuses a bare convoy id with no portal prefix', async () => {
    await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({ channel: MINE })
      .expect(403);
  });

  test('refuses a prefix that only looks right', async () => {
    // portal#<mine> must match exactly — not merely appear somewhere.
    for (const channel of [
      `xportal#${MINE}`,
      `portal#${MINE}extra`,
      `portal#${THEIRS}#${MINE}`,
      'portal#',
    ]) {
      await request(makeApp())
        .post('/api/v1/portal/auth/rt-sub-token')
        .send({ channel })
        .expect(403);
    }
  });

  test('still rejects a missing or non-string channel', async () => {
    await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({})
      .expect(400);
    await request(makeApp())
      .post('/api/v1/portal/auth/rt-sub-token')
      .send({ channel: 42 })
      .expect(400);
  });
});
