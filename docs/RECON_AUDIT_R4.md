# RECON_AUDIT_R4 — Security & Correctness Audit

Date: 2026-05-21  
Branch: `claude/sonalit-remediation-qAnLk`  
Auditor: Automated reconnaissance pass

---

## 1. Raw `pool.query` / RLS Leak Analysis

**Verdict: ACCEPTABLE with known exemptions**

All production routes access the database exclusively via `req.db(orgId)`, which calls `orgScopedDb.withOrgDb()`. That helper executes `SET LOCAL app.current_org_id` inside a transaction, activating the `ENABLE ROW LEVEL SECURITY` policies on every table.

The following files use raw `pool.query` or `client.query` legitimately:

| File | Reason |
|------|--------|
| `backend/src/config/database.js` | Pool definition — expected |
| `backend/src/utils/orgScopedDb.js` | Sets `app.current_org_id`; is the boundary itself |
| `backend/src/middleware/audit.js` | Writes to `audit_logs` (cross-org audit table, not subject to org RLS) |
| `backend/src/controllers/convoysCfoController.js` | Multi-step transaction; org_id passed explicitly in every WHERE clause |
| `backend/src/routes/gdpr.js` | GDPR erasure — intentionally cross-org admin action, gated by admin role check |
| `backend/src/app.js` | Health check, partition health, CFO flag seed — none return user data |

**No unguarded RLS leak paths found in production route handlers.**

Action required: none.

---

## 2. CSRF Coverage

**Verdict: CORRECT**

`csrf` middleware (`backend/src/middleware/csrf`) is mounted globally at line 111 of `app.js`, after body parsing:

```
requestId → helmet → cors → cookieParser → globalRateLimit → perRouteLimits
→ express.json → responseEnvelope → express.urlencoded → csrf → morgan → routes
```

Safe methods (GET, HEAD, OPTIONS) pass through without token validation.  
Skipped path prefixes: `/api/v1/guardian/` (device-signed requests), `/api/v1/webhooks/`, `/health`, `/metrics`.

All state-mutating HTTP routes (POST/PUT/PATCH/DELETE) require a matching `X-CSRF-Token` header equal to the `csrf` cookie value, verified with `timingSafeEqual` to prevent timing attacks.

Action required: none.

---

## 3. Rate-Limit Ordering

**Verdict: CORRECT**

Global rate-limit (`500 req / 15 min`) is mounted **before** `express.json`, preventing large-body memory exhaustion on over-limit clients.

Tighter per-route limits:
- `/api/v1/auth/login`: 10 req / 15 min
- `/api/v1/auth/refresh`: 30 req / 15 min

Both per-route limiters are registered **before** body parsing and before route handlers.

Action required: none.

---

## 4. Content Security Policy

**Verdict: ADEQUATE — one open item**

Current directives (helmet CSP):

| Directive | Value | Notes |
|-----------|-------|-------|
| `default-src` | `'self'` | Restrictive baseline |
| `script-src` | `'self'` | No inline scripts, no CDN eval |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind requires this; acceptable |
| `connect-src` | `'self' wss://rt.sonalit.io https://api.anthropic.com https://*.sentry.io` | Correct |
| `img-src` | `'self' data: https://*.r2.cloudflarestorage.com ...` | OK |
| `worker-src` | `'self'` | Covers SW registration |

**Open item:** `frame-ancestors` is not set explicitly. Helmet defaults to `DENY` via `X-Frame-Options`, which is adequate, but explicitly setting `frame-ancestors 'none'` in CSP is recommended for browsers ignoring the legacy header.

Action: Low priority — add `frameAncestors: ["'none'"]` to helmet CSP config in the next maintenance window.

---

## 5. GDPR / IMEI Retention Cron

**Verdict: PARTIALLY IMPLEMENTED — gap identified**

IMEI hashing is correct: raw IMEI is never stored; `sha256(rawImei + IMEI_PEPPER)` is persisted.

The GDPR erasure route (`/api/v1/gdpr`) handles user deletion on-demand.

**Gap:** No automated retention cron runs to purge records beyond a configurable window. The `partition_retention` table holds `retain_months` per table, and `archiveOldPartitions()` drops old partitions — but this only covers time-partitioned tables (`gps_logs`, `audit_logs`, `outbox`). Non-partitioned PII tables (e.g. `users`, `drivers`, `vehicles`) have no automated scheduled purge.

Action: Add a scheduled cron (weekly, 04:00 UTC) that calls the GDPR erasure logic for users who have requested deletion and whose `deletion_requested_at` is older than 30 days. Track as BL-010.

---

## 6. Idempotency Key Coverage

**Verdict: CORRECT on critical mutation paths**

`requireIdempotencyKey` middleware is mounted on:

| Route file | Coverage |
|-----------|---------|
| `convoys.js` | Convoy create, assign, status change |
| `incidents.js` | Incident create |
| `guardian.js` | Panic events, field reports |
| `alerts.js` | Alert acknowledgement |

Keys are cached in `idempotency_keys` with a 24-hour TTL and are scoped by `org_id`, preventing cross-tenant key reuse.

**Note:** `vehicles.js` does not use idempotency keys. Vehicle creation is a low-frequency, admin-only action; the risk of duplicate creation is low but non-zero. Consider adding for completeness.

Action: Low priority — add idempotency to vehicle and driver creation routes.

---

## 7. BullMQ Retry Configuration

**Verdict: CORRECT**

Default queue options in `backend/src/config/queue.js`:
```js
attempts: 5,
backoff: { type: 'exponential', delay: 1000 },
```

GPS ingest overrides at job-add time in `routes/gps.js`:
```js
attempts: 3,
backoff: { type: 'exponential', delay: 2000 },
```

No `removeOnFail` is set globally, meaning failed jobs accumulate in the failed set and are visible in the Bull dashboard. This is correct for observability — failed jobs should be inspectable.

`removeOnComplete: { count: 200 }` is set for convoy report jobs to prevent unbounded growth.

Action required: none.

---

## 8. CORS Configuration

**Verdict: REQUIRES ATTENTION — open item**

```js
app.use(cors({ origin: true, credentials: true }));
```

`origin: true` reflects the request's `Origin` header back as the `Access-Control-Allow-Origin` value, effectively allowing any origin. Combined with `credentials: true`, this means any origin can make credentialed (cookie-bearing) requests to the API.

This is mitigated by:
- CSRF double-submit cookie protection on all mutation routes
- `HttpOnly` refresh token cookies (not readable by JS)
- The non-`HttpOnly` CSRF cookie being same-site `strict`

However, in production the origin allowlist should be restricted to known frontend domains.

Action: **Medium priority** — replace `origin: true` with an explicit allowlist:
```js
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5173'];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
```
Add `CORS_ORIGINS=https://app.sonalit.io` to the production environment. Track as BL-011.

---

## Summary

| Check | Status | Priority |
|-------|--------|----------|
| pool.query / RLS leaks | PASS | — |
| CSRF coverage | PASS | — |
| Rate-limit ordering | PASS | — |
| CSP directives | PASS (gap: frame-ancestors) | Low |
| GDPR retention cron | PARTIAL (no scheduled purge) | Medium — BL-010 |
| Idempotency coverage | PASS (gap: vehicles/drivers) | Low |
| BullMQ retry config | PASS | — |
| CORS origin | OPEN (origin: true) | Medium — BL-011 |
