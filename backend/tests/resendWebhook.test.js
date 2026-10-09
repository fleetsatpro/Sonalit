const request = require('supertest');
const crypto = require('crypto');

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const WEBHOOK_SECRET = 'whsec_' + Buffer.from('sonalit-resend-webhook-test-secret').toString('base64');

describe('Resend webhook delivery projection and retry idempotency', () => {
  let app;
  let globalQuery;
  let withOrg;
  let client;
  let previousNodeEnv;
  let previousWebhookSecret;
  let existingReceipt;
  let existingProjection;
  let notificationExists;
  let notificationStatus;
  let throwAt;
  let auditInserts;
  let statusUpdates;

  beforeEach(() => {
    jest.resetModules();
    previousNodeEnv = process.env.NODE_ENV;
    previousWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;

    existingReceipt = false;
    existingProjection = false;
    notificationExists = true;
    notificationStatus = 'queued';
    throwAt = null;
    auditInserts = [];
    statusUpdates = [];

    globalQuery = jest.fn(async (sql, params = []) => {
      if (/SELECT id, org_id FROM email_notifications/i.test(sql)) {
        return {
          rows: notificationExists ? [{ id: 'email-row-1', org_id: ORG_ID }] : [],
        };
      }
      if (/INSERT INTO resend_webhook_events/i.test(sql)) {
        if (existingReceipt) return { rows: [] };
        existingReceipt = true;
        return { rows: [{ event_id: params[0] }] };
      }
      throw new Error('Unexpected global SQL in Resend webhook test: ' + sql);
    });

    client = {
      query: jest.fn(async (sql, params = []) => {
        if (/pg_advisory_xact_lock/i.test(sql)) {
          if (throwAt === 'advisory-lock') throw new Error('simulated transaction failure');
          return { rows: [] };
        }
        if (/SELECT id FROM communication_delivery_events/i.test(sql)) {
          return { rows: existingProjection ? [{ id: 'audit-row-1' }] : [] };
        }
        if (/SELECT id, status, correlation_id FROM email_notifications WHERE id=\$1 FOR UPDATE/i.test(sql)) {
          return {
            rows: notificationExists ? [{
              id: 'email-row-1',
              status: notificationStatus,
              correlation_id: 'correlation-1',
            }] : [],
          };
        }
        if (/UPDATE email_notifications SET status/i.test(sql)) {
          statusUpdates.push({ status: params[0], providerEventId: params[1], id: params[2] });
          notificationStatus = params[0];
          return { rowCount: 1, rows: [] };
        }
        if (/INSERT INTO communication_delivery_events/i.test(sql)) {
          if (throwAt === 'audit-insert') throw new Error('simulated transaction failure');
          auditInserts.push({ orgId: params[0], eventType: params[1], status: params[2], providerEmailId: params[3], eventId: params[4] });
          existingProjection = true;
          return { rowCount: 1, rows: [] };
        }
        throw new Error('Unexpected tenant SQL in Resend webhook test: ' + sql);
      }),
    };
    withOrg = jest.fn(async (_orgId, callback) => callback(client));

    jest.doMock('../src/config/database', () => ({ globalQuery }));
    jest.doMock('../src/utils/orgScopedDb', () => ({ withOrg }));
    jest.doMock('../src/services/securityIncidentMap', () => ({
      verifySecurityMapToken: () => false,
      renderSecurityMap: jest.fn(),
    }));
    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    const express = require('express');
    const router = require('../src/routes/resendWebhook');
    app = express();
    app.use(express.json({
      verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); },
    }));
    app.use('/resend', router);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  });

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousWebhookSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = previousWebhookSecret;
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function sendEvent({
    eventId = 'evt_delivery_1',
    type = 'email.delivered',
    emailId = 'provider_email_1',
    invalidSignature = false,
  } = {}) {
    const payload = JSON.stringify({ type, data: { email_id: emailId } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signingKey = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
    const signedContent = eventId + '.' + timestamp + '.' + payload;
    const signature = crypto.createHmac('sha256', signingKey).update(signedContent).digest('base64');
    return request(app)
      .post('/resend/')
      .set('content-type', 'application/json')
      .set('svix-id', eventId)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', 'v1,' + (invalidSignature ? 'invalid' : signature))
      .send(payload);
  }

  test('applies a signed delivery event using the canonical tenant-scoped DB helper', async () => {
    const response = await sendEvent();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, duplicate: false, advanced: true });
    expect(withOrg).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
    expect(client.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['evt_delivery_1'],
    );
    expect(statusUpdates).toEqual([{
      status: 'delivered', providerEventId: 'evt_delivery_1', id: 'email-row-1',
    }]);
    expect(auditInserts).toEqual([{
      orgId: ORG_ID,
      eventType: 'email.delivered',
      status: 'delivered',
      providerEmailId: 'provider_email_1',
      eventId: 'evt_delivery_1',
    }]);
    expect(globalQuery.mock.calls.map(([sql]) => sql).filter(sql => /INSERT INTO resend_webhook_events/i.test(sql))).toHaveLength(1);
  });

  test('repairs a legacy receipt row when its tenant delivery projection was never committed', async () => {
    // This represents the production failure mode: an older version recorded
    // the idempotency key first, then failed before writing the tenant audit row.
    existingReceipt = true;

    const response = await sendEvent();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, duplicate: true, advanced: true });
    expect(statusUpdates).toHaveLength(1);
    expect(auditInserts).toHaveLength(1);
    expect(globalQuery.mock.calls.some(([sql]) => /INSERT INTO resend_webhook_events/i.test(sql))).toBe(true);
  });

  test('acknowledges an already projected duplicate without duplicating the audit event', async () => {
    existingReceipt = true;
    existingProjection = true;

    const response = await sendEvent();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, duplicate: true, advanced: false });
    expect(statusUpdates).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
    expect(client.query.mock.calls.filter(([sql]) => /INSERT INTO communication_delivery_events/i.test(sql))).toHaveLength(0);
  });

  test('does not regress a newer notification state for an out-of-order webhook', async () => {
    notificationStatus = 'opened';

    const response = await sendEvent({ type: 'email.sent', eventId: 'evt_older_sent' });

    expect(response.status).toBe(200);
    expect(response.body.advanced).toBe(false);
    expect(statusUpdates).toHaveLength(0);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].status).toBe('sent');
  });

  test('does not persist a receipt if the tenant transaction fails before projection', async () => {
    throwAt = 'advisory-lock';

    const response = await sendEvent();

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('webhook_processing_failed');
    expect(globalQuery.mock.calls.some(([sql]) => /INSERT INTO resend_webhook_events/i.test(sql))).toBe(false);
    expect(statusUpdates).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
  });

  test('rejects invalid signatures before touching either database path', async () => {
    const response = await sendEvent({ invalidSignature: true });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('invalid_webhook_signature');
    expect(globalQuery).not.toHaveBeenCalled();
    expect(withOrg).not.toHaveBeenCalled();
  });
});
