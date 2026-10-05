'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

const express = require('express');
const request = require('supertest');

const getCameras = jest.fn();
const getNearestCameras = jest.fn();

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id:'admin-id', role:'admin', status:'active', org_id:'org-a' };
    next();
  }),
}));

jest.mock('../src/utils/orgScopedDb', () => ({
  attachOrgDb: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../src/services/spatial/cctvGateway', () => ({
  getCameras: (...args) => getCameras(...args),
  getNearestCameras: (...args) => getNearestCameras(...args),
}));

jest.mock('../src/services/spatial/cctv/cctvCatalog', () => ({
  getCameraById: jest.fn(),
  getCctvCountries: jest.fn(() => []),
  getCountryBbox: jest.fn(code => code === 'KE' ? [33.89, -4.68, 41.86, 5.51] : null),
}));

jest.mock('../src/services/spatial/cctv/cctvMediaProxy', () => ({
  getFrame: jest.fn(),
  getMedia: jest.fn(),
  openEyeWhepOffer: jest.fn(),
  openEyeWhepDelete: jest.fn(),
}));

describe('CCTV wall route contract', () => {
  beforeEach(() => {
    getCameras.mockReset();
    getNearestCameras.mockReset();
    getCameras.mockResolvedValue({
      observations:[],
      health:{},
      coverage:{},
      warnings:[],
    });
  });

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/cctv', require('../src/routes/cctv'));
    return app;
  }

  test('forwards includeSnapshots to the CCTV gateway', async () => {
    await request(makeApp())
      .get('/api/v1/cctv/cameras')
      .query({
        country:'KE',
        liveOnly:'1',
        includeSnapshots:'1',
        limit:'250',
      })
      .expect(200);

    expect(getCameras).toHaveBeenCalledTimes(1);
    expect(getCameras.mock.calls[0][0]).toMatchObject({
      countryCode:'KE',
      liveOnly:true,
      includeSnapshots:true,
      maxRecords:250,
    });
    expect(getCameras.mock.calls[0][0].bbox).toEqual([33.89, -4.68, 41.86, 5.51]);
    expect(getCameras.mock.calls[0][0].orgId).toBe('org-a');
  });

  test('keeps continuous-video-only behavior available when snapshots are not requested', async () => {
    await request(makeApp())
      .get('/api/v1/cctv/cameras')
      .query({ country:'KE', liveOnly:'true' })
      .expect(200);

    expect(getCameras.mock.calls[0][0].liveOnly).toBe(true);
    expect(getCameras.mock.calls[0][0].includeSnapshots).toBe(false);
  });
});
