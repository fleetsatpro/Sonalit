# Sonalit v4 Architecture Overview

**Version**: 4.0.0  
**Date**: 2026-05-19  
**Status**: Active Development

## Executive Summary

Sonalit v4 is a complete redesign of the v3 fleet operations and convoy field-security
platform. The monolithic Node.js backend is decomposed into twelve independently deployable
microservices. The Android Guardian Agent is migrated to Jetpack Compose with full hardware
security integration. The web dashboard is rewritten in TypeScript strict mode with
TanStack Router, MapLibre GL, and a Centrifugo-backed real-time layer. The system is
engineered to sustain 100,000 requests per second on the telemetry ingest path with
sub-second panic-event latency and life-safety SLOs.

## Design Principles

1. **No single point of failure** — every hot-path service has N≥3 replicas with PDB and
   HPA. NATS JetStream replaces Redis pub/sub for all life-safety events.
2. **Defence in depth** — mTLS between all services (SPIRE/SPIFFE), OPA policy sidecars,
   PostgreSQL row-level security keyed on JWT org claim, EncryptedSharedPreferences with
   Android Keystore on device.
3. **Immutable audit trail** — every state mutation flows through NATS `audit.*` → ClickHouse
   with a SHA-256 hash chain. Daily Merkle root anchored to a public RFC 3161 TSA.
4. **Idempotency by default** — every mutating HTTP endpoint accepts an `Idempotency-Key`
   header; replay returns the stored response; conflict returns 409.
5. **Outbox before side effects** — FCM, email, SMS, webhook, Anthropic calls, and R2
   confirms are written to an outbox table in the same transaction as state change; a relay
   worker handles delivery with exponential retry and dead-letter.
6. **Observability first** — OpenTelemetry traces with W3C traceparent propagated through
   HTTP, NATS headers, and BullMQ job data; Prometheus RED+USE metrics; pino JSON logs
   shipped to Loki via Vector; SLO recording rules with error-budget burn alerts.

## Repository Layout

```
sonalit/
├── apps/
│   ├── web/                  React 18 + TypeScript strict web dashboard
│   └── guardian-android/     Kotlin + Compose Android field device app
├── services/
│   ├── auth-svc/             WebAuthn, argon2id, JWT RS256 via Vault transit
│   ├── fleet-svc/            Vehicles, drivers, geofences, maintenance, sensors, shipments
│   ├── convoy-svc/           Convoy lifecycle, CFO management, photo workflow
│   ├── guardian-svc/         Device enrollment, heartbeat, commands, CFO hot-path
│   ├── telemetry-ingest-svc/ 100k RPS GPS batch ingest, dedup, NATS publish
│   ├── alerts-svc/           Rules engine, geofence eval, incident creation
│   ├── notification-svc/     FCM, Postmark email, Twilio SMS, in-app via Centrifugo
│   ├── reports-svc/          PDF generation (pdf-lib + headless Chromium), R2 upload
│   ├── analytics-svc/        TimescaleDB aggregates, ClickHouse fact table queries
│   ├── realtime-gateway-svc/ Centrifugo NATS consumer, history-enabled channels
│   ├── ai-copilot-svc/       RAG over pgvector+OpenSearch, Anthropic Claude, SSE
│   └── media-svc/            Resumable multipart R2 upload, TFLite model delivery
├── packages/
│   ├── contracts/            Zod schemas, TypeScript types, generated Kotlin data classes
│   ├── sdk-js/               Browser + Node client SDK
│   ├── sdk-kotlin/           Android client SDK (generated from contracts)
│   ├── eslint-config/        Shared ESLint rules (base, node, react variants)
│   ├── tsconfig-base/        Shared TypeScript configs (node, react variants)
│   └── prettier-config/      Shared Prettier configuration
├── infra/
│   ├── helm/                 Helm charts per service + shared _base chart
│   ├── terraform/            EKS, RDS+Citus, Redis Cluster, NATS, ClickHouse, OpenSearch
│   ├── argocd/               ArgoCD app-of-apps manifests
│   ├── chaos/                Chaos Mesh experiment definitions
│   └── grafana-dashboards/   Pre-built Grafana dashboard JSON
└── docs/
    ├── architecture/         Architecture documents (this file)
    ├── adr/                  Architecture Decision Records
    ├── runbooks/             Operational runbooks per service + SLO breaches
    └── migration-map.md      Legacy v3 → v4 artifact mapping
```

## Service Map

| Service | Port | Protocol | DB | Hot Path |
|---------|------|----------|----|----------|
| auth-svc | 4001 | HTTP/2 | Postgres (Citus) | No |
| fleet-svc | 4002 | HTTP/2 | Postgres (Citus), OpenSearch | No |
| convoy-svc | 4003 | HTTP/2 | Postgres (Citus) | No |
| guardian-svc | 4004 | HTTP/2 + HTTP/3 | Postgres (Citus), Redis | Yes |
| telemetry-ingest-svc | 4005 | HTTP/3 | TimescaleDB, Redis Cluster | Yes |
| alerts-svc | 4006 | HTTP/2 | Postgres (Citus) | No |
| notification-svc | 4007 | HTTP/2 | Postgres (outbox) | No |
| reports-svc | 4008 | HTTP/2 | Postgres (Citus), R2 | No |
| analytics-svc | 4009 | HTTP/2 | TimescaleDB, ClickHouse | No |
| realtime-gateway-svc | 4010 | HTTP/2 + WSS | Redis | Yes |
| ai-copilot-svc | 4011 | HTTP/2 + SSE | Postgres (pgvector), OpenSearch | No |
| media-svc | 4012 | HTTP/2 | Postgres, R2 | No |

