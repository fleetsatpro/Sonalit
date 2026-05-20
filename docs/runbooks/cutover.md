# Sonalit v3 → v4 Live Production Cutover Runbook

**Version**: 1.0  
**Last reviewed**: 2026-05-20  
**Owner**: Platform SRE  
**Estimated window**: 90 minutes (T-30min to T+60min)  
**Rollback window**: 8 minutes  

---

## Overview

This runbook covers the live production cutover from Sonalit v3 (Node.js monolith, Socket.IO, BullMQ, PostgreSQL 14) to Sonalit v4 (12 microservices, NATS JetStream, TimescaleDB, Centrifugo). The procedure is designed to minimize downtime to a maintenance window of approximately 15 minutes while preserving full data integrity.

**Architecture delta summary**:

| Component | v3 | v4 |
|-----------|----|----|
| Backend | Node.js monolith | 12 microservices (Kubernetes) |
| Messaging | BullMQ (Redis) | NATS JetStream |
| Database | PostgreSQL 14 | TimescaleDB (PostgreSQL 15 extension) |
| Realtime | Socket.IO | Centrifugo 5.x |
| Service mesh | None | SPIRE/SPIFFE mTLS |
| Secrets | .env files | Vault Agent injection |
| GitOps | Manual kubectl | ArgoCD ApplicationSet |

---

## Pre-Cutover Checklist (T-72h to T-0)

Complete all items before declaring cutover ready. Sign off each item with initials and timestamp.

### T-72h: Staging Validation

- [ ] **Smoke tests green in staging** — run `npm run test:smoke --env staging` and confirm all 47 assertions pass. Screenshot Grafana dashboard showing zero error rate. _Signed: ___ at ____
- [ ] **Database migration dry-run complete** — execute migration scripts against a staging clone of production PostgreSQL 14 data. Confirm row counts match pre/post with `./scripts/validate-migration.sh --env staging`. _Signed: ___ at ____
- [ ] **Helm charts validated in staging cluster** — run `helm lint ./charts/*` and confirm `helm diff upgrade` produces expected diff against staging release. _Signed: ___ at ____
- [ ] **ArgoCD ApplicationSet synced** — verify `argocd app list --project sonalit-prod` shows all 12 apps `Synced` / `Healthy` in staging. _Signed: ___ at ____

### T-48h: Infrastructure Readiness

- [ ] **NATS JetStream streams created and verified** — confirm streams `TELEMETRY`, `EVENTS`, `COMMANDS`, `NOTIFICATIONS` exist and are replicated (R=3):
  ```bash
  nats stream ls --server nats://nats-prod.sonalit.internal:4222
  nats stream info TELEMETRY --server nats://nats-prod.sonalit.internal:4222
  ```
  All streams must show `Cluster.Leader` populated and `Replicas: 3`. _Signed: ___ at ____

- [ ] **TimescaleDB hypertables partitioned** — connect to TimescaleDB and confirm hypertables are chunked correctly:
  ```sql
  SELECT hypertable_name, num_chunks, compression_enabled
  FROM timescaledb_information.hypertables;
  ```
  Expect: `telemetry_events` with chunks, compression enabled. _Signed: ___ at ____

- [ ] **Centrifugo cluster healthy (3 replicas)** — verify all replicas are up and connected:
  ```bash
  kubectl get pods -n sonalit-prod -l app=centrifugo
  kubectl exec -n sonalit-prod deploy/centrifugo -- centrifugo admin api \
    --method server.info | jq '.result.node.num_clients'
  ```
  All 3 pods must be `Running`. _Signed: ___ at ____

- [ ] **SPIRE SVID rotation verified** — confirm SPIRE agent is issuing SVIDs to all workloads:
  ```bash
  kubectl exec -n spire deploy/spire-server -- \
    /opt/spire/bin/spire-server entry show | grep sonalit-prod
  ```
  All 12 service entries must show a valid SVID with expiry > 24h. _Signed: ___ at ____

