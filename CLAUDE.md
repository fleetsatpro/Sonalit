# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Sonalit

Multi-tenant fleet operations and convoy field-security platform. Containerised logistics focused on container tracking, bookings, and e-lock management. The codebase is a pnpm monorepo (v9, Node 22) containing web UIs, a legacy Express backend, emerging Fastify microservices, Capacitor mobile shells, and a native Android app.

## Build & Dev Commands

```bash
pnpm install                          # install all workspace deps (use --frozen-lockfile in CI)
pnpm build                            # build every workspace package (runs pnpm -r build)
pnpm build:contracts                  # rebuild @sonalit/contracts (must run first if schemas changed)
pnpm lint                             # lint all packages
pnpm typecheck                        # tsc --noEmit across all packages
pnpm test                             # run all tests
pnpm test:unit                        # unit tests only (services + packages)
pnpm test:integration                 # integration tests only (services)
pnpm format                           # prettier write
pnpm format:check                     # prettier check (CI)
```

### Running individual packages

```bash
# Web dashboard (Vite, http://localhost:3000)
cd apps/web && pnpm dev

# Legacy backend (Express, port 5000)
cd backend && pnpm dev                # starts with ENABLE_INPROCESS_WORKERS=true

# A single v4 service
cd services/fleet-svc && pnpm dev     # tsx watch

# Single test file
cd services/fleet-svc && pnpm vitest run src/routes/vehicles.test.ts
cd backend && npx jest tests/messages.test.js
cd apps/web && pnpm vitest run src/lib/driveTrail.test.ts

# CDS standalone app
cd apps/container-delivery-system && pnpm dev
```

