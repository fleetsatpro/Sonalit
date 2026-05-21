# REMEDIATION_BACKLOG.md

Tracks work items that are deferred, in-progress, or intentionally left outside the main
remediation phases (T0–T8). Each entry has a clear disposition.

---

## Active Backlog

| ID | Item | Status | Owner Phase | Notes |
|----|------|--------|-------------|-------|
| BL-001 | CSRF double-submit cookie protection | **DONE** | Appendix A | See `backend/src/middleware/csrf.js` + `apps/web/src/lib/csrf.ts` |
| BL-002 | Integration test: device integrity check | **DONE** | Appendix A | `backend/tests/integration/integrity.test.js` |
| BL-003 | Integration test: convoy transaction rollback | **DONE** | Appendix A | `backend/tests/integration/convoy-txn.test.js` |
| BL-004 | UpdateAvailableToast + SW update flow | **DONE** | Appendix A | `apps/web/src/components/UpdateAvailableToast.tsx` |
| BL-005 | OpenAPI generation script + CI drift check | **DONE** | Appendix A | `backend/scripts/generate-openapi.js` + CI step |
| BL-006 | ARCHITECTURE.md | **DONE** | Appendix A | `docs/ARCHITECTURE.md` |
| BL-007 | SECURITY.md | **DONE** | Appendix A | `docs/SECURITY.md` |
| BL-008 | RUNBOOK.md | **DONE** | Appendix A | `docs/RUNBOOK.md` |
| BL-009 | Playwright E2E specs (5) | **DONE** | Appendix A | `apps/web/tests/e2e/` |

---

## Legacy / Duplicate Code Audit

### `frontend/` — Legacy React/JSX frontend (v2.1)

**Disposition: DEFER — do not delete yet.**

This directory is the previous production frontend that was replaced by `apps/web/`. It is
not imported or referenced by any live code path. However, it contains `vercel.json` and
`public/sw.js` which may still be referenced by old Vercel deployments. Deleting it risks
breaking any user who has the old service worker cached. Recommended action:

1. Confirm that the `vercel.json` at the repo root (not `frontend/vercel.json`) is the
   active deployment config.
2. Serve a tombstone `sw.js` from `apps/web/public/sw.js` that unregisters the old worker.
3. After 30 days of confirmed clean deployment, delete `frontend/` in a separate PR.

Filed: do not delete in this PR.

---

### `backend/src/sonalit/` — Embedded legacy AI copilot (Vite + JSX inside backend/src)

**Disposition: DEFER — do not delete yet.**

This is a self-contained React app living inside `backend/src/`. It has its own
`package.json` and `vite.config.js`. The backend `Dockerfile` may serve its `dist/`
as static assets. Removing it without confirming the Dockerfile and Railway config would
break the deployed copilot UI. Recommended action:

1. Check `backend/Dockerfile` for `COPY src/sonalit` instructions.
2. If confirmed unused in production, delete in a follow-up PR after deploy verification.

Filed: do not delete in this PR.

---

### `mlos-copilot/` — Standalone AI copilot mini-app

**Disposition: DEFER — do not delete yet.**

A standalone Vite+JSX app with its own `package.json`. Not in `pnpm-workspace.yaml` and
not referenced by any build pipeline. Likely superseded by `services/ai-copilot-svc` and
the embedded copilot page in `apps/web`. Safe to delete once confirmed no live URL points
to a Vercel deployment of this directory.

Filed: do not delete in this PR.

---

### `sonalit-proxy/` — Vercel edge proxy for AI chat

**Disposition: DEFER — do not delete yet.**

A minimal Vercel serverless function (`api/chat.js`) that proxies AI chat requests. May
still be the active API route for a deployed Vercel frontend. Check Vercel project
settings before deleting.

Filed: do not delete in this PR.

---

### `guardian-agent/` — Original Kotlin/View-based Android app

**Disposition: DEFER — superseded by `apps/guardian-android/`.**

This is the original Android app using Fragment/View-based UI (Material 3 + ViewBinding).
`apps/guardian-android/` is the rewritten version using Jetpack Compose and Hilt DI. Both
compile to equivalent APKs. The `guardian-agent/` version produced the APK currently in
`backend/static/guardian-agent.apk`. Until `apps/guardian-android/` produces a signed
release APK via CI (`build-guardian-apk.yml`), keep this directory. Delete after the first
successful CI-produced APK replaces the static one.

Filed: do not delete in this PR.

---

### `guardian-agent-apk/` — Raw Java APK source (pre-Kotlin, no Gradle)

**Disposition: DELETE candidate.**

This is a raw Java source directory with a hand-written `build.sh` — it predates the
Kotlin rewrite and has no Gradle build system. It cannot produce a signed APK without
significant manual intervention. No CI pipeline references it. It is safe to delete.
However, it is preserved here pending sign-off from the mobile team that no institutional
knowledge is lost (e.g. `SirenController.java`, `DmsAlarmReceiver.java` custom hardware
integrations).

Action: Delete in a follow-up PR after mobile team sign-off.

---

### `backend/scripts/migrate-guardian-p*.js` — Guardian ad-hoc migration scripts (18 files)

**Disposition: SUPERSEDED by numbered SQL migrations.**

The 18 `migrate-guardian-p*.js` scripts in `backend/scripts/` were written before the
`backend/migrations/` directory and `db-migrate.js` runner existed. Their DDL is a subset
of what the numbered SQL migrations apply. They remain in `migrate-all.js` for historical
compatibility on existing deployments that have already run them.

Action: Once all production databases have been confirmed to have `schema_migrations` table
(i.e. `db-migrate.js` has run at least once), remove these scripts from `migrate-all.js`
and delete the files. File a ticket to track this.

---

### Legacy Python deploy scripts (`frontend/deploy_*.py`, `fleetops_full_repair.py`)

**Disposition: DELETE candidate.**

Files: `frontend/deploy_enterprise.py`, `frontend/deploy_layout.py`, `frontend/deploy_v2.py`,
`frontend/deploy_v3_pages.py`, `frontend/deploy_v4.py`, `frontend/fix_ai.py`,
`frontend/fix_gps_ai_final.py`, `fleetops_full_repair.py`, `.github/fix_all_1.py`.

These are one-off Python scripts used during early development to patch deployed files
directly. They reference Vercel project IDs and write raw HTML/JS to deployment APIs.
None are referenced by CI. Safe to delete; kept only until confirmed no active Vercel
deployments depend on these scripts being discoverable.

---

## Completed Items (non-backlog phases)

All T0–T8 tasks are committed to `claude/sonalit-remediation-qAnLk`. See git log for details.