- [ ] **Vault secret injection smoke test** — deploy a test pod with the Vault annotation and confirm secrets mount:
  ```bash
  kubectl run vault-test --image=curlimages/curl --restart=Never \
    --annotations='vault.hashicorp.com/agent-inject: "true"' \
    --annotations='vault.hashicorp.com/role: "sonalit-prod"' \
    -n sonalit-prod -- sleep 30
  kubectl exec -n sonalit-prod vault-test -- cat /vault/secrets/db-creds
  kubectl delete pod vault-test -n sonalit-prod
  ```
  _Signed: ___ at ____

### T-24h: Communication & Sign-off

- [ ] **Runbook reviewed by on-call SRE** — second SRE must read and sign this document. _Reviewed by: ___ at ____
- [ ] **Stakeholder comms sent** — maintenance window notification sent to #engineering, #product, and #customer-success Slack channels. Email notification sent to enterprise customers via status page. Template in `docs/comms/maintenance-window-template.md`. _Sent by: ___ at ____
- [ ] **On-call rotation confirmed** — two SREs available for the full window. DBA on standby. _Confirmed: ___ at ____
- [ ] **Rollback assets staged** — confirm v3 PostgreSQL 14 snapshot from T-24h is accessible and restorable in under 8 minutes. Test restore to a scratch cluster. _Signed: ___ at ____

### T-1h: Final Go/No-Go

- [ ] **Production v3 error rate < 0.1%** on Grafana dashboard `sonalit-v3-overview` for the past hour.
- [ ] **No active incidents** in PagerDuty.
- [ ] **All engineers acknowledged** in #sonalit-cutover Slack thread.
- [ ] **Go/No-Go call held** — synchronous call with Platform Lead, on-call SREs, DBA. Decision recorded in Slack thread.

---

## Cutover Procedure

> **Two SREs required**: Primary executes commands; secondary watches Grafana and calls abort if rollback criteria are met.

> **Communication**: Post each step completion to #sonalit-cutover with timestamp.

### T-30min: Enable Maintenance Mode on v3 Frontend

Swap nginx's default config to serve `maintenance.html` without downtime:

```bash
# Confirm the maintenance page asset is present
kubectl exec -n sonalit-v3 deploy/nginx-frontend -- ls /usr/share/nginx/html/maintenance.html

# Apply the maintenance ConfigMap (pre-staged at T-72h)
kubectl apply -f ./k8s/v3/maintenance-mode-configmap.yaml

# Rolling restart to pick up new config (zero-downtime)
kubectl rollout restart deployment/nginx-frontend -n sonalit-v3
kubectl rollout status deployment/nginx-frontend -n sonalit-v3 --timeout=120s

# Verify maintenance page is served
curl -sI https://app.sonalit.io/ | grep 'Sonalit-Maintenance'
# Expected: Sonalit-Maintenance: true
```

Post to #sonalit-cutover: "T-30min: Maintenance mode ENABLED."

### T-25min: Drain v3 BullMQ Queues

Wait for all in-flight jobs to complete before snapshotting the database.

```bash
# Check queue depths across all workers
kubectl exec -n sonalit-v3 deploy/worker -- \
  node -e "
    const Queue = require('bullmq').Queue;
    const redis = { host: process.env.REDIS_HOST, port: 6379 };
    const queues = ['telemetry', 'notifications', 'exports', 'webhooks'];
    Promise.all(queues.map(async name => {
      const q = new Queue(name, { connection: redis });
      const counts = await q.getJobCounts();
      console.log(name, JSON.stringify(counts));
      await q.close();
    }));
  "
```

Wait until all `active` and `waiting` counts are `0`. Repeat every 30 seconds. Do not proceed until queues are fully drained. If queues have not drained after 10 minutes, escalate to Platform Lead — do not force-proceed.

```bash
# Once drained, scale down workers to prevent new jobs from starting
kubectl scale deployment/worker -n sonalit-v3 --replicas=0
kubectl rollout status deployment/worker -n sonalit-v3 --timeout=60s
```

