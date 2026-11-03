# Sonalit v3 → v4 Migration Map

Every legacy artifact is listed with its v4 equivalent or documented reason for
consolidation. No legacy capability is dropped. This document must be updated before
any v4 code that replaces a v3 artifact is merged.

## Backend Routes → Services

| v3 Route | v3 File | v4 Service | v4 Route/Handler | Notes |
|----------|---------|------------|-----------------|-------|
| POST /auth/login | routes/auth.js | auth-svc | POST /v4/auth/login | WebAuthn primary; argon2id fallback |
| POST /auth/register | routes/auth.js | auth-svc | POST /v4/auth/register | HIBP password check added |
| POST /auth/refresh | routes/auth.js | auth-svc | POST /v4/auth/refresh | Refresh token rotation + reuse detection |
| GET /auth/me | routes/auth.js | auth-svc | GET /v4/auth/me | |
| PATCH /auth/me | routes/auth.js | auth-svc | PATCH /v4/auth/me | |
| POST /auth/api-keys | routes/apikeys.js | auth-svc | POST /v4/auth/api-keys | Scoped, argon2id, IP allowlist, expiry |
| GET/POST/PATCH/DELETE /vehicles | routes/vehicles (vehicleController) | fleet-svc | /v4/vehicles/* | OpenSearch index sync |
| GET/POST/PATCH/DELETE /drivers | routes/drivers.js | fleet-svc | /v4/drivers/* | |
| POST /gps | routes/gps.js | telemetry-ingest-svc | POST /v4/telemetry/batch | Batch 10–50, HTTP/3, dedup, NATS |
| GET /gps/track | routes/gps.js | fleet-svc | GET /v4/gps/track/:deviceId | TimescaleDB continuous aggregates |
| GET/POST/PATCH/DELETE /sensors | routes/sensors.js | fleet-svc | /v4/sensors/* | |
| GET/POST/PATCH/DELETE /geofences | routes/geofences.js | fleet-svc | /v4/geofences/* | |
| GET/POST/PATCH/DELETE /rules | routes/rules.js | alerts-svc | /v4/rules/* | |
| GET/POST/PATCH/DELETE /maintenance | routes/maintenance.js | fleet-svc | /v4/maintenance/* | |
| GET/POST/PATCH/DELETE /shipments | routes/shipments.js | fleet-svc | /v4/shipments/* | |
| GET/POST/PATCH/DELETE /convoys | routes/convoys.js | convoy-svc | /v4/convoys/* | |
| GET/POST/PATCH/DELETE /convoys/cfo | routes/convoys.js (convoysCfoController) | convoy-svc | /v4/convoys/cfo/* | |
| GET/POST/PATCH/DELETE /alerts | routes/alerts.js | alerts-svc | /v4/alerts/* | NATS fan-out |
| GET/POST/PATCH/DELETE /incidents | routes/incidents.js | alerts-svc | /v4/incidents/* | |
| GET/POST/PATCH/DELETE /messages | routes/messages.js | fleet-svc | /v4/messages/* | OpenSearch index |
| POST /panic | routes/guardian.js | guardian-svc | POST /v4/guardian/panic | Never rate-limited, NATS |
| GET /analytics | routes/analytics.js | analytics-svc | /v4/analytics/* | TimescaleDB + ClickHouse |
| POST /ai | routes/ai.js | ai-copilot-svc | POST /v4/ai/* | RAG, SSE streaming, circuit breaker |
| GET/POST /riskzones | routes/riskzones.js | fleet-svc | /v4/riskzones/* | H3 hex aggregation |
| POST /gdpr | routes/gdpr.js | auth-svc + fleet-svc | /v4/gdpr/* | Cascading erasure saga |
| GET/POST /finance | routes/finance.js | fleet-svc | /v4/finance/* | |
| GET/POST /apikeys | routes/apikeys.js | auth-svc | /v4/auth/api-keys/* | |
| GET/POST /webhooks | routes/webhooks.js | notification-svc | /v4/webhooks/* | Outbox pattern |
| GET/POST /documents | routes/documents.js | media-svc | /v4/documents/* | R2 + lifecycle |
| GET/POST /reports | routes/reports.js | reports-svc | /v4/reports/* | pdf-lib + Browserless |

## Guardian Routes → guardian-svc

| v3 Route | v4 Route | Notes |
|----------|----------|-------|
| POST /guardian/enroll | POST /v4/guardian/enroll | Play Integrity required, operator approval |
| POST /guardian/heartbeat | POST /v4/guardian/heartbeat | Command delivery, integrity age check |
| POST /guardian/location | POST /v4/telemetry/batch | Migrated to telemetry-ingest-svc |
| POST /guardian/panic | POST /v4/guardian/panic | NATS events.panic, never rate-limited |
| POST /guardian/report | POST /v4/guardian/report | |
| POST /guardian/ack-command | POST /v4/guardian/ack-command | |
| GET /guardian/cfo/context | GET /v4/guardian/cfo/context | guardian-svc |
| POST /guardian/cfo/login | POST /v4/guardian/cfo/login | Rate limited 5/15min/device |
| POST /guardian/cfo/photo-upload-url | POST /v4/media/photo-upload-url | media-svc, resumable S3 multipart |
| POST /guardian/cfo/photos | POST /v4/media/photos/commit | media-svc, outbox confirm |

## BullMQ Workers → NATS Consumers

| v3 Worker | v4 Service | v4 Mechanism | Notes |
|-----------|-----------|-------------|-------|
| gpsWorker | telemetry-ingest-svc | NATS JetStream consumer → TimescaleDB COPY | Batch 200ms/1000 rows |
| gpsWorker (geofence) | alerts-svc | NATS consumer telemetry.gps.* | Rules engine |
| gpsWorker (fan-out) | realtime-gateway-svc | NATS consumer → Centrifugo | device# channel |
| alertWorker | alerts-svc | NATS consumer events.alert.* | Idempotent |
| alertWorker (FCM) | notification-svc | NATS consumer + outbox relay | |
| alertWorker (email) | notification-svc | Outbox relay → Postmark/SES | |
| notificationWorker | notification-svc | NATS consumer notifications.* | Unified envelope |
| convoyReportWorker | reports-svc | NATS consumer media.committed.* | pdf-lib + Browserless |

## Cron Jobs → Kubernetes CronJobs

| v3 Cron | Schedule | v4 Service | v4 Mechanism |
|---------|----------|-----------|-------------|
| Partition roller | Daily 02:00 UTC | analytics-svc | K8s CronJob → TimescaleDB retain policy |
| Base64 photo backfill | Daily 03:00 UTC | media-svc | K8s CronJob → R2 migration batch |
| EOD report sweep | Every 15 min | reports-svc | K8s CronJob → convoy-svc API call |

## Android Screens / Components

| v3 Component | v4 Equivalent | Migration Notes |
|-------------|--------------|-----------------|
| EnrollmentActivity + EnrollmentViewModel | EnrollmentScreen (Compose) + EnrollmentViewModel | Play Integrity, operator approval flow |
| MainActivity + MainViewModel | MainActivity (single-activity Compose host) + MainViewModel | Bottom nav → NavigationSuiteScaffold |
| HomeFragment | HomeScreen (Compose) | Material 3, dynamic color |
| CfoSectionFragment | CfoScreen (Compose) | EncryptedSharedPreferences, Centrifugo |
| CfoPhotoActivity | CfoPhotoScreen (Compose) | Resumable multipart, Tink AEAD on disk |
| GuardianService | GuardianService (foreground, FOREGROUND_SERVICE_LOCATION type) | ActivityRecognition adaptive interval |
| PanicTileService | PanicTileService | + Wear OS tile + hardware combo + widget |
| HeartbeatWorker | HeartbeatWorker | FCM primary; WM fallback 5min/1min |
| SyncWorker | SyncWorker | Drains Room buffers + pending uploads |
| BootReceiver | BootReceiver | |
| GuardianDeviceAdminReceiver | GuardianDeviceAdminReceiver + DevicePolicyManager | Fully-managed + work-profile support |

## Data Models → Contracts

| v3 DTO / DB Table | v4 Schema Location | Notes |
|-------------------|--------------------|-------|
| EnrollRequest/Response | packages/contracts/src/schemas/guardian.ts | |
| HeartbeatRequest/Response | packages/contracts/src/schemas/guardian.ts | |
| LocationRequest | packages/contracts/src/schemas/telemetry.ts | Batch schema |
| PanicRequest/Response | packages/contracts/src/schemas/guardian.ts | |
| CfoLoginRequest/Response | packages/contracts/src/schemas/guardian.ts | |
| CfoContextData | packages/contracts/src/schemas/convoy.ts | |
| CfoTruckDto / CfoPhotoDto / CfoConvoyDto | packages/contracts/src/schemas/convoy.ts | |
| CommandDto | packages/contracts/src/schemas/guardian.ts | |
| guardian_devices table | guardian-svc DB: guardian_devices | + integrity_verdict, play_integrity_token |
| convoy_cfos table | convoy-svc DB: convoy_cfos | |
| cfo_photos table | media-svc DB: media_assets | Generalized |
| gps_fixes table | TimescaleDB: gps_fixes hypertable | |
| audit_logs | ClickHouse: audit_logs | Hash-chained |

## Frontend Pages

| v3 Page | v4 Route | v4 File | Notes |
|---------|----------|---------|-------|
| LoginPage | /login | apps/web/src/pages/Login.tsx | WebAuthn passkey UI |
| DashboardPage | / | apps/web/src/pages/Dashboard.tsx | TanStack Query |
| FleetPage | /fleet | apps/web/src/pages/Fleet.tsx | |
| GPSPage | /gps | apps/web/src/pages/GPS.tsx | MapLibre GL + deck.gl, Centrifugo |
| ConvoysPage | /convoys | apps/web/src/pages/Convoys.tsx | |
| CfoConvoyForm | /convoys/new /convoys/:id/edit | apps/web/src/pages/CfoConvoyForm.tsx | |
| DriversPage | /drivers | apps/web/src/pages/Drivers.tsx | |
| AlertsPage | /alerts | apps/web/src/pages/Alerts.tsx | |
| IncidentsPage | /incidents | apps/web/src/pages/Incidents.tsx | Yjs CRDT collaborative notes |
| IncidentCenterPage | /incident-center | apps/web/src/pages/IncidentCenter.tsx | WebRTC live video |
| PanicCenterPage | /panic-center | apps/web/src/pages/PanicCenter.tsx | |
| MessagesPage | /messages | apps/web/src/pages/Messages.tsx | |
| AnalyticsPage | /analytics | apps/web/src/pages/Analytics.tsx | Recharts |
| ReportsPage | /reports | apps/web/src/pages/Reports.tsx | |
| ShipmentsPage | /shipments | apps/web/src/pages/Shipments.tsx | |
| FinancePage | /finance | apps/web/src/pages/Finance.tsx | |
| MaintenancePage | /maintenance | apps/web/src/pages/Maintenance.tsx | |
| GeofencesPage | /geofences | apps/web/src/pages/Geofences.tsx | MapLibre draw tools |
| RiskIntelPage | /risk-intel | apps/web/src/pages/RiskIntel.tsx | H3 hex overlays |
| RulesPage | /rules | apps/web/src/pages/Rules.tsx | |
| FieldOfficersPage | /field-officers | apps/web/src/pages/FieldOfficers.tsx | |
| ExecutivePage | /executive | apps/web/src/pages/Executive.tsx | |
| DevicesPage | /devices | apps/web/src/pages/Devices.tsx | CFO linking inline |
| GuardianPage | /guardian | apps/web/src/pages/Guardian.tsx | |
| AIDecisionPage | /ai | apps/web/src/pages/AIDecision.tsx | SSE streaming |
| CopilotPage | /copilot | apps/web/src/pages/Copilot.tsx | RAG copilot |
| SettingsPage | /settings | apps/web/src/pages/Settings.tsx | |
| WarRoom (component) | embedded in IncidentCenter | apps/web/src/components/WarRoom.tsx | WebRTC + Centrifugo |

## Real-Time Events

| v3 Socket.IO event | v4 Centrifugo channel + event | Notes |
|--------------------|-------------------------------|-------|
| alert:new | org#{org_id} / alert.new | |
| device:location | device#{device_id} / location | |
| panic:triggered | org#{org_id} / panic.triggered | |
| command:issued | device#{device_id} / command | |
| convoy:updated | convoy#{convoy_id} / updated | |
| message:new | user#{user_id} / message | |
| incident:updated | org#{org_id} / incident.updated | |
| geofence:triggered | org#{org_id} / geofence.triggered | |

## Services Without a Direct v3 Counterpart (Net New in v4)

| v4 Service | Rationale |
|-----------|-----------|
| telemetry-ingest-svc | Separated from guardian-svc to scale hot path independently at 100k RPS |
| realtime-gateway-svc | Centrifugo replaces Socket.IO for history-enabled, horizontally scaled WS |
| media-svc | Resumable multipart upload, TFLite model delivery, R2 lifecycle centralized |
| analytics-svc | Dedicated service consuming TimescaleDB aggregates + ClickHouse fact tables |
