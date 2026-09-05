/**
 * POST /api/v1/auth/request-access
 *
 * Regression cover for a form that never worked: the "Request access" dialog on
 * /login (and now the enquiry form on the public /contact page) posted to an
 * endpoint that did not exist, so every submission 404'd and was reported to
 * the visitor as a generic failure.
 *
 * The behaviour that matters here is the ordering: the request is persisted
 * first and the notification sent second, so a missing or broken mail provider
 * loses the enquiry from the inbox but never from the database.
 */
'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
}));

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  pool: { connect: jest.fn() },
  query: (...args) => mockQuery(...args),
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const mockSendMail = jest.fn();
jest.mock('../src/utils/mailer', () => ({ sendMail: (...args) => mockSendMail(...args) }));

const express = require('express');
const request = require('supertest');

// The limiter is module-scope state in routes/auth.js and counts every request
// in this suite as coming from the same IP, so each test gets a fresh copy of
// the router — otherwise the sixth assertion in the file starts seeing 429s.
function buildApp() {
  jest.resetModules();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../src/routes/auth'));
  return app;
}

const INSERT_OK = { rows: [{ id: 'req-1' }] };

const sqlStatements = () => mockQuery.mock.calls.map(([sql]) => String(sql));

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.ACCESS_REQUEST_TO;
});

describe('POST /api/v1/auth/request-access', () => {
  it('stores the request and notifies the operations mailbox', async () => {
    mockQuery.mockResolvedValueOnce(INSERT_OK).mockResolvedValueOnce({ rows: [] });
    mockSendMail.mockResolvedValueOnce(true);

    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'Ops@Example.com ', organization: ' Example Freight ', source: 'contact' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { ok: true } });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO access_requests/);
    // Email normalised, surrounding whitespace stripped from free text.
    expect(params).toEqual(['contact', null, 'ops@example.com', 'Example Freight', null]);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('ops@sonalit.com');
    expect(mail.replyTo).toBe('ops@example.com');
    expect(mail.subject).toContain('Contact enquiry');

    // Second query marks the row notified.
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE access_requests SET notified = TRUE/);
  });

  it('defaults to the login source and honours ACCESS_REQUEST_TO', async () => {
    process.env.ACCESS_REQUEST_TO = 'sales@example.com';
    mockQuery.mockResolvedValueOnce(INSERT_OK).mockResolvedValueOnce({ rows: [] });
    mockSendMail.mockResolvedValueOnce(true);

    await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'a@b.com', organization: 'Acme' });

    expect(mockQuery.mock.calls[0][1][0]).toBe('login');
    expect(mockSendMail.mock.calls[0][0].to).toBe('sales@example.com');
    expect(mockSendMail.mock.calls[0][0].subject).toContain('Access request');
  });

  it('still accepts the request when no mail provider is configured', async () => {
    mockQuery.mockResolvedValueOnce(INSERT_OK);
    mockSendMail.mockResolvedValueOnce(false); // no provider

    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'a@b.com' });

    expect(res.status).toBe(202);
    // Row stored, but never marked notified — the unnotified index finds it.
    expect(sqlStatements()).toEqual([expect.stringMatching(/INSERT INTO access_requests/)]);
  });

  it('still accepts the request when the mail provider throws', async () => {
    mockQuery.mockResolvedValueOnce(INSERT_OK);
    mockSendMail.mockRejectedValueOnce(new Error('Resend: 500'));

    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'a@b.com' });

    expect(res.status).toBe(202);
    expect(sqlStatements()).toEqual([expect.stringMatching(/INSERT INTO access_requests/)]);
  });

  it('rejects a malformed email without touching the database', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('rejects an unknown source rather than storing it', async () => {
    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'a@b.com', source: 'spam-cannon' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rate limits repeated submissions from one address', async () => {
    const app = buildApp();
    mockQuery.mockResolvedValue(INSERT_OK);
    mockSendMail.mockResolvedValue(true);

    const codes = [];
    for (let i = 0; i < 7; i += 1) {
      // Same app instance, so the same limiter window throughout.
      const res = await request(app)
        .post('/api/v1/auth/request-access')
        .send({ email: `a${i}@b.com` });
      codes.push(res.status);
    }

    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('fails loudly when the request cannot be stored', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const res = await request(buildApp())
      .post('/api/v1/auth/request-access')
      .send({ email: 'a@b.com' });

    expect(res.status).toBe(500);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