Post to #sonalit-cutover: "T-25min: BullMQ queues DRAINED and workers scaled down."

### T-20min: Snapshot v3 PostgreSQL

```bash
# Identify the primary pod
PG_PRIMARY=$(kubectl get pod -n sonalit-v3 -l role=primary \
  -o jsonpath='{.items[0].metadata.name}')
echo "Primary pod: $PG_PRIMARY"

# Run pg_dump to S3-compatible object store via envoy sidecar
kubectl exec -n sonalit-v3 $PG_PRIMARY -- \
  pg_dump \
    --host=localhost \
    --port=5432 \
    --username=sonalit \
    --dbname=sonalit_prod \
    --format=custom \
    --compress=9 \
    --file=/tmp/sonalit-v3-cutover-$(date +%Y%m%d-%H%M%S).dump \
    --verbose

# Upload snapshot to S3
kubectl exec -n sonalit-v3 $PG_PRIMARY -- \
  aws s3 cp /tmp/sonalit-v3-cutover-*.dump \
    s3://sonalit-backups/cutover/v3/ \
    --sse aws:kms \
    --storage-class STANDARD_IA

# Verify upload
aws s3 ls s3://sonalit-backups/cutover/v3/ --human-readable
```

Record the exact snapshot filename in the Slack thread for rollback reference.

Post to #sonalit-cutover: "T-20min: PostgreSQL snapshot COMPLETE. File: sonalit-v3-cutover-YYYYMMDD-HHMMSS.dump"

### T-15min: Run v4 Migrations

```bash
# auth-svc migrations (user accounts, sessions, tokens)
kubectl exec -n sonalit-prod deploy/auth-svc -- \
  node dist/db/migrate.js --direction up --verbose
# Expected output: "Migration complete: 12 up, 0 skipped"

# fleet-svc migrations (assets, devices, groups)
kubectl exec -n sonalit-prod deploy/fleet-svc -- \
  node dist/db/migrate.js --direction up --verbose

# telemetry-ingest-svc hypertable seed
kubectl exec -n sonalit-prod deploy/telemetry-ingest-svc -- \
  node dist/db/seed-hypertables.js --env production

# Verify hypertable chunk count
kubectl exec -n sonalit-prod deploy/telemetry-ingest-svc -- \
  psql $TIMESCALE_URL -c \
  "SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;"

# Validate row counts match v3 export
kubectl exec -n sonalit-prod deploy/auth-svc -- \
  node dist/db/validate-migration.js --compare-source $PG_V3_READONLY_URL
# Expected: "Row count delta: 0 across all tables"
```

If migration validation reports any delta > 0, **STOP** and escalate to DBA immediately.

Post to #sonalit-cutover: "T-15min: v4 migrations COMPLETE and validated."

### T-10min: Scale Up v4 Services

```bash
# Trigger ArgoCD sync for all sonalit-prod applications
argocd app sync --project sonalit-prod --timeout 300 --prune

# Watch sync progress
argocd app list --project sonalit-prod \
  --output wide \
  --watch

# Confirm all apps reach Synced/Healthy
argocd app wait --project sonalit-prod \
  --health --timeout 300
```

If any app fails to sync, check `argocd app logs <app-name>` and resolve before proceeding.

Post to #sonalit-cutover: "T-10min: v4 services scaled up via ArgoCD."

### T-5min: Validate v4 Health Checks

