# Architecture

## System Overview

Sonalit is a multi-tenant fleet and convoy security platform. The backend is a Node 22 / Express 4 API, the web frontend is React 18 / Vite / TanStack Router, and the mobile client is Kotlin / Jetpack Compose.

```
Browser (apps/web)   ←──HTTPS──→   Backend (backend/)
Android (apps/guardian-android)  ←──→  Backend

Backend ←──→ PostgreSQL (primary data store)
        ←──→ Redis      (BullMQ job queues, rate-limit state)
        ←──→ Centrifugo (real-time pub/sub)
        ←──→ R2 / S3    (photo / document storage)
        ←──→ Firebase   (FCM push to guardian devices)
```

## Monorepo Layout

| Path | Purpose |
|------|---------|
| `apps/web/` | React 18 SPA (Vite, TanStack Router, TanStack Query) |
| `apps/guardian-android/` | Kotlin/Compose Android guardian agent |
| `backend/` | Express 4 API — all REST routes, workers, migrations |
| `packages/contracts/` | Shared Zod schemas + TypeScript types |
| `services/ai-copilot-svc/` | Fastify microservice wrapping Anthropic API |
| `services/telemetry-ingest-svc/` | Fastify microservice for GPS/sensor ingestion |

## Backend Layers

### API (src/app.js)
Middleware order: `requestId → helmet → cors → cookieParser → rateLimiter → csrf → bodyParser → responseEnvelope → morgan → routes → errorHandler`

### Routes (`src/routes/`)
One file per domain. Every route that touches the database uses `req.db(async client => ...)` for org-scoped pooled connections.

### Workers (`src/workers/`)
Four BullMQ workers run as separate processes in production:
- **gpsWorker** — processes GPS location batches
- **alertWorker** — triggers speed/geofence/battery alerts
- **notificationWorker** — dispatches FCM, email, SMS
- **convoyReportWorker** — generates daily convoy PDF reports

Workers share `src/config/queue.js` for queue definitions and `src/config/redis.js` for the connection. `ENABLE_INPROCESS_WORKERS=true` runs them in the API process (dev only).

### Migrations (`migrations/`)
Numbered SQL files applied by `scripts/db-migrate.js` with `schema_migrations` tracking. Run `npm run db:migrate` on deploy. The `predeploy` script in `package.json` invokes `migrate-all.js` (legacy) which is being phased out.

### Real-time (`src/realtime/centrifugo.js`)
All real-time events use `POST /api/publish` on the Centrifugo HTTP API. Frontend connects via Centrifugo WebSocket with a JWT signed by `CENTRIFUGO_TOKEN_HMAC_SECRET`. Socket.IO has been fully removed.

## Data Model

Key tables (all partitioned or indexed for multi-tenant access):

| Table | Notes |
|-------|-------|
| `vehicles` | `org_id` indexed; soft-delete via `deleted_at` |
| `convoys` | Status machine: planned → active → completed/aborted/cancelled |
| `convoy_trucks`, `convoy_cfos` | CFO module; transaction-created with parent convoy |
| `guardian_devices` | `imei_hash` (sha256 + pepper); `last_integrity_verdict` |
| `panic_events` | Live guardian alerts; `resolved_at` marks closure |
| `gps_logs` | Range-partitioned by month; 12-month retention by default |
| `audit_logs` | Range-partitioned; append-only |
| `outbox` | Transactional outbox for reliable Centrifugo delivery |
| `idempotency_keys` | 24-hour TTL; prevents duplicate mutations |

## Auth Flow

1. `POST /api/v1/auth/login` → returns `{ token }` (15-min JWT) + sets httpOnly `refresh_token` cookie.
2. Access token stored in memory only (Zustand store, never localStorage).
3. On 401, axios interceptor calls `POST /api/v1/auth/refresh` (sends cookie, rotates token).
4. Guardian devices authenticate with `X-Device-Token` bearer token (issued at enroll).

## CSRF

Double-submit cookie: server sets `__Host-csrf` (SameSite=Strict, Secure) on every response; frontend reads it and attaches `X-CSRF-Token` header on all state-changing requests (POST/PUT/PATCH/DELETE). Guardian and webhook routes are exempt.

## Partitioning

`gps_logs`, `audit_logs`, `outbox` are range-partitioned by month. `ensure_future_partitions(table, 3)` keeps 3 months ahead (called hourly). `drop_old_partitions(table, retain_months)` is called daily at 03:00.

## Deployment

| Component | Host |
|-----------|------|
| Backend API | Railway |
| Frontend | Vercel |
| PostgreSQL | Railway managed |
| Redis | Railway managed |
| Centrifugo | Railway |
