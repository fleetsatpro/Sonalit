# Offline-first & low-bandwidth field resilience

How Sonalit keeps working when the network does not, and how it reconciles when
the network comes back.

The guiding idea is that **the internet is an accelerator, not a dependency**.
A yard worker, a convoy officer or a driver should be able to do their job in a
dead zone; connectivity only determines how quickly the cloud catches up.

---

## 1. What was already there

The audit that preceded this work found a real, if narrow, offline story:

| Piece | Location | Verdict |
|---|---|---|
| Clamp/unclamp write queue | `apps/web/src/pages/field/offlineQueue.ts` | Works. localStorage, UUID doubling as `x-idempotency-key`, oldest-first drain, stops at the first retryable failure to preserve causal order. |
| Field read cache | `apps/web/src/pages/field/fieldCache.ts` | Works. localStorage, network-first, three queries. |
| Server idempotency | `backend/src/middleware/idempotency.js` + `idempotency_keys` table | Works for its purpose (see §5 for the gap). |
| GPS device buffer | `apps/web/src/pages/DriverTrack.tsx` | Ad-hoc localStorage buffer. |
| Guardian batch ingest | `POST /api/v1/guardian/location/batch` | Batched GPS already exists for the Android agent. |
| Dexie | `apps/web/src/lib/db.ts` | Declared two stores, **never used by anything**. |
| PWA shell caching | `vite.config.ts` VitePWA | App shell precached; `/api` GETs NetworkFirst for 300s. |
| `navigator.onLine` | 7 files | Each interpreted it differently and they did not agree. |

Nothing else in the app could function without a connection.

## 2. What this adds

```
                          CONNECTIVITY
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
           GOOD              POOR              NONE
             │                 │                 │
             ▼                 ▼                 ▼
           LIVE            DEGRADED            LOCAL
      full payloads    smaller pages,     local reads,
      realtime on      deferred media     outbox writes
             │                 │                 │
             └─────────────────┼─────────────────┘
                               │
                        NETWORK RETURNS
                               │
                               ▼
                            SYNCING
                    authorise → push → pull
                               │
                               ▼
                         RECONCILED
```

### Client (`apps/web/src/lib/offline/`)

| Module | Responsibility |
|---|---|
| `db.ts` | Dexie/IndexedDB schema v2: `entities`, `outbox`, `gps_buffer`, `conflicts`, `sync_meta`. Storage-pressure and persistence helpers. Per-user purge. |
| `connectivity.ts` | The single connectivity authority. `UNKNOWN / ONLINE / DEGRADED / OFFLINE / SYNCING`. |
| `capabilities.ts` | The Operation Capability Matrix — what may happen offline, and under what conditions. |
| `outbox.ts` | Durable transactional queue: six states, priority bands, dependencies, backoff. |
| `retryPolicy.ts` | Error classification and jittered exponential backoff. Pure functions. |
| `syncEngine.ts` | Pull/push orchestration, checkpoints, partial success. |
| `entities.ts` | Reads of the local mirror, always with freshness attached. |
| `qr.ts` | Decode → resolve → act, with the security boundary between them. |
| `gpsBuffer.ts` | Buffering plus adaptive sampling. |
| `flags.ts` | Per-surface feature flags. |
| `chaos.ts` | Connectivity simulator (non-production builds only). |
| `device.ts` | Stable device identity for attribution — never a credential. |
| `index.ts` | Lifecycle and the single public surface. |

UI: `apps/web/src/components/offline/SyncCenter.tsx` (`SyncCenter`, `ConnectivityChip`).

### Server (`backend/`)

