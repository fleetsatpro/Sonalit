'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/clientAuth', () => ({
  clientAuth: (req, _res, next) => {
    req.client = {
      client_id: '11111111-1111-4111-8111-111111111111',
      org_id: '22222222-2222-4222-8222-222222222222',
      convoy_ids: ['33333333-3333-4333-8333-333333333333'],
    };
    next();
  },
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const portalConvoy = require('../src/routes/portalConvoy');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/portal', portalConvoy);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('portal notification preference validation', () => {
  beforeEach(() => query.mockReset());

  test('rejects unknown events', async () => {
    const res = await request(makeApp()).put('/portal/notifications').send({ convoy_id: null, events: ['arbitrary_internal_event'], channels: ['email'] });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects unknown channels', async () => {
    const res = await request(makeApp()).put('/portal/notifications').send({ convoy_id: null, events: ['delay'], channels: ['webhook'] });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects duplicate values and oversized lists', async () => {
    const duplicate = await request(makeApp()).put('/portal/notifications').send({ convoy_id: null, events: ['delay', 'delay'], channels: ['email'] });
    expect(duplicate.status).toBe(400);
    const oversized = await request(makeApp()).put('/portal/notifications').send({ convoy_id: null, events: ['departure', 'checkpoint', 'delay', 'arrival', 'incident', 'delivered', 'departure'], channels: ['email'] });
    expect(oversized.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('normalizes valid values before persistence', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ convoy_id: null, events: ['delay'], channels: ['email'] }] });
    const res = await request(makeApp()).put('/portal/notifications').send({ convoy_id: null, events: ['delay'], channels: ['email'] });
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      ['delay'],
      ['email'],
    ]);
  });
});
