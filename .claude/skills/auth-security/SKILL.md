---
name: auth-security
description: "MANDATORY when touching auth — three auth models (JWT, magic-link, portal token), RBAC role hierarchy, CSRF, device integrity, command signing, and idempotency."
triggers:
  - authentication
  - authorization
  - auth
  - token
  - JWT
  - login
  - role
  - permission
  - CSRF
  - device
  - command
  - security
  - middleware
related_skills:
  - multi-tenancy
  - guardian-system
  - portal-system
  - backend-patterns
---

# Auth & Security

## Purpose

Teaches the three authentication domains, role-based access control, CSRF protection, device integrity verification, and security middleware stack. Mandatory for any work involving authentication, authorization, or security-sensitive endpoints.

## When to Activate

Any work involving:
- Authentication or authorization logic
- Token handling (JWT, refresh, portal, API keys)
- Role checks or permission gates
- Device commands or integrity verification
- CSRF-sensitive endpoints
- New API routes (must choose correct auth middleware)

## Three Auth Models

### 1. Internal Users (JWT) — `backend/src/middleware/auth.js`

- Bearer token from `Authorization` header
- JWT verified with `JWT_SECRET`, 2-hour access token expiry
- Refresh: 30-day httpOnly cookie `sonalit_rt`, SHA-256 hashed in `refresh_tokens` table
- Token rotation: old refresh token deleted on use, new one issued
- Constant-time bcrypt comparison; dummy hash when user not found (prevents timing oracle)
- `req.user = { id, email, name, role, status, org_id }`

**Role hierarchy** (numeric levels):
```
admin: 4
dispatcher: 3
operator: 2
analyst: 1
cfo: 1
```

Valid roles for user creation: `admin`, `dispatcher`, `operator`, `analyst`, `driver`, `cfo`

`authorize(...roles)` checks `req.user.role` against the hierarchy — a user with a higher-level role can access lower-level endpoints.

### 2. Cargo Clients (Magic Link) — `backend/src/middleware/clientAuth.js`

- JWT from httpOnly cookie `sonalit_client` or Bearer header
- Uses `CLIENT_JWT_SECRET` (falls back to `JWT_SECRET`)
- Sets `req.client = { client_id, org_id, convoy_ids }`
- Flow: POST `/portal/auth/request-link` → email with magic link → POST `/portal/auth/verify` → session JWT
- Tables: `cargo_clients`, `client_magic_links`
- Email via Resend API (primary), nodemailer SMTP (fallback)

### 3. Portal Tokens (SHA-256 Bearer) — `backend/src/middleware/portalAuth.js`

- Raw Bearer token hashed with SHA-256, looked up in `portal_tokens`
- Sets `req.portal = { token_id, org_id, convoy_id, cargo_owner_ref }`
- Tokens have `expires_at` and `revoked_at` fields
- `last_used_at` updated on each use

## Frontend Auth Pattern

File: `apps/web/src/stores/auth.ts`

- Access token stored in a **module-scope variable only** — NEVER in localStorage, sessionStorage, or cookies
- Refresh via httpOnly cookie (automatic, no JS access)
- Token cleared on logout or tab close

File: `apps/web/src/lib/api.ts`

- Axios interceptor injects `Authorization: Bearer <token>` header
- CSRF header injected on mutating requests
- W3C traceparent propagation
- Auto-refresh on 401: queues requests, refreshes token, replays

## Security Middleware Stack

| Middleware | File | Purpose |
|-----------|------|---------|
| `authenticate` | `middleware/auth.js` | JWT verification, attaches `req.user` |
| `authorize(...roles)` | `middleware/auth.js` | Role-based access check |
| `attachOrgDb` | `utils/orgScopedDb.js` | Org-scoped DB (see multi-tenancy skill) |
| CSRF | `middleware/csrf.js` | Double-submit cookie pattern |
| `requireIdempotencyKey` | `middleware/idempotency.js` | Idempotency enforcement |
| `requireFreshIntegrity` | `middleware/requireFreshIntegrity.js` | Play Integrity verification |
| `auditLog(target)` | `middleware/audit.js` | Hash-chain audit trail |
| `requestId` | `middleware/requestId.js` | UUID v4 request tracing |

### CSRF Details

Cookie name: `__Host-csrf` (production) / `csrf` (development). Timing-safe comparison.

**CSRF skip prefixes** (no CSRF required):
- `/api/v1/auth/login`
- `/api/v1/portal/`
- `/api/v1/guardian/` (device auth, not browser)
- `/api/v1/webhooks/`
- `/api/v1/fuel/webhook/`
- `/health`, `/metrics`

### Audit Logging

Hash-chain tamper detection. SHA-256 chain per org. `SELECT ... FOR UPDATE` on latest row prevents chain splits under concurrency.

Columns: `table_name`, `record_id`, `action`, `old_data`, `new_data`, `user_id`, `org_id`, `hash`, `prev_hash`

### Idempotency

Header: `x-idempotency-key`. Table: `idempotency_keys` (24h TTL). Required on all state-mutating POST endpoints (shifts, fuel, claims, broadcasts, convoy creation).

### Device Integrity (Guardian)

Google Play Integrity API. Per-command age thresholds:
- WIPE: 5 minutes
- LOCKDOWN: 15 minutes
- UPDATE_PINS: 15 minutes
- Default: 60 minutes

Returns HTTP 412 and enqueues `REQUEST_INTEGRITY` command if stale.

### Command Signing

HMAC-SHA256 of canonical JSON. Format: `commandId:commandType:sha256(payload):issuedAt:expiresAt`. Uses `COMMAND_SIGNING_SECRET`.

## Rate Limits

- Global: 500/15min
- Auth login: 10/15min
- Auth refresh: 30/15min
- Guardian enroll: 5/15min
- Guardian panic: 5/min (keyed by device_id)
- Guardian heartbeat: 6/min
- Guardian location: 60/min

## Relevant Files

- `backend/src/middleware/auth.js` — JWT auth + RBAC
- `backend/src/middleware/clientAuth.js` — cargo client auth
- `backend/src/middleware/portalAuth.js` — portal token auth
- `backend/src/middleware/csrf.js` — CSRF protection
- `backend/src/middleware/audit.js` — audit logging
- `backend/src/middleware/idempotency.js` — idempotency keys
- `backend/src/middleware/requireFreshIntegrity.js` — Play Integrity
- `backend/src/utils/commandSigning.js` — HMAC command signing
- `apps/web/src/stores/auth.ts` — frontend auth store
- `apps/web/src/lib/api.ts` — Axios with auth interceptor

## Do

- Use `authenticate` on all API routes (except public/webhook)
- Use `authorize()` with appropriate roles
- Add `requireIdempotencyKey` on state-mutating POST endpoints
- Add `auditLog()` on operations that change important data
- Keep access tokens in module scope only (never localStorage)

## Don't

- Store tokens in localStorage or sessionStorage
- Skip CSRF on browser-facing mutating endpoints
- Use hardcoded role strings — use the `authorize()` middleware
- Skip idempotency on POST endpoints that create or mutate state
- Bypass integrity verification for Guardian commands
