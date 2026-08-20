---
name: sonalit-architecture
description: System-wide architecture map — monorepo layout, two-generation backend, frontend apps, shared packages, deployment topology, and build order.
triggers:
  - architecture
  - structure
  - monorepo
  - packages
  - services
  - overview
  - how does sonalit work
related_skills:
  - sonalit-workflow
  - multi-tenancy
  - realtime-events
---

# Sonalit Architecture

## Purpose

Provides the system-wide map of Sonalit before you touch any code. Understand what lives where, how packages depend on each other, and the build order.

## When to Activate

Before any cross-cutting change, when exploring the codebase, or when the request spans multiple packages.

## Monorepo Layout

pnpm v9 workspace, Node 22. Root `pnpm-workspace.yaml`:

```
apps/web                    → React 18 operator dashboard (Vite, Vercel)
apps/container-delivery-system → CDS standalone app
apps/guardian-convoy        → CFO convoy companion (Capacitor, bundled into web)
apps/sonalit-app            → Android APK shell wrapping hosted web
apps/sonalit-field          → Android APK shell for /field surface (appId: io.sonalit.field)
apps/sonalit-handover       → Android APK shell for /handover surface (appId: io.sonalit.handover)
apps/guardian-android       → Native Kotlin Guardian device agent (Jetpack Compose + Hilt)

backend/                    → Express monolith (CJS, plain JS, Railway)

services/ai-copilot-svc     → AI dispatch assistant
services/alerts-svc          → Alert processing
services/analytics-svc       → Analytics aggregation
services/auth-svc            → Authentication (v4)
services/convoy-svc          → Convoy management (v4)
services/fleet-svc           → Fleet CRUD (Fastify, ESM, TS)
services/guardian-svc        → Guardian device management (v4)
services/media-svc           → Photo/media handling
services/notification-svc    → Notification fan-out
services/realtime-gateway-svc → Centrifugo/NATS bridge
services/reports-svc         → Report generation
services/telemetry-ingest-svc → GPS/telemetry ingestion

packages/contracts           → @sonalit/contracts — Zod schemas, types, NATS subjects
packages/eslint-config       → @sonalit/eslint-config
packages/prettier-config     → @sonalit/prettier-config
packages/tsconfig-base       → @sonalit/tsconfig-base
```

## Build Order

1. `pnpm build:contracts` — MUST run first when schemas change
2. `pnpm build` — builds all packages (runs `pnpm -r build`)

The contracts package is the shared type source of truth. All v4 services and the web app import from it. If you change a schema in `packages/contracts/src/schemas/`, you must rebuild before anything else compiles.

## Two-Generation Backend

### Legacy monolith (`backend/`)
- Express + raw `pg` pool + BullMQ + Socket.IO
- Plain JavaScript, CommonJS (`require`/`module.exports`)
- 52 route files, 7 controllers, 10 workers
- Contains the full API surface today (`/api/v1/*`)
- Deployed to Railway via root Dockerfile
- Auto-runs `db-migrate.js` on deploy

### v4 microservices (`services/*`)
- Fastify + TypeScript (strict ESM)
- NATS JetStream for async events
- OpenTelemetry instrumented
- Each service owns its own Postgres pool and Redis
- Integration tests use testcontainers
- These are the migration target

**Rule**: Do not convert the backend to TypeScript or ESM. Do not convert v4 services to CJS.

## Frontend Apps

| App | Route shell | Purpose |
|-----|------------|---------|
| `apps/web` — `/` | `authFullscreenRoute` | Orbit launcher (globe + folder grid) |
| `apps/web` — `/command` | `authRoute` (AppShell) | Command center dashboard |
| `apps/web` — `/cds` | `authFullscreenRoute` | CDS sub-app (own chrome) |
| `apps/web` — `/field/*` | `authFullscreenRoute` | Yard/Port field ops |
| `apps/web` — `/portal/*` | `portalRootRoute` | Cargo owner portal (own auth) |
| `apps/web` — all others | `authRoute` (AppShell) | Standard pages with Rail sidebar |

Stack: React 18 + Vite + TanStack Router + MapLibre/Cesium/Deck.gl + Zustand + TailwindCSS.

## Shared Packages

- `@sonalit/contracts` — Zod schemas, TypeScript types, NATS event subjects, HTTP header constants. Source of truth for domain types.
- `@sonalit/eslint-config` — ESLint config with `./react` and `./node` entry points
- `@sonalit/prettier-config` — Prettier config
- `@sonalit/tsconfig-base` — Base tsconfig

## Deployment Topology

- **Web**: Vercel (Vite build via `scripts/vercel-build.sh`, bundles guardian-convoy). API proxied to Railway via Vercel rewrites.
- **Backend**: Railway (Docker, `node:22-slim`). Auto-runs migrations.
- **Infrastructure**: Terraform (`infra/terraform/`), Helm (`infra/helm/`), ArgoCD (`infra/argocd/`), Grafana dashboards (`infra/grafana-dashboards/`), k6 load tests (`infra/k6/`).
- **Local dev**: `docker-compose.dev.yml` — Postgres 16, Redis 7, Centrifugo v5.

## Key Environment Variables

Database: `DATABASE_URL`, `REDIS_URL`
Auth: `JWT_SECRET`, `CLIENT_JWT_SECRET`
AI: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`
Storage: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
Geo: `MAPBOX_TOKEN`, `OSRM_URL`
Guardian: `COMMAND_SIGNING_SECRET`
Server: `PORT` (default 5000), `NODE_ENV`, `CORS_ORIGINS`

## Cron Jobs (6)

1. Partition roller — hourly (ensures 3 future partitions for `gps_logs`, `audit_logs`, `outbox`)
2. Partition archival — daily 03:00 UTC
3. CFO EOD finalization sweep — every 15 minutes
4. Risk zone stats refresh — every 10 minutes (`REFRESH MATERIALIZED VIEW CONCURRENTLY risk_zone_stats`)
5. OSINT sweep — every 2 hours (7 sources)
6. GDPR weekly purge — Sundays 04:00 UTC

## Do

- Run `pnpm build:contracts` after schema changes, before anything else
- Keep backend as plain JS CJS
- Keep v4 services as strict TypeScript ESM
- Use the contracts package for any shared type definitions

## Don't

- Convert backend to TypeScript or ESM
- Add shared types outside `@sonalit/contracts`
- Deploy services without OTel instrumentation
- Skip the contracts build step
