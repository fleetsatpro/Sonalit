# Sonalit v3 → v4 Migration Map

## Overview

The v3 → v4 migration transitions Sonalit from a Node.js/Express monolith backed by a single PostgreSQL instance into a distributed, event-driven architecture composed of 12 purpose-built microservices. The migration preserves every feature present in v3 while hardening the platform for large-scale fleet operations, adding life-safety guarantees via NATS JetStream, and adopting modern auth, observability, and data-plane capabilities. Rather than a big-bang rewrite, each domain (auth, GPS, guardian, finance, etc.) is extracted in a defined sequence so legacy clients can coexist with v4 services during the cut-over window.

The data layer is the most significant change: the v3 single-schema Postgres is replaced by a polyglot store — PostgreSQL+Citus for relational entities, TimescaleDB for time-series telemetry, ClickHouse for analytics aggregations, and pgvector for AI/embedding workloads. Real-time delivery moves from Socket.IO to Centrifugo; queue work moves from BullMQ/Redis to NATS JetStream. All inter-service calls are mutually authenticated via SPIRE mTLS and authorised through OPA policy bundles. No legacy feature is dropped; all legacy API clients are served through a backwards-compatible API gateway during the transition.

---

## Backend Routes → Services

| Legacy Express Route | v4 Service | v4 Endpoint | Notes |
|---|---|---|---|
| `/auth` | auth-service | `POST /v4/auth/*` | Passkeys/WebAuthn added; JWT + SPIRE workload identity |
| `/vehicles` | fleet-service | `GET|POST /v4/fleet/vehicles` | Citus-sharded vehicle table |
| `/drivers` | fleet-service | `GET|POST /v4/fleet/drivers` | Shares fleet-service shard key |
| `/gps` | telemetry-service | `POST /v4/telemetry/positions` | TimescaleDB hypertable; ingest via NATS |
| `/sensors` | telemetry-service | `POST /v4/telemetry/sensors` | Same hypertable, separate chunk |
| `/geofences` | geo-service | `GET|POST /v4/geo/geofences` | MapLibre tile serving added |
| `/rules` | rules-service | `GET|POST /v4/rules` | OPA policy evaluation replaces in-process logic |
| `/maintenance` | fleet-service | `GET|POST /v4/fleet/maintenance` | Job scheduling integrated |
| `/convoys` | convoy-service | `GET|POST /v4/convoys` | CRDT notes; real-time via Centrifugo |
| `/convoys/cfo` | convoy-service | `POST /v4/convoys/cfo` | CFO device enrolment sub-resource |
| `/guardian` | guardian-service | `GET|POST /v4/guardian` | Device admin policy management |
| `/guardian/cfo` | guardian-service | `POST /v4/guardian/cfo` | CFO lockdown profile endpoint |
| `/documents` | document-service | `GET|POST /v4/documents` | RFC 3161 audit anchoring on upload |
| `/reports` | reporting-service | `GET|POST /v4/reports` | ClickHouse-backed aggregations |
| `/shipments` | shipment-service | `GET|POST /v4/shipments` | Saga pattern for GDPR erasure |
| `/alerts` | alert-service | `GET|POST /v4/alerts` | NATS JetStream delivery; dedup at consumer |
| `/incidents` | incident-service | `GET|POST /v4/incidents` | CRDT incident notes; WarRoom WebRTC |
| `/messages` | messaging-service | `GET|POST /v4/messages` | Centrifugo channels per convoy |
| `/panic` | guardian-service | `POST /v4/guardian/panic` | Life-safety; NATS subject `guardian.panic.>` |
| `/analytics` | analytics-service | `GET /v4/analytics` | ClickHouse direct query via analytics-service |
| `/ai` | ai-service | `POST /v4/ai/*` | pgvector embeddings; TFLite edge inference |
| `/riskzones` | geo-service | `GET|POST /v4/geo/riskzones` | deck.gl layer data served as GeoJSON tiles |
| `/gdpr` | compliance-service | `POST /v4/compliance/gdpr` | Full erasure saga orchestration |
| `/finance` | finance-service | `GET|POST /v4/finance` | Isolated service; double-entry ledger |
| `/apikeys` | auth-service | `GET|POST /v4/auth/apikeys` | Scoped key issuance with OPA claims |
| `/webhooks` | gateway-service | `GET|POST /v4/webhooks` | Fanout via NATS; idempotency keys |

