'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'portal-auth-test-secret';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/clientAuth', () => ({ clientAuth: (req, _res, next) => next() }));

const { query } = require('../src/config/database');
const request = require('supertest');
const express = require('express');
const portalAuth = require('../src/routes/portalAuth');

function app() { const a = express(); a.use(express.json()); a.use('/portal/auth', portalAuth); return a; }

describe('portal magic-link security', () => {
  beforeEach(() => query.mockReset());

  test('does not return an authentication link when delivery is unavailable', async () => {
    query.mockResolvedValueOnce({ rows: [{ id:'11111111-1111-4111-8111-111111111111', org_id:'22222222-2222-4222-8222-222222222222' }] });
    query.mockResolvedValueOnce({ rows: [{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] });
    const res = await request(app()).post('/portal/auth/request-link').send({ email:'client@example.com' });
    expect(res.status).toBe(200);
    expect(res.body._link).toBeUndefined();
    expect(res.body.message).toContain('If that email is registered');
  });

  test('verification consumes the token atomically and scopes returned convoy links to the token organisation', async () => {
    query.mockResolvedValueOnce({ rows: [{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_id:'11111111-1111-4111-8111-111111111111', org_id:'22222222-2222-4222-8222-222222222222', expires_at:new Date(Date.now()+60000), used_at:new Date() }] });
    query.mockResolvedValueOnce({ rows: [{ convoy_id:'33333333-3333-4333-8333-333333333333' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post('/portal/auth/verify').send({ token:'a'.repeat(64) });
    expect(res.status).toBe(200);
    expect(res.body.data.client_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(res.body.data.org_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(res.body.data.convoy_ids).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(String(query.mock.calls[0][0])).toContain('UPDATE client_magic_links');
    expect(String(query.mock.calls[0][0])).toContain('used_at IS NULL');
    expect(String(query.mock.calls[0][0])).toContain('expires_at > NOW()');
    expect(String(query.mock.calls[1][0])).toContain('ccl.org_id = $2');
    expect(String(query.mock.calls[1][0])).toContain('c.org_id = $2');
    expect(query.mock.calls[1][1]).toEqual(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
  });

  test('already-used or expired tokens fail closed', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post('/portal/auth/verify').send({ token:'b'.repeat(64) });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired link');
  });
});
