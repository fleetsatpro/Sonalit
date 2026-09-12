---
name: testing
description: Testing conventions — Jest (backend CJS), Vitest (web/services ESM), Playwright E2E, testcontainers, and per-package commands.
triggers:
  - test
  - testing
  - Jest
  - Vitest
  - Playwright
  - E2E
  - unit test
  - integration test
  - testcontainers
  - test coverage
related_skills:
  - backend-patterns
  - v4-service-patterns
  - frontend-patterns
  - multi-tenancy
---

# Testing

## Purpose

Teaches the testing conventions across all layers of the Sonalit codebase — which framework, which runner, and which commands to use for each package.

## When to Activate

Any work involving writing, running, or debugging tests.

## Testing Matrix

| Layer | Framework | Module System | Runner Command |
|-------|-----------|--------------|----------------|
| Backend | Jest + Supertest | CommonJS | `cd backend && pnpm test` |
| Web unit | Vitest + Testing Library | ESM | `cd apps/web && pnpm test:unit` |
| Web E2E | Playwright | ESM | `cd apps/web && pnpm test:e2e` |
| v4 services unit | Vitest | ESM | `cd services/<svc> && pnpm test:unit` |
| v4 services integration | Vitest + testcontainers | ESM | `cd services/<svc> && pnpm test:integration` |

## Backend Tests (Jest)

Directory: `backend/tests/`

**CRITICAL**: Backend uses Jest with CommonJS — NOT Vitest, NOT ESM.

Config: `testTimeout: 30000` (30 seconds).

Running a single test:
```bash
cd backend && npx jest tests/messages.test.js
```

Pattern: Supertest for HTTP endpoint testing:
```javascript
const request = require('supertest');
const app = require('../src/app');

describe('GET /api/v1/vehicles', () => {
  it('returns vehicles', async () => {
    const res = await request(app)
      .get('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data).toBeDefined();
  });
});
```

## Web Unit Tests (Vitest)

Directory: `apps/web/src/`

Running:
```bash
cd apps/web && pnpm vitest run src/lib/driveTrail.test.ts
```

Uses Vitest with Testing Library for component testing.

## Web E2E Tests (Playwright)

Directory: `apps/web/`

Running:
```bash
cd apps/web && pnpm test:e2e
```

Chromium is pre-installed at `/opt/pw-browsers/chromium`. Do NOT run `playwright install`.

If a project pins a different `@playwright/test` version, launch with `executablePath: '/opt/pw-browsers/chromium'`.

## v4 Service Tests (Vitest)

Directory: `services/<svc>/src/`

Config: `vitest.config.ts` in each service root.

Unit tests:
```bash
cd services/fleet-svc && pnpm test:unit
```

Integration tests (testcontainers):
```bash
cd services/fleet-svc && pnpm test:integration
```

Integration tests use testcontainers to spin up real Postgres, Redis, and NATS instances.

## Monorepo-Wide Commands

```bash
pnpm test              # run all tests across all packages
pnpm test:unit         # unit tests only (services + packages)
pnpm test:integration  # integration tests only (services)
```

## Multi-Tenancy in Tests

When testing tenant-scoped endpoints:

1. **Backend**: Use `req.db` (via `attachOrgDb` middleware in test setup) — NEVER `query()` for tenant data
2. **Services**: Use the test org's connection with RLS set via `SET app.current_org_id`
3. **Integration**: testcontainers create isolated DB instances, but RLS policies must still be applied

See the multi-tenancy skill for non-negotiable rules.

## Pure Function Testing

Several modules are designed to be pure and unit-testable without DB or network:

- `backend/src/services/signal/anomalies.js` — signal anomaly classification
- `backend/src/services/geo/routeRisk.js` — route risk scoring
- `backend/src/services/geofence/corridor.js` — corridor evaluation

These take data in, return verdicts out — test them directly without mocks.

## Test File Naming

- Backend: `tests/<name>.test.js` (CommonJS)
- Web: `src/**/<name>.test.ts` or `src/**/<name>.test.tsx` (ESM)
- Services: `src/**/<name>.test.ts` (ESM)

## Relevant Files

- `backend/tests/` — backend Jest tests
- `apps/web/vitest.config.ts` — web Vitest config
- `services/fleet-svc/vitest.config.ts` — reference service test config
- `apps/web/playwright.config.ts` — Playwright E2E config

## Do

- Use Jest for backend tests, Vitest for everything else
- Use Supertest for backend HTTP endpoint tests
- Use testcontainers for service integration tests
- Test pure functions directly without mocks
- Follow the correct module system (CJS for backend, ESM for services/web)
- Run `pnpm build:contracts` before testing services if schemas changed

## Don't

- Use Vitest in the backend (it's Jest + CommonJS)
- Use Jest in v4 services or web (they use Vitest + ESM)
- Run `playwright install` — Chromium is pre-installed
- Skip RLS setup in tenant-scoped tests
- Mock pure functions that can be tested directly
- Write test files in the repository root — use the correct package directory