| Piece | Responsibility |
|---|---|
| `migrations/20260904_090_offline_sync.sql` | `sync_devices`, `sync_operations`, `sync_conflicts`, `sync_change_log` + sequence, `revision` columns and triggers. |
| `src/sync/scope.js` | Role → replicable entity types. |
| `src/sync/changeFeed.js` | Incremental pull. |
| `src/sync/operations.js` | Claim-before-apply idempotent push. |
| `src/sync/handlers.js` | The operation registry. |
| `src/sync/retention.js` | Change-log and ledger pruning. |
| `src/routes/sync.js` | `/api/v1/sync/*`. |

---

## 3. Decision: Dexie, not RxDB

RxDB was the prompt's preferred candidate **conditional on there being no
adequate local store**. There is one.

Dexie is already a dependency, wraps IndexedDB, and provides everything needed:
durable persistence across process death, multi-store transactions, indexed
queries, versioned schemas with migration hooks, and hundreds of megabytes of
capacity. RxDB would add a large dependency plus an RxJS surface to obtain the
same storage — and a replication protocol Sonalit cannot use, because the
authority here is PostgreSQL behind an authenticated REST API with row-level
security, not a replication endpoint. Bending RxDB's protocol onto that means
writing this same pull/push logic anyway, with an extra layer underneath it.

**Decision: extend Dexie.** The unused `lib/db.ts` became `lib/offline/db.ts`,
with its two dead v1 stores carried forward so existing browsers upgrade
cleanly instead of throwing `VersionError`.

## 4. Operation Capability Matrix

The default is `ONLINE_REQUIRED`. An offline path around a control is a way to
defeat that control.

| Operation | Class | Notes |
|---|---|---|
| `cds_incident.create` | OFFLINE_ALLOWED | Append-only event |
| `cds_trip.observation` | OFFLINE_ALLOWED | Append-only note on the trip timeline |
| `gps.batch` | OFFLINE_ALLOWED | Telemetry |
| `cds_container.status_change` | OFFLINE_ALLOWED_WITH_RESTRICTIONS | Requires revision, synced copy, < 12h stale |
| `cds_container.clamp` / `.unclamp` | OFFLINE_ALLOWED_WITH_RESTRICTIONS | Replays the existing hardened route |
| `elock.command` | **ONLINE_REQUIRED** | A queued command is indistinguishable, to the person at the container, from a lock that opened |
| `cds_trip.complete_delivery` | **ONLINE_REQUIRED** | Starts custody/invoicing; only Sonalit can authorise it |
| `convoy.lifecycle_change` | **ONLINE_REQUIRED** | Affects every vehicle on the convoy |
| `admin.user_change` | **ONLINE_REQUIRED** | Permission changes are always live |

Note the pairing: a field worker **can** record that a delivery happened (an
observation) and **cannot** complete the delivery business transaction. Those
are different facts and the app says so.

Enforcement is in three places, on purpose: the matrix refuses before anything
is written locally, the server re-checks the role on every push, and RLS
enforces tenant isolation underneath both.

## 5. Idempotency: why a second mechanism exists

`backend/src/middleware/idempotency.js` caches a response **after** the handler
has run. That is right for a browser double-click, but it leaves a window: two
concurrent retries of the same key both find no cached response and both
execute.

A field device retries precisely when it does not know whether the first attempt
landed. A lost ACK on a 2G link is the normal case, not the exotic one — so that
window is exactly the one that matters, and a second execution means a second
trip, a second delivery, a second container movement.

`sync_operations` closes it by claiming **before** applying, in the same
transaction:

```
BEGIN
  INSERT INTO sync_operations (...) ON CONFLICT DO NOTHING   -- claim
  claim lost?  -> read the winner's recorded outcome, return it
  claim won?   -> run the handler, record the outcome
COMMIT
```

A concurrent duplicate blocks on the unique index until the first transaction
resolves, then either reads the committed outcome or wins the claim itself
(if the first rolled back). If the handler throws, the claim rolls back with it,
so a crash mid-flight leaves nothing to clean up and no permanently stuck row.

**The existing middleware is untouched** and still governs the routes it always
did. The clamp/unclamp path still uses it, via the outbox's `http` transport.

