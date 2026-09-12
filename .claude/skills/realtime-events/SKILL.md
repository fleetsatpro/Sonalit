---
name: realtime-events
description: Three event buses — NATS JetStream subjects, Centrifugo browser channels, BullMQ worker queues — plus the GPS processing pipeline.
triggers:
  - NATS
  - JetStream
  - Centrifugo
  - realtime
  - WebSocket
  - BullMQ
  - queue
  - GPS pipeline
  - worker
  - event
  - publish
  - subscribe
related_skills:
  - v4-service-patterns
  - backend-patterns
  - guardian-system
  - convoy-system
  - frontend-patterns
  - multi-tenancy
---

# Realtime Events

## Purpose

Teaches the three event transport layers and the GPS processing pipeline. Any feature that produces, consumes, or reacts to events MUST understand these patterns.

## When to Activate

Any work involving NATS, Centrifugo, BullMQ, GPS processing, realtime subscriptions, or event-driven features.

## Three Event Buses

### 1. NATS JetStream (v4 inter-service)

File: `packages/contracts/src/events/subjects.ts`

9 subject patterns with typed Zod payloads:

| Subject Pattern | Payload Schema | Purpose |
|-----------------|---------------|---------|
| `telemetry.gps.<orgId>.<deviceId>` | `GpsFixBatchSchema` | GPS telemetry batches |
| `events.panic.<orgId>` | `PanicRequestSchema` + org fields | Panic alerts |
| `events.alert.<orgId>` | `AlertSchema` | Alert creation |
| `events.geofence.breach.<orgId>` | — | Geofence breach events |
| `commands.<deviceId>` | `CommandSchema` | Device commands |
| `audit.<service>` | `AuditLogWriteSchema` | Audit log entries |
| `notifications.<channel>` | `NotificationEnvelopeSchema` | Notification fan-out |
| `convoy.updated.<orgId>` | `ConvoySchema` | Convoy mutations |
| `media.committed.<orgId>` | `CfoPhotoSchema` | Photo commits |

### JetStream Stream Configuration

7 streams defined in `STREAM_CONFIG`:

| Stream | Subjects | Retention | Storage |
|--------|----------|-----------|---------|
| TELEMETRY | `telemetry.gps.*.*` | 7 days | file |
| EVENTS | `events.*.*`, `events.*.*.>` | 30 days | file |
| COMMANDS | `commands.*` | 1 hour | memory |
| AUDIT | `audit.*` | 1 year | file |
| NOTIFICATIONS | `notifications.*` | 24 hours | file |
| CONVOY | `convoy.updated.*` | 90 days | file |
| MEDIA | `media.committed.*` | 90 days | file |

### 2. Centrifugo (browser realtime)

File: `backend/src/realtime/centrifugo.js`

Publishing: `publish(channel, data)` — HTTP call to Centrifugo server API.

Frontend client: `apps/web/src/lib/centrifuge.ts` — multiplexed subscriptions, one Subscription per channel, fan-out to multiple handler callbacks.

**Channel patterns:**

| Pattern | Purpose |
|---------|---------|
| `org#<orgId>` | All org events (GPS, panic, geofence, convoy, comms) |
| `portal#<convoyId>` | Portal live updates |
| `org:<orgId>:device:<deviceId>:telemetry` | Device-specific telemetry |

**CRITICAL**: The org channel carries ALL event types. Frontend handlers MUST filter by `data.type`:

```typescript
subscribe<GpsEvent>(`org#${orgId}`, (data) => {
  if (data.type === 'location') { /* handle GPS */ }
  if (data.type === 'panic') { /* handle panic */ }
});
```

Connection token: fetched from `/realtime/token` endpoint.

### 3. BullMQ + Redis (legacy backend)

File: `backend/src/config/queue.js`

7 queues with specific concurrency:

| Queue | Concurrency | Purpose |
|-------|------------|---------|
| `gps` | 10 | GPS fix processing |
| `alert` | 5 | Alert processing |
| `notification` | 3 | Notification delivery |
| `convoyReport` | 1 | Daily report PDF generation |
| `convoyArchive` | 1 | Convoy archive PDF |
| `device` | 1 | Device operations |
| `knox` | 1 | Knox remote sessions |

Default job options: 5 retries, exponential backoff (1s base), keep 1000 completed, never remove failed.

Worker files in `backend/src/workers/`:
- `gpsWorker.js` / `worker.gps.js`
- `alertWorker.js` / `worker.alert.js`
- `notificationWorker.js` / `worker.notification.js`
- `convoyReportWorker.js` / `worker.convoy-report.js`
- `worker.guardian.js`
- `worker.risk.js`

## GPS Processing Pipeline

File: `backend/src/workers/gpsWorker.js`

8-step pipeline for every GPS fix:

1. **Store** — insert into `gps_logs` (partitioned by month)
2. **Update vehicles** — update `vehicles` table with latest position
3. **Broadcast** — publish to Centrifugo `org#<orgId>` with `type: 'location'`
4. **Speed check** — compare against speed limits, create alert if exceeded
5. **Geofence evaluation** — run fix through `geofenceEngine.js`
6. **Corridor evaluation** — run fix through `corridor.js` for active convoys
7. **Smart geofence** — evaluate against smart geofences
8. **Driver behaviour** — score for hard braking, harsh acceleration, cornering, speeding, prolonged idle

## Cron Jobs

6 scheduled jobs in `backend/src/app.js`:

| Job | Interval | Purpose |
|-----|----------|---------|
| Partition roller | daily | Creates future month partitions for `gps_logs` |
| Command expiry | periodic | Expires stale device commands + nonce cleanup |
| DMS monitor | periodic | Dead Man's Switch check for overdue checkins |
| EOD finalization | 15 min | Queues convoy daily report generation |
| CDS Intelligence | 15 min | AI operations monitoring |
| OSINT sweep | configurable | Risk intel from 7 external sources |

## Relevant Files

- `packages/contracts/src/events/subjects.ts` — NATS subjects, typed payloads, stream configs
- `backend/src/realtime/centrifugo.js` — Centrifugo publish
- `apps/web/src/lib/centrifuge.ts` — frontend Centrifugo client
- `backend/src/config/queue.js` — BullMQ queue setup
- `backend/src/workers/` — all 10 worker files
- `backend/src/workers/gpsWorker.js` — GPS 8-step pipeline
- `backend/src/utils/geofenceEngine.js` — geofence evaluation
- `backend/src/services/geofence/corridor.js` — corridor evaluation
- `apps/web/src/features/live-fleet/hooks/useLiveFleet.ts` — frontend realtime subscription example

## Do

- Import typed payloads from `@sonalit/contracts/events/subjects`
- Filter Centrifugo events by `data.type` on the frontend
- Use the correct concurrency for each BullMQ queue
- Follow the GPS pipeline order — steps have dependencies
- Publish convoy updates to both NATS `convoy.updated.<orgId>` and Centrifugo `org#<orgId>`

## Don't

- Subscribe to Centrifugo without filtering by event type
- Change BullMQ queue concurrency without understanding downstream effects
- Skip the broadcast step in GPS processing
- Mix NATS subjects between v4 services — each service owns its subjects
- Use BullMQ in v4 services — use NATS JetStream instead