---

## Workers → Consumers

| Legacy BullMQ Worker | v4 NATS JetStream Consumer | v4 Service | Notes |
|---|---|---|---|
| `gpsWorker` | `telemetry.positions` consumer group | telemetry-service | Pull consumer; exactly-once via dedup window |
| `alertWorker` | `alerts.evaluate` consumer group | alert-service | Fan-out to `alerts.notify.>` subjects |
| `notificationWorker` | `notifications.dispatch` consumer group | messaging-service | Push via Centrifugo + APNs/FCM adapters |
| `convoyReportWorker` | `convoys.reports.generate` consumer group | reporting-service | Durable consumer; ClickHouse query on trigger |

---

## Cron Jobs → Replacements

| Legacy Cron | Schedule | v4 Replacement | Owner Service |
|---|---|---|---|
| Partition roller | Daily 02:00 | TimescaleDB native retention policy + `maintenance_policy`; no custom cron needed | telemetry-service |
| Base64 photo backfill | Daily 03:00 | One-shot migration job run during cut-over; superseded by streaming S3 upload in v4 | document-service |
| EOD report sweep | Every 15 min | NATS JetStream scheduled message (`KV` TTL trigger) → `convoys.reports.generate` | reporting-service |

---

## Frontend Pages → v4 Pages

| Legacy Page | v4 React Component | Notes |
|---|---|---|
| Login | `<AuthPage>` | Passkeys/WebAuthn flow; fallback to password |
| Dashboard | `<DashboardPage>` | Centrifugo live tiles |
| Fleet | `<FleetPage>` | Vehicle + driver unified view |
| GPS | `<LiveMapPage>` | MapLibre GL JS + deck.gl; replaces Leaflet |
| Convoys | `<ConvoysPage>` | CRDT-backed notes inline |
| CfoConvoyForm | `<CfoConvoyFormPage>` | CFO device form, unchanged UX |
| Drivers | `<DriversPage>` | Merged into fleet-service data |
| Alerts | `<AlertsPage>` | Real-time via Centrifugo channel |
| Incidents | `<IncidentsPage>` | WarRoom WebRTC entry point |
| IncidentCenter | `<IncidentCenterPage>` | Full CRDT collaborative board |
| PanicCenter | `<PanicCenterPage>` | Life-safety; prioritised Centrifugo channel |
| Messages | `<MessagesPage>` | Per-convoy Centrifugo rooms |
| Analytics | `<AnalyticsPage>` | ClickHouse-backed charts |
| Reports | `<ReportsPage>` | PDF/CSV export from reporting-service |
| Shipments | `<ShipmentsPage>` | Saga status tracking UI |
| Finance | `<FinancePage>` | Ledger view from finance-service |
| Maintenance | `<MaintenancePage>` | Job cards from fleet-service |
| Geofences | `<GeofencesPage>` | MapLibre draw tools |
| RiskIntel | `<RiskIntelPage>` | deck.gl risk-zone heatmap |
| Rules | `<RulesPage>` | OPA policy editor UI |
| FieldOfficers | `<FieldOfficersPage>` | Guardian enrolment + status |
| Executive | `<ExecutivePage>` | Aggregated ClickHouse KPIs |
| Devices | `<DevicesPage>` | CFO + guardian device inventory |
| Guardian | `<GuardianPage>` | Device admin policy management |
| AIDecision | `<AIDecisionPage>` | ai-service inference results |
| Copilot | `<CopilotPage>` | Streaming LLM chat; pgvector RAG |
| Settings | `<SettingsPage>` | Tenant config, API keys, webhooks |

---

## Android Components → v4 Compose

