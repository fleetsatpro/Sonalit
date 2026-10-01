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