## 6. Sync protocol

```
POST /api/v1/sync/device       register, refresh authorisation, learn scope
GET  /api/v1/sync/pull         ?checkpoint=N&limit=200&entity_types=a,b
POST /api/v1/sync/push         { operations: [...] }
GET  /api/v1/sync/status       device position, open conflicts
GET  /api/v1/sync/conflicts    open conflicts
POST /api/v1/sync/conflicts/:id/resolve
GET  /api/v1/sync/devices      fleet device health (office roles)
GET  /api/v1/sync/ping         unauthenticated reachability probe
```

Headers: `x-sync-device`, `x-sync-schema`, `x-sync-platform`,
`x-sync-app-version`. Auth is `dualAuthenticate` — the same JWT or field
device+PIN as everywhere else. **No new authentication system.**

### Pull

The checkpoint is one integer: `sync_change_log.seq`, from a dedicated
sequence. Timestamps alone cannot drive a correct incremental pull — clock
skew, ties within a millisecond, and out-of-order commits all silently skip
records, and the failure mode is invisible (the device just never learns about
a container).

The log stores identity only. Bodies are materialised **at pull time** through
`req.db`, so RLS decides visibility on every pull: access revoked while a
device was offline takes effect immediately, and a row the caller can no longer
see is reported to the device as a delete.

Repeated changes to one entity collapse to a single row on the wire at the
latest revision — the biggest bandwidth win in the pull path.

### Push

Operations are sorted by `local_sequence` server-side, applied one transaction
each, and each returns its own outcome:

| Outcome | Meaning | Client action |
|---|---|---|
| `accepted` | Applied | ACKNOWLEDGED |
| `duplicate` | Already applied; result replayed | ACKNOWLEDGED |
| `rejected` | Will never succeed | FAILED_PERMANENT |
| `conflict` | Entity moved on | CONFLICT, local event preserved |
| `retryable` | Outcome unknown | FAILED_RETRYABLE, backoff |

`POST /sync/push` returns 200 whenever the *batch* was well-formed, even if
every operation in it was rejected. An HTTP status cannot express "seven
accepted, one duplicate, one conflict, one retryable" — and a client that reads
200 as "all accepted" is the exact bug this protocol prevents.

### Two transports, one outbox

- **`http`** — replay the original REST call with `x-idempotency-key`. Used for
  operations that already have a hardened route (clamp, unclamp). Their
  validation, authorisation and audit path is unchanged; the outbox only decides
  *when* the call happens.
- **`sync`** — batch through `/sync/push`. Used for operations that had no
  offline story and need conflict-aware transactional application.

This is the alternative to building a second server-side path that
re-implements clamp — which would be a second business-rule engine, the one
thing this layer must not become.

## 7. Conflict resolution

No blanket last-write-wins.

- **Append-only events** (incidents, observations, GPS) do not conflict. Two
  similar-looking field events may be two real occurrences; only the operation
  id deduplicates, never content.
- **State entities** use optimistic concurrency on `revision`, bumped by a
  `BEFORE UPDATE` trigger so routes that know nothing about sync still produce
  correct revisions.
- On a revision mismatch the server applies **nothing** and records the losing
  local event in `sync_conflicts` with the server snapshot beside it. The device
  mirrors it locally and the Sync Center says *"Needs review"*.
- Resolution is an office-role decision (`admin`/`dispatcher`/`operator`) and
  records who decided and when. It never silently replays the local operation.

The pull path complements this: a row with an unsent local change is **not**
overwritten by the server's version — the revision is taken so the conflict is
detectable, but the optimistic body stays until the queued operation resolves.

## 8. Time

Three timestamps, deliberately distinct:

- `client_created_at` — device-observed. Preserved end to end. An incident
  recorded in a dead zone keeps its real time, not the moment signal returned.
- `server_received_at` / `server_processed_at` — authoritative ordering.
- GPS `device_time` vs `server_time` — same split, same reason.