## Event Backbone (NATS JetStream)

All subjects follow `<domain>.<entity>.<org_id>[.<device_id>]` naming.

| Subject | Publisher | Consumers | At-least-once |
|---------|-----------|-----------|---------------|
| `telemetry.gps.<org>.<device>` | telemetry-ingest-svc | TimescaleDB writer, geofence eval (alerts-svc), realtime-gateway-svc | Yes |
| `events.panic.<org>` | guardian-svc | notification-svc, realtime-gateway-svc, alerts-svc | Yes |
| `events.alert.<org>` | alerts-svc | notification-svc, realtime-gateway-svc | Yes |
| `commands.<device>` | guardian-svc, fleet-svc | guardian-svc relay | Yes |
| `audit.<service>` | every service | ClickHouse writer | Yes |
| `notifications.<channel>` | notification-svc internal | FCM relay, email relay, SMS relay | Yes |
| `convoy.updated.<org>` | convoy-svc | realtime-gateway-svc | Yes |
| `media.committed.<org>` | media-svc | convoy-svc, reports-svc | Yes |

## Authentication Flows

### Operator (Web Dashboard)
1. WebAuthn ceremony via `navigator.credentials` (passkey, L2 authenticator)
2. auth-svc verifies assertion, issues JWT access token (5 min, RS256, Vault transit) +
   refresh token (7d, rotated on every use, reuse detection revokes entire family)
3. TOTP required for `role=admin`; SSO via OIDC for enterprise tenants

### Guardian Device
1. Enrollment QR contains a 5-min one-time JWT from auth-svc
2. Device presents: IMEI, android_id, hardware-backed key attestation, Play Integrity verdict
3. auth-svc requires operator approval in dashboard before activating token
4. Subsequent calls use opaque device token (argon2id-hashed at rest)
5. Each heartbeat where integrity_age > 6h triggers a fresh Play Integrity check;
   server rejects verdict < MEETS_DEVICE_INTEGRITY

## Database Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16 + Citus (Citus cluster, sharded by org_id)       │
│  PgBouncer (transaction mode, 1000 client / 25 server per pool) │
│  Row-level security on every multi-tenant table                  │
│  pgvector extension for ai-copilot-svc embeddings               │
├─────────────────────────────────────────────────────────────────┤
│  TimescaleDB (separate cluster)                                   │
│  hypertable: gps_fixes  (1h chunks, compress after 7d)          │
│  continuous aggregates: gps_1m, gps_5m, gps_1h (for analytics) │
├─────────────────────────────────────────────────────────────────┤
│  ClickHouse                                                       │
│  tables: audit_logs (hash-chained), analytics_events            │
│  daily Merkle root anchored to RFC 3161 TSA                     │
├─────────────────────────────────────────────────────────────────┤
│  Redis Cluster                                                    │
│  Uses: idempotency keys (24h TTL), dedup SETNX for telemetry,   │
│  cache invalidation, rate-limit state (Redis-Cell / GCRA)       │
├─────────────────────────────────────────────────────────────────┤
│  OpenSearch                                                       │
│  indices: fleet, convoy, incident, message (BM25 + kNN vector)  │
└─────────────────────────────────────────────────────────────────┘
```

## Real-Time Architecture

Centrifugo cluster replaces Socket.IO entirely.

| Channel | Subscribers | History |
|---------|-------------|---------|
| `org#{org_id}` | All dashboard users in org | 5 min |
| `device#{device_id}` | Operators tracking a device | 5 min |
| `convoy#{convoy_id}` | CFO and operators on convoy | 5 min |
| `user#{user_id}` | Per-user notifications | 5 min |

History enables frontends and Android app to replay missed events after
reconnect without additional API calls.

## SLO Targets

| SLO | Target | Alert Burn Rate |
|-----|--------|-----------------|
| `panic_e2e_p99` | ≤ 1500 ms | 2x over 1h |
| `gps_fix_to_dashboard_p95` | ≤ 800 ms | 3x over 1h |
| `api_5xx_rate` | < 0.1% | 5x over 30m |
| `db_conn_saturation` | < 70% | Immediate on >80% |
| `nats_consumer_lag` | < 1000 messages | 2x sustained 5m |

## Deployment Model

- **EKS** (primary) with Argo Rollouts canary: 5% → 25% → 50% → 100%
- Automatic rollback on SLO burn or error-rate spike during canary
- Multi-region active-active for stateless services
- Postgres warm-standby in second region via logical replication (RPO 5 min, RTO 15 min)
- Cloudflare in front: WAF, Bot Management, Argo Smart Routing, R2
- Container images: distroless final stage, non-root, read-only rootfs, cosign-signed
- SBOM (CycloneDX) per build, Trivy scan gating CI
- HashiCorp Vault: database credentials dynamic 1h TTL, JWT signing keys, all secrets

## Security Posture

- mTLS between all services via SPIRE-issued SVIDs
- OPA sidecar per service enforcing per-service write policies
- RLS in Postgres enforces tenant isolation (even against SQL injection)
- CSP with per-response nonces, Trusted Types, COOP/COEP/CORP
- Certificate pinning on Android with rotating pin set (Ed25519-signed)
- No secrets in git — Vault Agent sidecar injection at pod startup
- Argon2id for all password hashing; HIBP check on password set/change
- API keys: scoped, argon2id-hashed, IP allowlist, mandatory expiry