```bash
# Check all pods are Running
kubectl get pods -n sonalit-prod -o wide
# All 12 services must show STATUS=Running and RESTARTS=0 (or low baseline)

# Check readiness probes
kubectl get pods -n sonalit-prod \
  --field-selector=status.phase=Running \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'
# All must show: True

# Spot-check individual service health endpoints
for svc in auth-svc fleet-svc telemetry-ingest-svc guardian-svc \
           realtime-gateway-svc notification-svc billing-svc \
           config-svc audit-svc report-svc integrations-svc api-gateway-svc; do
  STATUS=$(kubectl exec -n sonalit-prod deploy/$svc -- \
    wget -qO- http://localhost:3000/healthz 2>/dev/null | jq -r '.status')
  echo "$svc: $STATUS"
done
# All must return: ok

# Verify NATS connectivity from services
kubectl exec -n sonalit-prod deploy/telemetry-ingest-svc -- \
  node dist/scripts/nats-ping.js
# Expected: "NATS JetStream: connected, streams: 4, consumers: 8"

# Verify Centrifugo is accepting connections
kubectl exec -n sonalit-prod deploy/centrifugo -- \
  centrifugo admin api --method server.info | jq '.result.node'
```

**GO / NO-GO decision point.** If any service is not healthy, do not update DNS. Escalate immediately.

Post to #sonalit-cutover: "T-5min: Health checks PASS. Proceeding to DNS cutover."

### T-0: Update DNS / Ingress to v4

```bash
# Patch the Ingress to route traffic to v4 api-gateway-svc
kubectl patch ingress sonalit-prod-ingress -n sonalit-prod \
  --type='json' \
  -p='[{
    "op": "replace",
    "path": "/spec/rules/0/http/paths/0/backend/service/name",
    "value": "api-gateway-svc"
  },{
    "op": "replace",
    "path": "/spec/rules/0/http/paths/0/backend/service/port/number",
    "value": 8080
  }]'

# Confirm ingress controller has picked up the change
kubectl describe ingress sonalit-prod-ingress -n sonalit-prod \
  | grep -A5 "Rules:"

# If using external-dns, verify the annotation is correct
kubectl annotate ingress sonalit-prod-ingress -n sonalit-prod \
  external-dns.alpha.kubernetes.io/target="v4.sonalit.io" \
  --overwrite

# Verify DNS propagation (may take up to 60s depending on TTL)
watch -n5 "dig +short api.sonalit.io"
# Wait until the new IP address is returned consistently
```

Post to #sonalit-cutover: "T+0: DNS cutover COMPLETE. Traffic routing to v4."

### T+5min: Smoke Tests Against v4 Production

```bash
# Run automated smoke suite against production
npm run test:smoke --env production --timeout 60000

# Manual spot checks
# 1. Auth flow
curl -X POST https://api.sonalit.io/v4/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoketest@sonalit.io","password":"'$SMOKE_PASSWORD'"}' \
  | jq '{token: .access_token, user_id: .user.id}'

# 2. Telemetry ingest
curl -X POST https://api.sonalit.io/v4/telemetry/ingest \
  -H 'Authorization: Bearer '$SMOKE_TOKEN \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"smoke-device-001","timestamp":"'$(date -u +%FT%TZ)'","metrics":{"cpu":42.1}}' \
  | jq '.ingested'
# Expected: true

# 3. WebSocket via Centrifugo
node ./scripts/ws-smoke-test.js --endpoint wss://rt.sonalit.io/connection/websocket \
  --token $SMOKE_TOKEN
# Expected: "Connected. Channel subscribed. Message received in <200ms."
```

If any smoke test fails, initiate rollback immediately.

Post to #sonalit-cutover: "T+5min: Smoke tests PASS / FAIL (update accordingly)."

### T+15min: Enable v4 Frontend, Disable Maintenance Mode

```bash
# Update frontend ConfigMap to point to v4 API
kubectl apply -f ./k8s/v4/frontend-configmap.yaml

# Scale up v4 frontend (nginx serving v4 SPA)
kubectl scale deployment/nginx-frontend-v4 -n sonalit-prod --replicas=3
kubectl rollout status deployment/nginx-frontend-v4 -n sonalit-prod --timeout=120s

# Remove maintenance mode from v3 ingress (or simply update ingress to v4 frontend)
kubectl patch ingress sonalit-frontend-ingress -n sonalit-prod \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"nginx-frontend-v4"}]'

# Verify the live app loads v4
curl -s https://app.sonalit.io/ | grep 'data-version="4\.'
```

