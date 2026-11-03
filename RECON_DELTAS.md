# RECON_DELTAS — Reality vs. Reference Document

Generated: 2026-05-21 (Phase 0 Reconnaissance)

---

## 1. Real-time stack — SPLIT/BROKEN (Critical)

**Reference says:** Centrifuge on both sides.
**Reality:** Backend uses **Socket.IO** with `@socket.io/redis-adapter`; frontend uses **Centrifuge** client pointed at `wss://rt.sonalit.io`. They are NEVER connected — the frontend Centrifuge client talks to a Centrifugo server that the backend does NOT publish to. All `io.emit(...)` calls in the backend reach Socket.IO only; the frontend never receives them.

**Files:** `backend/src/app.js` (Socket.IO init, redis adapter), `apps/web/src/lib/centrifuge.ts` (Centrifuge client only).

---

## 2. Dev proxy — WRONG port and path

**Reference says:** proxy `/api → localhost:5000`.
**Reality:** `apps/web/vite.config.ts` proxies `/v4 → http://localhost:4000`. Backend runs on port 5000 at `/api/v1`. Local dev login fails silently (proxied to the wrong place, no 404 shown).

**File:** `apps/web/vite.config.ts` line `server: { port: 3000, proxy: { '/v4': 'http://localhost:4000' } }`.

---

## 3. Auth token in localStorage — SECURITY (Critical)

**Reference says:** access token in memory, refresh token in httpOnly cookie.
**Reality:** `apps/web/src/stores/auth.ts` uses Zustand `persist` with `partialize: (s) => ({ token: s.token, user: s.user })` — **the JWT access token is persisted to localStorage**. The `/auth/refresh` endpoint reads `req.body.refresh_token` (body JSON), not a cookie. No httpOnly cookie is set anywhere.

**Files:** `apps/web/src/stores/auth.ts`, `backend/src/routes/auth.js` (refresh endpoint).

---

## 4. org_id NOT on core tables — MULTI-TENANCY GAP (Critical)

**Reference says:** org_id on every table, RLS enforced.
**Reality:** Core tables created in `backend/scripts/migrate.js` have **no org_id**: `users`, `vehicles`, `convoys` (added later by `migrate-guardian-cfo-p1.js` as nullable), `alerts`, `incidents`, `messages`, `gps_logs`, `sensor_logs`, `fuel_logs`, `audit_logs`. `org_id` was bolted on later with `DEFAULT '00000000-0000-0000-0000-000000000001'` (hardcoded fake UUID). No RLS policies exist anywhere.

**Files:** `backend/scripts/migrate.js`, `backend/scripts/migrate-enterprise.js`, `backend/scripts/migrate-guardian-p5t6.js`.

---

## 5. uncaughtException / unhandledRejection do NOT exit

**Reference says:** handlers must call `shutdown(1)` / `process.exit`.
**Reality:** Handlers only log the error, no process exit:
```js
process.on("uncaughtException",(err)=>{ try{ logger.error(...) }catch(_){ ... } });
```
The server continues running in an undefined state after an uncaught exception.

**File:** `backend/src/app.js` lines 3–10.

---

## 6. services/* have REAL code (not empty scaffolds)

**Reference says:** check if services are real or scaffolding.
**Reality:** All 12 services have real TypeScript source code (Fastify apps with full route handlers, migrations, Redis/NATS integration). They duplicate the backend monolith functionality. This is a structural conflict — the monolith and microservices coexist with overlapping responsibilities. Each service's `src/` has ~100–260 lines of actual implementation.

**Services:** auth-svc, fleet-svc, guardian-svc, telemetry-ingest-svc, alerts-svc, analytics-svc, convoy-svc, ai-copilot-svc, media-svc, notification-svc, reports-svc, realtime-gateway-svc.

---

## 7. No formal migration tool — ad-hoc scripts only

**Reference says:** `backend/migrations/` directory with numbered migrations.
**Reality:** No `backend/migrations/` directory. 27 ad-hoc `backend/scripts/migrate-*.js` files, each connecting directly to the pool. No tracking table. No rollback support. `migrate-all.js` calls them in sequence but has no idempotency guarantee beyond `CREATE TABLE IF NOT EXISTS`.

