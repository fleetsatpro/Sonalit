/**
 * 4D geofence corridor HTTP routes.
 *
 * Regression cover for the bug where "Plan corridor" on the 4D Geofence page
 * failed with `POST /api/v1/convoys/:id/corridor not found`: routes/corridors.js
 * existed but was never mounted in app.js, and the live GET read only
 * convoy_route_waypoints, so even a saved corridor still reported "no planned
 * route". These mount the two routers in the same order app.js does and drive
 * them over HTTP with the DB stubbed.
 */
'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';

const fs = require('fs');
const path = require('path');

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
}));

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  pool: { connect: jest.fn() },
  query: (...args) => mockQuery(...args),
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const mockOrgQuery = jest.fn();
jest.mock('../src/utils/orgScopedDb', () => ({
  withOrg: jest.fn(),
  attachOrgDb: (req, _res, next) => { req.db = (...args) => mockOrgQuery(...args); next(); },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', org_id: '11111111-1111-1111-1111-111111111111', role: 'admin' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/audit', () => ({ auditLog: () => (_req, _res, next) => next() }));
jest.mock('../src/middleware/idempotency', () => (_req, _res, next) => next());
jest.mock('../src/realtime/centrifugo', () => ({ publish: jest.fn() }));

// The road geometry a routing engine would return for Malaba → Mombasa.
const ROAD = [
  { lat: 0.63, lng: 34.28 }, { lat: 0.28, lng: 34.75 }, { lat: -1.29, lng: 36.82 },
  { lat: -2.36, lng: 37.66 }, { lat: -4.04, lng: 39.67 },
];
jest.mock('../src/services/geo/routePlan', () => ({
  planRoute: jest.fn(async () => ({
    route: [
      { lat: 0.63, lng: 34.28 }, { lat: 0.28, lng: 34.75 }, { lat: -1.29, lng: 36.82 },
      { lat: -2.36, lng: 37.66 }, { lat: -4.04, lng: 39.67 },
    ],
    routed: true, provider: 'osrm', distance_km: 1203.4, duration_min: 1180,
  })),
}));

const express = require('express');
const request = require('supertest');

const ORG = '11111111-1111-1111-1111-111111111111';
const CONVOY = '7993c3d7-4c5d-4247-a255-b40c6078d9ec';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Same order as app.js: convoys.js owns GET /:id/corridor, corridors.js owns
  // the POST. Swapping these silently breaks the live view.
  app.use('/api/v1/convoys', require('../src/routes/convoys'));
  app.use('/api/v1/convoys', require('../src/routes/corridors'));
  app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.originalUrl} not found` }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

// Route the stubbed queries by the table they touch, so the tests don't depend
// on call order.
function stubQueries({ corridor = [], waypoints = [], members = [] } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM convoys\b/.test(sql)) {
      return { rows: [{ id: CONVOY, name: 'PE13', departure_time: null, status: 'planned' }] };
    }
    if (/convoy_route_corridors/.test(sql)) return { rows: corridor };
    if (/convoy_route_waypoints/.test(sql)) return { rows: waypoints };
    if (/convoy_cfos/.test(sql)) return { rows: members };
    return { rows: [] };
  });
}

beforeEach(() => { mockQuery.mockReset(); mockOrgQuery.mockReset(); });

describe('POST /api/v1/convoys/:id/corridor', () => {
  test('plans and stores a corridor from origin + destination (the route must be mounted)', async () => {
    mockOrgQuery.mockImplementation(async (sql) => {
      if (/FROM convoys\b/.test(sql)) return { rows: [{ id: CONVOY }] };
      return { rows: [{ id: 'corr-1', org_id: ORG, convoy_id: CONVOY, route_line: ROAD, width_km: '1.0', active: true }] };
    });

    const res = await request(buildApp())
      .post(`/api/v1/convoys/${CONVOY}/corridor`)
      .send({ origin: { lat: 0.63, lng: 34.28 }, destination: { lat: -4.04, lng: 39.67 }, width_km: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.planned).toBe(true);
    expect(res.body.data.routing_provider).toBe('osrm');
    expect(res.body.data.waypoint_count).toBe(ROAD.length);
  });

  test('404s for a convoy outside the caller org before any routing happens', async () => {
    const { planRoute } = require('../src/services/geo/routePlan');
    planRoute.mockClear();
    mockOrgQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/v1/convoys/${CONVOY}/corridor`)
      .send({ origin: { lat: 0.63, lng: 34.28 }, destination: { lat: -4.04, lng: 39.67 } });

    expect(res.status).toBe(404);
    expect(planRoute).not.toHaveBeenCalled();
  });

  test('rejects a body with neither a line nor endpoints', async () => {
    mockOrgQuery.mockResolvedValue({ rows: [{ id: CONVOY }] });
    const res = await request(buildApp()).post(`/api/v1/convoys/${CONVOY}/corridor`).send({ width_km: 2 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/convoys/:id/corridor', () => {
  test('evaluates against the planned corridor and adopts its width', async () => {
    stubQueries({ corridor: [{ route_line: ROAD, width_km: '1.5' }] });

    const res = await request(buildApp()).get(`/api/v1/convoys/${CONVOY}/corridor`);

    expect(res.status).toBe(200);
    expect(res.body.data.route).toHaveLength(ROAD.length);
    expect(res.body.data.config.corridor_km).toBe(1.5);
  });

  test('an explicit ?corridor_km still overrides the stored width', async () => {
    stubQueries({ corridor: [{ route_line: ROAD, width_km: '1.5' }] });
    const res = await request(buildApp()).get(`/api/v1/convoys/${CONVOY}/corridor?corridor_km=5`);
    expect(res.body.data.config.corridor_km).toBe(5);
  });

  test('falls back to dispatcher route waypoints when no corridor is planned', async () => {
    stubQueries({
      corridor: [],
      waypoints: [
        { seq: 0, name: 'Malaba', lat: 0.63, lng: 34.28 },
        { seq: 1, name: 'Mombasa', lat: -4.04, lng: 39.67 },
      ],
    });

    const res = await request(buildApp()).get(`/api/v1/convoys/${CONVOY}/corridor`);

    expect(res.status).toBe(200);
    expect(res.body.data.route.map(r => r.name)).toEqual(['Malaba', 'Mombasa']);
    expect(res.body.data.config.corridor_km).toBe(2); // default when nothing is stored
  });

  test('422s only when there is neither a corridor nor two waypoints', async () => {
    stubQueries({ corridor: [], waypoints: [] });
    const res = await request(buildApp()).get(`/api/v1/convoys/${CONVOY}/corridor`);
    expect(res.status).toBe(422);
  });

  test('survives a corridor row whose route_line is unusable', async () => {
    stubQueries({
      corridor: [{ route_line: 'not json', width_km: '2.0' }],
      waypoints: [
        { seq: 0, name: 'Malaba', lat: 0.63, lng: 34.28 },
        { seq: 1, name: 'Mombasa', lat: -4.04, lng: 39.67 },
      ],
    });
    const res = await request(buildApp()).get(`/api/v1/convoys/${CONVOY}/corridor`);
    expect(res.status).toBe(200);
    expect(res.body.data.route).toHaveLength(2);
  });
});

// The original failure was purely a missing mount, which no router-level test
// can see. Requiring app.js here would boot the queues and the pool, so assert
// on the wiring itself.
test('app.js mounts the corridors router under /api/v1/convoys', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  expect(appSrc).toMatch(/app\.use\(\s*["']\/api\/v1\/convoys["']\s*,\s*require\(["']\.\/routes\/corridors["']\)/);
});