Device clocks are never trusted for authority, and never overwritten either.

## 9. Bandwidth priorities

| Band | Contents |
|---|---|
| P0 EMERGENCY | Panic, critical security/safety |
| P1 CRITICAL | Delivery, container, e-lock, convoy status, incidents |
| P2 TELEMETRY | GPS, vehicle telemetry, device health |
| P3 SUPPORTING | Notes, documents, photos |
| P4 BACKGROUND | Analytics, large reports |

The drain loop sorts on priority first, then `localSequence`. A photo can never
delay a panic; two operations on the same container can never swap places.

Degraded mode reduces bandwidth without disabling function: pull pages shrink
from 200 to 25, the sync interval widens from 60s to 180s, and probes stretch.

## 10. Security

- **Scope**: `sync/scope.js` maps role → replicable entity types. A yard agent
  gets bookings/containers/trips only; convoy data never reaches a yard tablet.
  An unrecognised role replicates **nothing** — a role added later must be
  granted offline access explicitly.
- **Never trust the client**: `org_id`, `user_id` and role come from `req.user`.
  The device id is honoured only for attribution and checkpoint bookkeeping.
- **Revocation**: every reconnect calls `/sync/device` before anything else. A
  403 there stops sync and tells the user; it is not retried as a transient
  failure. RLS re-evaluates on every pull, so a narrowed scope surfaces as
  deletes on the device.
- **Replay**: operation ids are UUIDs and are the ledger's primary key. A
  replayed operation returns the original result rather than re-applying.
- **Logout / user switch**: `purgeUserData` clears cached entities, GPS,
  conflicts and resolved outbox rows. **Unacknowledged operations are kept by
  default** — a token expiring mid-shift is not consent to discard somebody's
  work — and are invisible to the next user, who has a different `ownerUserId`.
- **Local storage** holds operational data already visible on screen. Access
  tokens stay in memory (`stores/auth.ts` T1.2); field session tokens stay in
  sessionStorage (`lib/fieldSession.ts`). Neither is written to IndexedDB.

## 11. Honest status language

| Internal state | Shown to the user |
|---|---|
| PENDING | Saved on device |
| SYNCING | Synchronising |
| ACKNOWLEDGED | Confirmed by Sonalit |
| FAILED_RETRYABLE | Waiting to retry |
| FAILED_PERMANENT | Not accepted by Sonalit |
| CONFLICT | Needs review |

"Delivered", "Confirmed" and "Completed" are reserved for things the server has
actually accepted. Cached data is never labelled LIVE — the Sync Center reports
realtime connectivity separately, because Centrifugo can die while REST is fine.

## 12. Retention

| Data | Window | Rule |
|---|---|---|
| `sync_change_log` | 30d (`SYNC_CHANGE_LOG_RETENTION_DAYS`) | A cursor index, not a record. A device behind the window re-bootstraps. |
| `sync_operations` | 180d (`SYNC_OPERATION_RETENTION_DAYS`) | Audit trail **and** the thing that makes a late retry idempotent. Never pruned while `claimed`. |
| `sync_conflicts` | never auto-pruned | Unresolved conflicts are work items. |
| Client outbox | 7d after ACK | Only ACKNOWLEDGED rows. |
| Client entities | 7d under pressure | Never rows backing an unsent operation. |
| GPS buffer | 20 000 fixes | Oldest dropped first — the only place anything is discarded on overflow, because telemetry is genuinely lower value than an operational event. |

**Retention cleanup is never the reason a shift's work disappears.**

## 13. Feature flags

`OFFLINE_MODE`, `OFFLINE_SYNC`, `LOW_BANDWIDTH_MODE` default **on** (with all
per-surface flags off, they only make the app honest about connectivity — no
write path changes). `OFFLINE_QR`, `OFFLINE_CDS`, `OFFLINE_GPS`, `OFFLINE_MAPS`
default **off**; each opens a specific offline write path and is earned per
surface on real devices.

