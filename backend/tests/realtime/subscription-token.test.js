'use strict';

process.env.CENTRIFUGO_TOKEN_HMAC_SECRET = 'test-centrifugo-secret';

jest.mock('../../src/middleware/fieldAuth', () => ({
  dualAuthenticate: (req, _res, next) => {
    req.user = { id: 'user-1', org_id: 'org-a', role: 'operator' };
    if (typeof req.app.locals.dbTx === 'function') req.dbTx = req.app.locals.dbTx;
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

function makeApp(dbTx) {
  const app = express();
  if (typeof dbTx === 'function') app.locals.dbTx = dbTx;
  app.use(express.json());
  app.use('/api/v1/realtime', require('../../src/routes/realtime'));
  return app;
}

describe('POST /realtime/subscription-token channel authorisation', () => {
  test('binds the Centrifugo connection token to the authenticated user, not the tenant', async () => {
    const res = await request(makeApp())
      .post('/api/v1/realtime/token')
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('user-1');
  });

  test('allows the exact organization channel', async () => {
    const res = await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'org#org-a' })
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.channel).toBe('org#org-a');
  });

  test('allows the exact risk update channel for the same organization', async () => {
    const res = await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'risk:updates:org-a' })
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.channel).toBe('risk:updates:org-a');
  });

  test('rejects another organization risk channel', async () => {
    await request(makeApp())
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'risk:updates:org-b' })
      .expect(403);
  });

  test('allows an exact private SJM comms channel only for a current channel member', async () => {
    const channelId = 'cccccccc-0000-0000-0000-000000000001';
    const journeyId = '11111111-2222-4333-8444-555555555555';
    const calls = [];
    const dbTx = async (work) => work({ query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM channels/.test(sql)) {
        return { rows: [{ id: channelId, org_id: 'org-a', sjm_journey_id: journeyId }] };
      }
      if (/FROM sjm_journeys/.test(sql)) return { rows: [{ id: journeyId }] };
      if (/FROM sjm_journey_participants/.test(sql)) return { rows: [{ one: 1 }] };
      if (/FROM channel_members/.test(sql)) return { rows: [{ user_id: 'user-1' }] };
      return { rows: [] };
    } });
    const channel = `org#org-a#comms#${channelId}`;
    const res = await request(makeApp(dbTx))
      .post('/api/v1/realtime/subscription-token')
      .send({ channel })
      .expect(200);
    const claims = jwt.verify(res.body.token, process.env.CENTRIFUGO_TOKEN_HMAC_SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.channel).toBe(channel);
    expect(calls.some(c => /deleted_at IS NULL FOR SHARE/.test(c.sql))).toBe(true);
    expect(calls.findIndex(c => /FOR SHARE/.test(c.sql))).toBeLessThan(calls.findIndex(c => /FROM sjm_journey_participants/.test(c.sql)));
    expect(calls.findIndex(c => /FROM sjm_journey_participants/.test(c.sql))).toBeLessThan(calls.findIndex(c => /FROM channel_members/.test(c.sql)));
  });

  test('rejects private comms subscription when current membership is absent', async () => {
    const channelId = 'cccccccc-0000-0000-0000-000000000001';
    const journeyId = '11111111-2222-4333-8444-555555555555';
    const calls = [];
    const dbTx = async (work) => work({ query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM channels/.test(sql)) {
        return { rows: [{ id: channelId, org_id: 'org-a', sjm_journey_id: journeyId }] };
      }
      if (/FROM sjm_journeys/.test(sql)) return { rows: [{ id: journeyId }] };
      if (/FROM sjm_journey_participants/.test(sql)) return { rows: [{ one: 1 }] };
      if (/FROM channel_members/.test(sql)) return { rows: [] };
      return { rows: [] };
    } });
    await request(makeApp(dbTx))
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: `org#org-a#comms#${channelId}` })
      .expect(403);
    expect(calls.some(c => /FOR SHARE/.test(c.sql))).toBe(true);
    expect(calls.some(c => /FROM channel_members/.test(c.sql))).toBe(true);
  });

  test('rejects a stale channel_members row when no active SJM duty assignment remains', async () => {
    const channelId = 'cccccccc-0000-0000-0000-000000000001';
    const journeyId = '11111111-2222-4333-8444-555555555555';
    const calls = [];
    const dbTx = async (work) => work({ query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM channels/.test(sql)) return { rows: [{ id: channelId, org_id: 'org-a', sjm_journey_id: journeyId }] };
      if (/FROM sjm_journeys/.test(sql)) return { rows: [{ id: journeyId }] };
      if (/FROM sjm_journey_participants/.test(sql)) return { rows: [] };
      if (/FROM channel_members/.test(sql)) return { rows: [{ user_id: 'user-1' }] };
      return { rows: [] };
    } });
    await request(makeApp(dbTx))
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: `org#org-a#comms#${channelId}` })
      .expect(403);
    expect(calls.some(c => /FROM sjm_journey_participants/.test(c.sql))).toBe(true);
    expect(calls.some(c => /FROM channel_members/.test(c.sql))).toBe(false);
  });

  test('rejects malformed comms channel identifiers without querying the database', async () => {
    const dbTx = jest.fn(async () => { throw new Error('malformed channel must not query'); });
    await request(makeApp(dbTx))
      .post('/api/v1/realtime/subscription-token')
      .send({ channel: 'org#org-a#comms#not-a-uuid' })
      .expect(403);
    expect(dbTx).not.toHaveBeenCalled();
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