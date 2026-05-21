# Runbook

## Health Check

```bash
curl https://api.sonalit.io/health
# {"status":"ok","database":"ok","redis":"ok","partitions_ok":true,...}
```

Returns 200 when healthy, 503 when database is unreachable or a partition is missing.

## Deployment

### Backend (Railway)

1. Push to `main` branch — Railway auto-deploys.
2. `predeploy` script runs `migrate-all.js` then `db-migrate.js` before the process starts.
3. Check Railway logs for `FleetOps Enterprise v2.1 running on port 5000`.

### Database Migrations

```bash
# Check pending migrations
npm run db:status

# Apply all pending migrations
npm run db:migrate
```

If a migration fails mid-deploy, Railway rolls back the service. Fix the SQL, push, re-deploy.

### Frontend (Vercel)

Push to `main` triggers a Vercel build. The Vite PWA plugin generates `sw.js`. After deploy, users with old service workers see the `UpdateAvailableToast` and must click **Update** to activate the new SW.

## Environment Variables

See `backend/.env.example` for the full list. Critical variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes (prod) | BullMQ + rate-limit state |
| `JWT_SECRET` | Yes | Min 32 bytes; generated randomly if absent (breaks sessions on restart) |
| `CENTRIFUGO_API_URL` | Yes (real-time) | e.g. `https://rt.sonalit.io` |
| `CENTRIFUGO_API_KEY` | Yes (real-time) | HTTP API key for publish |
| `CENTRIFUGO_TOKEN_HMAC_SECRET` | Yes (real-time) | WS connection JWT signing key |
| `IMEI_PEPPER` | Yes | GDPR; never rotate without hash backfill |

## Workers

Workers are separate Railway services, one per entrypoint:

| Service | Entrypoint | Command |
|---------|-----------|---------|
| GPS Worker | `src/workers/worker.gps.js` | `npm run worker:gps` |
| Alert Worker | `src/workers/worker.alert.js` | `npm run worker:alert` |
| Notification Worker | `src/workers/worker.notification.js` | `npm run worker:notification` |
| Convoy Report Worker | `src/workers/worker.convoy-report.js` | `npm run worker:convoy-report` |

To check dead jobs:
```
GET /metrics   # Prometheus text format
# bullmq_dead_jobs{queue="gps-worker"} 0
```

## Incident Response

### Guardian Panic Alert

1. A panic event creates a row in `panic_events` and publishes to Centrifugo channel `org:{org_id}`.
2. Command centre users see the alert in the War Room (`/war-room`).
3. Acknowledge: `PATCH /api/v1/guardian/panics/:id/acknowledge`
4. Resolve: `PATCH /api/v1/guardian/panics/:id/resolve`
5. If FCM push fails silently, check `audit_logs` for `action = 'panic_alert_sent'`.

### Device Offline

A device is considered offline when `last_seen < NOW() - INTERVAL '5 minutes'`. The alert worker emits a `device:offline` event. Check `guardian_devices` table:
```sql
SELECT id, name, last_seen, status FROM guardian_devices
WHERE last_seen < NOW() - INTERVAL '10 minutes' AND deleted_at IS NULL;
```

### Queue Backlog

```sql
-- Count pending jobs (via Redis LLEN or BullMQ API)
-- Or check metrics endpoint for dead job counts
```

Restart the worker service in Railway. Jobs are persisted in Redis and will resume.

### Database Connection Exhaustion

The API uses a connection pool (`max: 20`, `statement_timeout: 30s`). If pool is exhausted:
1. Check `/health` for `database` status.
2. Look for long-running queries: `SELECT pid, state, query, now() - query_start FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;`
3. Terminate blocking queries if needed: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ...`

## Partition Maintenance

Partitions are rolled hourly (cron: `0 * * * *`). If a partition is missing:
```sql
SELECT ensure_future_partitions('gps_logs', 3);
SELECT ensure_future_partitions('audit_logs', 3);
SELECT ensure_future_partitions('outbox', 3);
```

Old partitions are dropped daily at 03:00 based on `partition_retention` table. Adjust retention:
```sql
UPDATE partition_retention SET retain_months = 24 WHERE table_name = 'gps_logs';
```

## OpenAPI Spec

Keep `backend/openapi.json` in sync when adding routes:
```bash
cd backend
node scripts/generate-openapi.js
git add openapi.json && git commit -m "chore: update OpenAPI spec"
```

CI will fail the `OpenAPI drift check` step if the committed spec is stale.

## Log Access

Logs are written to stdout in JSON format via Winston. Access via Railway Logs panel. Filter by level:
- `info` — normal operation
- `warn` — degraded conditions (missing env vars, optional feature failures)
- `error` — actionable errors
- `fatal` — uncaughtException / unhandledRejection (triggers shutdown)
