'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
process.env.JWT_SECRET = process.env.JWT_SECRET || 'spatial-http-itest-secret';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { spatialProviderManager } = require('../../src/services/spatial/providerManager');
const { errorHandler } = require('../../src/middleware/error');

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

jest.mock('../../src/services/spatial/openskyGateway', () => {
  const actual = jest.requireActual('../../src/services/spatial/openskyGateway');
  return {
    ...actual,
    validateBbox: (bbox) => {
      if (!Array.isArray(bbox) || bbox.length !== 4) return null;
      const nums = bbox.map(Number);
      if (nums.some(n => !Number.isFinite(n))) return null;
      const [west, south, east, north] = nums;
      if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
      if ((east - west) * (north - south) > 25) return null;
      return nums;
    },
  };
});

const ORG_A = 'eeeeeeee-0000-0000-0001-000000000001';
const ORG_B = 'eeeeeeee-0000-0000-0002-000000000002';
const USER_A = 'eeeeeeee-0000-0000-0011-000000000011';
const CONVOY_A = 'eeeeeeee-0000-0000-0021-000000000021';
const CONVOY_B = 'eeeeeeee-0000-0000-0022-000000000022';

let pool; let token; let app; let openSky; let openSkyQuery;

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/spatial', require('../../src/routes/spatial'));
  a.use((req, res) => res.status(404).json({ error: 'not found' }));
  a.use(errorHandler);
  return a;
}

describeIfDb('spatial HTTP integration', () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      'INSERT INTO users (id,email,name,password_hash,role,status,org_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id,status=EXCLUDED.status',
      [USER_A, 'spatial-http-a@sonalit.test', 'Spatial HTTP A', 'x', 'admin', 'active', ORG_A],
    );
    await pool.query(
      'INSERT INTO convoys (id,name,region,status,org_id,route_origin,route_destination,departure_time) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id,status=EXCLUDED.status',
      [CONVOY_A, 'SPATIAL HTTP A', 'Kenya', 'active', ORG_A, 'Nairobi', 'Mombasa'],
    );
    await pool.query(
      'INSERT INTO convoys (id,name,region,status,org_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id,status=EXCLUDED.status',
      [CONVOY_B, 'SPATIAL HTTP B', 'Kenya', 'planned', ORG_B],
    );
    token = jwt.sign({ id: USER_A }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const openskyProvider = spatialProviderManager.providers.get('opensky');
    if (!openskyProvider) throw new Error('OpenSky provider is not registered');
    openSkyQuery = jest.fn();
    openskyProvider.query = openSkyQuery;
    openSky = openSkyQuery;
    openSky.mockResolvedValue({
      observations: [{
        id: 'opensky:http-aircraft-1', entityType: 'aircraft', source: 'opensky', sourceReference: 'abc123',
        latitude: -1.291, longitude: 36.821, observedAt: '2026-09-24T17:00:00.000Z',
        receivedAt: '2026-09-24T17:00:05.000Z', observationConfidence: 0.9, operationalConfidence: 0.7,
        confidence: 0.9, status: 'airborne', attributes: { callsign: 'HTTP001' },
        provenance: { sourceName: 'OpenSky Network', sourceReference: 'abc123' },
        quality: { state: 'good', freshnessClass: 'LIVE' },
      }],
      health: { status: 'LIVE', recordCount: 1, acceptedCount: 1, rejectedCount: 0 },
      coverage: { complete: true, bounded: true, queryScope: 'test bbox' },
      warnings: [],
    });
    app = buildApp();
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM convoys WHERE id IN ($1,$2)', [CONVOY_A, CONVOY_B]);
    await pool.query('DELETE FROM users WHERE id = $1', [USER_A]);
    await pool.end();
  });

  beforeEach(() => {
    spatialProviderManager.reset();
    openSky.mockReset();
    openSky.mockResolvedValue({
      observations: [{
        id: 'opensky:http-aircraft-1', entityType: 'aircraft', source: 'opensky', sourceReference: 'abc123',
        latitude: -1.291, longitude: 36.821, observedAt: '2026-09-24T17:00:00.000Z',
        receivedAt: '2026-09-24T17:00:05.000Z', observationConfidence: 0.9, operationalConfidence: 0.7,
        confidence: 0.9, status: 'airborne', attributes: { callsign: 'HTTP001' },
        provenance: { sourceName: 'OpenSky Network', sourceReference: 'abc123' },
        quality: { state: 'good', freshnessClass: 'LIVE' },
      }],
      health: { status: 'LIVE', recordCount: 1, acceptedCount: 1, rejectedCount: 0 },
      coverage: { complete: true, bounded: true, queryScope: 'test bbox' },
      warnings: [],
    });
  });

  test('rejects an unauthenticated spatial request', async () => {
    const res = await request(app).get('/api/v1/spatial/world-context/convoy/' + CONVOY_A)
      .query({ lat: -1.29, lng: 36.82, radiusM: 25000, layers: 'aircraft' });
    expect(res.status).toBe(401);
  });

  test('resolves the authenticated organisation subject through the real HTTP route', async () => {
    const res = await request(app).get('/api/v1/spatial/world-context/convoy/' + CONVOY_A)
      .set('Authorization', 'Bearer ' + token)
      .query({ lat: -1.29, lng: 36.82, radiusM: 25000, layers: 'aircraft' });
    expect(res.status).toBe(200);
    expect(res.body.data.subject.kind).toBe('convoy');
    expect(res.body.data.subject.id).toBe(CONVOY_A);
    expect(res.body.data.subject.orgId).toBe(ORG_A);
    expect(res.body.data.movement.some(e => e.id === 'opensky:http-aircraft-1')).toBe(true);
    expect(openSky).toHaveBeenCalledTimes(1);
  });

  test('returns 404 for a cross-tenant convoy without revealing its existence', async () => {
    const res = await request(app).get('/api/v1/spatial/world-context/convoy/' + CONVOY_B)
      .set('Authorization', 'Bearer ' + token)
      .query({ lat: -1.29, lng: 36.82, radiusM: 25000, layers: 'aircraft' });
    expect(res.status).toBe(404);
    expect(String(res.body.error || '').toLowerCase()).not.toContain('org');
    expect(openSky).not.toHaveBeenCalled();
  });

  test('fails soft when the external provider is rate-limited', async () => {
    openSky.mockRejectedValueOnce(Object.assign(new Error('throttled'), { failureClass: 'rate_limited' }));
    const res = await request(app).get('/api/v1/spatial/world-context/convoy/' + CONVOY_A)
      .set('Authorization', 'Bearer ' + token)
      .query({ lat: -1.29, lng: 36.82, radiusM: 25000, layers: 'aircraft' });
    expect(res.status).toBe(200);
    expect(res.body.data.coverage.layersUnavailable).toContain('aircraft');
    expect(res.body.data.warnings).toEqual(expect.arrayContaining(['aircraft_layer_unavailable']));
  });

  test('enforces bounded spatial input at the HTTP boundary', async () => {
    const bad = await request(app).get('/api/v1/spatial/aircraft')
      .set('Authorization', 'Bearer ' + token).query({ bbox: '-10,-10,10,10' });
    expect(bad.status).toBe(400);
    expect(openSky).not.toHaveBeenCalled();
  });
});