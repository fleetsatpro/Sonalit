const request = require('supertest');

describe('live tenant route regressions', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('notifications await the tenant DB helper for GET and read-all', async () => {
    const db = jest.fn(async (sql) => {
      if (/^\s*SELECT id, type, title, body/i.test(sql)) {
        return { rows: [{ id: 'n1', type: 'alert', title: 'Test', body: 'Body', read: false, created_at: '2026-10-06T12:00:00.000Z' }] };
      }
      return { rowCount: 2, rows: [] };
    });
    jest.doMock('../src/middleware/auth', () => ({
      authenticate: (req, _res, next) => {
        req.user = { id: '11111111-1111-4111-8111-111111111111', org_id: '22222222-2222-4222-8222-222222222222' };
        req.db = db;
        next();
      },
    }));

    const express = require('express');
    const router = require('../src/routes/notifications');
    const app = express();
    app.use(express.json());
    app.use('/notifications', router);

    const list = await request(app).get('/notifications/?limit=10');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const readAll = await request(app).post('/notifications/read-all');
    expect(readAll.status).toBe(200);
    expect(readAll.body.updated).toBe(2);
    expect(db).toHaveBeenCalledTimes(2);
  });

  test('intelligence overview returns events and tenant-scoped summary', async () => {
    jest.doMock('../src/middleware/publicationPdfCapability', () => ({
      issuePublicationPdfCapability: jest.fn(),
    }));

    const db = jest.fn(async (sql) => {
      if (/FROM intel_events e/i.test(sql) && /LIMIT 50/i.test(sql)) {
        return {
          rows: [{
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Test event',
            summary: 'Evidence-backed event',
            severity: 'high',
            confidence: 80,
            country_code: 'KE',
            last_seen_at: '2026-10-06T12:00:00.000Z',
            source_count: 2,
          }],
        };
      }
      if (/COUNT\(\*\).*events_24h/i.test(sql)) return { rows: [{ events_24h: 1, high_critical_events_24h: 1 }] };
      if (/FROM intel_observations/i.test(sql)) return { rows: [{ observations_24h: 7 }] };
      if (/FROM intel_early_warnings/i.test(sql)) return { rows: [{ active_warnings: 3 }] };
      if (/FROM intel_gaps/i.test(sql)) return { rows: [{ open_gaps: 2 }] };
      throw new Error('unexpected SQL in overview test');
    });

    const express = require('express');
    const router = require('../src/routes/intelligenceOperations');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { org_id: '22222222-2222-4222-8222-222222222222' };
      req.db = db;
      next();
    });
    app.use('/risk/intelligence', router);

    const res = await request(app).get('/risk/intelligence/overview?scope_type=global&scope_key=global');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].title).toBe('Test event');
    expect(res.body.summary.events_24h).toBe(1);
    expect(res.body.summary.high_critical_events_24h).toBe(1);
    expect(res.body.summary.observations_24h).toBe(7);
    expect(res.body.summary.active_warnings).toBe(3);
    expect(res.body.summary.open_gaps).toBe(2);
    expect(res.body.scope).toEqual({ type: 'global', key: 'global' });
  });
});
