# Security Controls

## Authentication

| Control | Implementation |
|---------|---------------|
| Access token | 15-min JWT; stored in Zustand memory only — never localStorage |
| Refresh token | httpOnly, Secure, SameSite=Strict cookie; rotated on each refresh |
| Device token | Per-device bearer JWT issued at enroll; used by Guardian Android |
| Password storage | bcryptjs with work factor 12 |

## CSRF Protection

Double-submit cookie pattern (`backend/src/middleware/csrf.js`):
- Server sets `__Host-csrf` cookie (SameSite=Strict, Secure, httpOnly=false) on every response.
- Frontend reads cookie and attaches `X-CSRF-Token` header on POST/PUT/PATCH/DELETE.
- Middleware validates header == cookie using `crypto.timingSafeEqual`.
- Exempt paths: `/api/v1/guardian/` (device token auth), `/api/v1/webhooks/` (external systems).

## IMEI / PII Handling

Raw IMEI is never persisted. At enrollment, the device supplies an IMEI; the backend computes `sha256(rawImei + IMEI_PEPPER)` and stores only `imei_hash`. `IMEI_PEPPER` must be set in the environment. If the pepper is rotated, the hash column must be backfilled.

## Multi-tenancy / Data Isolation

Every SQL query that touches user data must include an `org_id` filter. Row-level access is enforced by `withOrg(org_id, fn)` (`src/utils/orgScopedDb.js`) which sets `app.current_org_id` as a session parameter. Composite indexes `(org_id, …)` exist on all hot-path tables.

## Rate Limiting

| Endpoint | Window | Max |
|----------|--------|-----|
| All IPs (global) | 15 min | 500 |
| `/api/v1/auth/login` | 15 min | 10 |
| `/api/v1/auth/refresh` | 15 min | 30 |
| `/api/v1/guardian/devices/:id/command` | configurable | 10 |
| Guardian enroll | 15 min | 5 |
| Guardian panic | 1 min | 5 |

## Play Integrity Gating

Destructive commands (`WIPE`, `LOCKDOWN`, `UPDATE_PINS`) require a fresh Play Integrity verdict:
- `WIPE` — verdict must be ≤ 5 minutes old and equal `MEETS_DEVICE_INTEGRITY`.
- `LOCKDOWN`, `UPDATE_PINS` — verdict must be ≤ 15 minutes old.
- Stale or missing verdict → 412 + enqueues `REQUEST_INTEGRITY` command.

## Command Replay Protection

Every command carries a `nonce` (min 8 chars) and optional `issued_at`. The nonce is inserted into `guardian_command_nonces(device_id, nonce)` with a unique constraint; duplicate nonces return 409. An `issued_at` more than 5 minutes in the past or future returns 400.

## Idempotency

`POST` and `PATCH` requests may include `X-Idempotency-Key`. The `idempotency` middleware stores the response in `idempotency_keys(key, org_id, status_code, response)` with a 24-hour TTL. Replayed requests with the same key return the cached response without re-executing business logic.

## Transport Security

`helmet` is configured with:
- `strictTransportSecurity` (2-year `max-age`, includeSubDomains, preload)
- `contentSecurityPolicy` — `defaultSrc 'self'`; WebSocket to `wss://rt.sonalit.io` only
- No `X-Powered-By` header

## Secrets Management

All secrets are injected as Railway environment variables. See `backend/.env.example` for the full list. Required secrets:
- `JWT_SECRET` — HMAC signing key for user JWTs (min 32 bytes)
- `CENTRIFUGO_TOKEN_HMAC_SECRET` — signing key for Centrifugo connection JWTs
- `IMEI_PEPPER` — GDPR pepper for IMEI hashing (never rotate without a backfill)
- `GUARDIAN_CMD_SECRET` — HMAC key for command signatures

## Vulnerability Disclosure

See `SECURITY.md` at the repository root. Report security issues to the security team email in that file before public disclosure.