Post to #sonalit-cutover: "T+15min: v4 frontend LIVE. Maintenance mode DISABLED."

### T+30min: Monitor Error Rates and Latency

Open the following Grafana dashboards and watch for 30 minutes:

- **sonalit-v4-overview**: Overall error rate (target: < 0.1%), request rate
- **sonalit-v4-slo**: p50 / p95 / p99 latency per service
- **nats-jetstream**: Consumer lag per stream (target: 0 sustained)
- **timescaledb**: Write throughput, replication lag, WAL size
- **centrifugo**: Connected clients, channel subscriptions, message rate

Alert thresholds that trigger rollback:

| Metric | Rollback threshold |
|--------|--------------------|
| Error rate | > 1% for 5 consecutive minutes |
| p99 latency (any service) | > 2s for 5 consecutive minutes |
| NATS consumer lag | > 50,000 messages sustained > 2 min |
| TimescaleDB replication lag | > 30s |

If all metrics are green at T+30min, post to #sonalit-cutover: "T+30min: CUTOVER SUCCESSFUL. All metrics nominal."

---

## Rollback Procedure

### Decision Criteria

Initiate rollback immediately if ANY of the following occur:

- Error rate > 1% for 5 consecutive minutes (Grafana alert: `sonalit-v4-error-rate-critical`)
- p99 latency > 2s for 5 consecutive minutes on any user-facing service
- Complete loss of connectivity to TimescaleDB or NATS
- Data integrity check fails post-cutover
- On-call SRE judgment call — no further justification required

### Rollback Steps (target: complete within 8 minutes)

**Minute 0: Call Rollback**

Announce in #sonalit-cutover: "ROLLBACK INITIATED at [timestamp]. Reason: [reason]."

**Minute 1: Revert DNS / Ingress to v3**

```bash
# Revert API ingress to v3 monolith service
kubectl patch ingress sonalit-prod-ingress -n sonalit-prod \
  --type='json' \
  -p='[{
    "op": "replace",
    "path": "/spec/rules/0/http/paths/0/backend/service/name",
    "value": "sonalit-v3-monolith"
  },{
    "op": "replace",
    "path": "/spec/rules/0/http/paths/0/backend/service/port/number",
    "value": 3000
  }]'

# Revert frontend ingress
kubectl patch ingress sonalit-frontend-ingress -n sonalit-prod \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"nginx-frontend-v3"}]'

# Re-enable maintenance mode on v4 to prevent split traffic
kubectl apply -f ./k8s/v3/maintenance-mode-removal-configmap.yaml
kubectl rollout restart deployment/nginx-frontend -n sonalit-v3
```

**Minute 2: Scale Down v4 Services**

```bash
# Scale down all v4 deployments to prevent database conflicts
for app in $(argocd app list --project sonalit-prod -o name); do
  argocd app patch $app --patch '{"spec":{"syncPolicy":{"automated":null}}}' --type merge
done

kubectl scale deployment --all -n sonalit-prod --replicas=0
```

**Minute 3: Scale Up v3**

```bash
# Restore v3 worker replicas
kubectl scale deployment/worker -n sonalit-v3 --replicas=4
kubectl rollout status deployment/worker -n sonalit-v3 --timeout=120s

# Confirm v3 monolith is healthy
kubectl get pods -n sonalit-v3
curl -s https://api.sonalit.io/healthz | jq '.version'
# Expected: "3.x.x"
```

**Minute 4–5: Database Restore (only if data was written to TimescaleDB and is inconsistent)**

This step is only required if v4 services wrote data that corrupted or diverged from the v3 dataset. Consult DBA before proceeding.