### Local infrastructure (docker-compose.dev.yml)

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres 16, Redis 7, Centrifugo v5
```

### Pre-commit hooks (Husky)

- Blocks `.swp`, `.tsbuildinfo`, `logs/`, real `.env` files
- Auto-regenerates `backend/openapi.json` when `backend/src/routes/` or `backend/src/controllers/` change
- lint-staged: ESLint --fix + Prettier on staged `.ts/.tsx/.js/.jsx` files
- Commits follow Conventional Commits (`@commitlint/config-conventional`)

## Architecture

### Two-generation backend

The codebase has two coexisting backend layers:

1. **Legacy monolith** (`backend/`) — Express + raw `pg` + BullMQ workers + Socket.IO. Plain JS (CommonJS). Deployed to Railway via the root Dockerfile. Contains the full API surface today (`/api/v1/*`), background workers (GPS, alerts, notifications, convoy reports), and cron jobs (partition roller, photo backfill).

2. **v4 microservices** (`services/*`) — Fastify + TypeScript (ESM) + NATS JetStream + OpenTelemetry. Each service owns its own Postgres pool and Redis. Integration tests use testcontainers. These are the migration target.

All v4 services import `@sonalit/contracts` for shared Zod schemas and NATS subject constants. The contracts package must be built (`pnpm build:contracts`) before services or the web app can compile.

### Frontend apps

| Package | Stack | Purpose |
|---------|-------|---------|
| `apps/web` | React 18 + Vite + TanStack Router + MapLibre/Cesium/Deck.gl + Zustand + TailwindCSS | Main operator dashboard. Deployed to Vercel. |
| `apps/container-delivery-system` | React + Vite | CDS standalone — enterprise container logistics with SecuriSat e-lock integration |
| `apps/guardian-convoy` | React + Vite + Capacitor | CFO convoy companion app (built and bundled into web deploy as `/convoy.html`) |
| `apps/sonalit-app` | Capacitor shell | Wraps the hosted web app as an installable Android APK (no local UI code) |
| `apps/sonalit-field` | Capacitor shell | Wraps the `/field` surface for yard/port teams (separate appId: `io.sonalit.field`) |
| `apps/sonalit-handover` | Capacitor shell | Wraps the `/handover` surface for Handover Officers (separate appId: `io.sonalit.handover`) |
| `apps/guardian-android` | Kotlin + Jetpack Compose + Hilt | Native Guardian device agent APK |

### Web app internals

- **Routing**: TanStack Router with `authRoute` (AppShell chrome) and `authFullscreenRoute` (edge-to-edge, no shell). Home page is the Orbit launcher (globe + folder grid under fullscreen shell).
- **Auth**: Access token in module-scope variable only (never localStorage). Refresh via httpOnly cookie. CSRF double-submit cookie on mutating requests. Store: `stores/auth.ts`.
- **API client**: `lib/api.ts` — Axios instance with auth interceptor, CSRF header injection, and W3C tracing propagation. Base URL from `VITE_API_BASE_URL` (defaults to `/api/v1`).
- **Realtime**: Centrifugo v5 via `lib/centrifuge.ts`. One Subscription per channel, multiplexed to multiple handler callbacks. Connection token fetched from `/realtime/token`.
- **State**: Zustand stores (`stores/auth.ts`, `stores/ui.ts`, `stores/dashboardStore.ts`). Feature-local state in feature dirs.
- **Features**: `features/auth/`, `features/live-fleet/`, `features/risk-intel/`, `features/comms/` — each with own components, hooks, types.
- **Public website**: `pages/public/` + `components/marketing/` — the seven crawlable routes (`/`, `/fleet-management`, `/convoy-management`, `/container-delivery`, `/security-operations`, `/about`, `/contact`). They hang off the router root with no auth check, use plain `<a>` links, and are prerendered to static HTML by `scripts/prerender.tsx` after `vite build`. Page metadata lives in one registry (`lib/seo/pages.ts`) shared by the runtime `<Seo />`, the prerenderer and the sitemap. The authenticated launcher lives at `/home`; `index.html` is the public homepage and `app-shell.html` is the SPA fallback for every app route (keep the two HTML files in sync — the prerender step fails the build if they drift).
- **CDS sub-app**: `pages/cds/` — Container Management views (dashboard, live map, data pages). Own store, hooks, constants, components. See README for adding views.

### Shared packages

| Package | Purpose |
|---------|---------|
| `@sonalit/contracts` | Zod schemas, TypeScript types, NATS event subjects, HTTP header constants. Source of truth for domain types. |
| `@sonalit/eslint-config` | Shared ESLint config with `./react` and `./node` entry points |
| `@sonalit/prettier-config` | Shared Prettier config |
| `@sonalit/tsconfig-base` | Base tsconfig |

### Inter-service communication

- **NATS JetStream** for async events between v4 services. Subject patterns defined in `@sonalit/contracts/events/subjects.ts` (e.g. `telemetry.gps.{orgId}.{deviceId}`, `events.panic.{orgId}`, `convoy.updated.{orgId}`).
- **Centrifugo** for browser realtime (WebSocket). Backend publishes; frontend subscribes via channel names.
- **BullMQ + Redis** for background job queues in the legacy backend.

### Deployment

- **Web**: Vercel (Vite build via `scripts/vercel-build.sh`, which also builds and bundles guardian-convoy into the output). API calls proxied to Railway via Vercel rewrites.
- **Backend**: Railway (Docker, `node:22-slim`). Auto-runs `db-migrate.js` on start.
- **Infra**: Terraform in `infra/terraform/`, Helm charts in `infra/helm/`, ArgoCD in `infra/argocd/`, Grafana dashboards in `infra/grafana-dashboards/`, k6 load tests in `infra/k6/`.

### Testing

| Layer | Framework | Runner |
|-------|-----------|--------|
| Web unit | Vitest + Testing Library | `cd apps/web && pnpm test:unit` |
| Web E2E | Playwright | `cd apps/web && pnpm test:e2e` |
| Backend | Jest + Supertest | `cd backend && pnpm test` |
| v4 services unit | Vitest | `cd services/<svc> && pnpm test:unit` |
| v4 services integration | Vitest + testcontainers | `cd services/<svc> && pnpm test:integration` |

Backend uses Jest (CommonJS, `testTimeout: 30000`). Everything else uses Vitest (ESM).

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- Keep files under 500 lines
- Build contracts first when schemas change: `pnpm build:contracts`
- Backend route/controller changes trigger automatic `openapi.json` regeneration via pre-commit hook
- The backend is plain JS (CommonJS) — do not convert it to TypeScript or ESM
- v4 services are strict TypeScript ESM — maintain that convention