| Legacy Component | Type | v4 Equivalent | Notes |
|---|---|---|---|
| `EnrollmentActivity` | Activity | `EnrollmentScreen` (Compose) | Passkeys enrolment flow added |
| `MainActivity` | Activity | `MainScreen` (Compose NavHost) | Single-activity architecture |
| `CfoSectionFragment` | Fragment | `CfoSectionScreen` (Compose) | Fragment removed; nav controller |
| `CfoPhotoActivity` | Activity | `CfoPhotoScreen` (Compose) | CameraX API upgrade |
| `GuardianService` | Foreground Service | `GuardianService` (retained) | Refactored to coroutine-scoped |
| `PanicTileService` | TileService | `PanicTileService` (retained) | Quick Settings tile unchanged |
| `HeartbeatWorker` | WorkManager Worker | `HeartbeatWorker` (retained) | Sends to NATS via guardian-service REST |
| `SyncWorker` | WorkManager Worker | `SyncWorker` (retained) | Syncs to v4 endpoints; retry via WM policy |
| `BootReceiver` | BroadcastReceiver | `BootReceiver` (retained) | Restarts GuardianService on boot |
| `GuardianDeviceAdminReceiver` | DeviceAdminReceiver | `GuardianDeviceAdminReceiver` (retained) | Policy commands from guardian-service |
| `DevicePrefs` | SharedPreferences | `DevicePrefs` (DataStore migration) | Proto DataStore replaces SharedPreferences |
| `GuardianDatabase` | Room Database | `GuardianDatabase` (retained, schema v2) | Schema migration for v4 entity fields |
| `GuardianApiService` | Retrofit Interface | `GuardianApiService` (Retrofit + v4 base URL) | Targets v4 guardian-service endpoints |
| `GuardianRepository` | Repository | `GuardianRepository` (retained) | Updated to consume v4 response models |

---

## Infrastructure Changes

| Legacy | v4 Replacement | Rationale |
|---|---|---|
| Socket.IO | Centrifugo | Protocol-agnostic (WS/SSE/HTTP-stream); scales horizontally without sticky sessions |
| BullMQ | NATS JetStream | Exactly-once delivery; life-safety guarantee; no Redis dependency for queuing |
| Redis pub/sub | NATS (life-safety channels); Redis remains for cache | Decouple ephemeral cache from durable message delivery |
| Express monolith | 12 microservices | Independent deploy, scale, and fault isolation per domain |
| Single PostgreSQL | PostgreSQL+Citus + TimescaleDB + ClickHouse + pgvector | Right-sized storage per workload: relational, time-series, analytical, vector |
| Leaflet | MapLibre GL JS + deck.gl | GPU-accelerated vector tiles; WebGL layers for risk zones and large fleet overlays |

---

## Explicitly Dropped (none — all features preserved)

No legacy feature has been dropped in v4. Every Express route, worker, cron job, frontend page, and Android component listed above has a direct v4 counterpart. The migration is purely additive: existing functionality is preserved in full, and new capabilities are layered on top without removing access to any existing workflow.

---

## New Capabilities (features added in v4, not present in v3)

- **HTTP/3 (QUIC)** — reduced latency for mobile clients on lossy links
- **SPIRE mTLS** — workload identity and mutual TLS for all inter-service calls
- **OPA authorisation** — fine-grained, policy-as-code access control across every service
- **Passkeys / WebAuthn** — phishing-resistant authentication for web and Android
- **Canary deployments** — traffic-split releases with automatic rollback on error budget breach
- **Multi-region active-active** — Citus global tables + NATS leaf nodes for geographic redundancy
- **CRDT incident notes** — conflict-free collaborative editing of incident records in real time
- **WarRoom WebRTC** — low-latency video/audio bridge for incident command teams
- **TFLite on-device ML** — driver behaviour scoring and anomaly detection running locally on CFO devices
- **RFC 3161 audit anchoring** — cryptographic timestamp receipts for document and event audit trails
- **GDPR erasure saga** — distributed, compensating-transaction workflow for right-to-erasure requests
- **Chaos Mesh experiments** — scheduled fault injection in staging to validate resilience targets
