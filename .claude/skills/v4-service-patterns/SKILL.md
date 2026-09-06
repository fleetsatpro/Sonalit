---
name: v4-service-patterns
description: Fastify/TypeScript ESM microservice conventions — service setup, NATS consumers, OTel instrumentation, testcontainers, and the contracts dependency.
triggers:
  - Fastify
  - microservice
  - service
  - NATS
  - JetStream
  - OpenTelemetry
  - v4
  - fleet-svc
  - ESM
related_skills:
  - sonalit-architecture
  - realtime-events
  - multi-tenancy
  - testing
---

# v4 Service Patterns

## Purpose

Teaches the conventions for the emerging Fastify/TypeScript ESM microservices in `services/`. These are the migration target — follow these patterns exactly when adding or modifying v4 services.

## When to Activate

Any work in `services/*/`.

## Service Structure

Each service follows this layout:

```
services/<name>-svc/
├── src/
│   ├── otel.ts          → OpenTelemetry setup (MUST be first import)
│   ├── index.ts         → Fastify app setup + start
│   ├── config.ts        → environment config
│   ├── db.ts            → pg pool
│   ├── redis.ts         → ioredis client
│   ├── nats.ts          → NATS JetStream connection
│   └── routes/
│       ├── health.ts    → /health endpoint
│       └── <domain>.ts  → domain route handlers
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Service Entry Point

File: `services/fleet-svc/src/index.ts` (reference implementation)

```typescript
import './otel.js';  // MUST be first — instruments before other imports
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { vehicleRoutes } from './routes/vehicles.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });

  await app.register(cors, { origin: false });
  await app.register(helmet);
  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });

  await app.register(healthRoutes);
  await app.register(vehicleRoutes);

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    app.log.error({ err }, 'Request error');
    void reply.code(status).send({ error: (err as Error).message ?? 'Internal server error' });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

start().catch((err) => { console.error(err); process.exit(1); });
```

## NATS JetStream Pattern

File: `services/fleet-svc/src/nats.ts`

```typescript
import { connect, type NatsConnection, type JetStreamClient } from 'nats';
import { config } from './config.js';

let nc: NatsConnection;
let js: JetStreamClient;

export async function connectNats(): Promise<void> {
  nc = await connect({ servers: config.NATS_URL });
  js = nc.jetstream();
}

export function getJetStream(): JetStreamClient { return js; }
```

Subject patterns from `@sonalit/contracts/events/subjects.ts`:
- `telemetry.gps.<orgId>.<deviceId>`
- `events.panic.<orgId>`
- `events.alert.<orgId>`
- `commands.<deviceId>`
- `convoy.updated.<orgId>`

## Contracts Dependency

All v4 services import Zod schemas and types from `@sonalit/contracts`:

```typescript
import { VehicleSchema, type Vehicle } from '@sonalit/contracts';
```

**CRITICAL**: Run `pnpm build:contracts` after any schema change before the services can compile.

## 12 Services

| Service | Purpose |
|---------|---------|
| `ai-copilot-svc` | AI dispatch assistant |
| `alerts-svc` | Alert processing |
| `analytics-svc` | Analytics aggregation |
| `auth-svc` | Authentication |
| `convoy-svc` | Convoy management |
| `fleet-svc` | Fleet CRUD (reference implementation) |
| `guardian-svc` | Guardian device management |
| `media-svc` | Photo/media handling |
| `notification-svc` | Notification fan-out |
| `realtime-gateway-svc` | Centrifugo/NATS bridge |
| `reports-svc` | Report generation |
| `telemetry-ingest-svc` | GPS/telemetry ingestion |

## Relevant Files

- `services/fleet-svc/src/index.ts` — reference entry point
- `services/fleet-svc/src/nats.ts` — NATS connection
- `services/fleet-svc/src/routes/` — route examples
- `packages/contracts/src/` — schemas and event subjects

## Do

- Import `otel.ts` as the FIRST line of `index.ts`
- Use strict TypeScript ESM (`import`/`export`)
- Import types from `@sonalit/contracts`
- Use Pino logger via Fastify
- Run `pnpm build:contracts` before compiling after schema changes
- Add integration tests with testcontainers

## Don't

- Convert to CJS
- Define shared types locally instead of in contracts
- Skip OTel instrumentation
- Use `console.log` instead of Fastify's logger
- Import from the legacy backend directly
