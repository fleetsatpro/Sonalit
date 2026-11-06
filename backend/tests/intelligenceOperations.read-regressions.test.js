'use strict';

const request = require('supertest');
const mockDbQuery = jest.fn();

describe('intelligence operations read endpoints', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    mockDbQuery.mockReset();
    mockDbQuery.mockResolvedValue({ rows: [] });
    const express = require('express');
    const router = require('../src/routes/intelligenceOperations');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: '00000000-0000-0000-0000-000000000001',
        org_id: '00000000-0000-0000-0000-000000000002',
        role: 'admin',
      };
      req.db = mockDbQuery;
      next();
    });
    app.use('/intelligence', router);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  test('overview headline totals use the exact validated server-side analytic window', async () => {
    const res = await request(app).get('/intelligence/overview?window_hours=6');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ analytic_window_hours: 6, events_in_window: 0, priority_events_in_window: 0, observations_in_window: 0, active_warnings: 0, open_gaps: 0 });
    expect(mockDbQuery).toHaveBeenCalledTimes(5);
    const [eventSql,eventParams] = mockDbQuery.mock.calls[0];
    expect(eventParams).toEqual(['00000000-0000-0000-0000-000000000002', 6]);
    expect(eventSql).toContain('e.last_seen_at>=now()-($2::int * interval');
    const [summarySql,summaryParams] = mockDbQuery.mock.calls[1];
    expect(summaryParams).toEqual(['00000000-0000-0000-0000-000000000002', 6]);
    expect(summarySql).toContain('COUNT(*) FILTER(WHERE e.last_seen_at>=now()-($2::int * interval');
    expect(summarySql).not.toContain('WHERE e.org_id=$1 AND e.last_seen_at>=now()-($2::int');
    expect(summarySql).toContain('priority_events_in_window');
  });

  test('overview rejects an unsupported analytic window before querying', async () => {
    const res = await request(app).get('/intelligence/overview?window_hours=12');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_window_hours');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('event ledger binds its time window and list limit without interpolating user values', async () => {
    const res = await request(app).get('/intelligence/events?window_hours=6&limit=40');
    expect(res.status).toBe(200);
    const [sql,params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['00000000-0000-0000-0000-000000000002', null, null, 6, 40]);
    expect(sql).toContain('($4::int IS NULL OR e.last_seen_at>=now()-($4::int * interval');
  });

  test('global requirements does not leave untyped unused scope parameters', async () => {
    const res = await request(app).get('/intelligence/requirements');
    expect(res.status).toBe(200);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual(['00000000-0000-0000-0000-000000000002', null]);
    expect(sql).toContain('$2::text');
    expect(sql).not.toContain('$3');
  });

  test('scoped requirements uses a stable typed parameter layout', async () => {
    const res = await request(app).get('/intelligence/requirements?scope_type=country&scope_key=KE&status=open');
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([
      '00000000-0000-0000-0000-000000000002',
      'open',
      'country',
      'KE',
      ['KE'],
    ]);
    expect(sql).toContain('$3::text');
    expect(sql).toContain('$5::text[]');
  });

  test('assessments filters the schema-backed analyst_status field', async () => {
    const res = await request(app).get('/intelligence/assessments?status=verified');
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([
      '00000000-0000-0000-0000-000000000002',
      'verified',
    ]);
    expect(sql).toContain('a.analyst_status');
    expect(sql).not.toContain('a.status');
  });
});