Set via `VITE_<FLAG>` at build time, or per-device in localStorage in
non-production builds.

## 14. Chaos testing

`setChaosProfile(...)` in non-production builds: `offline`, `2g`, `3g`,
`high_latency`, `packet_loss`, `random_disconnect`, `api_down`,
`realtime_down`, `sync_failure`. Inert in production — the module
short-circuits on `import.meta.env.PROD`, so no localStorage tampering can
degrade a real user's connection.

## 15. Infrastructure — unchanged

| Component | Status |
|---|---|
| PostgreSQL | **PRESERVED** — still the sole server-side authority |
| Redis / BullMQ | **PRESERVED** — untouched |
| Centrifugo | **PRESERVED** — still the realtime transport; sync solves a different problem |
| Existing REST API | **PRESERVED** — additive routes only |
| Authentication | **PRESERVED** — JWT, field device+PIN, portal token all unchanged |
| RLS | **PRESERVED** — new tables carry `org_id` + policies |

No MQTT. No NATS added. No new microservice. No new database.

## 16. Known limitations

1. **The field clamp/unclamp queue was not migrated onto the new outbox.** It
   works, it is already idempotent, and it is security-sensitive; migrating it
   needs a client-side owner identity the field app does not currently expose
   (its session is device+PIN with no user id in the browser). It now shares the
   connectivity manager, which was the duplication that mattered. The migration
   path is the `http` transport, already built and used by the matrix entries
   for `cds_container.clamp` / `.unclamp`.
2. **Media queue is not implemented.** The outbox supports dependencies
   (`dependsOn`) and a SUPPORTING priority band, which is the scaffolding a
   media queue needs, but photo/video upload still goes through the existing
   paths. An incident's photo would currently upload eagerly rather than
   deferring behind bandwidth.
3. **Offline maps are not implemented.** `OFFLINE_MAPS` exists as a flag only.
   Tile caching needs a licensing decision before an implementation one.
4. **Background sync on Android is not wired.** The Capacitor shells wrap the
   hosted web app; sync runs while the WebView is alive. Android does not
   guarantee background execution, and promising it would be dishonest.
5. **`cds_trip`, `cds_incident` and `cds_geofence` pull their column list from
   `information_schema`** rather than an explicit allowlist, because those
   tables have drifted across migrations and a hard-coded list would break a
   pull on a deployment one migration behind. Binary columns and `org_id` are
   excluded. The other four types use explicit allowlists.
6. **No integration test against a live PostgreSQL.** The idempotency and
   conflict paths are covered by unit tests with a fake client that models the
   unique-key and rollback semantics; the triggers and RLS policies in the
   migration are not yet exercised by an automated test.
7. **`applyBatch` is sequential.** Correct for causal ordering, but a 50-item
   batch is 50 round trips to the database inside one request.

## 17. Deployment

1. `pnpm build:contracts` is not required — no contract schemas changed.
2. Run migrations: `node backend/scripts/db-migrate.js`. The migration is
   additive and idempotent (`IF NOT EXISTS` throughout); the rollback is at
   `backend/migrations/rollback/20260904_090_offline_sync_down.sql`.
3. Deploy the backend. `/api/v1/sync` is mounted before the pre-existing
   `/api/v1/sync` no-op so the legacy `frontend/public/sw.js` replay (which
   posts to the bare path) still gets the response it expects.
4. Deploy the web app. With the per-surface flags off, users with good
   connectivity see the app they had, plus honest connectivity status.
5. Enable `OFFLINE_QR` / `OFFLINE_CDS` / `OFFLINE_GPS` per surface once
   validated on real devices.

New environment variables (both optional, both defaulted):
`SYNC_CHANGE_LOG_RETENTION_DAYS`, `SYNC_OPERATION_RETENTION_DAYS`.
