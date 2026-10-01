'use strict';

process.env.CENTRIFUGO_TOKEN_HMAC_SECRET = 'test-centrifugo-secret';

jest.mock('../../src/middleware/fieldAuth', () => ({
  dualAuthenticate: (req, _res, next) => {
    req.user = { id: 'user-1', org_id: 'org-a' };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/realtime', require('../../src/routes/realtime'));
  return app;
}

describe('POST /realtime/subscription-token channel authorisation', () => {
  test('allows the exact organization channel', async () => {
    const res = await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'org#org-a' })
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('org-a');
    expect(claims.channel).toBe('org#org-a');
  });

  test('allows the exact risk update channel for the same organization', async () => {
    const res = await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'risk:updates:org-a' })
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('org-a');
    expect(claims.channel).toBe('risk:updates:org-a');
  });

  test('rejects another organization risk channel', async () => {
    await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'risk:updates:org-b' })
      .expect(403);
  });

  test('rejects portal/device/nested channel shapes', async () => {
    for (const channel of ['portal#convoy-1', 'org:org-a:device:1:commands', 'risk:updates:org-a:extra', 'org#org-b']) {
      await request(makeApp())
        .post('/api/v1/realtime/subscription-token')
        .send({ channel })
        .expect(403);
    }
  });
});