```bash
# Stop all writes to TimescaleDB
kubectl exec -n sonalit-prod deploy/timescaledb-primary -- \
  psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='sonalit_prod' AND pid <> pg_backend_pid();"

# Restore from the snapshot taken at T-20min
SNAPSHOT_FILE=$(aws s3 ls s3://sonalit-backups/cutover/v3/ \
  --recursive | sort | tail -1 | awk '{print $NF}')
aws s3 cp s3://sonalit-backups/cutover/v3/$SNAPSHOT_FILE /tmp/rollback.dump

kubectl exec -n sonalit-v3 $PG_PRIMARY -- \
  pg_restore \
    --host=localhost \
    --username=sonalit \
    --dbname=sonalit_prod \
    --clean \
    --if-exists \
    --no-privileges \
    --no-owner \
    /tmp/rollback.dump
```

**Minute 6–7: Smoke Test v3**

```bash
npm run test:smoke --env production --suite v3 --timeout 60000
```

**Minute 8: Confirm Rollback Complete**

```bash
# Confirm traffic is on v3
curl -s https://api.sonalit.io/healthz | jq '.version'

# Remove maintenance mode from v3 frontend
kubectl apply -f ./k8s/v3/maintenance-mode-removal-configmap.yaml
```

Post to #sonalit-cutover: "ROLLBACK COMPLETE at [timestamp]. v3 is serving traffic. PagerDuty incident [ID] opened."

Schedule post-mortem within 24 hours.

---

## Post-Cutover Tasks (T+1h to T+24h)

### T+1h

- [ ] **Verify TimescaleDB continuous aggregates are populating** — connect to TimescaleDB and confirm:
  ```sql
  SELECT view_name, last_run_started_at, last_run_status
  FROM timescaledb_information.continuous_aggregate_stats;
  ```
  All views must show `last_run_status = 'Success'` within the past hour.

- [ ] **Confirm NATS consumer lag is zero** across all streams:
  ```bash
  nats consumer report --all \
    --server nats://nats-prod.sonalit.internal:4222
  ```
  `Num Pending` must be `0` for all consumers.

- [ ] **Check Centrifugo connection count matches expected active users** — compare Centrifugo `num_clients` against the expected active user count from v3 analytics. Acceptable variance: ±15% (reconnection in progress).

### T+2h

- [ ] **Run full integration test suite against prod**:
  ```bash
  npm run test:integration --env production --suite full
  ```
  Zero failures tolerated for P0 and P1 test cases.

### T+4h

- [ ] **Verify billing-svc has processed any queued events** — check for any DLQ messages in NATS `BILLING.dead-letter` stream.
- [ ] **Confirm audit-svc is logging to TimescaleDB** — spot-check audit trail for the cutover window.

### T+24h

- [ ] **Archive v3 deployment** — scale all v3 deployments to zero, keep namespace intact for 7 days:
  ```bash
  kubectl scale deployment --all -n sonalit-v3 --replicas=0
  kubectl annotate namespace sonalit-v3 \
    sonalit.io/archived-at="$(date -u +%FT%TZ)" \
    sonalit.io/purge-after="$(date -u -d '+7 days' +%F)"
  ```

- [ ] **Update status page** — mark maintenance complete, post summary to #engineering.
- [ ] **Close PagerDuty maintenance window**.
- [ ] **Schedule retrospective** within 5 business days.

---

## Contacts & Escalation

| Role | Contact | Channel |
|------|---------|---------|
| On-call SRE (primary) | PagerDuty rotation | #sonalit-oncall |
| On-call SRE (secondary) | PagerDuty rotation | #sonalit-oncall |
| DBA | @database-team | #database-team |
| Platform Lead | @platform-lead (direct message) | Direct |
| NATS/JetStream SME | @messaging-team | #platform-infra |
| TimescaleDB SME | @database-team | #database-team |
| Network/DNS | @netops | #netops |
| Customer Success (if user impact) | @cs-oncall | #customer-escalations |
| Executive sponsor | @vp-engineering (direct message) | Direct |

**Escalation path**: On-call SRE → Platform Lead → VP Engineering

If a rollback is initiated, open a PagerDuty incident immediately and page the Platform Lead regardless of time of day.