---

## 8. Workbox caches wrong URL pattern

**Reference says:** runtime cache should match `url.pathname.startsWith('/api/')`.
**Reality:** `apps/web/vite.config.ts` Workbox config caches `^https://api.sonalit.io/` — this will NEVER match in production (Vercel rewrites to Railway, requests are `/api/...` paths, not the Railway hostname). Offline API cache is effectively broken.

---

## 9. Guardian Command replay protection — MISSING

**Reference says:** every Command has `nonce: Ulid` and `issued_at: IsoDateTime`, signature covers nonce.
**Reality:** `packages/contracts/src/schemas/guardian.ts` `CommandSchema` has `issued_at` but NO `nonce`. No `guardian_command_nonces` table exists in any migration. No replay check in `backend/src/routes/guardian.js`.

---

## 10. Centrifuge token — WRONG token type

**Reference says:** dedicated Centrifugo JWT signed with `CENTRIFUGO_TOKEN_HMAC_SECRET`.
**Reality:** `apps/web/src/lib/centrifuge.ts` passes the user's app JWT directly as the Centrifuge connection token (`getToken: async () => useAuthStore.getState().token`). Centrifugo requires its own HMAC-signed token — the app JWT will be rejected unless the Centrifugo server is misconfigured to skip token verification.

---

## 11. Build: main chunk is 1003 KB (gzip 269 KB) — over 300 KB limit

`vendor` chunk is essentially empty (0.05 KB). All app code lands in `index-*.js` (1003 KB). The `manualChunks` config is present but `vendor: ['react', 'react-dom']` creates an empty chunk because React is tree-shaken into the router chunk. Map chunk is separate (correct).

---

## 12. Rate limit applied AFTER body parser

**Reference says:** rate limit must be BEFORE `express.json`.
**Reality:** `backend/src/app.js` order: `requestId → helmet → cors → express.json → morgan → rateLimit`. Rate limit is applied after body parsing, allowing large bodies to consume memory before being rate-limited.

---

## 13. auth middleware doesn't include org_id

`backend/src/middleware/auth.js` queries `SELECT id, email, name, role, status FROM users WHERE id = $1` — no `org_id` in the SELECT. `req.user.org_id` is always undefined, so any `WHERE org_id = $1` guard using it would silently filter with `NULL`.

---

## 14. No .env.example at repo root or backend/

Only `.env.example` files found in `mlos-copilot/` and `backend/src/sonalit/` (legacy nested app). No root-level or `backend/` level `.env.example`.

---

## 15. CI workflow is minimal — missing typecheck, lint, test, integration tests

`.github/workflows/node.js.yml` only runs `pnpm install` + build contracts + build web. No typecheck, lint, unit tests, integration tests, or migration steps.

---

## 16. pnpm -r typecheck FAILS

`services/analytics-svc` fails: missing `@types/pg`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/sdk-trace-node` type declarations.

---

## 17. pnpm -r lint FAILS

All packages fail: ESLint v9 expects flat config (`eslint.config.js`), packages use old `.eslintrc.*` format. The `packages/eslint-config/` provides `index.js`/`react.js`/`node.js` configs that are not compatible with ESLint v9 flat config system.

---

## 18. pnpm -r test FAILS

Most services have a test script that runs `pnpm test:unit && pnpm test:integration` but have no test files in `src/`. Vitest exits with code 1 on "no test files found". Only `packages/contracts`, `services/telemetry-ingest-svc`, and `backend/tests/cfo.test.js` have actual test files.

---

## 19. No docker-compose.dev.yml

No local development compose file. Dev requires external Postgres, Redis, Centrifugo instances.

---

## Summary of 5 most critical deltas

1. **Access token in localStorage** — XSS → account takeover. Refresh token in request body. (T1.2)
2. **Real-time stack is split** — Socket.IO backend + Centrifuge frontend = no real-time. (T2.1)
3. **org_id missing on core tables, no RLS** — full cross-tenant data exposure. (T1.1)
4. **uncaughtException/unhandledRejection don't exit** — server runs in undefined state. (T1.7)
5. **Dev proxy wrong** — cannot run the stack locally at all. (T2.2)
